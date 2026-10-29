import { memo, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
  Film,
  Music,
  Image as ImageIcon,
  Type,
  Copy,
  X,
  Plus,
  Shuffle,
  Square,
  Pencil,
  Maximize2,
  ChevronsLeft,
  ArrowLeftToLine,
  Eye,
  EyeOff,
  Volume2,
  VolumeX,
  Headphones,
  Lock,
  Unlock,
} from 'lucide-react';
import type { MediaFile } from '@shared/types';
import { useMediaStore } from './mediaStore';
import { getPeaks, PEAKS_PER_SEC } from './peaks';
import { getThumbs, type Thumb } from './thumbs';
import { DND_EFFECT, DND_TRANSITION, useDnd } from './dndStore';
import {
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  orderedTracks,
  sourceTimeAt,
  timelineDuration,
  TRANSITIONS,
  useTimelineStore,
  type Clip,
  type MediaClip,
  type Track,
  type TrackKind,
  type TransitionType,
} from './timelineStore';
import { fmtClock, fmtTimecode, MOD_KEY } from '../utils/format';
import { IconButton } from '../components/common';
import { cls } from '../utils/format';

const RULER_H = 28;
const TRACK_H = 56;
const GUTTER_W = 68;
const SNAP_PX = 7;
const TICKS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

const TRACK_ICON: Record<TrackKind, typeof Film> = { video: Film, audio: Music, text: Type };
const TINT: Record<string, string> = {
  video: 'from-indigo-500/30 to-indigo-500/10 border-indigo-400/40',
  audio: 'from-pink-500/30 to-pink-500/10 border-pink-400/40',
  image: 'from-purple-500/30 to-purple-500/10 border-purple-400/40',
  text: 'from-amber-500/30 to-amber-500/10 border-amber-400/40',
};

function tickInterval(pxPerSec: number): number {
  return TICKS.find((t) => t * pxPerSec >= 64) ?? TICKS[TICKS.length - 1];
}

