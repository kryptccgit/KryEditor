import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { MediaFile } from '@shared/types';
import { GhostButton, PrimaryButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { fmtTimecode } from '../utils/format';
import { useMediaStore } from './mediaStore';
import { defaultRevoiceMedia, loadRevoiceLines, runRevoice, type OriginalAudio, type RevoiceLine } from './revoice';
import { useTimelineStore } from './timelineStore';
import { TTS_VOICES, warmUpVoice } from './tts';
import { VoiceModelCard } from './VoiceModelCard';

const VOICES = TTS_VOICES.filter((v) => v.value.startsWith('kokoro:'));
const ORIGINAL: Array<{ value: OriginalAudio; label: string }> = [
  { value: 'mute', label: 'Mute it' },
  { value: 'lower', label: 'Lower it to 20% (keeps game sound and music)' },
  { value: 'keep', label: 'Keep it as is' },
];

export function RevoiceDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const allMedia = useMediaStore((s) => s.media);
  const clips = useTimelineStore((s) => s.clips);
  const sources = useMemo(() => {
    const onTimeline = new Set(clips.filter((c) => c.type === 'media').map((c) => (c as { mediaId: string }).mediaId));
    return allMedia.filter((m) => onTimeline.has(m.id) && (m.kind === 'video' || m.kind === 'audio') && !/^revoice-/.test(m.name));
  }, [allMedia, clips]);
  const [source, setSource] = useState<MediaFile | null>(() => defaultRevoiceMedia());
  const [lines, setLines] = useState<RevoiceLine[] | null>(null);
  const [voice, setVoice] = useState(VOICES[0].value);
  const [original, setOriginal] = useState<OriginalAudio>('mute');
  const [busy, setBusy] = useState<{ status: string; ratio: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => void warmUpVoice(), []);

  useEffect(() => {
    if (!source) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setLines(null);
    setError(null);
    setBusy({ status: 'Transcribing…', ratio: 0 });
    loadRevoiceLines(source, { signal: abort.signal, onProgress: (p) => setBusy({ status: p.status, ratio: p.ratio }) })
      .then((ls) => !abort.signal.aborted && setLines(ls))
      .catch((e) => !abort.signal.aborted && setError((e as Error).message))
      .finally(() => !abort.signal.aborted && setBusy(null));
    return () => abort.abort();
  }, [source]);

  const spoken = lines?.filter((l) => l.text.trim()).length ?? 0;

  const go = async (): Promise<void> => {
    if (!source || !lines) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setBusy({ status: 'Starting…', ratio: 0 });
    try {
      const r = await runRevoice({ media: source, lines, voice, original, signal: abort.signal, onProgress: (ratio, status) => setBusy({ ratio, status }) });
      const notes = [r.stretched ? `${r.stretched} sped up to fit` : '', r.moved ? `${r.moved} moved later` : ''].filter(Boolean).join(', ');
      toast.success(`Re-voiced ${r.lines} lines onto a new "Re-voice" track${notes ? ` (${notes})` : ''}. Undo reverts it.`);
      onClose();
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
      setBusy(null);
    }
  };

  const generating = busy !== null && lines !== null;
  const select = 'w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50';
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="flex max-h-[90%] w-[560px] flex-col rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <AudioLines className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Re-voice</div>
            <div className="text-xs text-krypt-muted">Replace the speech with an AI voice at the same timing. Edit any line first; clear a line to skip it.</div>
          </div>
        </div>

        {sources.length === 0 ? (
          <div className="text-sm text-krypt-muted">Put a video or audio clip with speech on the timeline first.</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <div className="mb-1 text-xs text-krypt-muted">Clip</div>
                <select value={source?.id ?? ''} disabled={generating} onChange={(e) => setSource(sources.find((m) => m.id === e.target.value) ?? null)} className={select}>
                  {!source && <option value="">Choose…</option>}
                  {sources.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-krypt-muted">Voice</div>
                <select value={voice} disabled={generating} onChange={(e) => setVoice(e.target.value)} className={select}>
                  {VOICES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <div className="mb-1 text-xs text-krypt-muted">Original audio</div>
                <select value={original} disabled={generating} onChange={(e) => setOriginal(e.target.value as OriginalAudio)} className={select}>
                  {ORIGINAL.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {!generating && <VoiceModelCard compact />}

            {lines && (
              <div className="mt-3 min-h-0 flex-1">
                <div className="mb-1 text-xs text-krypt-muted">
                  {spoken} of {lines.length} lines
                </div>
                <div className="max-h-[38vh] space-y-1 overflow-y-auto pr-1">
                  {lines.length === 0 && <div className="text-sm text-krypt-muted">No speech found in this clip.</div>}
                  {lines.map((l, i) => (
                    <div key={`${l.start}-${i}`} className="flex items-start gap-2">
                      <span className="w-16 flex-shrink-0 pt-1.5 font-mono text-[11px] text-krypt-muted">{fmtTimecode(l.start)}</span>
                      <textarea
                        value={l.text}
                        rows={Math.min(3, Math.max(1, Math.ceil(l.text.length / 60)))}
                        disabled={generating}
                        onChange={(e) => setLines((ls) => ls && ls.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
                        className="w-full resize-none rounded-md border border-white/10 bg-black/40 px-2 py-1 text-sm text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {busy && (
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-krypt-muted">
                  <span className="truncate">{busy.status}</span>
                  {busy.ratio > 0 && <span className="font-mono text-white">{Math.round(busy.ratio * 100)}%</span>}
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
                  {busy.ratio > 0 ? (
                    <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-krypt-gradient" />
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
          >
            Cancel
          </GhostButton>
          <PrimaryButton onClick={() => void go()} disabled={busy !== null || spoken === 0}>
            <AudioLines className="h-4 w-4" />
            Re-voice {spoken > 0 ? `${spoken} lines` : ''}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
