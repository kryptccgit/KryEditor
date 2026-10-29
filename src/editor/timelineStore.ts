import { create } from 'zustand';
import type { MediaFile } from '@shared/types';
import { probeMedia } from './probe';
import type { ClipMask } from './mask';

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted?: boolean;
  solo?: boolean;
  locked?: boolean;
  hidden?: boolean;
}

export function audibleTrackIds(tracks: Track[]): Set<string> {
  const anySolo = tracks.some((t) => t.solo);
  return new Set(tracks.filter((t) => (anySolo ? t.solo : !t.muted)).map((t) => t.id));
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export const BLEND_MODES: Array<{ label: string; value: BlendMode }> = [
  { label: 'Normal', value: 'normal' },
  { label: 'Multiply', value: 'multiply' },
  { label: 'Screen', value: 'screen' },
  { label: 'Overlay', value: 'overlay' },
  { label: 'Darken', value: 'darken' },
  { label: 'Lighten', value: 'lighten' },
  { label: 'Color dodge', value: 'color-dodge' },
  { label: 'Color burn', value: 'color-burn' },
  { label: 'Hard light', value: 'hard-light' },
  { label: 'Soft light', value: 'soft-light' },
  { label: 'Difference', value: 'difference' },
  { label: 'Exclusion', value: 'exclusion' },
  { label: 'Hue', value: 'hue' },
  { label: 'Saturation', value: 'saturation' },
  { label: 'Color', value: 'color' },
  { label: 'Luminosity', value: 'luminosity' },
];

interface ClipBase {
  id: string;
  trackId: string;
  start: number;
  duration: number;
  fadeIn: number;
  fadeOut: number;
}

export interface MediaClip extends ClipBase {
  type: 'media';
  mediaId: string;
  inPoint: number;
  sourceDuration: number;
  sourceWidth: number;
  sourceHeight: number;
  speed: number;
  volume: number;
  muted: boolean;
  brightness: number;
  contrast: number;
  saturation: number;
  hue?: number;
  vignette?: number;
  effect: string;
  scaleX: number;
  scaleY: number;
  posX: number;
  posY: number;
  rotation: number;
  opacity: number;
  blend?: BlendMode;
  cropTop: number;
  cropRight: number;
  cropBottom: number;
  cropLeft: number;
  keyframes: Keyframe[];
  transition: TransitionType;
  transitionDur: number;
  chromaKey: boolean;
  chromaColor: string;
  chromaSimilarity: number;
  chromaSmoothness: number;
  bgRemove: boolean;
  mask?: ClipMask;
  lut?: string;
  lutAmount?: number;
  freezeAt?: number;
  denoise?: boolean;
}

export type TextAnim =
  | 'none'
  | 'fade'
  | 'slide'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'pop'
  | 'zoom'
  | 'bounce'
  | 'spin'
  | 'blur'
  | 'typewriter';

export interface TextClip extends ClipBase {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  outlineWidth: number;
  outlineColor: string;
  glow: number;
  glowColor: string;
  bgStyle: TextBgStyle;
  bgColor: string;
  bgOpacity: number;
  bgRadius: number;
  bgPadding: number;
  align: 'left' | 'center' | 'right';
  x: number;
  y: number;
  opacity?: number;
  animIn: TextAnim;
  animOut: TextAnim;
  keyframes: Keyframe[];
  role?: 'caption';
  words?: Array<{ start: number; end: number; text: string }>;
  karaoke?: KaraokeStyle;
  karaokeColor?: string;
}

export type KaraokeStyle = 'none' | 'color' | 'pop' | 'box';

export const KARAOKE_STYLES: Array<{ label: string; value: KaraokeStyle }> = [
  { label: 'None', value: 'none' },
  { label: 'Color', value: 'color' },
  { label: 'Pop', value: 'pop' },
  { label: 'Box', value: 'box' },
];

export const DEFAULT_KARAOKE_COLOR = '#ffd53d';

export function karaokeActive(clip: TextClip): boolean {
  return !!clip.words && clip.words.length > 0 && !!clip.karaoke && clip.karaoke !== 'none';
}

export function activeWordAt(clip: TextClip, t: number): number {
  const ws = clip.words;
  if (!ws || ws.length === 0) return -1;
  const lt = t - clip.start;
  for (let i = ws.length - 1; i >= 0; i--) if (lt >= ws[i].start) return i;
  return -1;
}

export type TextBgStyle = 'none' | 'box' | 'highlight';

export const TEXT_BG: Array<{ label: string; value: TextBgStyle }> = [
  { label: 'None', value: 'none' },
  { label: 'Box', value: 'box' },
  { label: 'Highlight', value: 'highlight' },
];

export const TEXT_ANIMS: Array<{ label: string; value: TextAnim }> = [
  { label: 'None', value: 'none' },
  { label: 'Fade', value: 'fade' },
  { label: 'Slide up', value: 'slide' },
  { label: 'Slide down', value: 'slide-down' },
  { label: 'Slide left', value: 'slide-left' },
  { label: 'Slide right', value: 'slide-right' },
  { label: 'Pop', value: 'pop' },
  { label: 'Zoom', value: 'zoom' },
  { label: 'Bounce', value: 'bounce' },
  { label: 'Spin', value: 'spin' },
  { label: 'Blur', value: 'blur' },
  { label: 'Typewriter', value: 'typewriter' },
];

export const ANIM_DUR = 0.5;

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  outlineWidth: number;
  outlineColor: string;
  align: 'left' | 'center' | 'right';
  y: number;
  karaoke: KaraokeStyle;
  karaokeColor: string;
}

export type Easing = 'linear' | 'in' | 'out' | 'inout';

export const EASINGS: Array<{ label: string; value: Easing }> = [
  { label: 'Linear', value: 'linear' },
  { label: 'Ease in', value: 'in' },
  { label: 'Ease out', value: 'out' },
  { label: 'Ease in-out', value: 'inout' },
];

export function easeProgress(e: Easing | undefined, r: number): number {
  switch (e) {
    case 'in':
      return r * r;
    case 'out':
      return 1 - (1 - r) * (1 - r);
    case 'inout':
      return r < 0.5 ? 2 * r * r : 1 - ((-2 * r + 2) * (-2 * r + 2)) / 2;
    default:
      return r;
  }
}

export interface Keyframe {
  id: string;
  prop: string;
  t: number;
  value: number;
  ease?: Easing;
}

const KEY_EPS = 0.04;

export type TransitionType = 'none' | 'fade' | 'dip' | 'slide' | 'push' | 'wipe' | 'zoom' | 'blur';

export const TRANSITIONS: Array<{ label: string; value: TransitionType }> = [
  { label: 'None', value: 'none' },
  { label: 'Crossfade', value: 'fade' },
  { label: 'Dip to black', value: 'dip' },
  { label: 'Slide', value: 'slide' },
  { label: 'Push', value: 'push' },
  { label: 'Wipe', value: 'wipe' },
  { label: 'Zoom', value: 'zoom' },
  { label: 'Blur', value: 'blur' },
];

export interface EffectDef {
  label: string;
  value: string;
  filter: string;
  shader?: boolean;
  swatch?: string;
}

export const EFFECTS: EffectDef[] = [
  { label: 'None', value: 'none', filter: '' },
  { label: 'B&W', value: 'bw', filter: 'grayscale(100%)' },
  { label: 'Sepia', value: 'sepia', filter: 'sepia(80%)' },
  { label: 'Vintage', value: 'vintage', filter: 'sepia(40%) contrast(110%) saturate(120%) brightness(105%)' },
  { label: 'Cool', value: 'cool', filter: 'hue-rotate(-18deg) saturate(115%) brightness(102%)' },
  { label: 'Warm', value: 'warm', filter: 'hue-rotate(18deg) saturate(120%) brightness(104%)' },
  { label: 'Vivid', value: 'vivid', filter: 'saturate(165%) contrast(112%)' },
  { label: 'Invert', value: 'invert', filter: 'invert(100%)' },
  { label: 'Blur', value: 'blur', filter: 'blur(6px)' },
  { label: 'Glitch', value: 'glitch', filter: '', shader: true, swatch: 'contrast(150%) saturate(170%) hue-rotate(8deg)' },
  { label: 'VHS', value: 'vhs', filter: '', shader: true, swatch: 'saturate(140%) contrast(115%) sepia(18%)' },
  { label: 'Chromatic', value: 'chromatic', filter: '', shader: true, swatch: 'contrast(120%) saturate(135%)' },
  { label: 'CRT lines', value: 'scanlines', filter: '', shader: true, swatch: 'brightness(88%) contrast(125%)' },
  { label: 'Film grain', value: 'grain', filter: '', shader: true, swatch: 'sepia(35%) contrast(110%) brightness(98%)' },
  { label: 'Pixelate', value: 'pixelate', filter: '', shader: true, swatch: 'contrast(108%) saturate(120%)' },
];