function dragX(move: (clientX: number) => void, onEnd?: () => void): void {
  const mv = (ev: PointerEvent): void => move(ev.clientX);
  const up = (): void => {
    window.removeEventListener('pointermove', mv);
    window.removeEventListener('pointerup', up);
    onEnd?.();
  };
  window.addEventListener('pointermove', mv);
  window.addEventListener('pointerup', up);
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function Timeline() {
  const contentRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const onLanesScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    if (gutterRef.current) gutterRef.current.style.transform = `translateY(-${e.currentTarget.scrollTop}px)`;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const st = useTimelineStore.getState();
      const factor = Math.exp(-e.deltaY * 0.0025);
      const next = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, st.pxPerSec * factor));
      if (next === st.pxPerSec) return;
      const offsetX = e.clientX - el.getBoundingClientRect().left;
      const t = (el.scrollLeft + offsetX) / st.pxPerSec;
      st.setZoom(next);
      el.scrollLeft = t * next - offsetX;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const fitToProject = (): void => {
    const el = scrollRef.current;
    const dur = timelineDuration(useTimelineStore.getState().clips);
    if (!el || dur <= 0) return;
    setZoom((el.clientWidth - 16) / dur);
    el.scrollLeft = 0;
  };

  const dragPointer = useRef<{ x: number; y: number } | null>(null);
  const beginEdgeAutoScroll = (onScrolled: () => void, axes: { x: boolean; y: boolean }): (() => void) => {
    const EDGE = 28;
    const MAX_STEP = 20;
    const step = (over: number): number => Math.min(MAX_STEP, 4 + over / 3);
    let raf = 0;
    const tick = (): void => {
      const el = scrollRef.current;
      const p = dragPointer.current;
      if (el && p) {
        const r = el.getBoundingClientRect();
        let moved = false;
        if (axes.y) {
          const before = el.scrollTop;
          if (p.y < r.top + RULER_H + EDGE) el.scrollTop -= step(r.top + RULER_H + EDGE - p.y);
          else if (p.y > r.bottom - EDGE) el.scrollTop += step(p.y - (r.bottom - EDGE));
          moved = el.scrollTop !== before;
        }
        if (axes.x) {
          const before = el.scrollLeft;
          if (p.x < r.left + EDGE) el.scrollLeft -= step(r.left + EDGE - p.x);
          else if (p.x > r.right - EDGE) el.scrollLeft += step(p.x - (r.right - EDGE));
          moved = moved || el.scrollLeft !== before;
        }
        if (moved) onScrolled();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  };

  const media = useMediaStore((s) => s.media);
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  const tracks = useTimelineStore((s) => s.tracks);
  const clips = useTimelineStore((s) => s.clips);
  const pxPerSec = useTimelineStore((s) => s.pxPerSec);
  const selectedIds = useTimelineStore((s) => s.selectedIds);

  const setZoom = useTimelineStore((s) => s.setZoom);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const setSelection = useTimelineStore((s) => s.setSelection);
  const removeSelected = useTimelineStore((s) => s.removeSelected);
  const rippleDelete = useTimelineStore((s) => s.rippleDeleteSelected);
  const closeGapBefore = useTimelineStore((s) => s.closeGapBefore);
  const duplicateClip = useTimelineStore((s) => s.duplicateClip);
  const splitSelected = useTimelineStore((s) => s.splitSelectedAtPlayhead);
  const addTrack = useTimelineStore((s) => s.addTrack);
  const removeTrack = useTimelineStore((s) => s.removeTrack);

  const dndKind = useDnd((s) => s.kind);
  const ordered = useMemo(() => orderedTracks(tracks), [tracks]);
  const total = useMemo(() => timelineDuration(clips), [clips]);
  const lockedTracks = useMemo(() => new Set(tracks.filter((t) => t.locked).map((t) => t.id)), [tracks]);

  const applyEffect = (clipId: string, value: string): void => {
    const st = useTimelineStore.getState();
    st.pushHistory();
    st.updateClip(clipId, { effect: value });
  };
  const applyTransition = (rightId: string, value: string): void => {
    const st = useTimelineStore.getState();
    st.pushHistory();
    st.updateClip(rightId, { transition: value as TransitionType, transitionDur: 0.5 });
  };
  const removeTransition = (rightId: string): void => {
    const st = useTimelineStore.getState();
    st.pushHistory();
    st.updateClip(rightId, { transition: 'none' });
  };
  const beginEdit = (): void => useTimelineStore.getState().pushHistory();
  const editTransition = (rightId: string, patch: { type?: TransitionType; dur?: number }): void => {
    const p: Partial<MediaClip> = {};
    if (patch.type !== undefined) p.transition = patch.type;
    if (patch.dur !== undefined) p.transitionDur = patch.dur;
    useTimelineStore.getState().updateClip(rightId, p);
  };
  const junctionsFor = (trackId: string): Array<{ x: number; rightId: string; type: TransitionType; dur: number; maxDur: number }> => {
    const tc = clips.filter((c) => c.trackId === trackId && c.type === 'media').sort((a, b) => a.start - b.start);
    const res: Array<{ x: number; rightId: string; type: TransitionType; dur: number; maxDur: number }> = [];
    for (let i = 1; i < tc.length; i++) {
      const p = tc[i - 1] as MediaClip;
      const c = tc[i] as MediaClip;
      if (Math.abs(p.start + p.duration - c.start) < 0.05)
        res.push({ x: c.start * pxPerSec, rightId: c.id, type: c.transition, dur: c.transitionDur, maxDur: Math.min(c.duration, p.duration, 5) });
    }
    return res;
  };
  const contentSeconds = Math.max(total + 2, 12);
  const contentWidth = contentSeconds * pxPerSec;
  const hasSel = selectedIds.length > 0;

  const [marquee, setMarquee] = useState<Marquee | null>(null);

  const snapTargets = (exclude: Set<string>): number[] => {
    const st = useTimelineStore.getState();
    const ts = [0, st.playhead];
    for (const c of st.clips) {
      if (exclude.has(c.id)) continue;
      ts.push(c.start, c.start + c.duration);
    }
    return ts;
  };

  const snap = (t: number, targets: number[]): number => {
    let best = t;
    let bestPx = SNAP_PX;
    for (const target of targets) {
      const d = Math.abs(target - t) * pxPerSec;
      if (d < bestPx) {
        bestPx = d;
        best = target;
      }
    }
    return best;
  };

  const timeAt = (clientX: number): number => {
    const rect = contentRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.max(0, Math.min(contentSeconds, (clientX - rect.left) / pxPerSec));
  };
  const scrub = (clientX: number): void => {
    useTimelineStore.getState().pause();
    useTimelineStore.getState().setPlayhead(snap(timeAt(clientX), snapTargets(new Set())));
  };
  const onRulerDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    scrub(e.clientX);
    dragX(scrub);
  };

  const onLaneBackgroundDown = (e: ReactPointerEvent): void => {
    if (e.target !== e.currentTarget) return;
    const rect0 = contentRef.current?.getBoundingClientRect();
    if (!rect0) return;
    const x0 = e.clientX - rect0.left;
    const y0 = e.clientY - rect0.top;
    const base = e.shiftKey ? [...useTimelineStore.getState().selectedIds] : [];
    if (!e.shiftKey) selectClip(null);
    setMarquee({ x0, y0, x1: x0, y1: y0 });
    dragPointer.current = { x: e.clientX, y: e.clientY };

    const apply = (): void => {
      const p = dragPointer.current;
      const rect = contentRef.current?.getBoundingClientRect();
      if (!p || !rect) return;
      const x1 = p.x - rect.left;
      const y1 = p.y - rect.top;
      setMarquee({ x0, y0, x1, y1 });
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);
      const t0 = minX / pxPerSec;
      const t1 = maxX / pxPerSec;
      const ids = new Set(base);
      ordered.forEach((track, i) => {
        const top = RULER_H + i * TRACK_H;
        if (maxY < top || minY > top + TRACK_H) return;
        if (lockedTracks.has(track.id)) return;
        for (const c of clips) {
          if (c.trackId !== track.id) continue;
          if (c.start + c.duration > t0 && c.start < t1) ids.add(c.id);
        }
      });
      setSelection([...ids]);
    };
    const stopScroll = beginEdgeAutoScroll(apply, { x: true, y: true });
    const mv = (ev: PointerEvent): void => {
      dragPointer.current = { x: ev.clientX, y: ev.clientY };
      apply();
    };
    const up = (): void => {
      stopScroll();
      dragPointer.current = null;
      setMarquee(null);
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const startMove = (e: ReactPointerEvent, clip: Clip): void => {
    e.stopPropagation();
    if (lockedTracks.has(clip.trackId)) return;
    const st = useTimelineStore.getState();
    if (!st.selectedIds.includes(clip.id)) selectClip(clip.id, e.shiftKey);
    else if (e.shiftKey) selectClip(clip.id, true);
    st.pause();
    const ids = useTimelineStore.getState().selectedIds;
    const lanes0 = orderedTracks(useTimelineStore.getState().tracks);
    const laneOf = (trackId: string): number => lanes0.findIndex((t) => t.id === trackId);
    const origins = new Map(
      useTimelineStore
        .getState()
        .clips.filter((c) => ids.includes(c.id))
        .map((c) => {
          const lane = laneOf(c.trackId);
          return [c.id, { start: c.start, lane, kind: lanes0[lane]?.kind, trackId: c.trackId }] as const;
        }),
    );
    const primary = origins.get(clip.id) ?? { start: clip.start, lane: laneOf(clip.trackId), kind: undefined, trackId: clip.trackId };
    const primaryOrig = primary.start;
    const minOrig = Math.min(...[...origins.values()].map((o) => o.start));
    const targets = snapTargets(new Set(ids));
    const rect0 = contentRef.current?.getBoundingClientRect();
    const startContentX = e.clientX - (rect0?.left ?? 0);
    dragPointer.current = { x: e.clientX, y: e.clientY };
    let pushed = false;
    const apply = (): void => {
      const p = dragPointer.current;
      const rect = contentRef.current?.getBoundingClientRect();
      if (!p || !rect) return;
      if (!pushed) {
        useTimelineStore.getState().pushHistory();
        pushed = true;
      }
      let delta = (p.x - rect.left - startContentX) / pxPerSec;
      const raw = Math.max(0, primaryOrig + delta);
      const left = snap(raw, targets);
      const right = snap(raw + clip.duration, targets) - clip.duration;
      const snapped = Math.abs(left - raw) <= Math.abs(right - raw) ? left : right;
      delta = snapped - primaryOrig;
      if (minOrig + delta < 0) delta = -minOrig;
      const overLane = Math.floor((p.y - rect.top - RULER_H) / TRACK_H);
      const laneDelta = overLane - primary.lane;
      const store = useTimelineStore.getState();
      const lanes = orderedTracks(store.tracks);
      origins.forEach((o, id) => {
        const c = store.clips.find((x) => x.id === id);
        if (!c) return;
        const dest = lanes[o.lane + laneDelta];
        const destTrackId = dest && dest.kind === o.kind ? dest.id : o.trackId;
        store.moveClip(id, o.start + delta, destTrackId);
      });
    };
    const stopScroll = beginEdgeAutoScroll(apply, { x: true, y: true });
    const mv = (ev: PointerEvent): void => {
      dragPointer.current = { x: ev.clientX, y: ev.clientY };
      apply();
    };
    const up = (): void => {
      stopScroll();
      dragPointer.current = null;
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const startTrim = (e: ReactPointerEvent, clip: Clip, edge: 'start' | 'end'): void => {
    e.stopPropagation();
    if (lockedTracks.has(clip.trackId)) return;
    const st = useTimelineStore.getState();
    selectClip(clip.id);
    st.pause();
    const rect0 = contentRef.current?.getBoundingClientRect();
    const startContentX = e.clientX - (rect0?.left ?? 0);
    const anchor = edge === 'start' ? clip.start : clip.start + clip.duration;
    const targets = snapTargets(new Set([clip.id]));
    dragPointer.current = { x: e.clientX, y: e.clientY };
    let pushed = false;
    const apply = (): void => {
      const p = dragPointer.current;
      const rect = contentRef.current?.getBoundingClientRect();
      if (!p || !rect) return;
      if (!pushed) {
        useTimelineStore.getState().pushHistory();
        pushed = true;
      }
      const t = snap(anchor + (p.x - rect.left - startContentX) / pxPerSec, targets);
      if (edge === 'start') useTimelineStore.getState().trimClipStart(clip.id, t);
      else useTimelineStore.getState().trimClipEnd(clip.id, t);
    };
    const stopScroll = beginEdgeAutoScroll(apply, { x: true, y: false });
    const mv = (ev: PointerEvent): void => {
      dragPointer.current = { x: ev.clientX, y: ev.clientY };
      apply();
    };
    const up = (): void => {
      stopScroll();
      dragPointer.current = null;
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const interval = tickInterval(pxPerSec);
  const tickCount = Math.floor(contentSeconds / interval) + 1;
  const mq = marquee
    ? { left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-krypt-panel/60 shadow-krypt-card">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <h2 className="mr-1 text-xs font-semibold uppercase tracking-[0.18em] text-krypt-muted">Timeline</h2>
        <IconButton title="Split at playhead (S)" onClick={() => splitSelected()} disabled={!hasSel}>
          <Scissors className="h-4 w-4" />
        </IconButton>
        <IconButton title="Duplicate clip" onClick={() => hasSel && duplicateClip(selectedIds[selectedIds.length - 1])} disabled={selectedIds.length !== 1}>
          <Copy className="h-4 w-4" />
        </IconButton>
        <IconButton title="Delete selected (Del)" destructive onClick={() => removeSelected()} disabled={!hasSel}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
        <IconButton title="Ripple delete — close the gap (Shift+Del)" destructive onClick={() => rippleDelete()} disabled={!hasSel}>
          <ChevronsLeft className="h-4 w-4" />
        </IconButton>
        <IconButton title="Close gap before clip" onClick={() => hasSel && closeGapBefore(selectedIds[selectedIds.length - 1])} disabled={selectedIds.length !== 1}>
          <ArrowLeftToLine className="h-4 w-4" />
        </IconButton>
        <div className="mx-1 h-6 w-px bg-white/10" />
        <AddTrackButton kind="video" onClick={() => addTrack('video')} />
        <AddTrackButton kind="audio" onClick={() => addTrack('audio')} />
        <AddTrackButton kind="text" onClick={() => addTrack('text')} />

        <div className="ml-auto flex items-center gap-2">
          <IconButton title={`Zoom out (${MOD_KEY}+wheel)`} onClick={() => setZoom(pxPerSec / 1.5)} disabled={pxPerSec <= MIN_PX_PER_SEC}>
            <ZoomOut className="h-4 w-4" />
          </IconButton>
          <IconButton title={`Zoom in (${MOD_KEY}+wheel)`} onClick={() => setZoom(pxPerSec * 1.5)} disabled={pxPerSec >= MAX_PX_PER_SEC}>
            <ZoomIn className="h-4 w-4" />
          </IconButton>
          <IconButton title="Fit whole project" onClick={fitToProject} disabled={total <= 0}>
            <Maximize2 className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="relative flex-shrink-0 overflow-hidden border-r border-white/10"
          style={{ width: GUTTER_W }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) return;
            const el = scrollRef.current;
            if (!el) return;
            el.scrollTop += e.deltaY;
            el.scrollLeft += e.deltaX;
          }}
        >
          <div ref={gutterRef}>
            <div style={{ height: RULER_H }} />
            {ordered.map((t) => (
              <TrackLabel key={t.id} track={t} onRemove={() => removeTrack(t.id)} />
            ))}
          </div>
          <div className="absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-krypt-panel" style={{ height: RULER_H }} />
        </div>

        <div ref={scrollRef} onScroll={onLanesScroll} className="relative min-h-0 flex-1 overflow-auto">
          <div ref={contentRef} className="relative" style={{ width: contentWidth, minWidth: '100%' }}>
            <div className="sticky top-0 z-30 cursor-pointer select-none border-b border-white/10 bg-krypt-panel" style={{ height: RULER_H }} onPointerDown={onRulerDown}>
              {Array.from({ length: tickCount }, (_, i) => {
                const sec = i * interval;
                return (
                  <div key={i} className="absolute top-0 h-full" style={{ left: sec * pxPerSec }}>
                    <div className="h-2 w-px bg-white/20" />
                    <div className="pl-1 text-[10px] leading-none text-krypt-muted">{fmtClock(sec)}</div>
                  </div>
                );
              })}
              <PlayheadGrabber pxPerSec={pxPerSec} />
            </div>

            {ordered.map((track) => (
              <div
                key={track.id}
                className={cls('relative border-b border-white/5', track.hidden && 'opacity-40', track.locked && 'opacity-60')}
                style={{ height: TRACK_H }}
                onPointerDown={onLaneBackgroundDown}
              >
                {clips
                  .filter((c) => c.trackId === track.id)
                  .map((clip) => (
                    <ClipBlock
                      key={clip.id}
                      clip={clip}
                      media={clip.type === 'media' ? mediaById.get(clip.mediaId) : undefined}
                      trackKind={track.kind}
                      pxPerSec={pxPerSec}
                      selected={selectedIds.includes(clip.id)}
                      onMoveDown={(e) => startMove(e, clip)}
                      onTrimDown={(e, edge) => startTrim(e, clip, edge)}
                      onEffectDrop={(v) => applyEffect(clip.id, v)}
                      onTransitionDrop={(v) => applyTransition(clip.id, v)}
                    />
                  ))}
                {track.kind === 'video' &&
                  junctionsFor(track.id).map((j) => (
                    <Junction
                      key={j.rightId}
                      x={j.x}
                      type={j.type}
                      dur={j.dur}
                      maxDur={j.maxDur}
                      active={dndKind === 'transition'}
                      onDropTransition={(v) => applyTransition(j.rightId, v)}
                      onBegin={beginEdit}
                      onEdit={(patch) => editTransition(j.rightId, patch)}
                      onRemove={() => removeTransition(j.rightId)}
                    />
                  ))}
              </div>
            ))}

            {mq && <div className="pointer-events-none absolute z-10 rounded-sm border border-krypt-purple/80 bg-krypt-purple/15" style={{ left: mq.left, top: mq.top, width: mq.width, height: mq.height }} />}

            <CutPreview pxPerSec={pxPerSec} />
            <Playhead pxPerSec={pxPerSec} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackLabel({ track, onRemove }: { track: Track; onRemove: () => void }) {
  const updateTrack = useTimelineStore((s) => s.updateTrack);
  const Icon = TRACK_ICON[track.kind];
  return (
    <div className="group relative flex flex-col items-center justify-center gap-1 border-b border-white/5 text-krypt-muted" style={{ height: TRACK_H }}>
      <div className="flex items-center gap-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] font-semibold">{track.name}</span>
      </div>
      <div className="flex items-center gap-1">
        {track.kind !== 'audio' && (
          <TrackToggle on={!!track.hidden} title={track.hidden ? 'Show track' : 'Hide track'} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>
            {track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          </TrackToggle>
        )}
        <TrackToggle on={!!track.muted} title={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
          {track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
        </TrackToggle>
        {track.kind === 'audio' && (
          <TrackToggle on={!!track.solo} title={track.solo ? 'Unsolo track' : 'Solo track'} onClick={() => updateTrack(track.id, { solo: !track.solo })}>
            <Headphones className="h-3 w-3" />
          </TrackToggle>
        )}
        <TrackToggle on={!!track.locked} title={track.locked ? 'Unlock track' : 'Lock track'} onClick={() => updateTrack(track.id, { locked: !track.locked })}>
          {track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
        </TrackToggle>
      </div>
      <button onClick={onRemove} title={`Remove ${track.name}`} className="absolute right-0.5 top-0.5 rounded p-0.5 text-krypt-muted opacity-0 transition hover:text-rose-300 group-hover:opacity-100">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}

function TrackToggle({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={title} className={cls('rounded p-0.5 transition', on ? 'bg-krypt-purple/25 text-krypt-pink' : 'text-krypt-muted/70 hover:text-white')}>
      {children}
    </button>
  );
}

function AddTrackButton({ kind, onClick }: { kind: TrackKind; onClick: () => void }) {
  const Icon = TRACK_ICON[kind];
  return (
    <button onClick={onClick} title={`Add ${kind} track`} className="flex items-center gap-0.5 rounded-lg border border-white/10 bg-white/5 px-1.5 py-1.5 text-krypt-muted transition hover:bg-white/10 hover:text-white">
      <Plus className="h-3 w-3" />
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function CutPreview({ pxPerSec }: { pxPerSec: number }) {
  const ranges = useTimelineStore((s) => s.cutPreview);
  if (!ranges || ranges.length === 0) return null;
  return (
    <>
      {ranges.map(([a, b], i) => (
        <div
          key={i}
          className="pointer-events-none absolute top-0 bottom-0 z-10 border-x border-red-400/70 bg-red-500/20"
          style={{ left: a * pxPerSec, width: Math.max(1, (b - a) * pxPerSec) }}
        />
      ))}
    </>
  );
}

function Playhead({ pxPerSec }: { pxPerSec: number }) {
  const playhead = useTimelineStore((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute top-0 bottom-0 z-20" style={{ left: playhead * pxPerSec }}>
      <div className="h-full w-px bg-krypt-pink shadow-[0_0_8px_rgba(236,72,153,0.7)]" />
    </div>
  );
}

function PlayheadGrabber({ pxPerSec }: { pxPerSec: number }) {
  const playhead = useTimelineStore((s) => s.playhead);
  return (
    <div className="pointer-events-none absolute top-0 z-10" style={{ left: playhead * pxPerSec }}>
      <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-krypt-pink" />
      <div className="absolute left-0 top-0 w-px bg-krypt-pink" style={{ height: RULER_H }} />
    </div>
  );
}

const ClipBlock = memo(_ClipBlock, (a, b) =>
  a.clip === b.clip && a.media === b.media && a.trackKind === b.trackKind && a.pxPerSec === b.pxPerSec && a.selected === b.selected,
);

function _ClipBlock({
  clip,
  media,
  trackKind,
  pxPerSec,
  selected,
  onMoveDown,
  onTrimDown,
  onEffectDrop,
  onTransitionDrop,
}: {
  clip: Clip;
  media: MediaFile | undefined;
  trackKind: TrackKind;
  pxPerSec: number;
  selected: boolean;
  onMoveDown: (e: ReactPointerEvent) => void;
  onTrimDown: (e: ReactPointerEvent, edge: 'start' | 'end') => void;
  onEffectDrop: (value: string) => void;
  onTransitionDrop: (value: string) => void;
}) {
  const isOverlay = clip.type === 'text' || clip.type === 'shape' || clip.type === 'draw';
  const onAudioLane = trackKind === 'audio';
  const kind = isOverlay ? 'text' : onAudioLane ? 'audio' : media?.kind ?? 'video';
  const Icon =
    clip.type === 'shape' ? Square : clip.type === 'draw' ? Pencil : clip.type === 'text' ? Type : kind === 'audio' ? Music : kind === 'image' ? ImageIcon : Film;
  const label = clip.type === 'text' ? clip.text : clip.type === 'shape' ? clip.shape : clip.type === 'draw' ? 'Drawing' : media?.name ?? 'clip';
  const width = Math.max(2, clip.duration * pxPerSec);
  const dndKind = useDnd((s) => s.kind);
  const [dropTarget, setDropTarget] = useState(false);
  const isMedia = clip.type === 'media';
  const canDropEffect = isMedia && kind !== 'audio';

  const onDragOver = (e: ReactDragEvent): void => {
    const t = e.dataTransfer.types;
    if ((canDropEffect && t.includes(DND_EFFECT)) || (isMedia && t.includes(DND_TRANSITION))) {
      e.preventDefault();
      setDropTarget(true);
    }
  };
  const onDrop = (e: ReactDragEvent): void => {
    if (e.dataTransfer.types.includes(DND_EFFECT) && canDropEffect) {
      e.preventDefault();
      e.stopPropagation();
      onEffectDrop(e.dataTransfer.getData(DND_EFFECT));
    } else if (e.dataTransfer.types.includes(DND_TRANSITION) && isMedia) {
      e.preventDefault();
      e.stopPropagation();
      onTransitionDrop(e.dataTransfer.getData(DND_TRANSITION));
    }
    setDropTarget(false);
  };

  return (
    <div
      className={cls(
        'group absolute top-1.5 bottom-1.5 select-none touch-none overflow-hidden rounded-lg border bg-gradient-to-b',
        TINT[kind],
        dropTarget ? 'ring-2 ring-krypt-purple' : selected ? 'ring-2 ring-krypt-pink shadow-krypt-glow' : dndKind === 'effect' && canDropEffect ? 'ring-1 ring-krypt-purple/40' : 'hover:brightness-110',
      )}
      style={{ left: clip.start * pxPerSec, width }}
      onPointerDown={onMoveDown}
      onDragOver={onDragOver}
      onDragLeave={() => setDropTarget(false)}
      onDrop={onDrop}
      title={label}
    >
      {isMedia && !onAudioLane && media?.kind === 'image' && <img src={media.mediaUrl} alt="" draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60" />}
      {isMedia && !onAudioLane && media?.kind === 'video' && (
        <Filmstrip media={media} inPoint={clip.inPoint} sourceSpan={sourceTimeAt(clip, clip.start + clip.duration) - clip.inPoint} width={width} height={TRACK_H - 12} />
      )}
      {isMedia && onAudioLane && media && (
        <Waveform media={media} inPoint={clip.inPoint} sourceSpan={sourceTimeAt(clip, clip.start + clip.duration) - clip.inPoint} width={width} height={TRACK_H - 12} />
      )}
      {isMedia && !onAudioLane && (media?.kind === 'video' || media?.kind === 'image') && (
        <div className="pointer-events-none absolute inset-y-0 left-0 w-2/3 bg-gradient-to-r from-black/60 to-transparent" />
      )}
      <div className="relative flex h-full cursor-grab items-center gap-1.5 px-2 active:cursor-grabbing [text-shadow:_0_1px_2px_rgba(0,0,0,0.85)]">
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-white/90" />
        <span className="truncate text-xs font-medium text-white/95">{label}</span>
        <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-white/70">{fmtTimecode(clip.duration)}</span>
      </div>
      <div className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 group-hover:bg-white/15" onPointerDown={(e) => onTrimDown(e, 'start')} />
      <div className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 group-hover:bg-white/15" onPointerDown={(e) => onTrimDown(e, 'end')} />
      {selected && <KeyMarkers clip={clip} pxPerSec={pxPerSec} />}
    </div>
  );
}

function KeyMarkers({ clip, pxPerSec }: { clip: Clip; pxPerSec: number }) {
  const ks = clip.keyframes ?? [];
  if (ks.length === 0) return null;
  const times: number[] = [];
  for (const k of [...ks].sort((a, b) => a.t - b.t)) {
    if (times.length === 0 || Math.abs(k.t - times[times.length - 1]) > 0.04) times.push(k.t);
  }
  return (
    <>
      {times.map((t) => (
        <KeyMarker key={`${t}`} clip={clip} t={t} pxPerSec={pxPerSec} />
      ))}
    </>
  );
}

function KeyMarker({ clip, t, pxPerSec }: { clip: Clip; t: number; pxPerSec: number }) {
  const onDown = (e: ReactPointerEvent): void => {
    e.stopPropagation();
    const st = useTimelineStore.getState();
    if (e.altKey) {
      st.deleteKeyframes(clip.id, t);
      return;
    }
    const startX = e.clientX;
    let cur = t;
    let pushed = false;
    let moved = false;
    dragX(
      (clientX) => {
        const next = Math.max(0, Math.min(clip.duration, t + (clientX - startX) / pxPerSec));
        if (Math.abs(next - cur) < 1e-4) return;
        moved = true;
        if (!pushed) {
          useTimelineStore.getState().pushHistory();
          pushed = true;
        }
        useTimelineStore.getState().moveKeyframes(clip.id, cur, next);
        cur = next;
      },
      () => {
        if (!moved) {
          const s = useTimelineStore.getState();
          s.pause();
          s.setPlayhead(clip.start + t);
        }
      },
    );
  };
  return (
    <div
      onPointerDown={onDown}
      title="Keyframe — drag to retime · Alt+click to delete · click to jump"
      className="absolute bottom-1 z-10 h-2.5 w-2.5 -translate-x-1/2 rotate-45 cursor-ew-resize rounded-[1px] border border-white/80 bg-krypt-pink shadow"
      style={{ left: t * pxPerSec }}
    />
  );
}

function Junction({
  x,
  type,
  dur,
  maxDur,
  active,
  onDropTransition,
  onBegin,
  onEdit,
  onRemove,
}: {
  x: number;
  type: TransitionType;
  dur: number;
  maxDur: number;
  active: boolean;
  onDropTransition: (v: string) => void;
  onBegin: () => void;
  onEdit: (patch: { type?: TransitionType; dur?: number }) => void;
  onRemove: () => void;
}) {
  const [over, setOver] = useState(false);
  const [pop, setPop] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  if (active) {
    return (
      <div
        className={cls('absolute top-0 bottom-0 z-30 -translate-x-1/2 rounded-sm border border-krypt-pink/60', over ? 'bg-krypt-pink/50' : 'bg-krypt-pink/20')}
        style={{ left: x, width: 18 }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND_TRANSITION)) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const v = e.dataTransfer.getData(DND_TRANSITION);
          setOver(false);
          if (v) onDropTransition(v);
        }}
      />
    );
  }
  if (type === 'none') return null;

  const safeMax = Math.max(0.1, maxDur);
  const cur = Math.min(Math.max(0.1, dur), safeMax);
  const openPop = (e: ReactMouseEvent): void => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPop({ left: r.left + r.width / 2, top: r.top });
  };

  return (
    <>
      <button
        ref={btnRef}
        className="absolute top-1 z-30 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full border border-krypt-pink/60 bg-krypt-pink/25 text-krypt-pink shadow transition hover:bg-krypt-pink/40"
        style={{ left: x }}
        title={`Transition: ${type} — click to edit`}
        onClick={openPop}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Shuffle className="h-3 w-3" />
      </button>
      {pop && (
        <>
          <div className="fixed inset-0 z-40" onPointerDown={() => setPop(null)} />
          <div
            className="fixed z-50 w-52 -translate-x-1/2 -translate-y-full rounded-xl border border-white/10 bg-krypt-panel/95 p-3 shadow-krypt-card backdrop-blur"
            style={{ left: pop.left, top: pop.top - 8 }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-krypt-muted">Transition</div>
            <div className="mb-3 grid grid-cols-2 gap-1">
              {TRANSITIONS.map((tr) => (
                <button
                  key={tr.value}
                  onClick={() => {
                    if (tr.value === 'none') {
                      onRemove();
                      setPop(null);
                    } else {
                      onBegin();
                      onEdit({ type: tr.value });
                    }
                  }}
                  className={cls(
                    'rounded-md px-2 py-1 text-xs transition',
                    tr.value === type ? 'bg-krypt-pink/30 text-white ring-1 ring-krypt-pink/60' : 'bg-white/5 text-krypt-muted hover:bg-white/10 hover:text-white',
                  )}
                >
                  {tr.label}
                </button>
              ))}
            </div>
            <div className="mb-1 flex items-center justify-between text-xs text-krypt-muted">
              <span>Duration</span>
              <span className="font-mono tabular-nums text-white">{cur.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min={0.1}
              max={safeMax}
              step={0.1}
              value={cur}
              onPointerDown={onBegin}
              onChange={(e) => onEdit({ dur: Number(e.target.value) })}
              className="h-1 w-full cursor-pointer accent-krypt-pink"
            />
            <button
              onClick={() => {
                onRemove();
                setPop(null);
              }}
              className="mt-3 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-krypt-muted transition hover:border-rose-400/40 hover:text-rose-300"
            >
              Remove transition
            </button>
          </div>
        </>
      )}
    </>
  );
}

function Filmstrip({ media, inPoint, sourceSpan, width, height }: { media: MediaFile; inPoint: number; sourceSpan: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [thumbs, setThumbs] = useState<Thumb[] | null>(null);

  useEffect(() => {
    let live = true;
    void getThumbs(media).then((t) => {
      if (live) setThumbs(t);
    });
    return () => {
      live = false;
    };
  }, [media]);

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv || !thumbs || thumbs.length === 0) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const first = thumbs[0].canvas;
    const tileW = Math.max(8, (first.width / first.height) * h);
    for (let x = 0; x < w; x += tileW) {
      const tt = inPoint + ((x + tileW / 2) / w) * sourceSpan;
      let best = thumbs[0];
      for (const th of thumbs) if (Math.abs(th.t - tt) < Math.abs(best.t - tt)) best = th;
      ctx.drawImage(best.canvas, x, 0, tileW, h);
    }
  }, [thumbs, inPoint, sourceSpan, width, height]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-90" />;
}

function Waveform({ media, inPoint, sourceSpan, width, height }: { media: MediaFile; inPoint: number; sourceSpan: number; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);

  useEffect(() => {
    let live = true;
    void getPeaks(media).then((p) => {
      if (live) setPeaks(p);
    });
    return () => {
      live = false;
    };
  }, [media]);

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv || !peaks || peaks.length === 0) return;
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const tSec = inPoint + (x / w) * sourceSpan;
      const idx = Math.min(peaks.length - 1, Math.max(0, Math.floor(tSec * PEAKS_PER_SEC)));
      const barH = Math.max(1, peaks[idx] * h * 0.85);
      ctx.fillRect(x, mid - barH / 2, 1, barH);
    }
  }, [peaks, inPoint, sourceSpan, width, height]);

  return <canvas ref={ref} className="pointer-events-none absolute inset-0 h-full w-full opacity-70" />;
}
