import { useMemo, useRef, useState } from 'react';
import { ScanFace } from 'lucide-react';
import { GhostButton, PrimaryButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { cls } from '../utils/format';
import { useMediaStore } from './mediaStore';
import { reframeTargets, runReframe, type ReframeFollow } from './reframe';
import { RESOLUTIONS, useTimelineStore } from './timelineStore';

export function ReframeDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const canvas = useTimelineStore((s) => s.canvas);
  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const selectedIds = useTimelineStore((s) => s.selectedIds);
  const media = useMediaStore((s) => s.media);
  const isCurrent = (w: number, h: number): boolean => Math.abs(w / h - canvas.width / canvas.height) < 0.001;
  const [target, setTarget] = useState(() => RESOLUTIONS.find((r) => r.label === '9:16' && !isCurrent(r.width, r.height)) ?? RESOLUTIONS.find((r) => !isCurrent(r.width, r.height)) ?? RESOLUTIONS[0]);
  const [follow, setFollow] = useState<ReframeFollow>('face');
  const kinds = useMemo(() => new Map(media.map((m) => [m.id, m.kind])), [media]);
  const locked = useMemo(() => new Set(tracks.filter((t) => t.locked).map((t) => t.id)), [tracks]);
  const all = useMemo(() => reframeTargets(clips, kinds, locked), [clips, kinds, locked]);
  const selected = useMemo(() => reframeTargets(clips, kinds, locked, new Set(selectedIds)), [clips, kinds, locked, selectedIds]);
  const [onlySelected, setOnlySelected] = useState(false);
  const [busy, setBusy] = useState<{ ratio: number; status: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const go = async (): Promise<void> => {
    const abort = new AbortController();
    abortRef.current = abort;
    setError(null);
    setBusy({ ratio: 0, status: 'Starting…' });
    try {
      const r = await runReframe({
        canvas: { width: target.width, height: target.height },
        follow,
        only: onlySelected ? new Set(selected.map((c) => c.id)) : undefined,
        signal: abort.signal,
        onProgress: (ratio, status) => setBusy({ ratio, status }),
      });
      const none = follow === 'face' && r.followed.length === 0 ? ' No face was big enough to follow, so it stays centred.' : '';
      toast.success(`Reframed ${r.clips} clip${r.clips === 1 ? '' : 's'} to ${target.label}${r.moving ? ` (the camera follows the speaker in ${r.moving})` : ''}.${none} Undo reverts it.`);
      onClose();
    } catch (e) {
      if (!abort.signal.aborted) setError((e as Error).message);
      setBusy(null);
    }
  };

  const option = (on: boolean): string =>
    cls('rounded-lg border px-3 py-2 text-left transition disabled:opacity-50', on ? 'border-krypt-purple/60 bg-krypt-purple/15 text-white' : 'border-white/10 bg-black/30 text-krypt-muted hover:text-white');
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[480px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <ScanFace className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Auto reframe</div>
            <div className="text-xs text-krypt-muted">Change the shape and keep the speaker in shot. Faces are found on your computer.</div>
          </div>
        </div>

        {all.length === 0 ? (
          <div className="text-sm text-krypt-muted">Put a video or image on the timeline first.</div>
        ) : (
          <>
            <div className="mb-1 text-xs text-krypt-muted">New shape</div>
            <div className="grid grid-cols-4 gap-2">
              {RESOLUTIONS.map((r) => (
                <button key={r.label} disabled={!!busy} onClick={() => setTarget(r)} className={option(target.label === r.label)}>
                  <div className="text-sm font-semibold">{r.label}</div>
                  <div className="truncate text-[10px] opacity-80">{r.hint}</div>
                </button>
              ))}
            </div>

            <div className="mb-1 mt-4 text-xs text-krypt-muted">Framing</div>
            <div className="grid grid-cols-2 gap-2">
              <button disabled={!!busy} onClick={() => setFollow('face')} className={option(follow === 'face')}>
                <div className="text-sm font-semibold">Follow the speaker</div>
                <div className="text-[11px] opacity-80">Pans smoothly when the face moves. Footage without a clear face stays centred.</div>
              </button>
              <button disabled={!!busy} onClick={() => setFollow('center')} className={option(follow === 'center')}>
                <div className="text-sm font-semibold">Keep centred</div>
                <div className="text-[11px] opacity-80">Fills the frame from the middle. Instant.</div>
              </button>
            </div>

            {selected.length > 0 && selected.length < all.length && (
              <label className="mt-4 flex cursor-pointer items-center gap-2 text-xs text-krypt-muted">
                <input type="checkbox" checked={onlySelected} disabled={!!busy} onChange={(e) => setOnlySelected(e.target.checked)} className="accent-krypt-purple" />
                Only the {selected.length} selected clip{selected.length === 1 ? '' : 's'} (otherwise all {all.length})
              </label>
            )}

            {busy && (
              <div className="mt-4">
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
          <PrimaryButton onClick={() => void go()} disabled={!!busy || all.length === 0}>
            <ScanFace className="h-4 w-4" />
            Reframe to {target.label}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
