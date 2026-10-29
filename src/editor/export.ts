import {
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  StreamTarget,
  CanvasSource,
  AudioBufferSource,
  Input,
  UrlSource,
  CanvasSink,
  VideoSample,
  VideoSampleSink,
  ALL_FORMATS,
  QUALITY_LOW,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  type Quality,
  type StreamTargetChunk,
} from 'mediabunny';
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { MediaFile } from '@shared/types';
import { keyFrame } from './chroma';
import { denoiseChannel } from './denoise';
import { decodeAudioBuffer } from './audioDecode';
import { addPassthroughTrack, openPassthrough, passthroughClip } from './passthrough';
import { CEILING_BY_QUALITY, MAX_BOOST_DB, normalizeLoudness, type LoudnessResult } from './loudness';
import { getLutProcessor } from './lut';
import { lutById } from './lutStore';
import { makeMaskCanvas, maskKey } from './mask';
import { timeStretch } from './stretch';
import { fxMode, getFxProcessor } from './fx';
import { applyMask, createImageSegmenter } from './segmenter';
import {
  activeOverlays,
  activeVisualLayers,
  activeWordAt,
  audibleTrackIds,
  clipFilter,
  DEFAULT_KARAOKE_COLOR,
  karaokeActive,
  clipLayout,
  DEFAULT_BACKGROUND,
  fadeFactor,
  hasSpeedKeys,
  hexToRgba,
  keyOpacity,
  sourceTimeAt,
  REF_HEIGHT,
  resolvedValue,
  textAnim,
  timelineDuration,
  visibleText,
  withKeyframes,
  type Background,
  type Canvas,
  type Clip,
  type DrawClip,
  type MediaClip,
  type ShapeClip,
  type TextClip,
  type Track,
  type VisualLayer,
} from './timelineStore';
import { polyPoints } from './shapes';

export interface ExportProgress {
  phase: 'audio' | 'video' | 'finalizing';
  ratio: number;
}

export type ExportFormat = 'mp4' | 'webm';
export type ExportQuality = 'low' | 'medium' | 'high';

export interface ExportSettings {
  format: ExportFormat;
  height: number;
  fps: number;
  quality: ExportQuality;
  loudness: number | null;
}

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = { format: 'mp4', height: 1080, fps: 30, quality: 'high', loudness: null };

export interface ExportOptions {
  clips: Clip[];
  tracks: Track[];
  canvas: Canvas;
  background?: Background;
  media: MediaFile[];
  settings?: Partial<ExportSettings>;
  onProgress?: (p: ExportProgress) => void;
  signal?: { cancelled: boolean };
  onChunk?: (data: Uint8Array, position: number) => Promise<void>;
}

export interface ExportResult {
  data: Uint8Array | null;
  ext: 'mp4' | 'webm' | 'm4a';
  warnings: string[];
  loudness?: LoudnessResult;
  copiedVideo?: boolean;
}

const QUALITY: Record<ExportQuality, Quality> = { low: QUALITY_LOW, medium: QUALITY_MEDIUM, high: QUALITY_HIGH };
const even = (n: number): number => (n % 2 === 0 ? n : n + 1);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

const isMediaClip = (c: Clip): c is MediaClip => c.type === 'media';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

type DecodedFrame = { canvas: HTMLCanvasElement | OffscreenCanvas; timestamp: number; duration: number };

export interface SourceFrame {
  src: HTMLCanvasElement | OffscreenCanvas | VideoFrame;
  width: number;
  height: number;
  canvas(): HTMLCanvasElement;
}

class ClipFrameReader {
  private input: Input | null = null;
  private samples: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private canvases: AsyncGenerator<DecodedFrame, void, unknown> | null = null;
  private cur: VideoSample | DecodedFrame | null = null;
  private next: VideoSample | DecodedFrame | null = null;
  private started = false;
  private failed = false;
  private scratch: HTMLCanvasElement | null = null;
  private scratchOf: unknown = null;
  lastUsedFrame = 0;
  lastLocal = 0;

  constructor(
    private url: string,
    private localStart: number,
  ) {}

  private async pull(): Promise<VideoSample | DecodedFrame | null> {
    const r = this.samples ? await this.samples.next() : this.canvases ? await this.canvases.next() : null;
    return !r || r.done || !r.value ? null : r.value;
  }

  private async ensure(): Promise<boolean> {
    if (this.started) return !this.failed;
    this.started = true;
    try {
      this.input = new Input({ source: new UrlSource(this.url), formats: ALL_FORMATS });
      const track = await this.input.getPrimaryVideoTrack();
      if (!track) throw new Error('no video track');
      if (track.rotation === 0) this.samples = new VideoSampleSink(track).samples(this.localStart);
      else this.canvases = new CanvasSink(track).canvases(this.localStart) as AsyncGenerator<DecodedFrame, void, unknown>;
      this.cur = await this.pull();
      this.next = await this.pull();
    } catch {
      this.failed = true;
      await this.dispose();
    }
    return !this.failed;
  }

  private static close(f: VideoSample | DecodedFrame | null): void {
    if (f instanceof VideoSample) f.close();
  }

