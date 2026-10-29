import { useMemo, useState } from 'react';
import { Volume1 } from 'lucide-react';
import { GhostButton, PrimaryButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { DUCK, defaultDuckTracks, runDucking } from './ducking';
import { useMediaStore } from './mediaStore';
import { useTimelineStore } from './timelineStore';

export function DuckDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const media = useMediaStore((s) => s.media);
  const kinds = useMemo(() => new Map(media.map((m) => [m.id, m.kind])), [media]);
  const names = useMemo(() => new Map(media.map((m) => [m.id, m.name])), [media]);
  const withSound = useMemo(
    () => tracks.filter((t) => clips.some((c) => c.trackId === t.id && c.type === 'media' && (kinds.get(c.mediaId) === 'video' || kinds.get(c.mediaId) === 'audio'))),
    [tracks, clips, kinds],
  );
  const defaults = useMemo(() => defaultDuckTracks(clips, tracks, kinds, names), [clips, tracks, kinds, names]);
  const [voice, setVoice] = useState<string | null>(defaults.voice);
  const [targets, setTargets] = useState<Set<string>>(() => new Set(defaults.targets));
  const [amount, setAmount] = useState(DUCK.amountDb);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = withSound.filter((t) => t.id !== voice && targets.has(t.id) && !t.locked);
  const go = async (): Promise<void> => {
    if (!voice) return;
    setBusy(true);
    setError(null);
    try {
      const r = await runDucking({ voiceTrack: voice, targetTracks: chosen.map((t) => t.id), amountDb: amount });
      toast.success(
        r.clips === 0
          ? 'No speech overlaps the other tracks, so nothing changed.'
          : `Ducked ${r.clips} clip${r.clips === 1 ? '' : 's'} by ${-amount} dB under ${r.spans} stretch${r.spans === 1 ? '' : 'es'} of speech (found by ${r.source === 'speech' ? 'the transcript' : 'loudness'}). Undo reverts it.`,
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const select = 'w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50';
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[440px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Volume1 className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Auto duck</div>
            <div className="text-xs text-krypt-muted">Lower the music and game sound whenever someone talks, and bring it back up in the pauses.</div>
          </div>
        </div>

        {withSound.length < 2 ? (
          <div className="text-sm text-krypt-muted">Ducking needs the voice and the music (or game audio) on separate tracks. Add music on its own audio track first.</div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1 text-xs text-krypt-muted">Voice track</div>
              <select value={voice ?? ''} disabled={busy} onChange={(e) => setVoice(e.target.value || null)} className={select}>
                {withSound.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-krypt-muted">If this clip has a transcript (from captions, auto edit or Transcript), only speech counts. Otherwise its loudness is used.</p>
            </div>
            <div>
              <div className="mb-1 text-xs text-krypt-muted">Lower these tracks</div>
              <div className="flex flex-wrap gap-1.5">
                {withSound
                  .filter((t) => t.id !== voice)
                  .map((t) => (
                    <label key={t.id} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-white/90" title={t.locked ? 'Locked tracks are left alone' : undefined}>
                      <input
                        type="checkbox"
                        disabled={busy || t.locked}
                        checked={targets.has(t.id) && !t.locked}
                        onChange={(e) =>
                          setTargets((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(t.id);
                            else next.delete(t.id);
                            return next;
                          })
                        }
                        className="accent-krypt-purple"
                      />
                      {t.name}
                    </label>
                  ))}
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-krypt-muted">
                <span>How much</span>
                <span className="font-mono text-white">{amount} dB</span>
              </div>
              <input type="range" min={-24} max={-4} step={1} value={amount} disabled={busy} onChange={(e) => setAmount(Number(e.target.value))} className="w-full accent-krypt-purple" />
              <div className="flex justify-between text-[10px] text-krypt-muted">
                <span>Almost silent</span>
                <span>A little</span>
              </div>
            </div>
          </div>
        )}

        {error && <div className="mt-3 text-xs text-red-400">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={() => void go()} disabled={busy || !voice || chosen.length === 0 || withSound.length < 2}>
            <Volume1 className="h-4 w-4" />
            {busy ? 'Listening…' : `Duck ${chosen.length} track${chosen.length === 1 ? '' : 's'}`}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
