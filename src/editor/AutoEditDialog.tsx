import { useEffect, useMemo, useRef, useState } from 'react';
import { Lock, Wand2, X } from 'lucide-react';
import { GhostButton, PrimaryButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { useMediaStore } from './mediaStore';
import { DEFAULT_CAPTION_STYLE, captionClipsFor, timelineDuration, uid, useTimelineStore, type Clip, type MediaClip, type Track } from './timelineStore';
import { getEnvelope } from './peaks';
import { offeredModels, speechModelFor, type CaptionSegment } from './captions';
import { getTranscript, type SpeechProgress } from './speechAnalysis';
import {
  AUTO_EDIT_PRESETS,
  SEAM_FADE,
  analyzeCuts,
  pieceCount,
  planCuts,
  rangesTotal,
  remapSegments,
  transcriptWords,
  type AnalysisMode,
  type AutoEditSettings,
  type CutAnalysis,
  type LoudnessStats,
  type TimedWord,
} from './autoEdit';
import { cls, MOD_KEY } from '../utils/format';

type Scope = { kind: 'selection' } | { kind: 'track'; trackId: string } | { kind: 'all' };
const scopeKey = (s: Scope): string => (s.kind === 'track' ? `track:${s.trackId}` : s.kind);
const parseScope = (k: string): Scope => (k.startsWith('track:') ? { kind: 'track', trackId: k.slice(6) } : k === 'selection' ? { kind: 'selection' } : { kind: 'all' });

function fmtSecs(s: number): string {
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;

const NO_ANALYSIS: CutAnalysis = { cuts: [], pauses: 0, fillers: 0, retakes: 0 };

export function AutoEditDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const media = useMediaStore((s) => s.media);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedIds = useTimelineStore((s) => s.selectedIds);
  const setCutPreview = useTimelineStore((s) => s.setCutPreview);

  const [presetId, setPresetId] = useState(AUTO_EDIT_PRESETS[0].id);
  const [settings, setSettings] = useState<AutoEditSettings>(AUTO_EDIT_PRESETS[0].settings);
  const [mode, setMode] = useState<AnalysisMode>('loudness');
  const [model, setModel] = useState(() => speechModelFor());
  const [captionsOn, setCaptionsOn] = useState(false);
  const preset = AUTO_EDIT_PRESETS.find((p) => p.id === presetId);
  const pick = (id: string): void => {
    const p = AUTO_EDIT_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setSettings(p.settings);
    if (p.mode) setMode(p.mode);
  };
  const patch = (p: Partial<AutoEditSettings>): void => {
    setPresetId('custom');
    setSettings((s) => ({ ...s, ...p }));
  };

  const mediaKind = useMemo(() => new Map(media.map((m) => [m.id, m.kind])), [media]);
  const audible = useMemo(
    () => clips.filter((c): c is MediaClip => c.type === 'media' && c.freezeAt == null && (mediaKind.get(c.mediaId) === 'video' || mediaKind.get(c.mediaId) === 'audio')),
    [clips, mediaKind],
  );
  const selectedAudible = useMemo(() => audible.filter((c) => selectedIds.includes(c.id)), [audible, selectedIds]);
  const trackOptions = useMemo(() => tracks.filter((t) => t.kind !== 'text' && audible.some((c) => c.trackId === t.id)), [tracks, audible]);

  const [scope, setScope] = useState<Scope>(() => {
    if (selectedAudible.length > 0) return { kind: 'selection' };
    const v = trackOptions.find((t) => t.kind === 'video') ?? trackOptions[0];
    return v ? { kind: 'track', trackId: v.id } : { kind: 'all' };
  });
  const scoped = useMemo(
    () => (scope.kind === 'selection' ? selectedAudible : scope.kind === 'track' ? audible.filter((c) => c.trackId === scope.trackId) : audible),
    [scope, audible, selectedAudible],
  );
  const wanted = useMemo(() => Array.from(new Set(scoped.map((c) => c.mediaId))), [scoped]);
  const wantedKey = wanted.join('|');

  const [envs, setEnvs] = useState<Map<string, Float32Array>>(() => new Map());
  const missingEnv = useMemo(() => wanted.filter((id) => !envs.has(id)), [wanted, envs]);
  const missingEnvKey = missingEnv.join('|');
  useEffect(() => {
    if (missingEnv.length === 0) return;
    let alive = true;
    const byId = new Map(media.map((m) => [m.id, m]));
    void Promise.all(
      missingEnv.map(async (id) => {
        const m = byId.get(id);
        return [id, m ? await getEnvelope(m) : new Float32Array(0)] as const;
      }),
    ).then((pairs) => {
      if (!alive) return;
      setEnvs((prev) => {
        const next = new Map(prev);
        for (const [id, env] of pairs) next.set(id, env);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [missingEnvKey]);
  const envsReady = missingEnv.length === 0;

  const [transcripts, setTranscripts] = useState<Map<string, CaptionSegment[]>>(() => new Map());
  const transcriptsRef = useRef(transcripts);
  const [speech, setSpeech] = useState<SpeechProgress | null>(null);
  useEffect(() => {
    transcriptsRef.current = new Map();
    setTranscripts(new Map());
  }, [model]);
  useEffect(() => {
    if (mode !== 'speech') return;
    const need = wanted.filter((id) => !transcriptsRef.current.has(id));
    if (need.length === 0) return;
    const abort = new AbortController();
    let alive = true;
    const byId = new Map(media.map((m) => [m.id, m]));
    void (async () => {
      try {
        for (const id of need) {
          const m = byId.get(id);
          if (!m) continue;
          const segs = await getTranscript(m, { model, signal: abort.signal, onProgress: (p) => alive && setSpeech(p) });
          if (!alive) return;
          transcriptsRef.current = new Map(transcriptsRef.current).set(id, segs);
          setTranscripts(transcriptsRef.current);
        }
      } catch (e) {
        if (alive && !abort.signal.aborted) {
          toast.error(`Speech analysis failed: ${(e as Error).message}`);
          setMode('loudness');
        }
      } finally {
        if (alive) setSpeech(null);
      }
    })();
    return () => {
      alive = false;
      abort.abort();
      setSpeech(null);
    };
  }, [mode, model, wantedKey]);
  const speechReady = wanted.every((id) => transcripts.has(id));

  const statsRef = useRef(new Map<string, LoudnessStats>());
  const voiceRef = useRef(new Map<string, number | null>());
  const analysis = useMemo<CutAnalysis>(() => {
    if (!envsReady || (mode === 'speech' && !speechReady)) return NO_ANALYSIS;
    const words = new Map<string, TimedWord[]>();
    return analyzeCuts({
      mode,
      clips: scoped,
      settings,
      envelope: (id) => envs.get(id),
      words: (id) => {
        if (!words.has(id)) {
          const segs = transcripts.get(id);
          if (segs) words.set(id, transcriptWords(segs));
        }
        return words.get(id);
      },
      statsCache: statsRef.current,
      voiceCache: voiceRef.current,
    });
  }, [mode, envsReady, speechReady, scoped, envs, transcripts, settings]);
  const { cuts } = analysis;

  useEffect(() => {
    setCutPreview(cuts);
  }, [cuts, setCutPreview]);
  useEffect(() => () => setCutPreview(null), [setCutPreview]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = timelineDuration(clips);
  const saved = rangesTotal(cuts);
  const locked = useMemo(() => new Set(tracks.filter((t) => t.locked).map((t) => t.id)), [tracks]);
  const punchIns = useMemo(() => {
    if (!settings.zoom || cuts.length === 0) return 0;
    let n = 0;
    for (const c of clips) {
      if (c.type !== 'media' || mediaKind.get(c.mediaId) !== 'video' || locked.has(c.trackId)) continue;
      n += Math.floor(pieceCount(c, cuts, settings.removePauses) / 2);
    }
    return n;
  }, [clips, mediaKind, locked, cuts, settings.zoom, settings.removePauses]);

  const analyzing = !envsReady || (mode === 'speech' && !speechReady);
  const canApply = !analyzing && cuts.length > 0;
  let summary: string;
  if (scoped.length === 0) summary = 'Nothing with audio in this scope.';
  else if (analyzing) summary = mode === 'speech' && envsReady ? 'Transcribing…' : 'Analyzing audio…';
  else if (cuts.length === 0) summary = mode === 'speech' ? 'Nothing to cut — no quiet gaps, fillers or retakes found. Try a smaller voice margin.' : 'No pauses found — raise the sensitivity or shorten the minimum pause.';
  else {
    const found = [plural(analysis.pauses, 'pause')];
    if (analysis.fillers > 0) found.push(plural(analysis.fillers, 'filler'));
    if (analysis.retakes > 0) found.push(plural(analysis.retakes, 'retake'));
    if (settings.zoom) found.push(plural(punchIns, 'punch-in'));
    summary = settings.removePauses
      ? `${found.join(' · ')} · removes ${fmtSecs(saved)} of ${fmtSecs(total)} (${Math.round((saved / Math.max(1e-9, total)) * 100)}%)`
      : `${found.join(' · ')} · nothing removed`;
  }

  const apply = (): void => {
    const st = useTimelineStore.getState();
    st.pause();
    const next = planCuts(st.clips, st.tracks, media, cuts, { remove: settings.removePauses, zoom: settings.zoom ? settings.zoomScale : null, seamFade: SEAM_FADE });
    let newTracks: Track[] | undefined;
    const extra: Clip[] = [];
    if (mode === 'speech' && captionsOn) {
      let track = st.tracks.find((t) => t.kind === 'text');
      if (!track) {
        track = { id: uid('tr'), kind: 'text', name: 'T1' };
        newTracks = [...st.tracks, track];
      }
      for (const id of wanted) {
        const segs = transcripts.get(id);
        if (!segs) continue;
        const pieces = next.filter((c): c is MediaClip => c.type === 'media' && c.mediaId === id);
        extra.push(...captionClipsFor(remapSegments(segs, pieces), DEFAULT_CAPTION_STYLE, track.id));
      }
    }
    st.commitClips([...next, ...extra], newTracks);
    const caps = extra.length > 0 ? ` Added ${plural(extra.length, 'caption')}.` : '';
    toast.success(
      settings.removePauses
        ? `Removed ${plural(cuts.length, 'cut')} (${fmtSecs(saved)}).${caps} ${MOD_KEY}+Z to undo.`
        : `Cut at ${plural(cuts.length, 'pause')}, added ${plural(punchIns, 'punch-in')}.${caps} ${MOD_KEY}+Z to undo.`,
    );
    onClose();
  };

  const determinate = !!speech && speech.ratio > 0 && speech.ratio < 1;
  return (
    <div className="absolute right-3 top-[72px] z-40 w-[400px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-5 shadow-krypt-card backdrop-blur-sm animate-fade-in">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
          <Wand2 className="h-5 w-5 text-krypt-purple" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold text-white">Auto edit</div>
          <div className="text-xs text-krypt-muted">Finds the dead air. Red bands on the timeline show what goes; Apply is one undo step.</div>
        </div>
        <button onClick={onClose} title="Close (Esc)" className="rounded-lg p-1 text-krypt-muted transition hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {AUTO_EDIT_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => pick(p.id)}
            className={cls(
              'rounded-lg px-2.5 py-1 text-xs font-semibold transition',
              presetId === p.id ? 'bg-krypt-purple/25 text-white ring-1 ring-krypt-purple/60' : 'bg-white/5 text-krypt-muted hover:text-white',
            )}
          >
            {p.label}
          </button>
        ))}
        {presetId === 'custom' && <span className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white">Custom</span>}
      </div>
      <div className="mt-2 min-h-[2rem] text-xs text-krypt-muted">{preset?.hint ?? 'Your own mix of the settings below.'}</div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-1 text-xs text-krypt-muted">Listen to</div>
          <select
            value={scopeKey(scope)}
            onChange={(e) => setScope(parseScope(e.target.value))}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60"
          >
            <option value="selection" disabled={selectedAudible.length === 0}>
              Selected clips{selectedAudible.length > 0 ? ` (${selectedAudible.length})` : ''}
            </option>
            {trackOptions.map((t) => (
              <option key={t.id} value={`track:${t.id}`}>
                Track {t.name} · {plural(audible.filter((c) => c.trackId === t.id).length, 'clip')}
              </option>
            ))}
            <option value="all">All audio (only where everything is quiet)</option>
          </select>
        </div>
        <div>
          <div className="mb-1 text-xs text-krypt-muted">Detect by</div>
          <div className="flex overflow-hidden rounded-lg border border-white/10">
            {(
              [
                ['loudness', 'Loudness'],
                ['speech', 'Speech (AI)'],
              ] as Array<[AnalysisMode, string]>
            ).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                title={m === 'speech' ? 'Transcribe with Whisper on your device: game audio and music no longer count as talking' : 'Instant: quiet stretches of the waveform'}
                className={cls('flex-1 px-2 py-1.5 text-xs font-semibold transition', mode === m ? 'bg-krypt-purple/25 text-white' : 'bg-white/5 text-krypt-muted hover:text-white')}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {mode === 'speech' && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <div className="flex items-center gap-2">
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!!speech}
              className="flex-1 rounded-lg border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50"
            >
              {offeredModels().map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-krypt-muted">on-device · cached per clip</span>
          </div>
          <div className="mt-1.5 text-[11px] text-krypt-muted">Cuts a gap in the transcript only where the sound is also quieter than your voice, so words Whisper missed stay in.</div>
          {speech && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[11px] text-krypt-muted">
                <span className="truncate">{speech.status}</span>
                {determinate && <span className="font-mono text-white">{Math.round(speech.ratio * 100)}%</span>}
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                {determinate ? <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${Math.round(speech.ratio * 100)}%` }} /> : <div className="h-full w-full animate-pulse bg-krypt-gradient" />}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2.5">
        {mode === 'loudness' ? (
          <Dial label="Sensitivity" value={settings.sensitivityDb} min={4} max={24} step={1} fmt={(v) => `${v} dB over the floor`} onChange={(v) => patch({ sensitivityDb: v })} />
        ) : (
          <Dial label="Voice margin" value={settings.sensitivityDb} min={3} max={24} step={1} fmt={(v) => `${v} dB quieter than you`} onChange={(v) => patch({ sensitivityDb: v })} />
        )}
        <Dial label="Minimum pause" value={settings.minPause} min={0.2} max={3} step={0.1} fmt={(v) => `${v.toFixed(1)}s`} onChange={(v) => patch({ minPause: v })} />
        <Dial
          label="Padding"
          value={settings.padAfter}
          min={0}
          max={0.6}
          step={0.02}
          fmt={(v) => `${Math.round(v * 1000)} ms`}
          onChange={(v) => patch({ padAfter: v, padBefore: +(v * 0.4).toFixed(3) })}
        />
      </div>

      <div className="mt-3 space-y-2">
        <Check
          checked={settings.removePauses}
          onChange={(v) => patch({ removePauses: v })}
          label="Remove what it finds"
          hint={settings.removePauses ? 'ripples every unlocked track' : 'off: only cut there, for zooms'}
        />
        {mode === 'speech' && (
          <>
            <Check checked={settings.fillers} onChange={(v) => patch({ fillers: v })} label="Remove filler words" hint="um, uh, erm… (the ones Whisper wrote down)" disabled={!settings.removePauses} />
            <Check checked={settings.retakes} onChange={(v) => patch({ retakes: v })} label="Remove retakes" hint="a 5+ word phrase said again within 15s keeps only the last take" disabled={!settings.removePauses} />
            <Check checked={captionsOn} onChange={setCaptionsOn} label="Add captions" hint="from the same transcript, in the default caption style" />
          </>
        )}
        <Check checked={settings.zoom} onChange={(v) => patch({ zoom: v })} label="Punch-in zoom on cuts" hint="every other piece of a cut video clip zooms in" />
        {settings.zoom && (
          <Dial label="Zoom amount" value={settings.zoomScale} min={1.04} max={1.3} step={0.02} fmt={(v) => `${Math.round((v - 1) * 100)}%`} onChange={(v) => patch({ zoomScale: v })} />
        )}
      </div>

      <div className={cls('mt-4 rounded-lg border px-3 py-2 text-xs', canApply ? 'border-red-400/30 bg-red-500/10 text-white' : 'border-white/10 bg-black/20 text-krypt-muted')}>{summary}</div>
      {settings.removePauses && locked.size > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-amber-300/90">
          <Lock className="h-3 w-3" />
          Locked tracks stay put and may drift out of sync.
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton onClick={apply} disabled={!canApply}>
          <Wand2 className="h-4 w-4" />
          Apply
        </PrimaryButton>
      </div>
    </div>
  );
}

function Dial({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-krypt-muted">{label}</span>
        <span className="font-mono text-white/90">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full cursor-pointer accent-krypt-purple" />
    </div>
  );
}

function Check({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={cls('flex items-start gap-2 text-xs', disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-krypt-purple" />
      <span>
        <span className="font-semibold text-white">{label}</span>
        {hint && <span className="text-krypt-muted"> — {hint}</span>}
      </span>
    </label>
  );
}