  async frameAt(t: number): Promise<SourceFrame | null> {
    if (!(await this.ensure())) return null;
    try {
      while (this.next && this.next.timestamp <= t + 1e-6) {
        ClipFrameReader.close(this.cur);
        this.cur = this.next;
        this.next = await this.pull();
      }
    } catch {
      this.failed = true;
    }
    const f = this.cur;
    if (!f) return null;
    if (!(f instanceof VideoSample)) {
      const c = f.canvas as HTMLCanvasElement;
      return { src: c, width: c.width, height: c.height, canvas: () => c };
    }
    const src = f.toCanvasImageSource();
    const width = f.displayWidth;
    const height = f.displayHeight;
    return {
      src,
      width,
      height,
      canvas: () => {
        this.scratch ??= document.createElement('canvas');
        if (this.scratchOf !== f) {
          if (this.scratch.width !== width || this.scratch.height !== height) {
            this.scratch.width = width;
            this.scratch.height = height;
          }
          this.scratch.getContext('2d')?.drawImage(src, 0, 0, width, height);
          this.scratchOf = f;
        }
        return this.scratch;
      },
    };
  }

  async dispose(): Promise<void> {
    try {
      await (this.samples ?? this.canvases)?.return?.();
    } catch {
    }
    ClipFrameReader.close(this.cur);
    ClipFrameReader.close(this.next);
    this.samples = null;
    this.canvases = null;
    this.cur = null;
    this.next = null;
    this.scratchOf = null;
    this.input?.dispose();
    this.input = null;
  }
}

class ClipReaders {
  private readers = new Map<string, ClipFrameReader>();
  frameIdx = 0;

  constructor(private mediaById: Map<string, MediaFile>) {}

  async frame(clip: MediaClip, t: number): Promise<SourceFrame | null> {
    const m = this.mediaById.get(clip.mediaId);
    if (m?.kind !== 'video') return null;
    const local = clamp(sourceTimeAt(clip, t), 0, Math.max(0, clip.sourceDuration - 0.001));
    let reader = this.readers.get(clip.id);
    if (reader && (local < reader.lastLocal - 0.05 || local > reader.lastLocal + 2)) {
      await reader.dispose();
      reader = undefined;
    }
    if (!reader) {
      reader = new ClipFrameReader(m.mediaUrl, local);
      this.readers.set(clip.id, reader);
    }
    reader.lastUsedFrame = this.frameIdx;
    reader.lastLocal = local;
    return reader.frameAt(local);
  }

  async reap(idleFrames: number): Promise<void> {
    for (const [id, reader] of this.readers) {
      if (this.frameIdx - reader.lastUsedFrame > idleFrames) {
        await reader.dispose();
        this.readers.delete(id);
      }
    }
  }

  async disposeAll(): Promise<void> {
    for (const reader of this.readers.values()) await reader.dispose();
    this.readers.clear();
  }
}

interface LayerFx {
  dx: number;
  scale: number;
  blur: number;
  reveal?: { l: number; t: number; r: number; b: number };
}