export function effectFilter(value: string): string {
  return EFFECTS.find((e) => e.value === value)?.filter ?? '';
}

export function effectSwatch(value: string): string {
  const e = EFFECTS.find((x) => x.value === value);
  return e?.swatch ?? e?.filter ?? '';
}

export function clipFilter(clip: MediaClip): string {
  const hue = clip.hue ? ` hue-rotate(${clip.hue}deg)` : '';
  const base = `brightness(${clip.brightness}%) contrast(${clip.contrast}%) saturate(${clip.saturation}%)${hue}`;
  const fx = effectFilter(clip.effect);
  return fx ? `${base} ${fx}` : base;
}

export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'star' | 'heart' | 'arrow' | 'line';

export const SHAPES: Array<{ label: string; value: ShapeKind }> = [
  { label: 'Rectangle', value: 'rect' },
  { label: 'Rounded', value: 'rounded' },
  { label: 'Ellipse', value: 'ellipse' },
  { label: 'Triangle', value: 'triangle' },
  { label: 'Star', value: 'star' },
  { label: 'Heart', value: 'heart' },
  { label: 'Arrow', value: 'arrow' },
  { label: 'Line', value: 'line' },
];

export interface ShapeClip extends ClipBase {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  animIn: TextAnim;
  animOut: TextAnim;
  keyframes: Keyframe[];
}

export interface Stroke {
  color: string;
  width: number;
  points: number[];
}

export interface DrawClip extends ClipBase {
  type: 'draw';
  strokes: Stroke[];
  opacity: number;
  x: number;
  y: number;
  animIn: TextAnim;
  animOut: TextAnim;
  keyframes: Keyframe[];
}

export const STICKERS = ['😀', '😂', '😍', '😎', '🥳', '🤯', '👍', '🔥', '✨', '💯', '❤️', '⭐', '🎉', '👀', '💀', '🙌', '🚀', '⚡', '💥', '🎬', '🎵', '📍', '✅', '❌'];

export type Clip = MediaClip | TextClip | ShapeClip | DrawClip;

export type OverlayClip = TextClip | ShapeClip | DrawClip;

export interface Canvas {
  width: number;
  height: number;
}

export type BackgroundType = 'black' | 'color' | 'gradient' | 'blur';
export interface Background {
  type: BackgroundType;
  color: string;
  color2: string;
}

export const DEFAULT_BACKGROUND: Background = { type: 'black', color: '#101018', color2: '#2a2a3a' };

export const BACKGROUNDS: Array<{ label: string; value: BackgroundType }> = [
  { label: 'Black', value: 'black' },
  { label: 'Color', value: 'color' },
  { label: 'Gradient', value: 'gradient' },
  { label: 'Blur', value: 'blur' },
];

