import type { FaceDetector } from '@mediapipe/tasks-vision';
import { ALL_FORMATS, CanvasSink, Input, UrlSource } from 'mediabunny';
import type { MediaFile } from '@shared/types';
import { mergeRanges, sourceWindow, timelineTimeAtSource, type Range } from './autoEdit';
import { useMediaStore } from './mediaStore';
import {
  clipLayout,
  easeProgress,
  exportDims,
  uid,
  useTimelineStore,
  type Canvas,
  type Clip,
  type Easing,
  type Keyframe,
  type MediaClip,
} from './timelineStore';

export interface FaceSample {
  t: number;
  x: number | null;
}

export interface PathKey {
  t: number;
  x: number;
  ease?: Easing;
}

export interface CameraSettings {
  deadZone: number;
  hold: number;
  pan: number;
  smooth: number;
}

export const CAMERA: CameraSettings = { deadZone: 0.06, hold: 0.8, pan: 0.6, smooth: 1 };

export const MIN_FACE = 0.09;

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function cameraPath(samples: FaceSample[], o: CameraSettings = CAMERA): PathKey[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const first = sorted.find((s) => s.x != null);
  if (!first || first.x == null) return [];
  let last = first.x;
  const filled = sorted.map((s) => {
    if (s.x != null) last = s.x;
    return { t: s.t, x: last };
  });
  const med = filled.map((p) => ({ t: p.t, x: median(filled.filter((q) => Math.abs(q.t - p.t) <= o.smooth).map((q) => q.x)) }));

  let cur = med[0].x;
  const out: PathKey[] = [{ t: med[0].t, x: cur }];
  let i = 1;
  while (i < med.length) {
    const p = med[i];
    if (Math.abs(p.x - cur) > o.deadZone) {
      const win = med.filter((q) => q.t >= p.t && q.t <= p.t + o.hold);
      if (win.every((q) => Math.abs(q.x - cur) > o.deadZone / 2)) {
        const target = median(win.map((q) => q.x));
        if (p.t > out[out.length - 1].t + 1e-6) out.push({ t: p.t, x: cur });
        out.push({ t: p.t + o.pan, x: target, ease: 'inout' });
        cur = target;
        while (i < med.length && med[i].t < p.t + o.pan) i++;
        continue;
      }
    }
    i++;
  }
  return out;
}

export function pathAt(path: PathKey[], t: number): number {
  if (path.length === 0) return 0.5;
  if (t <= path[0].t) return path[0].x;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (t <= b.t) {
      const r = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.x + (b.x - a.x) * easeProgress(b.ease, r);
    }
  }
  return path[path.length - 1].x;
}

export function fillFactor(clip: MediaClip, canvas: Canvas): number {
  const l = clipLayout({ ...clip, scaleX: 1, scaleY: 1 }, clip.sourceWidth, clip.sourceHeight, canvas.width, canvas.height);
  if (l.dw <= 0 || l.dh <= 0) return 1;
  return Math.max(canvas.width / l.dw, canvas.height / l.dh);
}

export function posXFor(clip: MediaClip, x: number, canvas: Canvas, scaleX: number): number {
  const fitW = clipLayout({ ...clip, scaleX: 1, scaleY: 1 }, clip.sourceWidth, clip.sourceHeight, canvas.width, canvas.height).dw;
  const dw = fitW * scaleX;
  if (dw <= canvas.width + 1e-6) return 0;
  const cropW = Math.max(0.01, 1 - clip.cropLeft - clip.cropRight);
  const half = canvas.width / (2 * dw);
  const c = Math.min(1 - half, Math.max(half, (x - clip.cropLeft) / cropW));
  return (dw / canvas.width) * (0.5 - c);
}