function drawClip(
  ctx: CanvasRenderingContext2D,
  clip: MediaClip,
  src: CanvasImageSource & { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number; displayWidth?: number; displayHeight?: number },
  W: number,
  H: number,
  opacity: number,
  fx: LayerFx,
): void {
  const sw = src.naturalWidth || src.displayWidth || src.width || W;
  const sh = src.naturalHeight || src.displayHeight || src.height || H;
  const L = clipLayout(clip, sw, sh, W, H);
  ctx.save();
  ctx.globalAlpha = opacity;
  if (fx.reveal) {
    const r = fx.reveal;
    ctx.beginPath();
    ctx.rect(W * r.l, H * r.t, W * (1 - r.l - r.r), H * (1 - r.t - r.b));
    ctx.clip();
  }
  const blurPx = fx.blur > 0 ? fx.blur * (H / REF_HEIGHT) : 0;
  ctx.filter = blurPx > 0 ? `${clipFilter(clip)} blur(${blurPx}px)` : clipFilter(clip);
  ctx.translate(L.cx + fx.dx * W, L.cy);
  if (L.rotation) ctx.rotate((L.rotation * Math.PI) / 180);
  const dw = L.dw * fx.scale;
  const dh = L.dh * fx.scale;
  ctx.drawImage(src, L.sx, L.sy, L.sw, L.sh, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

const shapeMaskCache = new Map<string, HTMLCanvasElement>();
let shapeMaskScratch: HTMLCanvasElement | null = null;

function applyShapeMask(src: CanvasImageSource, srcW: number, srcH: number, clip: MediaClip): HTMLCanvasElement | null {
  const m = clip.mask;
  const vig = clip.vignette ?? 0;
  if (!m && vig <= 0) return null;
  const cfW = Math.max(0.01, 1 - clip.cropLeft - clip.cropRight);
  const cfH = Math.max(0.01, 1 - clip.cropTop - clip.cropBottom);
  const sw = Math.round(srcW * cfW);
  const sh = Math.round(srcH * cfH);
  const sx = srcW * clip.cropLeft;
  const sy = srcH * clip.cropTop;

  shapeMaskScratch ??= document.createElement('canvas');
  const scratch = shapeMaskScratch;
  if (scratch.width !== srcW || scratch.height !== srcH) {
    scratch.width = srcW;
    scratch.height = srcH;
  }
  const ctx = scratch.getContext('2d');
  if (!ctx) return null;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, srcW, srcH);
  ctx.drawImage(src, 0, 0, srcW, srcH);

  if (m) {
    const key = `${clip.id}|${maskKey(m, sw, sh)}`;
    let mask = shapeMaskCache.get(key);
    if (!mask) {
      mask = makeMaskCanvas(sw, sh, m);
      shapeMaskCache.set(key, mask);
    }
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, sx, sy, sw, sh);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (vig > 0) {
    const cx = sx + sw / 2;
    const cy = sy + sh / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sw * 0.75, sh * 0.75);
    const g = ctx.createRadialGradient(0, 0, 0.6, 0, 0, 1);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${vig})`);
    ctx.fillStyle = g;
    ctx.fillRect(-1.5, -1.5, 3, 3);
    ctx.restore();
  }
  return scratch;
}

function segMask(src: HTMLCanvasElement | HTMLImageElement, imgSeg: ImageSegmenter): HTMLCanvasElement | null {
  const result = imgSeg.segment(src);
  const mask = result.confidenceMasks?.[0];
  const out = mask ? applyMask(src, mask) : null;
  result.close();
  return out;
}

async function drawVisualClip(
  ctx: CanvasRenderingContext2D,
  clip: MediaClip,
  t: number,
  opacity: number,
  fx: LayerFx,
  W: number,
  H: number,
  readers: ClipReaders,
  images: Map<string, HTMLImageElement>,
  mediaById: Map<string, MediaFile>,
  imgSeg: ImageSegmenter | null,
): Promise<void> {
  if (opacity <= 0) return;
  const m = mediaById.get(clip.mediaId);
  const eff = withKeyframes(clip, t);
  const mode = fxMode(clip.effect);
  ctx.globalCompositeOperation = clip.blend && clip.blend !== 'normal' ? clip.blend : 'source-over';
  if (m?.kind === 'video') {
    const base = await readers.frame(clip, t);
    if (base) {
      let frame: HTMLCanvasElement | OffscreenCanvas | VideoFrame = base.src;
      if (clip.bgRemove && imgSeg) frame = segMask(base.canvas(), imgSeg) ?? base.canvas();
      else if (clip.chromaKey) frame = keyFrame(base.canvas(), clip.chromaColor, clip.chromaSimilarity, clip.chromaSmoothness);
      else if (mode > 0) frame = getFxProcessor().render(base.canvas(), mode, base.width, base.height, t - clip.start) ?? base.canvas();
      else if (clip.lut) {
        const lut = lutById(clip.lut);
        if (lut) frame = getLutProcessor().render(base.canvas(), lut, clip.lutAmount ?? 1, base.width, base.height) ?? base.canvas();
      }
      frame = applyShapeMask(frame, base.width, base.height, clip) ?? frame;
      drawClip(ctx, eff, frame, W, H, opacity, fx);
    }
    ctx.globalCompositeOperation = 'source-over';
    return;
  }
  if (m?.kind === 'image') {
    const img = images.get(m.id);
    if (img) {
      let frame: HTMLCanvasElement | HTMLImageElement = img;
      if (clip.bgRemove && imgSeg) frame = segMask(img, imgSeg) ?? img;
      else if (clip.chromaKey) frame = keyFrame(img, clip.chromaColor, clip.chromaSimilarity, clip.chromaSmoothness);
      else if (mode > 0) frame = getFxProcessor().render(img, mode, img.naturalWidth, img.naturalHeight, t - clip.start) ?? img;
      else if (clip.lut) {
        const lut = lutById(clip.lut);
        if (lut) frame = getLutProcessor().render(img, lut, clip.lutAmount ?? 1, img.naturalWidth, img.naturalHeight) ?? img;
      }
      frame = applyShapeMask(frame, img.naturalWidth, img.naturalHeight, clip) ?? frame;
      drawClip(ctx, eff, frame, W, H, opacity, fx);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

async function fetchFrame(
  clip: MediaClip,
  t: number,
  readers: ClipReaders,
  images: Map<string, HTMLImageElement>,
  mediaById: Map<string, MediaFile>,
): Promise<{ src: CanvasImageSource; sw: number; sh: number } | null> {
  const m = mediaById.get(clip.mediaId);
  if (m?.kind === 'video') {
    const base = await readers.frame(clip, t);
    if (!base) return null;
    return { src: base.src, sw: base.width, sh: base.height };
  }
  if (m?.kind === 'image') {
    const img = images.get(m.id);
    if (img) return { src: img, sw: img.naturalWidth, sh: img.naturalHeight };
  }
  return null;
}

async function drawBackdropBlur(
  ctx: CanvasRenderingContext2D,
  layer: VisualLayer,
  t: number,
  W: number,
  H: number,
  readers: ClipReaders,
  images: Map<string, HTMLImageElement>,
  mediaById: Map<string, MediaFile>,
): Promise<void> {
  const f = await fetchFrame(layer.clip, t, readers, images, mediaById);
  if (!f || f.sw <= 0 || f.sh <= 0) return;
  const scale = Math.max(W / f.sw, H / f.sh) * 1.12;
  const dw = f.sw * scale;
  const dh = f.sh * scale;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = `blur(${Math.max(2, Math.round(H * 0.025))}px) brightness(0.65)`;
  ctx.drawImage(f.src, (W - dw) / 2, (H - dh) / 2, dw, dh);
  ctx.restore();
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawText(ctx: CanvasRenderingContext2D, tc: TextClip, W: number, H: number, t: number): void {
  const anim = textAnim(tc, t);
  const opacity = fadeFactor(tc, t) * anim.opacity * keyOpacity(tc, t);
  if (opacity <= 0) return;
  const ex = resolvedValue(tc, 'x', t, tc.x);
  const ey = resolvedValue(tc, 'y', t, tc.y);
  const px = tc.fontSize * (H / REF_HEIGHT);
  ctx.save();
  ctx.globalAlpha = opacity;
  if (anim.blur > 0) ctx.filter = `blur(${anim.blur * (H / REF_HEIGHT)}px)`;
  ctx.fillStyle = tc.color;
  ctx.font = `${tc.italic ? 'italic ' : ''}${tc.bold ? '800' : '500'} ${px}px ${tc.fontFamily}`;
  ctx.textBaseline = 'middle';
  if (tc.glow > 0) {
    ctx.shadowColor = tc.glowColor;
    ctx.shadowBlur = tc.glow * (H / REF_HEIGHT) * 1.6;
    ctx.shadowOffsetY = 0;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = px * 0.12;
    ctx.shadowOffsetY = px * 0.03;
  }
  ctx.translate(ex * W + anim.dxFrac * W, ey * H + anim.dyFrac * H);
  if (anim.rotate) ctx.rotate((anim.rotate * Math.PI) / 180);
  ctx.scale(anim.scale, anim.scale);
  const lines = visibleText(tc, t).split('\n');
  const lineH = px * 1.18;
  const blockW = Math.max(...lines.map((l) => ctx.measureText(l).width), 0);

  const bgStyle = tc.bgStyle ?? 'none';
  if (bgStyle !== 'none' && (tc.bgOpacity ?? 1) > 0) {
    const padX = (tc.bgPadding ?? 16) * (H / REF_HEIGHT);
    const padY = padX * 0.55;
    const rad = (tc.bgRadius ?? 10) * (H / REF_HEIGHT);
    ctx.save();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = hexToRgba(tc.bgColor ?? '#000000', tc.bgOpacity ?? 1);
    if (bgStyle === 'box') {
      const bw = blockW + padX * 2;
      const bh = lines.length * lineH + padY * 2;
      roundRectPath(ctx, -bw / 2, -bh / 2, bw, bh, rad);
      ctx.fill();
    } else {
      const rh = px * 1.08 + padY * 1.2;
      let hy = -((lines.length - 1) * lineH) / 2;
      for (const line of lines) {
        const lw = ctx.measureText(line).width;
        if (lw > 0) {
          const lx = tc.align === 'left' ? -blockW / 2 : tc.align === 'right' ? blockW / 2 - lw : -lw / 2;
          roundRectPath(ctx, lx - padX, hy - rh / 2, lw + padX * 2, rh, rad);
          ctx.fill();
        }
        hy += lineH;
      }
    }
    ctx.restore();
  }

  const stroke = tc.outlineWidth * (H / REF_HEIGHT);
  if (stroke > 0) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = tc.outlineColor;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
  }

  if (karaokeActive(tc)) {
    const words = tc.words!;
    const wi = activeWordAt(tc, t);
    const mode = tc.karaoke!;
    const kcol = tc.karaokeColor ?? DEFAULT_KARAOKE_COLOR;
    const wtexts = words.map((w, i) => (i === 0 ? w.text.replace(/^\s+/, '') : w.text));
    const widths = wtexts.map((s) => ctx.measureText(s).width);
    const totalW = widths.reduce((a, b) => a + b, 0);
    let wx = tc.align === 'left' ? -blockW / 2 : tc.align === 'right' ? blockW / 2 - totalW : -totalW / 2;
    ctx.textAlign = 'left';
    for (let i = 0; i < wtexts.length; i++) {
      const active = i === wi;
      ctx.save();
      if (active && mode === 'pop') {
        const cxm = wx + widths[i] / 2;
        ctx.translate(cxm, 0);
        ctx.scale(1.18, 1.18);
        ctx.translate(-cxm, 0);
      }
      if (active && mode === 'box') {
        ctx.shadowColor = 'transparent';
        const bpad = px * 0.12;
        const rh = px * 1.12;
        ctx.fillStyle = kcol;
        roundRectPath(ctx, wx - bpad, -rh / 2, widths[i] + bpad * 2, rh, px * 0.12);
        ctx.fill();
        ctx.fillStyle = '#111111';
        ctx.fillText(wtexts[i], wx, 0);
      } else {
        if (stroke > 0) ctx.strokeText(wtexts[i], wx, 0);
        ctx.fillStyle = active ? kcol : tc.color;
        ctx.fillText(wtexts[i], wx, 0);
      }
      ctx.restore();
      wx += widths[i];
    }
    ctx.restore();
    return;
  }

  let cy = -((lines.length - 1) * lineH) / 2;
  for (const line of lines) {
    const x = tc.align === 'left' ? -blockW / 2 : tc.align === 'right' ? blockW / 2 : 0;
    ctx.textAlign = tc.align;
    if (stroke > 0) ctx.strokeText(line, x, cy);
    ctx.fillText(line, x, cy);
    cy += lineH;
  }
  ctx.restore();
}

function traceShape(ctx: CanvasRenderingContext2D, kind: ShapeClip['shape'], w: number, h: number): void {
  ctx.beginPath();
  if (kind === 'ellipse') {
    ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    return;
  }
  if (kind === 'line') {
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2, 0);
    return;
  }
  if (kind === 'rect' || kind === 'rounded') {
    const r = kind === 'rounded' ? Math.min(w, h) * 0.18 : 0;
    const x = -w / 2;
    const y = -h / 2;
    if (r <= 0) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
    return;
  }
  const pp = polyPoints(kind);
  if (!pp) return;
  for (let i = 0; i + 1 < pp.length; i += 2) {
    const px = (pp[i] - 0.5) * w;
    const py = (pp[i + 1] - 0.5) * h;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function drawShape(ctx: CanvasRenderingContext2D, clip: ShapeClip, W: number, H: number, t: number): void {
  const anim = textAnim(clip, t);
  const opacity = fadeFactor(clip, t) * anim.opacity * keyOpacity(clip, t);
  if (opacity <= 0) return;
  const ex = resolvedValue(clip, 'x', t, clip.x) + anim.dxFrac;
  const ey = resolvedValue(clip, 'y', t, clip.y) + anim.dyFrac;
  const w = clip.w * W;
  const h = clip.h * H;
  const sw = clip.strokeWidth * (H / REF_HEIGHT);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(ex * W, ey * H + 0);
  ctx.rotate(((clip.rotation + anim.rotate) * Math.PI) / 180);
  ctx.scale(anim.scale, anim.scale);
  traceShape(ctx, clip.shape, w, h);
  if (clip.fill && clip.shape !== 'line') {
    ctx.fillStyle = clip.fill;
    ctx.fill();
  }
  if (sw > 0 && clip.stroke) {
    ctx.lineWidth = sw;
    ctx.strokeStyle = clip.stroke;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  } else if (clip.shape === 'line') {
    ctx.lineWidth = Math.max(1, sw);
    ctx.strokeStyle = clip.stroke || '#ffffff';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

function drawDraw(ctx: CanvasRenderingContext2D, clip: DrawClip, W: number, H: number, t: number): void {
  const anim = textAnim(clip, t);
  const opacity = fadeFactor(clip, t) * anim.opacity * keyOpacity(clip, t);
  if (opacity <= 0) return;
  const ox = (resolvedValue(clip, 'x', t, clip.x) + anim.dxFrac) * W;
  const oy = (resolvedValue(clip, 'y', t, clip.y) + anim.dyFrac) * H;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(ox, oy);
  ctx.scale(anim.scale, anim.scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of clip.strokes) {
    if (s.points.length < 4) continue;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width * (H / REF_HEIGHT);
    ctx.moveTo(s.points[0] * W, s.points[1] * H);
    for (let i = 2; i + 1 < s.points.length; i += 2) ctx.lineTo(s.points[i] * W, s.points[i + 1] * H);
    ctx.stroke();
  }
  ctx.restore();
}

async function mixAudio(
  clips: Clip[],
  tracks: Track[],
  mediaById: Map<string, MediaFile>,
  total: number,
  warnings: string[],
): Promise<AudioBuffer | null> {
  const audible = audibleTrackIds(tracks);
  const contributors = clips.filter(
    (c): c is MediaClip =>
      isMediaClip(c) &&
      !c.muted &&
      c.freezeAt == null &&
      c.volume > 0 &&
      audible.has(c.trackId) &&
      (mediaById.get(c.mediaId)?.kind === 'video' || mediaById.get(c.mediaId)?.kind === 'audio'),
  );
  if (contributors.length === 0) return null;

  const sampleRate = 48000;
  const length = Math.ceil(total * sampleRate);
  if (length <= 0) return null;

  const octx = new OfflineAudioContext(2, length, sampleRate);

  const xIn = new Map<string, number>();
  const xOut = new Map<string, number>();
  for (const c of clips) {
    if (!isMediaClip(c) || c.transition === 'none' || c.transitionDur <= 0) continue;
    const d = Math.min(c.transitionDur, c.duration);
    const out = clips.find(
      (o): o is MediaClip => isMediaClip(o) && o.id !== c.id && o.trackId === c.trackId && Math.abs(o.start + o.duration - c.start) < 0.03,
    );
    if (!out) continue;
    xIn.set(c.id, d);
    xOut.set(out.id, d);
  }

  const spans = new Map<string, [number, number]>();
  for (const c of contributors) {
    const playDur = c.duration + (xOut.get(c.id) ?? 0);
    const b = hasSpeedKeys(c) ? c.sourceDuration : c.inPoint + playDur * c.speed;
    const [x, y] = spans.get(c.mediaId) ?? [Infinity, -Infinity];
    spans.set(c.mediaId, [Math.min(x, c.inPoint), Math.max(y, b)]);
  }
  const decoded = new Map<string, { buf: AudioBuffer; off: number } | null>();
  for (const [id, [a, b]] of spans) {
    const m = mediaById.get(id);
    if (!m) continue;
    const off = Math.max(0, a - 0.5);
    try {
      const buf = await decodeAudioBuffer(m.mediaUrl, octx, sampleRate, { start: off, end: b + 0.5 });
      decoded.set(id, buf ? { buf, off } : null);
    } catch {
      decoded.set(id, null);
      if (m.kind === 'audio') warnings.push(`Audio from ${m.name} couldn't be decoded — it exported silent.`);
    }
  }

  for (const c of contributors) {
    const d = decoded.get(c.mediaId);
    if (!d) continue;
    const { buf, off } = d;
    const inPoint = c.inPoint - off;

    const startT = c.start;
    const extend = xOut.get(c.id) ?? 0;
    const playDur = c.duration + extend;

    const wantDenoise = !!c.denoise;
    const denoiseInPlace = (b: AudioBuffer): void => {
      if (!wantDenoise) return;
      for (let ch = 0; ch < b.numberOfChannels; ch++) b.copyToChannel(denoiseChannel(b.getChannelData(ch)) as Float32Array<ArrayBuffer>, ch);
    };

    const node = octx.createBufferSource();
    if (hasSpeedKeys(c)) {
      const sr = buf.sampleRate;
      const cuts = [
        0,
        ...(c.keyframes ?? [])
          .filter((k) => k.prop === 'speed' && k.t > 1e-3 && k.t < playDur - 1e-3)
          .map((k) => k.t)
          .sort((a, b) => a - b),
        playDur,
      ];
      const sbuf = octx.createBuffer(buf.numberOfChannels, Math.max(1, Math.ceil(playDur * sr)), sr);
      for (let i = 0; i < cuts.length - 1; i++) {
        const t0 = cuts[i];
        const t1 = cuts[i + 1];
        if (t1 - t0 < 1e-3) continue;
        const srcA = sourceTimeAt(c, c.start + t0);
        const srcB = sourceTimeAt(c, c.start + t1);
        const srcStart = Math.max(0, Math.floor((srcA - off) * sr));
        const srcLen = Math.min(buf.length - srcStart, Math.ceil((srcB - srcA) * sr));
        if (srcLen <= 0) continue;
        const rate = (srcB - srcA) / (t1 - t0);
        const chans: Float32Array<ArrayBuffer>[] = [];
        for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch).subarray(srcStart, srcStart + srcLen));
        const stretched = timeStretch(chans, rate);
        const offset = Math.floor(t0 * sr);
        const slot = Math.min(stretched[0].length, sbuf.length - offset);
        stretched.forEach((d, ch) => sbuf.copyToChannel(d.length > slot ? d.slice(0, slot) : d, ch, offset));
      }
      denoiseInPlace(sbuf);
      node.buffer = sbuf;
    } else if (Math.abs(c.speed - 1) > 1e-3) {
      const srcStart = Math.max(0, Math.floor(inPoint * buf.sampleRate));
      const srcLen = Math.min(buf.length - srcStart, Math.ceil(playDur * c.speed * buf.sampleRate));
      if (srcLen <= 0) continue;
      const chans: Float32Array<ArrayBuffer>[] = [];
      for (let ch = 0; ch < buf.numberOfChannels; ch++) chans.push(buf.getChannelData(ch).subarray(srcStart, srcStart + srcLen));
      const stretched = timeStretch(chans, c.speed);
      const sbuf = octx.createBuffer(buf.numberOfChannels, stretched[0].length, buf.sampleRate);
      stretched.forEach((d, ch) => sbuf.copyToChannel(d, ch));
      denoiseInPlace(sbuf);
      node.buffer = sbuf;
    } else if (wantDenoise) {
      const sr = buf.sampleRate;
      const srcStart = Math.max(0, Math.floor(inPoint * sr));
      const srcLen = Math.max(1, Math.min(buf.length - srcStart, Math.ceil(playDur * sr)));
      const sbuf = octx.createBuffer(buf.numberOfChannels, srcLen, sr);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        sbuf.copyToChannel(buf.getChannelData(ch).subarray(srcStart, srcStart + srcLen) as Float32Array<ArrayBuffer>, ch);
      }
      denoiseInPlace(sbuf);
      node.buffer = sbuf;
    } else {
      node.buffer = buf;
    }

    const gain = octx.createGain();
    const fadeInDur = Math.max(c.fadeIn, xIn.get(c.id) ?? 0);
    const fadeOutDur = Math.max(c.fadeOut, extend);
    const n = Math.max(2, Math.ceil(playDur * 50));
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const rel = (i / (n - 1)) * playDur;
      let g = resolvedValue(c, 'volume', c.start + rel, c.volume);
      if (fadeInDur > 0) g *= Math.min(1, rel / fadeInDur);
      if (fadeOutDur > 0) g *= Math.min(1, (playDur - rel) / fadeOutDur);
      curve[i] = Math.max(0.0001, g);
    }
    gain.gain.setValueCurveAtTime(curve, startT, playDur);

    node.connect(gain).connect(octx.destination);
    if (hasSpeedKeys(c) || Math.abs(c.speed - 1) > 1e-3 || wantDenoise) node.start(startT, 0, playDur);
    else node.start(startT, Math.max(0, inPoint), playDur);
  }

  return octx.startRendering();
}