export function backgroundCss(bg: Background): string {
  if (bg.type === 'color') return bg.color;
  if (bg.type === 'gradient') return `linear-gradient(180deg, ${bg.color} 0%, ${bg.color2} 100%)`;
  return '#000000';
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  const a = Math.max(0, Math.min(1, alpha));
  if (!m) return `rgba(0,0,0,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

export const RESOLUTIONS: Array<{ label: string; width: number; height: number; hint: string }> = [
  { label: '16:9', width: 1920, height: 1080, hint: 'YouTube' },
  { label: '9:16', width: 1080, height: 1920, hint: 'TikTok / Reels' },
  { label: '1:1', width: 1080, height: 1080, hint: 'Square' },
  { label: '4:5', width: 1080, height: 1350, hint: 'Instagram' },
];

export const FONTS: Array<{ label: string; value: string }> = [
  { label: 'Chakra Petch', value: '"Chakra Petch", sans-serif' },
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Segoe UI', value: '"Segoe UI", sans-serif' },
  { label: 'Trebuchet', value: '"Trebuchet MS", sans-serif' },
  { label: 'Verdana', value: 'Verdana, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times', value: '"Times New Roman", serif' },
  { label: 'Courier', value: '"Courier New", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { label: 'Impact', value: 'Impact, sans-serif' },
  { label: 'Comic Sans', value: '"Comic Sans MS", cursive' },
  { label: 'Press Start 2P', value: '"Press Start 2P", monospace' },
];

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  fontFamily: FONTS[0].value,
  fontSize: 64,
  color: '#ffffff',
  bold: true,
  italic: false,
  outlineWidth: 6,
  outlineColor: '#000000',
  align: 'center',
  y: 0.86,
  karaoke: 'color',
  karaokeColor: DEFAULT_KARAOKE_COLOR,
};

export const REF_HEIGHT = 1080;
export const MIN_CLIP = 0.1;
export const MAX_FADE = 3;
export const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
const MAX_CANVAS_DIM = 1920;

const DEFAULT_PX_PER_SEC = 60;
export const MIN_PX_PER_SEC = 8;
export const MAX_PX_PER_SEC = 320;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const even = (n: number): number => (n % 2 === 0 ? n : n + 1);

let seq = 0;
export const uid = (p: string): string => `${p}${Date.now().toString(36)}-${++seq}`;

function makeDefaultTracks(): Track[] {
  return [
    { id: 'text-1', kind: 'text', name: 'T1' },
    { id: 'video-1', kind: 'video', name: 'V1' },
    { id: 'audio-1', kind: 'audio', name: 'A1' },
  ];
}

export function fitCanvas(w: number, h: number): Canvas {
  if (w <= 0 || h <= 0) return { width: 1920, height: 1080 };
  const s = Math.min(1, MAX_CANVAS_DIM / Math.max(w, h));
  return { width: even(Math.round(w * s)), height: even(Math.round(h * s)) };
}

export function exportDims(canvas: Canvas): Canvas {
  return { width: even(canvas.width), height: even(canvas.height) };
}

interface Doc {
  clips: Clip[];
  tracks: Track[];
  canvas: Canvas;
  background: Background;
}

export type ClipPatch = Partial<
  Omit<MediaClip, 'id' | 'type'> & Omit<TextClip, 'id' | 'type'> & Omit<ShapeClip, 'id' | 'type'> & Omit<DrawClip, 'id' | 'type'>
>;

interface TimelineState extends Doc {
  fps: number;
  playhead: number;
  playing: boolean;
  selectedIds: string[];
  pxPerSec: number;
  canvasUserSet: boolean;
  drawMode: boolean;
  brush: { color: string; width: number };
  past: Doc[];
  future: Doc[];

  cutPreview: Array<[number, number]> | null;
  setCutPreview: (ranges: Array<[number, number]> | null) => void;
  commitClips: (clips: Clip[], tracks?: Track[]) => void;

  pushHistory: () => void;
  undo: () => void;
  redo: () => void;

  addMedia: (media: MediaFile) => Promise<string | null>;
  addText: () => void;
  addShape: (shape: ShapeKind) => void;
  addSticker: (emoji: string) => void;
  addStroke: (clipId: string | null, stroke: Stroke) => string;
  setDrawMode: (on: boolean) => void;
  setBrush: (patch: Partial<{ color: string; width: number }>) => void;
  addTrack: (kind: TrackKind) => void;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'hidden' | 'name'>>) => void;
  duplicateClip: (id: string) => void;
  detachAudio: (id: string) => void;
  removeClip: (id: string) => void;
  removeByMedia: (mediaId: string) => void;
  removeSelected: () => void;
  rippleDeleteSelected: () => void;
  closeGapBefore: (id: string) => void;
  selectClip: (id: string | null, additive?: boolean) => void;
  setSelection: (ids: string[]) => void;
  updateSelected: (patch: ClipPatch) => void;

  copySelected: () => number;
  cutSelected: () => number;
  paste: () => number;

  moveClip: (id: string, start: number, trackId: string) => void;
  trimClipStart: (id: string, newStart: number) => void;
  trimClipEnd: (id: string, newEnd: number) => void;
  applySpeedPreset: (id: string, preset: string) => void;
  freezeFrameAtPlayhead: () => boolean;
  moveKeyframes: (id: string, fromT: number, toT: number) => void;
  deleteKeyframes: (id: string, atT: number) => void;
  splitSelectedAtPlayhead: () => void;
  updateClip: (id: string, patch: ClipPatch) => void;
  setSpeed: (id: string, speed: number) => void;
  setKeyframe: (id: string, prop: string, t: number, value: number) => void;
  toggleKeyframe: (id: string, prop: string, t: number, value: number) => void;
  setKeyframeEase: (id: string, prop: string, t: number, ease: Easing) => void;
  addClips: (clips: Clip[]) => void;
  addCaptions: (
    segments: Array<{ start: number; end: number; text: string; words?: Array<{ start: number; end: number; text: string }> }>,
    style?: CaptionStyle,
  ) => void;

  setCanvas: (canvas: Canvas) => void;
  setFps: (fps: number) => void;
  setBackground: (patch: Partial<Background>) => void;
  loadDoc: (doc: { clips: Clip[]; tracks: Track[]; canvas: Canvas; background?: Background; fps?: number }) => void;
  setPlayhead: (t: number) => void;
  play: () => void;
  pause: () => void;
  setZoom: (pxPerSec: number) => void;
  clear: () => void;
}

export function captionClipsFor(
  segments: Array<{ start: number; end: number; text: string; words?: Array<{ start: number; end: number; text: string }> }>,
  style: CaptionStyle | undefined,
  trackId: string,
): TextClip[] {
  const st = { ...DEFAULT_CAPTION_STYLE, ...style };
  return segments.map((seg) => {
    const start = Math.max(0, seg.start);
    return {
      type: 'text',
      id: uid('t'),
      trackId,
      start,
      duration: Math.max(0.3, seg.end - seg.start),
      fadeIn: 0,
      fadeOut: 0,
      text: seg.text,
      fontSize: st.fontSize,
      fontFamily: st.fontFamily,
      color: st.color,
      bold: st.bold,
      italic: st.italic,
      outlineWidth: st.outlineWidth,
      outlineColor: st.outlineColor,
      glow: 0,
      glowColor: '#a855f7',
      bgStyle: 'none',
      bgColor: '#000000',
      bgOpacity: 0.6,
      bgRadius: 10,
      bgPadding: 16,
      align: st.align,
      x: 0.5,
      y: st.y,
      animIn: 'none',
      animOut: 'none',
      keyframes: [],
      role: 'caption',
      words: seg.words?.map((w) => ({ start: w.start - start, end: w.end - start, text: w.text })),
      karaoke: st.karaoke,
      karaokeColor: st.karaokeColor,
    };
  });
}

const snapshot = (s: Doc): Doc => ({ clips: s.clips, tracks: s.tracks, canvas: s.canvas, background: s.background });

let clipboard: Array<{ clip: Clip; kind: TrackKind }> = [];

export const useTimelineStore = create<TimelineState>((set, get) => ({
  tracks: makeDefaultTracks(),
  clips: [],
  canvas: { width: 1920, height: 1080 },
  fps: 30,
  background: DEFAULT_BACKGROUND,
  canvasUserSet: false,
  drawMode: false,
  brush: { color: '#ff2d55', width: 8 },
  playhead: 0,
  playing: false,
  selectedIds: [],
  pxPerSec: DEFAULT_PX_PER_SEC,
  past: [],
  future: [],
  cutPreview: null,

  pushHistory: () => set((s) => ({ past: [...s.past, snapshot(s)].slice(-100), future: [] })),

  setCutPreview: (ranges) => set({ cutPreview: ranges }),

  commitClips: (clips, tracks) => {
    get().pushHistory();
    set((s) => ({
      clips,
      tracks: tracks ?? s.tracks,
      selectedIds: s.selectedIds.filter((id) => clips.some((c) => c.id === id)),
      playhead: Math.min(s.playhead, timelineDuration(clips)),
    }));
  },

  undo: () =>
    set((s) => {
      if (s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      const sel = s.selectedIds.filter((id) => prev.clips.some((c) => c.id === id));
      return { ...prev, past: s.past.slice(0, -1), future: [snapshot(s), ...s.future].slice(0, 100), selectedIds: sel, playing: false };
    }),

  redo: () =>
    set((s) => {
      if (s.future.length === 0) return {};
      const next = s.future[0];
      const sel = s.selectedIds.filter((id) => next.clips.some((c) => c.id === id));
      return { ...next, past: [...s.past, snapshot(s)].slice(-100), future: s.future.slice(1), selectedIds: sel, playing: false };
    }),

  addMedia: async (media) => {
    const info = await probeMedia(media);
    const kind: TrackKind = media.kind === 'audio' ? 'audio' : 'video';
    const id = uid('c');
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === kind);
      if (!track) {
        track = { id: uid('tr'), kind, name: (kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T') + '1' };
        tracks = [...tracks, track];
      }
      const end = s.clips
        .filter((c) => c.trackId === track!.id)
        .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
      const clip: MediaClip = {
        type: 'media',
        id,
        mediaId: media.id,
        trackId: track.id,
        start: end,
        duration: info.duration,
        inPoint: 0,
        sourceDuration: info.duration,
        sourceWidth: info.width,
        sourceHeight: info.height,
        speed: 1,
        volume: 1,
        muted: false,
        brightness: 100,
        contrast: 100,
        saturation: 100,
        effect: 'none',
        scaleX: 1,
        scaleY: 1,
        posX: 0,
        posY: 0,
        rotation: 0,
        opacity: 1,
        cropTop: 0,
        cropRight: 0,
        cropBottom: 0,
        cropLeft: 0,
        keyframes: [],
        transition: 'none',
        transitionDur: 0.5,
        chromaKey: false,
        chromaColor: '#00d800',
        chromaSimilarity: 0.4,
        chromaSmoothness: 0.1,
        bgRemove: false,
        fadeIn: 0,
        fadeOut: 0,
      };
      const videoTrackIds = new Set(tracks.filter((t) => t.kind === 'video').map((t) => t.id));
      const hadVisual = s.clips.some((c) => c.type === 'media' && videoTrackIds.has(c.trackId));
      const canvas =
        !s.canvasUserSet && kind === 'video' && info.width > 0 && info.height > 0 && !hadVisual
          ? fitCanvas(info.width, info.height)
          : s.canvas;
      return { tracks, clips: [...s.clips, clip], selectedIds: [id], canvas };
    });
    return id;
  },

  addText: () => {
    get().pushHistory();
    set((s) => {
      const track = s.tracks.find((t) => t.kind === 'text') ?? s.tracks[0];
      const clip: TextClip = {
        type: 'text',
        id: uid('t'),
        trackId: track.id,
        start: Math.max(0, s.playhead),
        duration: 3,
        fadeIn: 0,
        fadeOut: 0,
        text: 'Your text',
        fontSize: 80,
        fontFamily: FONTS[0].value,
        color: '#ffffff',
        bold: true,
        italic: false,
        outlineWidth: 0,
        outlineColor: '#000000',
        glow: 0,
        glowColor: '#a855f7',
        bgStyle: 'none',
        bgColor: '#000000',
        bgOpacity: 0.6,
        bgRadius: 10,
        bgPadding: 16,
        align: 'center',
        x: 0.5,
        y: 0.82,
        animIn: 'none',
        animOut: 'none',
        keyframes: [],
      };
      return { clips: [...s.clips, clip], selectedIds: [clip.id] };
    });
  },

  addShape: (shape) => {
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === 'text');
      if (!track) {
        track = { id: uid('tr'), kind: 'text', name: 'T1' };
        tracks = [...tracks, track];
      }
      const clip: ShapeClip = {
        type: 'shape',
        id: uid('s'),
        trackId: track.id,
        start: Math.max(0, s.playhead),
        duration: 3,
        fadeIn: 0,
        fadeOut: 0,
        shape,
        fill: shape === 'line' ? '' : '#7c5cff',
        stroke: shape === 'line' ? '#ffffff' : '',
        strokeWidth: shape === 'line' ? 10 : 0,
        opacity: 1,
        x: 0.5,
        y: 0.5,
        w: 0.3,
        h: shape === 'line' ? 0.012 : 0.3,
        rotation: 0,
        animIn: 'none',
        animOut: 'none',
        keyframes: [],
      };
      return { tracks, clips: [...s.clips, clip], selectedIds: [clip.id] };
    });
  },

  addSticker: (emoji) => {
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === 'text');
      if (!track) {
        track = { id: uid('tr'), kind: 'text', name: 'T1' };
        tracks = [...tracks, track];
      }
      const clip: TextClip = {
        type: 'text',
        id: uid('t'),
        trackId: track.id,
        start: Math.max(0, s.playhead),
        duration: 3,
        fadeIn: 0,
        fadeOut: 0,
        text: emoji,
        fontSize: 160,
        fontFamily: FONTS[1].value,
        color: '#ffffff',
        bold: false,
        italic: false,
        outlineWidth: 0,
        outlineColor: '#000000',
        glow: 0,
        glowColor: '#a855f7',
        bgStyle: 'none',
        bgColor: '#000000',
        bgOpacity: 0.6,
        bgRadius: 10,
        bgPadding: 16,
        align: 'center',
        x: 0.5,
        y: 0.5,
        animIn: 'pop',
        animOut: 'none',
        keyframes: [],
      };
      return { tracks, clips: [...s.clips, clip], selectedIds: [clip.id] };
    });
  },

  addStroke: (clipId, stroke) => {
    const existing = clipId ? get().clips.find((c) => c.id === clipId) : undefined;
    get().pushHistory();
    if (existing && existing.type === 'draw') {
      const draw = existing;
      set((s) => ({ clips: s.clips.map((c) => (c.id === draw.id ? { ...draw, strokes: [...draw.strokes, stroke] } : c)) }));
      return draw.id;
    }
    const id = uid('d');
    set((s) => {
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === 'text');
      if (!track) {
        track = { id: uid('tr'), kind: 'text', name: 'T1' };
        tracks = [...tracks, track];
      }
      const clip: DrawClip = {
        type: 'draw',
        id,
        trackId: track.id,
        start: Math.max(0, s.playhead),
        duration: 5,
        fadeIn: 0,
        fadeOut: 0,
        strokes: [stroke],
        opacity: 1,
        x: 0,
        y: 0,
        animIn: 'none',
        animOut: 'none',
        keyframes: [],
      };
      return { tracks, clips: [...s.clips, clip], selectedIds: [id] };
    });
    return id;
  },

  setDrawMode: (on) => set({ drawMode: on }),
  setBrush: (patch) => set((s) => ({ brush: { ...s.brush, ...patch } })),

  addTrack: (kind) => {
    get().pushHistory();
    set((s) => {
      const count = s.tracks.filter((t) => t.kind === kind).length;
      const prefix = kind === 'video' ? 'V' : kind === 'audio' ? 'A' : 'T';
      const track: Track = { id: uid('tr'), kind, name: `${prefix}${count + 1}` };
      return { tracks: [...s.tracks, track] };
    });
  },

  removeTrack: (id) => {
    get().pushHistory();
    set((s) => {
      const clips = s.clips.filter((c) => c.trackId !== id);
      const tracks = s.tracks.filter((t) => t.id !== id);
      const selectedIds = s.selectedIds.filter((id) => clips.some((c) => c.id === id));
      return { tracks, clips, selectedIds };
    });
  },

  updateTrack: (id, patch) => {
    get().pushHistory();
    set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },

  duplicateClip: (id) => {
    get().pushHistory();
    set((s) => {
      const c = s.clips.find((x) => x.id === id);
      if (!c) return {};
      const copy: Clip = {
        ...c,
        id: c.type === 'text' ? uid('t') : uid('c'),
        start: c.start + c.duration,
        keyframes: c.keyframes.map((k) => ({ ...k, id: uid('k') })),
      };
      return { clips: [...s.clips, copy], selectedIds: [copy.id] };
    });
  },

  detachAudio: (id) => {
    const c0 = get().clips.find((x) => x.id === id);
    if (!c0 || c0.type !== 'media') return;
    get().pushHistory();
    set((s) => {
      const c = s.clips.find((x) => x.id === id);
      if (!c || c.type !== 'media') return {};
      let tracks = s.tracks;
      let atrack = tracks.find((t) => t.kind === 'audio');
      if (!atrack) {
        atrack = { id: uid('tr'), kind: 'audio', name: 'A1' };
        tracks = [...tracks, atrack];
      }
      const audio: MediaClip = {
        ...c,
        id: uid('c'),
        trackId: atrack.id,
        muted: false,
        keyframes: [],
        transition: 'none',
        effect: 'none',
        chromaKey: false,
        bgRemove: false,
      };
      const clips = s.clips.map((x) => (x.id === id ? { ...x, muted: true } : x));
      return { tracks, clips: [...clips, audio], selectedIds: [audio.id] };
    });
  },

  removeClip: (id) => {
    get().pushHistory();
    set((s) => ({
      clips: s.clips.filter((c) => c.id !== id),
      selectedIds: s.selectedIds.filter((x) => x !== id),
    }));
  },

  removeSelected: () => {
    const s0 = get();
    if (s0.selectedIds.length === 0) return;
    get().pushHistory();
    set((s) => {
      const sel = new Set(s.selectedIds);
      return { clips: s.clips.filter((c) => !sel.has(c.id)), selectedIds: [] };
    });
  },

  rippleDeleteSelected: () => {
    const s0 = get();
    if (s0.selectedIds.length === 0) return;
    get().pushHistory();
    set((s) => {
      const sel = new Set(s.selectedIds);
      const byTrack = new Map<string, Array<[number, number]>>();
      for (const c of s.clips) {
        if (!sel.has(c.id)) continue;
        const arr = byTrack.get(c.trackId) ?? [];
        arr.push([c.start, c.start + c.duration]);
        byTrack.set(c.trackId, arr);
      }
      for (const [trackId, ivs] of byTrack) {
        ivs.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [];
        for (const iv of ivs) {
          const last = merged[merged.length - 1];
          if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
          else merged.push([...iv]);
        }
        byTrack.set(trackId, merged);
      }
      const clips = s.clips
        .filter((c) => !sel.has(c.id))
        .map((c) => {
          const ivs = byTrack.get(c.trackId);
          if (!ivs) return c;
          let shift = 0;
          for (const [a, b] of ivs) shift += Math.max(0, Math.min(b, c.start) - a);
          return shift > 0 ? { ...c, start: c.start - shift } : c;
        });
      return { clips, selectedIds: [] };
    });
  },

  closeGapBefore: (id) => {
    const s0 = get();
    const clip = s0.clips.find((c) => c.id === id);
    if (!clip) return;
    const prevEnd = s0.clips
      .filter((c) => c.trackId === clip.trackId && c.id !== id && c.start + c.duration <= clip.start + 1e-6)
      .reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const gap = clip.start - prevEnd;
    if (gap <= 1e-6) return;
    get().pushHistory();
    set((s) => ({
      clips: s.clips.map((c) => (c.trackId === clip.trackId && c.start >= clip.start - 1e-6 ? { ...c, start: c.start - gap } : c)),
    }));
  },

  copySelected: () => {
    const s = get();
    const kindOf = new Map(s.tracks.map((t) => [t.id, t.kind] as const));
    clipboard = s.clips
      .filter((c) => s.selectedIds.includes(c.id))
      .map((clip) => ({ clip, kind: kindOf.get(clip.trackId) ?? (clip.type === 'media' ? 'video' : 'text') }));
    return clipboard.length;
  },

  cutSelected: () => {
    const n = get().copySelected();
    if (n > 0) get().removeSelected();
    return n;
  },

  paste: () => {
    if (clipboard.length === 0) return 0;
    get().pushHistory();
    const at = get().playhead;
    const minStart = Math.min(...clipboard.map((e) => e.clip.start));
    const pastedIds: string[] = [];
    set((s) => {
      let tracks = s.tracks;
      const trackFor = (e: { clip: Clip; kind: TrackKind }): string => {
        const orig = tracks.find((t) => t.id === e.clip.trackId);
        if (orig && orig.kind === e.kind) return orig.id;
        const existing = tracks.find((t) => t.kind === e.kind);
        if (existing) return existing.id;
        const made: Track = {
          id: uid('tr'),
          kind: e.kind,
          name: (e.kind === 'video' ? 'V' : e.kind === 'audio' ? 'A' : 'T') + (tracks.filter((t) => t.kind === e.kind).length + 1),
        };
        tracks = [...tracks, made];
        return made.id;
      };
      const copies: Clip[] = clipboard.map((e) => {
        const id = uid(e.clip.type === 'text' ? 't' : 'c');
        pastedIds.push(id);
        return {
          ...e.clip,
          id,
          trackId: trackFor(e),
          start: Math.max(0, at + (e.clip.start - minStart)),
          keyframes: (e.clip.keyframes ?? []).map((k) => ({ ...k, id: uid('k') })),
        } as Clip;
      });
      return { tracks, clips: [...s.clips, ...copies], selectedIds: pastedIds };
    });
    return clipboard.length;
  },

  removeByMedia: (mediaId) => {
    get().pushHistory();
    set((s) => {
      const clips = s.clips.filter((c) => !(c.type === 'media' && c.mediaId === mediaId));
      const selectedIds = s.selectedIds.filter((id) => clips.some((c) => c.id === id));
      return { clips, selectedIds };
    });
  },

  selectClip: (id, additive = false) =>
    set((s) => {
      if (id === null) return { selectedIds: [] };
      if (!additive) return { selectedIds: [id] };
      return s.selectedIds.includes(id)
        ? { selectedIds: s.selectedIds.filter((x) => x !== id) }
        : { selectedIds: [...s.selectedIds, id] };
    }),

  setSelection: (ids) => set({ selectedIds: ids }),

  updateSelected: (patch) =>
    set((s) => {
      const sel = new Set(s.selectedIds);
      return { clips: s.clips.map((c) => (sel.has(c.id) ? ({ ...c, ...patch } as Clip) : c)) };
    }),

  moveClip: (id, start, trackId) =>
    set((s) => {
      const clip = s.clips.find((c) => c.id === id);
      if (!clip) return {};
      const fromKind = s.tracks.find((t) => t.id === clip.trackId)?.kind;
      const toTrack = s.tracks.find((t) => t.id === trackId);
      const destId = toTrack && toTrack.kind === fromKind ? trackId : clip.trackId;
      return { clips: s.clips.map((c) => (c.id === id ? { ...c, start: Math.max(0, start), trackId: destId } : c)) };
    }),

  trimClipStart: (id, newStart) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const end = c.start + c.duration;
        const maxStart = end - MIN_CLIP;
        const minStart = c.type === 'media' ? Math.max(0, c.start - c.inPoint / speedAt(c, 0)) : 0;
        const start = clamp(newStart, minStart, maxStart);
        const delta = start - c.start;
        const keyframes = retimeKeyframesForHeadTrim(c, delta);
        if (c.type === 'media') return { ...c, start, inPoint: Math.max(0, sourceTimeAt(c, c.start + delta)), duration: c.duration - delta, keyframes };
        return { ...c, start, duration: c.duration - delta, keyframes };
      }),
    })),

  trimClipEnd: (id, newEnd) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        if (c.type === 'media') {
          return { ...c, duration: clamp(newEnd - c.start, MIN_CLIP, maxClipDuration(c)) };
        }
        return { ...c, duration: Math.max(MIN_CLIP, newEnd - c.start) };
      }),
    })),

  splitSelectedAtPlayhead: () => {
    const s0 = get();
    const t = s0.playhead;
    const sel = new Set(s0.selectedIds);
    const targets = s0.clips.filter((c) => sel.has(c.id) && t > c.start + MIN_CLIP && t < c.start + c.duration - MIN_CLIP);
    if (targets.length === 0) return;
    const ids = new Set(targets.map((c) => c.id));
    get().pushHistory();
    set((s) => {
      const next: Clip[] = [];
      const newSel: string[] = [];
      for (const c of s.clips) {
        if (!ids.has(c.id)) {
          next.push(c);
          continue;
        }
        const left = sliceClip(c, c.start, t, { keepId: true });
        const right = sliceClip(c, t, c.start + c.duration);
        next.push(left, right);
        newSel.push(right.id);
      }
      return { clips: next, selectedIds: newSel };
    });
  },

  updateClip: (id, patch) =>
    set((s) => ({ clips: s.clips.map((c) => (c.id === id ? ({ ...c, ...patch } as Clip) : c)) })),

  setKeyframe: (id, prop, t, value) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const ks = c.keyframes ?? [];
        const prev = ks.find((k) => k.prop === prop && Math.abs(k.t - t) < KEY_EPS);
        const kept = ks.filter((k) => !(k.prop === prop && Math.abs(k.t - t) < KEY_EPS));
        return { ...c, keyframes: [...kept, { id: uid('k'), prop, t, value, ease: prev?.ease }] } as Clip;
      }),
    })),

  setKeyframeEase: (id, prop, t, ease) => {
    get().pushHistory();
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          keyframes: (c.keyframes ?? []).map((k) => (k.prop === prop && Math.abs(k.t - t) < KEY_EPS ? { ...k, ease } : k)),
        } as Clip;
      }),
    }));
  },

  toggleKeyframe: (id, prop, t, value) => {
    get().pushHistory();
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const ks = c.keyframes ?? [];
        const existing = ks.find((k) => k.prop === prop && Math.abs(k.t - t) < KEY_EPS);
        if (existing) return { ...c, keyframes: ks.filter((k) => k !== existing) } as Clip;
        return { ...c, keyframes: [...ks, { id: uid('k'), prop, t, value }] } as Clip;
      }),
    }));
  },

  addClips: (incoming) => {
    if (incoming.length === 0) return;
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      if (incoming.some((c) => c.type === 'text') && !tracks.some((t) => t.kind === 'text')) {
        tracks = [...tracks, { id: uid('tr'), kind: 'text', name: 'T1' }];
      }
      return { tracks, clips: [...s.clips, ...incoming] };
    });
  },

  addCaptions: (segments, style) => {
    if (segments.length === 0) return;
    get().pushHistory();
    set((s) => {
      let tracks = s.tracks;
      let track = tracks.find((t) => t.kind === 'text');
      if (!track) {
        track = { id: uid('tr'), kind: 'text', name: 'T1' };
        tracks = [...tracks, track];
      }
      return { tracks, clips: [...s.clips, ...captionClipsFor(segments, style, track.id)] };
    });
  },

  freezeFrameAtPlayhead: () => {
    const s0 = get();
    const t = s0.playhead;
    const c = s0.clips.find(
      (x): x is MediaClip => s0.selectedIds.includes(x.id) && x.type === 'media' && t >= x.start && t < x.start + x.duration && x.freezeAt == null,
    );
    if (!c) return false;
    const FREEZE = 3;
    get().pushHistory();
    set((s) => {
      const src = clamp(sourceTimeAt(c, t), 0, Math.max(0, c.sourceDuration - 0.001));
      const frozen: MediaClip = {
        ...c,
        id: uid('c'),
        start: t,
        duration: FREEZE,
        inPoint: src,
        freezeAt: src,
        muted: true,
        keyframes: [],
        transition: 'none',
        fadeIn: 0,
        fadeOut: 0,
      };
      const leftDur = t - c.start;
      const rightDur = c.duration - leftDur;
      const parts = splitKeyframes(c, leftDur);
      const pieces: Clip[] = [];
      if (leftDur > MIN_CLIP) pieces.push({ ...c, duration: leftDur, fadeOut: 0, keyframes: parts.left });
      pieces.push(frozen);
      if (rightDur > MIN_CLIP) {
        pieces.push({ ...c, id: uid('c'), start: t + FREEZE, inPoint: src, duration: rightDur, fadeIn: 0, keyframes: parts.right, transition: 'none' });
      }
      const clips: Clip[] = [];
      for (const x of s.clips) {
        if (x.id === c.id) {
          clips.push(...pieces);
          continue;
        }
        if (x.trackId === c.trackId && x.start >= t - 1e-6) clips.push({ ...x, start: x.start + FREEZE });
        else clips.push(x);
      }
      return { clips, selectedIds: [frozen.id] };
    });
    return true;
  },

  applySpeedPreset: (id, preset) => {
    get().pushHistory();
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id || c.type !== 'media') return c;
        const kept = (c.keyframes ?? []).filter((k) => k.prop !== 'speed');
        const def = SPEED_PRESETS.find((p) => p.value === preset);
        if (!def || def.points.length === 0) return { ...c, keyframes: kept };
        const keys: Keyframe[] = def.points.map(([f, v]) => ({ id: uid('k'), prop: 'speed', t: f * c.duration, value: v, ease: 'inout' }));
        const next: MediaClip = { ...c, keyframes: [...kept, ...keys] };
        return { ...next, duration: Math.min(next.duration, maxClipDuration(next)) };
      }),
    }));
  },

  moveKeyframes: (id, fromT, toT) =>
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        const to = clamp(toT, 0, c.duration);
        return {
          ...c,
          keyframes: (c.keyframes ?? []).map((k) => (Math.abs(k.t - fromT) < KEY_EPS ? { ...k, t: to } : k)),
        } as Clip;
      }),
    })),

  deleteKeyframes: (id, atT) => {
    get().pushHistory();
    set((s) => ({
      clips: s.clips.map((c) => {
        if (c.id !== id) return c;
        return { ...c, keyframes: (c.keyframes ?? []).filter((k) => Math.abs(k.t - atT) >= KEY_EPS) } as Clip;
      }),
    }));
  },

  setSpeed: (id, speed) =>
    set((s) => {
      const sp = clamp(speed, MIN_SPEED, MAX_SPEED);
      return {
        clips: s.clips.map((c) =>
          c.id === id && c.type === 'media' ? { ...c, speed: sp, duration: (c.duration * c.speed) / sp } : c,
        ),
      };
    }),

  setCanvas: (canvas) => {
    get().pushHistory();
    set({ canvas: exportDims(canvas), canvasUserSet: true });
  },

  setFps: (fps) => set({ fps: clamp(Math.round(fps), 1, 120) }),

  setBackground: (patch) => set((s) => ({ background: { ...s.background, ...patch } })),

  loadDoc: (doc) =>
    set({
      clips: doc.clips,
      tracks: doc.tracks,
      canvas: doc.canvas,
      fps: doc.fps ?? 30,
      background: doc.background ?? DEFAULT_BACKGROUND,
      canvasUserSet: true,
      selectedIds: [],
      playhead: 0,
      playing: false,
      past: [],
      future: [],
    }),

  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  setZoom: (pxPerSec) => set({ pxPerSec: clamp(pxPerSec, MIN_PX_PER_SEC, MAX_PX_PER_SEC) }),

  clear: () => set({ clips: [], selectedIds: [], playhead: 0, playing: false, past: [], future: [], cutPreview: null }),
}));

export function timelineDuration(clips: Clip[]): number {
  return clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
}

const KIND_ORDER: Record<TrackKind, number> = { text: 0, video: 1, audio: 2 };

export function orderedTracks(tracks: Track[]): Track[] {
  const idx = new Map(tracks.map((t, i) => [t.id, i] as const));
  return [...tracks].sort((a, b) => {
    if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.kind === 'video') return (idx.get(b.id) ?? 0) - (idx.get(a.id) ?? 0);
    return (idx.get(a.id) ?? 0) - (idx.get(b.id) ?? 0);
  });
}

const SLIDE_FRAC = 0.07;
const ANIM_BLUR = 12;
interface AnimPart {
  op: number;
  dx: number;
  dy: number;
  scale: number;
  rot: number;
  blur: number;
}
const IDENTITY: AnimPart = { op: 1, dx: 0, dy: 0, scale: 1, rot: 0, blur: 0 };
const backOut = (p: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

const animPart = (anim: TextAnim, p: number): AnimPart => {
  switch (anim) {
    case 'fade':
      return { ...IDENTITY, op: p };
    case 'slide':
      return { ...IDENTITY, op: p, dy: (1 - p) * SLIDE_FRAC };
    case 'slide-down':
      return { ...IDENTITY, op: p, dy: -(1 - p) * SLIDE_FRAC };
    case 'slide-left':
      return { ...IDENTITY, op: p, dx: (1 - p) * SLIDE_FRAC };
    case 'slide-right':
      return { ...IDENTITY, op: p, dx: -(1 - p) * SLIDE_FRAC };
    case 'pop':
      return { ...IDENTITY, op: p, scale: 0.55 + 0.45 * p };
    case 'zoom':
      return { ...IDENTITY, op: p, scale: 1.6 - 0.6 * p };
    case 'bounce':
      return { ...IDENTITY, op: Math.min(1, p * 2), scale: 0.3 + 0.7 * backOut(p) };
    case 'spin':
      return { ...IDENTITY, op: p, rot: (1 - p) * 180, scale: 0.6 + 0.4 * p };
    case 'blur':
      return { ...IDENTITY, op: p, blur: (1 - p) * ANIM_BLUR };
    default:
      return IDENTITY;
  }
};

export function textAnim(clip: { start: number; duration: number; animIn: TextAnim; animOut: TextAnim }, t: number): { opacity: number; dxFrac: number; dyFrac: number; scale: number; rotate: number; blur: number } {
  const inP = clamp((t - clip.start) / ANIM_DUR, 0, 1);
  const outP = clamp((clip.start + clip.duration - t) / ANIM_DUR, 0, 1);
  const a = animPart(clip.animIn, inP);
  const b = animPart(clip.animOut, outP);
  return { opacity: a.op * b.op, dxFrac: a.dx + b.dx, dyFrac: a.dy + b.dy, scale: a.scale * b.scale, rotate: a.rot + b.rot, blur: a.blur + b.blur };
}

export function visibleText(clip: TextClip, t: number): string {
  if (clip.animIn !== 'typewriter') return clip.text;
  const len = clip.text.length;
  if (len === 0) return clip.text;
  const revealDur = clamp(len * 0.05, 0.4, Math.max(0.4, clip.duration * 0.7));
  const p = clamp((t - clip.start) / revealDur, 0, 1);
  return clip.text.slice(0, Math.ceil(p * len));
}

function keyAt(clip: Clip, prop: string, lt: number, base: number): number {
  const f = (clip.keyframes ?? []).filter((k) => k.prop === prop).sort((a, b) => a.t - b.t);
  if (f.length === 0) return base;
  if (lt <= f[0].t) return f[0].value;
  if (lt >= f[f.length - 1].t) return f[f.length - 1].value;
  for (let i = 0; i < f.length - 1; i++) {
    const a = f[i];
    const b = f[i + 1];
    if (lt >= a.t && lt <= b.t) {
      const r = b.t === a.t ? 0 : (lt - a.t) / (b.t - a.t);
      return a.value + (b.value - a.value) * easeProgress(b.ease, r);
    }
  }
  return base;
}

export function retimeKeyframesForHeadTrim(clip: Clip, delta: number): Keyframe[] {
  const ks = clip.keyframes ?? [];
  if (ks.length === 0 || delta === 0) return ks;
  const out: Keyframe[] = [];
  for (const prop of new Set(ks.map((k) => k.prop))) {
    const mine = ks.filter((k) => k.prop === prop);
    const kept = mine.filter((k) => k.t - delta > KEY_EPS).map((k) => ({ ...k, t: k.t - delta }));
    if (kept.length < mine.length) out.push({ id: uid('k'), prop, t: 0, value: keyAt(clip, prop, delta, 0) });
    out.push(...kept);
  }
  return out;
}

export function splitKeyframes(clip: Clip, cut: number): { left: Keyframe[]; right: Keyframe[] } {
  const ks = clip.keyframes ?? [];
  const left: Keyframe[] = [];
  const right: Keyframe[] = [];
  for (const prop of new Set(ks.map((k) => k.prop))) {
    const mine = ks.filter((k) => k.prop === prop);
    const before = mine.filter((k) => k.t < cut - KEY_EPS);
    const after = mine.filter((k) => k.t > cut + KEY_EPS);
    const atCut = mine.length - before.length - after.length;
    const boundary = keyAt(clip, prop, cut, 0);
    left.push(...before);
    if (after.length > 0 || atCut > 0) left.push({ id: uid('k'), prop, t: cut, value: boundary });
    if (before.length > 0 || atCut > 0) right.push({ id: uid('k'), prop, t: 0, value: boundary });
    right.push(...after.map((k) => ({ ...k, id: uid('k'), t: k.t - cut })));
  }
  return { left, right };
}

export function sliceClip<T extends Clip>(clip: T, a: number, b: number, opts: { keepId?: boolean } = {}): T {
  const clipEnd = clip.start + clip.duration;
  const start = Math.min(Math.max(clip.start, a), clipEnd);
  const end = Math.max(start, Math.min(clipEnd, b));
  const head = start - clip.start;
  const tail = end - clip.start;
  const isHead = head <= 1e-6;
  const isTail = clip.duration - tail <= 1e-6;
  let keyframes = clip.keyframes ?? [];
  if (!isTail) keyframes = splitKeyframes({ ...clip, keyframes }, tail).left;
  if (!isHead) keyframes = splitKeyframes({ ...clip, keyframes }, head).right;
  const piece: T = {
    ...clip,
    id: opts.keepId ? clip.id : uid(clip.type === 'media' ? 'c' : 't'),
    start,
    duration: end - start,
    fadeIn: isHead ? clip.fadeIn : 0,
    fadeOut: isTail ? clip.fadeOut : 0,
    keyframes,
  };
  const src: Clip = clip;
  const p: Clip = piece;
  if (src.type === 'media' && p.type === 'media') {
    p.inPoint = sourceTimeAt(src, start);
    if (!isHead) p.transition = 'none';
  } else if (p.type === 'text' && p.words && !isHead) {
    p.words = p.words.map((w) => ({ ...w, start: w.start - head, end: w.end - head }));
  }
  return piece;
}

export function clipHasKeys(clip: Clip, prop: string): boolean {
  return !!clip.keyframes?.some((k) => k.prop === prop);
}

export function keyframeAt(clip: Clip, prop: string, lt: number): Keyframe | undefined {
  return clip.keyframes?.find((k) => k.prop === prop && Math.abs(k.t - lt) < KEY_EPS);
}

export function resolvedValue(clip: Clip, prop: string, t: number, base: number): number {
  return keyAt(clip, prop, t - clip.start, base);
}

export function keyOpacity(clip: Clip, t: number): number {
  return keyAt(clip, 'opacity', t - clip.start, clip.opacity ?? 1);
}

export const MIN_KEY_SPEED = 0.1;
export const MAX_KEY_SPEED = 8;

export const SPEED_PRESETS: Array<{ label: string; value: string; points: Array<[number, number]> }> = [
  { label: 'Constant', value: 'none', points: [] },
  { label: 'Montage', value: 'montage', points: [[0, 1], [0.35, 2.6], [0.5, 0.45], [0.7, 1.6], [1, 1]] },
  { label: 'Hero', value: 'hero', points: [[0, 1.8], [0.45, 3.2], [0.55, 0.25], [0.8, 0.5], [1, 1.5]] },
  { label: 'Bullet', value: 'bullet', points: [[0, 1], [0.3, 3.5], [0.5, 0.15], [0.7, 3.5], [1, 1]] },
  { label: 'Jump cut', value: 'jump', points: [[0, 3], [0.5, 0.5], [1, 3]] },
];

export function hasSpeedKeys(clip: Clip): boolean {
  return clip.type === 'media' && !!clip.keyframes?.some((k) => k.prop === 'speed');
}

export function speedAt(clip: MediaClip, lt: number): number {
  return clamp(keyAt(clip, 'speed', lt, clip.speed), MIN_KEY_SPEED, MAX_KEY_SPEED);
}

const SPEED_TABLE_HZ = 120;
const speedTableCache = new Map<string, { sig: string; table: Float64Array }>();

function speedSignature(clip: MediaClip): string {
  const keys = (clip.keyframes ?? [])
    .filter((k) => k.prop === 'speed')
    .sort((a, b) => a.t - b.t)
    .map((k) => `${k.t}:${k.value}:${k.ease ?? ''}`)
    .join(',');
  return `${clip.speed}|${clip.inPoint}|${clip.duration}|${keys}`;
}

function speedTable(clip: MediaClip): Float64Array {
  const sig = speedSignature(clip);
  const hit = speedTableCache.get(clip.id);
  if (hit && hit.sig === sig) return hit.table;
  const n = Math.max(2, Math.ceil(clip.duration * SPEED_TABLE_HZ) + 1);
  const dt = clip.duration / (n - 1);
  const table = new Float64Array(n);
  let acc = 0;
  let prev = speedAt(clip, 0);
  table[0] = 0;
  for (let i = 1; i < n; i++) {
    const s = speedAt(clip, i * dt);
    acc += ((prev + s) / 2) * dt;
    table[i] = acc;
    prev = s;
  }
  speedTableCache.set(clip.id, { sig, table });
  return table;
}

export function sourceTimeAt(clip: MediaClip, t: number): number {
  if (clip.freezeAt != null) return clip.freezeAt;
  const lt = t - clip.start;
  if (!hasSpeedKeys(clip)) return clip.inPoint + lt * clip.speed;
  if (lt <= 0) return clip.inPoint + lt * speedAt(clip, 0);
  const table = speedTable(clip);
  const pos = Math.min(lt / Math.max(1e-9, clip.duration), 1) * (table.length - 1);
  const i = Math.floor(pos);
  const frac = pos - i;
  const integ = i + 1 < table.length ? table[i] + (table[i + 1] - table[i]) * frac : table[table.length - 1];
  return clip.inPoint + integ;
}

export function maxClipDuration(clip: MediaClip): number {
  if (clip.freezeAt != null) return Number.POSITIVE_INFINITY;
  if (!hasSpeedKeys(clip)) return (clip.sourceDuration - clip.inPoint) / clip.speed;
  const table = speedTable(clip);
  const budget = clip.sourceDuration - clip.inPoint;
  const consumed = table[table.length - 1];
  if (consumed <= budget) return clip.duration + (budget - consumed) / speedAt(clip, clip.duration);
  const dt = clip.duration / (table.length - 1);
  for (let i = 1; i < table.length; i++) {
    if (table[i] > budget) {
      const over = (table[i] - budget) / Math.max(1e-9, table[i] - table[i - 1]);
      return (i - over) * dt;
    }
  }
  return clip.duration;
}

export function withKeyframes<T extends Clip>(clip: T, t: number): T {
  if (!clip.keyframes || clip.keyframes.length === 0) return clip;
  const lt = t - clip.start;
  if (clip.type === 'media') {
    return {
      ...clip,
      posX: keyAt(clip, 'posX', lt, clip.posX),
      posY: keyAt(clip, 'posY', lt, clip.posY),
      scaleX: keyAt(clip, 'scaleX', lt, clip.scaleX),
      scaleY: keyAt(clip, 'scaleY', lt, clip.scaleY),
      rotation: keyAt(clip, 'rotation', lt, clip.rotation),
    };
  }
  return { ...clip, x: keyAt(clip, 'x', lt, clip.x), y: keyAt(clip, 'y', lt, clip.y) };
}

export interface TransitionState {
  out: MediaClip | null;
  incoming: MediaClip;
  p: number;
  type: TransitionType;
}

export interface TransReveal {
  l: number;
  t: number;
  r: number;
  b: number;
}

export interface TransPart {
  op: number;
  dx: number;
  scale: number;
  blur: number;
  reveal?: TransReveal;
}

const TRANS_BLUR = 24;
const flatPart = (op: number): TransPart => ({ op, dx: 0, scale: 1, blur: 0 });

export function transitionPart(type: TransitionType, p: number, side: 'in' | 'out'): TransPart {
  const isIn = side === 'in';
  switch (type) {
    case 'dip':
      return flatPart(isIn ? Math.max(0, 2 * p - 1) : Math.max(0, 1 - 2 * p));
    case 'slide':
      return isIn ? { op: 1, dx: 1 - p, scale: 1, blur: 0 } : flatPart(1);
    case 'push':
      return isIn ? { op: 1, dx: 1 - p, scale: 1, blur: 0 } : { op: 1, dx: -p, scale: 1, blur: 0 };
    case 'wipe':
      return isIn ? { op: 1, dx: 0, scale: 1, blur: 0, reveal: { l: 0, t: 0, r: 1 - p, b: 0 } } : flatPart(1);
    case 'zoom':
      return isIn ? { op: p, dx: 0, scale: 1.3 - 0.3 * p, blur: 0 } : { op: 1 - p, dx: 0, scale: 1 + 0.3 * p, blur: 0 };
    case 'blur':
      return isIn ? { op: p, dx: 0, scale: 1, blur: (1 - p) * TRANS_BLUR } : { op: 1 - p, dx: 0, scale: 1, blur: p * TRANS_BLUR };
    case 'fade':
    default:
      return flatPart(isIn ? p : 1 - p);
  }
}

export function activeClipAt(clips: Clip[], tracks: Track[], kind: 'video' | 'audio', t: number): MediaClip | null {
  const audible = audibleTrackIds(tracks);
  const ids = new Set(tracks.filter((tr) => tr.kind === kind && (kind !== 'audio' || audible.has(tr.id))).map((tr) => tr.id));
  let best: MediaClip | null = null;
  for (const c of clips) {
    if (c.type !== 'media' || !ids.has(c.trackId)) continue;
    if (t >= c.start && t < c.start + c.duration && (!best || c.start > best.start)) best = c;
  }
  return best;
}

function activeClipOnTrack(clips: Clip[], trackId: string, t: number): MediaClip | null {
  let best: MediaClip | null = null;
  for (const c of clips) {
    if (c.type !== 'media' || c.trackId !== trackId) continue;
    if (t >= c.start && t < c.start + c.duration && (!best || c.start > best.start)) best = c;
  }
  return best;
}

function trackTransitionAt(clips: Clip[], trackId: string, t: number): TransitionState | null {
  for (const c of clips) {
    if (c.type !== 'media' || c.trackId !== trackId || c.transition === 'none' || c.transitionDur <= 0) continue;
    const d = Math.min(c.transitionDur, c.duration);
    const w0 = c.start;
    const w1 = c.start + d;
    if (t >= w0 && t < w1) {
      const out =
        clips.find(
          (o): o is MediaClip =>
            o.type === 'media' && o.id !== c.id && o.trackId === c.trackId && Math.abs(o.start + o.duration - c.start) < 0.03,
        ) ?? null;
      return { out, incoming: c, p: clamp((t - w0) / d, 0, 1), type: c.transition };
    }
  }
  return null;
}

export interface VisualLayer {
  clip: MediaClip;
  opacity: number;
  dx: number;
  scale: number;
  blur: number;
  reveal?: TransReveal;
  audioGain: number;
}

export function activeVisualLayers(clips: Clip[], tracks: Track[], t: number): VisualLayer[] {
  const videoBackToFront = orderedTracks(tracks)
    .filter((tr) => tr.kind === 'video' && !tr.hidden)
    .reverse();
  const audible = audibleTrackIds(tracks);
  const layers: VisualLayer[] = [];
  for (const track of videoBackToFront) {
    const trackGain = audible.has(track.id) ? 1 : 0;
    const trans = trackTransitionAt(clips, track.id, t);
    if (trans) {
      if (trans.out) {
        const po = transitionPart(trans.type, trans.p, 'out');
        layers.push({
          clip: trans.out,
          opacity: po.op * fadeFactor(trans.out, t) * keyOpacity(trans.out, t),
          dx: po.dx,
          scale: po.scale,
          blur: po.blur,
          reveal: po.reveal,
          audioGain: trackGain * Math.sqrt(Math.max(0, 1 - trans.p)),
        });
      }
      const pi = transitionPart(trans.type, trans.p, 'in');
      layers.push({
        clip: trans.incoming,
        opacity: pi.op * fadeFactor(trans.incoming, t) * keyOpacity(trans.incoming, t),
        dx: pi.dx,
        scale: pi.scale,
        blur: pi.blur,
        reveal: pi.reveal,
        audioGain: trackGain * Math.sqrt(Math.max(0, trans.p)),
      });
    } else {
      const c = activeClipOnTrack(clips, track.id, t);
      if (c) layers.push({ clip: c, opacity: fadeFactor(c, t) * keyOpacity(c, t), dx: 0, scale: 1, blur: 0, audioGain: trackGain });
    }
  }
  return layers;
}

export function upcomingVideoClips(clips: Clip[], tracks: Track[], t: number, ahead: number, max = 3): MediaClip[] {
  const visible = new Set(tracks.filter((tr) => tr.kind === 'video' && !tr.hidden).map((tr) => tr.id));
  return clips
    .filter((c): c is MediaClip => c.type === 'media' && visible.has(c.trackId) && c.start > t && c.start <= t + ahead)
    .sort((a, b) => a.start - b.start)
    .slice(0, max);
}

export function activeOverlays(clips: Clip[], t: number, tracks?: Track[]): OverlayClip[] {
  const hidden = tracks ? new Set(tracks.filter((tr) => tr.hidden).map((tr) => tr.id)) : null;
  return clips
    .filter(
      (c): c is OverlayClip =>
        (c.type === 'text' || c.type === 'shape' || c.type === 'draw') && t >= c.start && t < c.start + c.duration && !hidden?.has(c.trackId),
    )
    .sort((a, b) => a.start - b.start);
}

export function fadeFactor(clip: Clip, t: number): number {
  const into = t - clip.start;
  const out = clip.start + clip.duration - t;
  let g = 1;
  if (clip.fadeIn > 0) g = Math.min(g, into / clip.fadeIn);
  if (clip.fadeOut > 0) g = Math.min(g, out / clip.fadeOut);
  return clamp(g, 0, 1);
}

export function clipLayout(
  clip: MediaClip,
  srcW: number,
  srcH: number,
  W: number,
  H: number,
): { sx: number; sy: number; sw: number; sh: number; dw: number; dh: number; cx: number; cy: number; rotation: number } {
  const cropFracW = Math.max(0.01, 1 - clip.cropLeft - clip.cropRight);
  const cropFracH = Math.max(0.01, 1 - clip.cropTop - clip.cropBottom);
  const sw = srcW * cropFracW;
  const sh = srcH * cropFracH;
  const sx = srcW * clip.cropLeft;
  const sy = srcH * clip.cropTop;
  const fit = sw > 0 && sh > 0 ? Math.min(W / sw, H / sh) : 1;
  const dw = sw * fit * clip.scaleX;
  const dh = sh * fit * clip.scaleY;
  return { sx, sy, sw, sh, dw, dh, cx: W / 2 + clip.posX * W, cy: H / 2 + clip.posY * H, rotation: clip.rotation };
}