function clampPosY(clip: MediaClip, posY: number, canvas: Canvas, scaleY: number): number {
  const dh = clipLayout({ ...clip, scaleX: 1, scaleY: 1 }, clip.sourceWidth, clip.sourceHeight, canvas.width, canvas.height).dh * scaleY;
  const room = Math.max(0, (dh - canvas.height) / (2 * canvas.height));
  return Math.min(room, Math.max(-room, posY));
}

export function reframeClip(clip: MediaClip, path: PathKey[], canvas: Canvas): MediaClip {
  const f = fillFactor(clip, canvas);
  const scaleX = clip.scaleX * f;
  const scaleY = clip.scaleY * f;
  const kept: Keyframe[] = (clip.keyframes ?? [])
    .filter((k) => k.prop !== 'posX')
    .map((k) => (k.prop === 'scaleX' || k.prop === 'scaleY' ? { ...k, value: k.value * f } : k));
  const [s0, s1] = clip.freezeAt != null ? [clip.freezeAt, clip.freezeAt] : sourceWindow(clip);
  const v0 = pathAt(path, s0);
  const v1 = pathAt(path, s1);
  const inner = path.filter((k) => k.t > s0 + 1e-3 && k.t < s1 - 1e-3);
  const base = { ...clip, scaleX, scaleY, posY: clampPosY(clip, clip.posY, canvas, scaleY) };
  if (inner.length === 0 && Math.abs(v0 - v1) < 1e-4) return { ...base, posX: posXFor(clip, v0, canvas, scaleX), keyframes: kept };
  const local = (s: number): number => (clip.freezeAt != null ? 0 : timelineTimeAtSource(clip, s) - clip.start);
  const keys: Keyframe[] = [
    { id: uid('kf'), prop: 'posX', t: 0, value: posXFor(clip, v0, canvas, scaleX) },
    ...inner.map((k) => ({ id: uid('kf'), prop: 'posX', t: local(k.t), value: posXFor(clip, k.x, canvas, scaleX), ease: k.ease })),
    { id: uid('kf'), prop: 'posX', t: clip.duration, value: posXFor(clip, v1, canvas, scaleX), ease: path.find((k) => k.t >= s1)?.ease },
  ].filter((k, i, all) => i === 0 || k.t > all[i - 1].t + 1e-3);
  return { ...base, posX: keys[0].value, keyframes: [...kept, ...keys] };
}

const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/latest/blaze_face_short_range.tflite';

async function createFaceDetector(): Promise<FaceDetector> {
  const vision = await import('@mediapipe/tasks-vision');
  const { MEDIAPIPE_FILESET } = await import('./mediapipeFileset');
  return vision.FaceDetector.createFromOptions(MEDIAPIPE_FILESET, {
    baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.5,
  });
}

function faceX(det: FaceDetector, frame: HTMLCanvasElement | OffscreenCanvas | HTMLImageElement, w: number, h: number): number | null {
  const faces = det.detect(frame as HTMLCanvasElement).detections;
  let best: { x: number; area: number } | null = null;
  for (const f of faces) {
    const b = f.boundingBox;
    if (!b || b.height < MIN_FACE * h) continue;
    const area = b.width * b.height;
    if (!best || area > best.area) best = { x: (b.originX + b.width / 2) / w, area };
  }
  return best ? Math.min(1, Math.max(0, best.x)) : null;
}

export function sampleTimes(windows: Range[], budget = 900): number[] {
  const merged = mergeRanges(windows);
  const span = merged.reduce((s, [a, b]) => s + (b - a), 0);
  const step = Math.min(2, Math.max(0.4, span / budget));
  const out: number[] = [];
  for (const [a, b] of merged) {
    for (let t = a; t < b; t += step) out.push(t);
    if (out[out.length - 1] !== b) out.push(Math.max(a, b - 0.05));
  }
  return out;
}