function toU8(buffer: ArrayBuffer | null): Uint8Array {
  if (!buffer) throw new Error('Export produced no data.');
  return new Uint8Array(buffer);
}

async function hardwarePreference(webm: boolean, width: number, height: number): Promise<'prefer-hardware' | 'no-preference'> {
  try {
    const codec = webm ? 'vp09.00.10.08' : height > 1088 ? 'avc1.640033' : 'avc1.640028';
    const s = await VideoEncoder.isConfigSupported({ codec, width, height, hardwareAcceleration: 'prefer-hardware' });
    return s.supported ? 'prefer-hardware' : 'no-preference';
  } catch {
    return 'no-preference';
  }
}

async function drawFrameAt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  t: number,
  clips: Clip[],
  tracks: Track[],
  bg: Background,
  readers: ClipReaders,
  images: Map<string, HTMLImageElement>,
  mediaById: Map<string, MediaFile>,
  imgSeg: ImageSegmenter | null,
): Promise<void> {
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  const layers = activeVisualLayers(clips, tracks, t);
  if (bg.type === 'color') {
    ctx.fillStyle = bg.color;
  } else if (bg.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, height);
    g.addColorStop(0, bg.color);
    g.addColorStop(1, bg.color2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = '#000000';
  }
  ctx.fillRect(0, 0, width, height);
  if (bg.type === 'blur' && layers[0]) await drawBackdropBlur(ctx, layers[0], t, width, height, readers, images, mediaById);
  for (const L of layers) {
    await drawVisualClip(ctx, L.clip, t, L.opacity, { dx: L.dx, scale: L.scale, blur: L.blur, reveal: L.reveal }, width, height, readers, images, mediaById, imgSeg);
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  for (const oc of activeOverlays(clips, t, tracks)) {
    if (oc.type === 'text') drawText(ctx, oc, width, height, t);
    else if (oc.type === 'shape') drawShape(ctx, oc, width, height, t);
    else drawDraw(ctx, oc, width, height, t);
  }
}

export async function renderStills(
  opts: Pick<ExportOptions, 'clips' | 'tracks' | 'canvas' | 'background' | 'media'>,
  times: number[],
  height = 360,
): Promise<string[]> {
  const { clips, tracks, canvas, media } = opts;
  const bg: Background = opts.background ?? DEFAULT_BACKGROUND;
  const h = even(Math.max(2, Math.round(height)));
  const w = even(Math.max(2, Math.round(h * (canvas.width / canvas.height))));
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing canvas.');
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const used = new Set(clips.filter(isMediaClip).map((c) => c.mediaId));
  const images = new Map<string, HTMLImageElement>();
  for (const m of media) {
    if (!used.has(m.id) || m.kind !== 'image') continue;
    try {
      images.set(m.id, await loadImage(m.mediaUrl));
    } catch {
    }
  }
  try {
    await document.fonts.ready;
  } catch {
  }
  const readers = new ClipReaders(mediaById);
  const total = timelineDuration(clips);
  const out: string[] = [];
  try {
    for (let i = 0; i < times.length; i++) {
      readers.frameIdx = i;
      const t = Math.max(0, Math.min(Math.max(0, total - 1e-4), times[i]));
      await drawFrameAt(ctx, w, h, t, clips, tracks, bg, readers, images, mediaById, null);
      const url = cnv.toDataURL('image/jpeg', 0.85);
      out.push(url.slice(url.indexOf(',') + 1));
    }
  } finally {
    await readers.disposeAll();
  }
  return out;
}

function throttleProgress(fn: (p: ExportProgress) => void): (p: ExportProgress) => void {
  let last = -Infinity;
  let phase = '';
  return (p) => {
    const now = performance.now();
    if (p.phase === phase && now - last < 100) return;
    phase = p.phase;
    last = now;
    fn(p);
  };
}

export async function exportTimeline(opts: ExportOptions): Promise<ExportResult> {
  const { clips, tracks, canvas, media } = opts;
  const bg: Background = opts.background ?? DEFAULT_BACKGROUND;
  const s: ExportSettings = { ...DEFAULT_EXPORT_SETTINGS, ...opts.settings };
  const fps = Math.max(1, Math.min(120, s.fps));
  const bitrate = QUALITY[s.quality];
  const onProgress = throttleProgress(opts.onProgress ?? (() => {}));
  const total = timelineDuration(clips);
  if (total <= 0) throw new Error('Nothing on the timeline to export.');

  const mediaById = new Map(media.map((m) => [m.id, m]));
  const usedMediaIds = new Set(clips.filter(isMediaClip).map((c) => c.mediaId));
  const hasVisual = clips.some(
    (c) => c.type !== 'media' || mediaById.get(c.mediaId)?.kind !== 'audio',
  );
  const onChunk = opts.onChunk;
  const makeTarget = (): BufferTarget | StreamTarget =>
    onChunk
      ? new StreamTarget(new WritableStream<StreamTargetChunk>({ write: (c) => onChunk(c.data, c.position) }), { chunked: true })
      : new BufferTarget();
  const finish = (out: Output): Uint8Array | null => (out.target instanceof BufferTarget ? toU8(out.target.buffer) : null);

  const warnings: string[] = [];
  onProgress({ phase: 'audio', ratio: 0 });
  const audioBuffer = await mixAudio(clips, tracks, mediaById, total, warnings);
  let loudness: LoudnessResult | undefined;
  if (audioBuffer && s.loudness != null) {
    const chans = Array.from({ length: audioBuffer.numberOfChannels }, (_, c) => audioBuffer.getChannelData(c));
    loudness = normalizeLoudness(chans, audioBuffer.sampleRate, s.loudness, CEILING_BY_QUALITY[s.quality]) ?? undefined;
    if (loudness && loudness.gainDb < s.loudness - loudness.before - 0.1) {
      warnings.push(`The mix is very quiet (${loudness.before.toFixed(1)} LUFS), so it was boosted by the maximum ${MAX_BOOST_DB} dB to ${loudness.after.toFixed(1)} LUFS instead of ${s.loudness}.`);
    }
  }

  if (!hasVisual) {
    if (!audioBuffer) throw new Error('Nothing audible to export.');
    const out = new Output({ format: new Mp4OutputFormat(), target: makeTarget() });
    const src = new AudioBufferSource({ codec: 'aac', bitrate });
    out.addAudioTrack(src);
    await out.start();
    await src.add(audioBuffer);
    onProgress({ phase: 'finalizing', ratio: 0.95 });
    await out.finalize();
    return { data: finish(out), ext: 'm4a', warnings, loudness };
  }

  const webm = s.format === 'webm';
  const height = even(Math.max(2, Math.round(s.height || canvas.height)));
  const width = even(Math.max(2, Math.round(height * (canvas.width / canvas.height))));
  const pass = passthroughClip(clips, tracks, mediaById, { format: s.format, quality: s.quality, width, height }, total);
  const passSrc = pass ? await openPassthrough(mediaById.get(pass.mediaId)!.mediaUrl, fps) : null;
  if (passSrc) {
    try {
      const o = new Output({ format: new Mp4OutputFormat(), target: makeTarget() });
      const feed = addPassthroughTrack(o, passSrc, fps);
      let a: AudioBufferSource | null = null;
      if (audioBuffer) {
        a = new AudioBufferSource({ codec: 'aac', bitrate });
        o.addAudioTrack(a);
      }
      await o.start();
      await feed((r) => {
        if (opts.signal?.cancelled) throw new Error('Export cancelled.');
        onProgress({ phase: 'video', ratio: r * (audioBuffer ? 0.9 : 1) });
      }, total);
      if (a && audioBuffer) await a.add(audioBuffer);
      onProgress({ phase: 'finalizing', ratio: 0.97 });
      await o.finalize();
      return { data: finish(o), ext: 'mp4', warnings, loudness, copiedVideo: true };
    } finally {
      passSrc.input.dispose();
    }
  }

  const cnv = document.createElement('canvas');
  cnv.width = width;
  cnv.height = height;
  const ctx = cnv.getContext('2d');
  if (!ctx) throw new Error('Could not create a drawing canvas.');

  const buildPipeline = async (pref: 'prefer-hardware' | 'no-preference') => {
    const o = new Output({ format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(), target: makeTarget() });
    const v = new CanvasSource(cnv, { codec: webm ? 'vp9' : 'avc', bitrate, hardwareAcceleration: pref });
    o.addVideoTrack(v);
    let a: AudioBufferSource | null = null;
    if (audioBuffer) {
      a = new AudioBufferSource({ codec: webm ? 'opus' : 'aac', bitrate });
      o.addAudioTrack(a);
    }
    await o.start();
    return { out: o, vsrc: v, asrc: a };
  };
  const hw = await hardwarePreference(webm, width, height);
  let pipeline: Awaited<ReturnType<typeof buildPipeline>>;
  try {
    pipeline = await buildPipeline(hw);
  } catch (err) {
    if (hw !== 'prefer-hardware') throw err;
    pipeline = await buildPipeline('no-preference');
  }
  const { out, vsrc, asrc } = pipeline;

  const readers = new ClipReaders(mediaById);
  const images = new Map<string, HTMLImageElement>();
  for (const m of media) {
    if (!usedMediaIds.has(m.id) || m.kind !== 'image') continue;
    try {
      images.set(m.id, await loadImage(m.mediaUrl));
    } catch {
      warnings.push(`${m.name} couldn't be read — its clips exported blank.`);
    }
  }

  const textFamilies = [...new Set(clips.filter((c): c is TextClip => c.type === 'text').map((c) => c.fontFamily))];
  if (textFamilies.length > 0) {
    try {
      await document.fonts.ready;
      await Promise.all(textFamilies.flatMap((f) => [document.fonts.load(`500 32px ${f}`), document.fonts.load(`800 32px ${f}`)]));
    } catch {
    }
  }

  let imgSeg: ImageSegmenter | null = null;
  if (clips.some((c) => c.type === 'media' && c.bgRemove)) {
    try {
      imgSeg = await createImageSegmenter();
    } catch {
      warnings.push('Background removal was unavailable (model not downloaded?) — those clips exported without it.');
    }
  }

  const frames = Math.max(1, Math.round(total * fps));
  const videoWeight = audioBuffer ? 0.9 : 1;
  let failedFrames = 0;
  try {
    const idleFrames = Math.max(8, Math.ceil(fps * 4));
    for (let i = 0; i < frames; i++) {
      if (opts.signal?.cancelled) throw new Error('Export cancelled.');
      const t = Math.min(total - 1e-4, i / fps);
      readers.frameIdx = i;

      try {
        await drawFrameAt(ctx, width, height, t, clips, tracks, bg, readers, images, mediaById, imgSeg);
      } catch (err) {
        if (opts.signal?.cancelled) throw err;
        failedFrames++;
        console.warn('[export] frame', i, 'failed', err);
      }

      await vsrc.add(t, 1 / fps);
      if (i % 30 === 29) await readers.reap(idleFrames);
      onProgress({ phase: 'video', ratio: ((i + 1) / frames) * videoWeight });
    }

    if (asrc && audioBuffer) await asrc.add(audioBuffer);
    onProgress({ phase: 'finalizing', ratio: 0.97 });
    await out.finalize();
    if (failedFrames > 0) warnings.push(`${failedFrames} frame${failedFrames === 1 ? '' : 's'} failed to render and exported degraded (see console).`);
    return { data: finish(out), ext: webm ? 'webm' : 'mp4', warnings, loudness };
  } finally {
    await readers.disposeAll();
    imgSeg?.close();
  }
}