async function sampleFaces(
  media: MediaFile,
  windows: Range[],
  det: FaceDetector,
  opts: { signal?: AbortSignal; onProgress?: (r: number) => void },
): Promise<FaceSample[]> {
  if (media.kind === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = media.mediaUrl;
    await img.decode();
    return [{ t: 0, x: faceX(det, img, img.naturalWidth, img.naturalHeight) }];
  }
  const times = sampleTimes(windows);
  const input = new Input({ source: new UrlSource(media.mediaUrl), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return [];
    const sink = new CanvasSink(track, { width: 480, poolSize: 2 });
    const out: FaceSample[] = [];
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (opts.signal?.aborted) throw new Error('Reframe cancelled.');
      const t = times[i++];
      if (frame) out.push({ t, x: faceX(det, frame.canvas, frame.canvas.width, frame.canvas.height) });
      opts.onProgress?.(i / times.length);
    }
    return out;
  } finally {
    input.dispose();
  }
}

export type ReframeFollow = 'face' | 'center';

export interface ReframeResult {
  clips: number;
  moving: number;
  followed: string[];
  centred: string[];
}

export function reframeTargets(clips: Clip[], kinds: Map<string, string>, lockedTracks: Set<string>, only?: Set<string>): MediaClip[] {
  return clips.filter(
    (c): c is MediaClip =>
      c.type === 'media' &&
      (kinds.get(c.mediaId) === 'video' || kinds.get(c.mediaId) === 'image') &&
      c.sourceWidth > 0 &&
      !lockedTracks.has(c.trackId) &&
      (!only || only.has(c.id)),
  );
}

export async function runReframe(opts: {
  canvas: Canvas;
  follow: ReframeFollow;
  only?: Set<string>;
  signal?: AbortSignal;
  onProgress?: (ratio: number, status: string) => void;
}): Promise<ReframeResult> {
  const canvas = exportDims(opts.canvas);
  const s0 = useTimelineStore.getState();
  const mediaList = useMediaStore.getState().media;
  const kinds = new Map(mediaList.map((m) => [m.id, m.kind]));
  const locked = new Set(s0.tracks.filter((t) => t.locked).map((t) => t.id));
  const targets = reframeTargets(s0.clips, kinds, locked, opts.only);
  if (targets.length === 0) throw new Error('There is no video or image on the timeline to reframe.');

  const byMedia = new Map<string, MediaClip[]>();
  for (const c of targets) byMedia.set(c.mediaId, [...(byMedia.get(c.mediaId) ?? []), c]);
  const paths = new Map<string, PathKey[]>();
  const followed: string[] = [];
  const centred: string[] = [];
  if (opts.follow === 'face') {
    opts.onProgress?.(0, 'Loading the face detector…');
    const det = await createFaceDetector();
    try {
      let done = 0;
      for (const [id, cs] of byMedia) {
        const m = mediaList.find((x) => x.id === id);
        if (!m) continue;
        const windows = cs.map((c): Range => (c.freezeAt != null ? [c.freezeAt, c.freezeAt + 0.05] : sourceWindow(c)));
        const samples = await sampleFaces(m, windows, det, {
          signal: opts.signal,
          onProgress: (r) => opts.onProgress?.((done + r) / byMedia.size, `Finding faces in ${m.name}…`),
        });
        const path = cameraPath(samples);
        paths.set(id, path);
        (path.length > 0 ? followed : centred).push(m.name);
        done++;
      }
    } finally {
      det.close();
    }
  }
  if (opts.signal?.aborted) throw new Error('Reframe cancelled.');

  const ids = new Set(targets.map((c) => c.id));
  const s = useTimelineStore.getState();
  let moving = 0;
  const clips = s.clips.map((c) => {
    if (!ids.has(c.id) || c.type !== 'media') return c;
    const next = reframeClip(c, paths.get(c.mediaId) ?? [], canvas);
    if (next.keyframes.some((k) => k.prop === 'posX')) moving++;
    return next;
  });
  s.pause();
  s.pushHistory();
  useTimelineStore.setState({ clips, canvas, canvasUserSet: true });
  return { clips: targets.length, moving, followed, centred };
}
