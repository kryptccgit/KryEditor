import type { MediaFile, McpToolCall, McpToolResult } from '@shared/types';
import { useMediaStore } from './mediaStore';
import {
  BACKGROUNDS,
  BLEND_MODES,
  DEFAULT_CAPTION_STYLE,
  EASINGS,
  EFFECTS,
  FONTS,
  KARAOKE_STYLES,
  MAX_FADE,
  MAX_KEY_SPEED,
  MIN_CLIP,
  MIN_KEY_SPEED,
  SHAPES,
  SPEED_PRESETS,
  STICKERS,
  TEXT_ANIMS,
  TRANSITIONS,
  captionClipsFor,
  hasSpeedKeys,
  maxClipDuration,
  sliceClip,
  timelineDuration,
  uid,
  useTimelineStore,
  type BackgroundType,
  type Clip,
  type ClipPatch,
  type Easing,
  type KaraokeStyle,
  type Keyframe,
  type MediaClip,
  type ShapeClip,
  type ShapeKind,
  type TextClip,
  type Track,
  type TrackKind,
  RESOLUTIONS,
} from './timelineStore';
import {
  AUTO_EDIT_PRESETS,
  SEAM_FADE,
  analyzeCuts,
  mergeRanges,
  planCuts,
  rangesTotal,
  remapSegments,
  transcriptWords,
  type AnalysisMode,
  type AutoEditSettings,
  type Range,
  type Segment,
} from './autoEdit';
import { getEnvelope } from './peaks';
import { getTranscript } from './speechAnalysis';
import { speechModelFor } from './captions';
import { DEFAULT_EXPORT_SETTINGS, exportTimeline, renderStills, type ExportSettings } from './export';
import { DEFAULT_MASK, type ClipMask } from './mask';
import { fxMode } from './fx';
import { parseCube } from './lut';
import { useLutStore } from './lutStore';
import { renderReversedClip } from './reverse';
import { TTS_VOICES, encodeWavPcm16, synthesize } from './tts';
import { defaultRevoiceMedia, joinLines, loadRevoiceLines, runRevoice } from './revoice';
import { runReframe } from './reframe';
import { defaultDuckTracks, runDucking } from './ducking';
import { applyProject, hasContent, serializeProject } from './project';
import { useProjectStore } from './projectStore';

type Progress = (fraction: number, message: string) => void;
type Args = Record<string, unknown>;

class ToolError extends Error {}
const fail = (msg: string): never => {
  throw new ToolError(msg);
};

const st = () => useTimelineStore.getState();
const media = () => useMediaStore.getState().media;
const r2 = (x: number): number => Math.round(x * 100) / 100;
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const plural = (n: number, w: string): string => `${n} ${w}${n === 1 ? '' : 's'}`;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const obj = (v: unknown): Args | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Args) : undefined);

async function oneStep<T>(fn: () => T | Promise<T>): Promise<T> {
  const before = new Set(st().past);
  const out = await fn();
  const past = st().past;
  const added = past.filter((p) => !before.has(p));
  if (added.length > 1) useTimelineStore.setState({ past: past.filter((p) => before.has(p) || p === added[0]) });
  return out;
}

function mediaById(id: string): MediaFile {
  return media().find((m) => m.id === id) ?? fail(`No media "${id}". get_project lists the media library.`);
}
function clipById(id: string): Clip {
  return st().clips.find((c) => c.id === id) ?? fail(`No clip "${id}". get_project lists the clips.`);
}
function trackById(id: string): Track {
  return st().tracks.find((t) => t.id === id) ?? fail(`No track "${id}". get_project lists the tracks.`);
}
function mediaClipById(id: string): MediaClip {
  const c = clipById(id);
  return c.type === 'media' ? c : fail(`${id} is a ${c.type} clip; this needs a video, audio or image clip.`);
}

function pick<T extends string>(list: ReadonlyArray<{ label: string; value: T }>, name: unknown, what: string): T {
  const k = String(name ?? '').trim().toLowerCase();
  const hit = list.find((o) => o.value.toLowerCase() === k || o.label.toLowerCase() === k);
  return hit ? hit.value : fail(`Unknown ${what} "${String(name)}". Use one of: ${list.map((o) => o.value).join(', ')}.`);
}

const modelFor = (lang: unknown): string => speechModelFor(lang === 'multilingual' ? 'multilingual' : 'english');
const fontName = (value: string): string => FONTS.find((f) => f.value === value)?.label ?? value;
const lutName = (id: string | undefined): string | undefined => (id ? (useLutStore.getState().luts.find((l) => l.id === id)?.name ?? id) : undefined);

function ensureTextTrack(): Track {
  const found = st().tracks.find((t) => t.kind === 'text');
  if (found) return found;
  st().addTrack('text');
  const ts = st().tracks.filter((t) => t.kind === 'text');
  return ts[ts.length - 1];
}

function audibleClips(): MediaClip[] {
  const kind = new Map(media().map((m) => [m.id, m.kind]));
  return st().clips.filter((c): c is MediaClip => c.type === 'media' && c.freezeAt == null && (kind.get(c.mediaId) === 'video' || kind.get(c.mediaId) === 'audio'));
}

function resolveScope(scope: unknown): MediaClip[] {
  const aud = audibleClips();
  const s = (scope ?? {}) as { track_id?: unknown; clip_ids?: unknown };
  if (Array.isArray(s.clip_ids) && s.clip_ids.length > 0) {
    const ids = new Set(s.clip_ids.map(String));
    const picked = aud.filter((c) => ids.has(c.id));
    if (picked.length === 0) fail('None of those clips has audio to analyse.');
    return picked;
  }
  if (typeof s.track_id === 'string') {
    trackById(s.track_id);
    const picked = aud.filter((c) => c.trackId === s.track_id);
    if (picked.length === 0) fail(`Track ${s.track_id} has no clips with audio.`);
    return picked;
  }
  const tracks = st().tracks;
  const t = tracks.find((tr) => tr.kind === 'video' && aud.some((c) => c.trackId === tr.id)) ?? tracks.find((tr) => aud.some((c) => c.trackId === tr.id));
  if (!t) fail('Nothing on the timeline has audio. Import a video or audio file first.');
  return aud.filter((c) => c.trackId === t!.id);
}

function resolveTargets(a: Args): Clip[] {
  if (Array.isArray(a.clip_ids) && a.clip_ids.length > 0) return a.clip_ids.map((id) => clipById(String(id)));
  if (str(a.clip_id)) return [clipById(String(a.clip_id))];
  if (str(a.track_id)) {
    trackById(String(a.track_id));
    const on = st().clips.filter((c) => c.trackId === a.track_id);
    return on.length > 0 ? on : fail(`Track ${String(a.track_id)} is empty.`);
  }
  return fail('Say which clips: clip_id, clip_ids or track_id.');
}

function settingsFrom(a: Args): { settings: AutoEditSettings; mode: AnalysisMode } {
  const preset = AUTO_EDIT_PRESETS.find((p) => p.id === (str(a.preset) ?? 'talking')) ?? AUTO_EDIT_PRESETS[0];
  const s: AutoEditSettings = { ...preset.settings };
  const minPause = num(a.min_pause);
  const pad = num(a.padding);
  const sens = num(a.sensitivity_db);
  if (minPause !== undefined) s.minPause = minPause;
  if (pad !== undefined) {
    s.padAfter = pad;
    s.padBefore = +(pad * 0.4).toFixed(3);
  }
  if (sens !== undefined) s.sensitivityDb = sens;
  if (bool(a.fillers) !== undefined) s.fillers = !!a.fillers;
  if (bool(a.retakes) !== undefined) s.retakes = !!a.retakes;
  if (bool(a.remove) !== undefined) s.removePauses = !!a.remove;
  if (bool(a.zoom) !== undefined) s.zoom = !!a.zoom;
  const zs = num(a.zoom_scale);
  if (zs !== undefined) s.zoomScale = zs;
  const mode: AnalysisMode = a.mode === 'speech' || a.mode === 'loudness' ? a.mode : (preset.mode ?? 'loudness');
  return { settings: s, mode };
}

async function transcriptsFor(ids: string[], model: string, progress: Progress, signal: AbortSignal): Promise<Map<string, Segment[]>> {
  const out = new Map<string, Segment[]>();
  for (const id of ids) {
    const m = mediaById(id);
    out.set(id, await getTranscript(m, { model, signal, onProgress: (p) => progress(p.ratio > 0 ? p.ratio : -1, p.status) }));
  }
  return out;
}

async function analyse(a: Args, progress: Progress, signal: AbortSignal) {
  const { settings, mode } = settingsFrom(a);
  const clips = resolveScope(a.scope);
  const ids = [...new Set(clips.map((c) => c.mediaId))];
  progress(-1, 'Reading audio…');
  const envs = new Map<string, Float32Array>();
  for (const id of ids) envs.set(id, await getEnvelope(mediaById(id)));
  const transcripts = mode === 'speech' ? await transcriptsFor(ids, modelFor(a.language), progress, signal) : new Map<string, Segment[]>();
  const words = new Map([...transcripts].map(([id, segs]) => [id, transcriptWords(segs)]));
  const result = analyzeCuts({ mode, clips, settings, envelope: (id) => envs.get(id), words: (id) => words.get(id) });
  return { ...result, settings, mode, clips, transcripts };
}

function fmtRanges(ranges: Range[], max = 60): string {
  const shown = ranges.slice(0, max).map(([x, y]) => `[${r2(x)}, ${r2(y)}]`).join(', ');
  return ranges.length > max ? `${shown}, … (${ranges.length - max} more)` : shown;
}

function describeClip(c: Clip, name: Map<string, string>): Record<string, unknown> {
  const o: Record<string, unknown> = { id: c.id, type: c.type, track: c.trackId, start: r2(c.start), end: r2(c.start + c.duration) };
  if (c.fadeIn) o.fade_in = r2(c.fadeIn);
  if (c.fadeOut) o.fade_out = r2(c.fadeOut);
  const keyed = [...new Set((c.keyframes ?? []).map((k) => k.prop))];
  if (keyed.length) o.keyframed = keyed;
  if (c.type === 'media') {
    Object.assign(o, { media: c.mediaId, name: name.get(c.mediaId), in: r2(c.inPoint), speed: c.speed });
    if (c.volume !== 1) o.volume = c.volume;
    if (c.muted) o.muted = true;
    if (c.denoise) o.denoise = true;
    if (c.opacity !== 1) o.opacity = c.opacity;
    if (c.scaleX !== 1 || c.scaleY !== 1) o.scale = c.scaleX === c.scaleY ? r2(c.scaleX) : [r2(c.scaleX), r2(c.scaleY)];
    if (c.posX || c.posY) o.pos = [r2(c.posX), r2(c.posY)];
    if (c.rotation) o.rotation = c.rotation;
    if (c.cropTop || c.cropBottom || c.cropLeft || c.cropRight) o.crop = { top: c.cropTop, bottom: c.cropBottom, left: c.cropLeft, right: c.cropRight };
    if (c.blend && c.blend !== 'normal') o.blend = c.blend;
    if (c.brightness !== 100 || c.contrast !== 100 || c.saturation !== 100) o.color = { brightness: c.brightness, contrast: c.contrast, saturation: c.saturation };
    if (c.hue) o.hue = c.hue;
    if (c.vignette) o.vignette = c.vignette;
    if (c.effect !== 'none') o.effect = c.effect;
    if (c.lut) o.lut = { name: lutName(c.lut), amount: c.lutAmount ?? 1 };
    if (c.transition !== 'none') o.transition = { type: c.transition, duration: c.transitionDur };
    if (c.chromaKey) o.chroma_key = { color: c.chromaColor, similarity: c.chromaSimilarity, smoothness: c.chromaSmoothness };
    if (c.bgRemove) o.bg_remove = true;
    if (c.mask) o.mask = c.mask;
    if (c.freezeAt != null) o.freeze = true;
  } else if (c.type === 'text') {
    o.text = c.text.length > 80 ? `${c.text.slice(0, 77)}…` : c.text;
    if (c.role === 'caption') o.caption = true;
    else Object.assign(o, { font: fontName(c.fontFamily), size: c.fontSize, color: c.color, at: [r2(c.x), r2(c.y)] });
    if (c.animIn !== 'none' || c.animOut !== 'none') o.anim = [c.animIn, c.animOut];
  } else if (c.type === 'shape') {
    Object.assign(o, { shape: c.shape, fill: c.fill, at: [r2(c.x), r2(c.y)], size: [r2(c.w), r2(c.h)] });
  }
  return o;
}

function getProject(): string {
  const s = st();
  const lib = media();
  const name = new Map(lib.map((m) => [m.id, m.name]));
  const proj = useProjectStore.getState();
  const out = {
    project: { name: proj.name, path: proj.path, unsaved: proj.dirty },
    canvas: s.canvas,
    fps: s.fps,
    background: s.background,
    duration: r2(timelineDuration(s.clips)),
    playhead: r2(s.playhead),
    tracks: s.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, ...(t.locked ? { locked: true } : {}), ...(t.hidden ? { hidden: true } : {}), ...(t.muted ? { muted: true } : {}), ...(t.solo ? { solo: true } : {}) })),
    clips: [...s.clips].sort((x, y) => x.start - y.start).map((c) => describeClip(c, name)),
    media: lib.map((m) => ({ id: m.id, name: m.name, kind: m.kind, path: m.filePath })),
  };
  return JSON.stringify(out);
}

const KEYABLE: Record<'media' | 'overlay', Record<string, string[]>> = {
  media: { pos_x: ['posX'], pos_y: ['posY'], scale: ['scaleX', 'scaleY'], scale_x: ['scaleX'], scale_y: ['scaleY'], rotation: ['rotation'], opacity: ['opacity'], volume: ['volume'], speed: ['speed'] },
  overlay: { x: ['x'], y: ['y'], opacity: ['opacity'] },
};

function listOptions(): string {
  const v = <T extends { value: string }>(l: ReadonlyArray<T>) => l.map((o) => o.value);
  return JSON.stringify({
    effects: { filters: EFFECTS.filter((e) => !fxMode(e.value)).map((e) => e.value), gpu_effects: EFFECTS.filter((e) => fxMode(e.value) > 0).map((e) => e.value) },
    transitions: v(TRANSITIONS),
    blend_modes: v(BLEND_MODES),
    fonts: FONTS.map((f) => f.label),
    text_animations: v(TEXT_ANIMS),
    karaoke_styles: v(KARAOKE_STYLES),
    shapes: v(SHAPES),
    stickers: STICKERS,
    speed_presets: v(SPEED_PRESETS),
    easings: v(EASINGS),
    backgrounds: v(BACKGROUNDS),
    luts: useLutStore.getState().luts.map((l) => ({ id: l.id, name: l.name })),
    keyframable: { media: Object.keys(KEYABLE.media), text_shape_drawing: Object.keys(KEYABLE.overlay) },
    voices: TTS_VOICES.map((t) => t.label),
  });
}

async function getTranscriptTool(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const aud = audibleClips();
  const id = str(a.media_id) ?? aud[0]?.mediaId ?? fail('Nothing on the timeline has audio; pass media_id.');
  const m = mediaById(id);
  if (m.kind !== 'video' && m.kind !== 'audio') fail(`${m.name} has no audio.`);
  const segs = (await transcriptsFor([id], modelFor(a.language), progress, signal)).get(id) ?? [];
  const onTimeline = aud.filter((c) => c.mediaId === id);
  const track = onTimeline[0]?.trackId;
  const pieces = onTimeline.filter((c) => c.trackId === track);
  const words = a.words === true;
  const mapped = pieces.length > 0 ? remapSegments(segs, pieces) : segs;
  const lines = mapped.map((s) => {
    const head = `[${r2(s.start)}–${r2(s.end)}] ${s.text.trim()}`;
    return words && s.words ? `${head}\n  ${s.words.map((w) => `${w.text.trim()}@${r2(w.start)}`).join(' ')}` : head;
  });
  const where = pieces.length > 0 ? 'timeline seconds' : 'source seconds (this media is not on the timeline)';
  return `Transcript of ${m.name} (${plural(mapped.length, 'line')}, ${where}):\n${lines.join('\n')}`;
}

async function detectPauses(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const r = await analyse(a, progress, signal);
  const total = timelineDuration(st().clips);
  const saved = rangesTotal(r.cuts);
  const kinds = [plural(r.pauses, 'pause')];
  if (r.fillers) kinds.push(plural(r.fillers, 'filler'));
  if (r.retakes) kinds.push(plural(r.retakes, 'retake'));
  if (r.cuts.length === 0) return `Nothing to cut (${r.mode} mode). Try a lower min_pause${r.mode === 'loudness' ? ' or a higher sensitivity_db' : ' or a smaller sensitivity_db'}.`;
  return `${kinds.join(', ')} found (${r.mode} mode): ${r2(saved)}s of ${r2(total)}s (${Math.round((saved / Math.max(1e-9, total)) * 100)}%).\nranges: ${fmtRanges(r.cuts)}\nNothing changed yet: pass these to cut_ranges, or use auto_edit.`;
}

async function autoEdit(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const r = await analyse(a, progress, signal);
  if (r.cuts.length === 0) return `Nothing to cut (${r.mode} mode); the timeline is unchanged.`;
  const s = st();
  const saved = rangesTotal(r.cuts);
  const next = planCuts(s.clips, s.tracks, media(), r.cuts, { remove: r.settings.removePauses, zoom: r.settings.zoom ? r.settings.zoomScale : null, seamFade: SEAM_FADE });
  let tracks: Track[] | undefined;
  const caps: Clip[] = [];
  if (a.captions === true && r.mode === 'speech') {
    let tt = s.tracks.find((t) => t.kind === 'text');
    if (!tt) {
      tt = { id: uid('tr'), kind: 'text', name: 'T1' };
      tracks = [...s.tracks, tt];
    }
    const scopeIds = new Set(r.clips.map((c) => c.trackId));
    for (const [id, segs] of r.transcripts) {
      const pieces = next.filter((c): c is MediaClip => c.type === 'media' && c.mediaId === id && scopeIds.has(c.trackId));
      caps.push(...captionClipsFor(remapSegments(segs, pieces), DEFAULT_CAPTION_STYLE, tt.id));
    }
  }
  s.pause();
  st().commitClips([...next, ...caps], tracks);
  const bits = [plural(r.pauses, 'pause')];
  if (r.fillers) bits.push(plural(r.fillers, 'filler'));
  if (r.retakes) bits.push(plural(r.retakes, 'retake'));
  const verb = r.settings.removePauses ? `Removed ${bits.join(', ')} (${r2(saved)}s)` : `Cut at ${bits.join(', ')} (nothing removed)`;
  const extra = [r.settings.zoom ? 'alternating punch-in zoom on' : '', caps.length ? `added ${plural(caps.length, 'caption')}` : ''].filter(Boolean).join('; ');
  return `${verb} in ${r.mode} mode${extra ? `; ${extra}` : ''}. New duration ${r2(timelineDuration(st().clips))}s. One undo step.`;
}

function cutRanges(a: Args): string {
  const raw = Array.isArray(a.ranges) ? (a.ranges as unknown[]) : [];
  const ranges: Range[] = raw
    .map((r) => (Array.isArray(r) ? [Number(r[0]), Number(r[1])] : [NaN, NaN]))
    .filter((r): r is Range => Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[1] > r[0]);
  if (ranges.length === 0) fail('No valid [start, end] ranges (end must be after start).');
  const merged = mergeRanges(ranges);
  const s = st();
  const ripple = a.ripple !== false;
  s.pause();
  st().commitClips(planCuts(s.clips, s.tracks, media(), merged, { remove: true, zoom: null, seamFade: SEAM_FADE, ripple }));
  return `Cut ${plural(merged.length, 'range')} (${r2(rangesTotal(merged))}s)${ripple ? ', gaps closed' : ', gaps left'}. New duration ${r2(timelineDuration(st().clips))}s.`;
}

async function importMedia(a: Args): Promise<string> {
  const paths = (Array.isArray(a.paths) ? a.paths : []).map(String).filter(Boolean);
  const r = await window.krypt.media.resolvePaths(paths);
  if (!r.ok) fail(r.message ?? 'Could not import those files.');
  const files = r.data ?? [];
  if (files.length === 0) fail('None of those paths is a readable video, audio or image file.');
  useMediaStore.getState().add(files);
  const lib = media();
  const entries = files.map((f) => lib.find((m) => m.filePath === f.filePath) ?? f);
  const added: string[] = [];
  if (a.add_to_timeline === true) {
    await oneStep(async () => {
      for (const m of entries) {
        const id = await st().addMedia(m);
        if (id) added.push(id);
      }
    });
  }
  const skipped = paths.length - files.length;
  return `Imported ${entries.map((m) => `${m.name} (id ${m.id}, ${m.kind})`).join(', ')}.${added.length ? ` Added to the timeline as clips ${added.join(', ')}.` : ''}${skipped > 0 ? ` Skipped ${plural(skipped, 'path')} that weren't media files.` : ''}`;
}

function maxDuration(c: MediaClip, kind: string | undefined): number {
  if (kind === 'image' || c.freezeAt != null || !(c.sourceDuration > 0)) return Infinity;
  return Math.max(MIN_CLIP, maxClipDuration(c));
}

async function addClip(a: Args): Promise<string> {
  const m = mediaById(String(a.media_id));
  const tr = str(a.track_id) ? trackById(String(a.track_id)) : null;
  if (tr && tr.kind === 'text') fail('Media clips go on video or audio tracks, not text tracks.');
  const id = await oneStep(async () => {
    const cid = await st().addMedia(m);
    if (!cid) fail(`Could not add ${m.name}.`);
    const c = clipById(cid!) as MediaClip;
    const patch: ClipPatch = {};
    const inPt = num(a.in_point);
    if (inPt !== undefined && m.kind !== 'image') patch.inPoint = Math.max(0, Math.min(inPt, Math.max(0, c.sourceDuration - MIN_CLIP)));
    const probe = { ...c, ...patch } as MediaClip;
    const dur = num(a.duration);
    patch.duration = Math.max(MIN_CLIP, Math.min(dur ?? (m.kind === 'image' ? c.duration : Infinity), maxDuration(probe, m.kind)));
    if (!Number.isFinite(patch.duration)) patch.duration = c.duration;
    const start = num(a.start);
    if (start !== undefined) patch.start = start;
    if (tr) patch.trackId = tr.id;
    st().updateClip(cid!, patch);
    return cid!;
  });
  const c = clipById(id);
  return `Added ${m.name} as clip ${id} on ${c.trackId}, ${r2(c.start)}–${r2(c.start + c.duration)}s.`;
}

const animOf = (v: unknown): TextClip['animIn'] => pick(TEXT_ANIMS, String(v ?? '').toLowerCase() === 'slide-up' ? 'slide' : v, 'animation');

function stylePatch(style: unknown): Partial<TextClip> {
  const s = obj(style) ?? {};
  const p: Partial<TextClip> = {};
  const n = (k: string): number | undefined => num(s[k]);
  const c = (k: string): string | undefined => str(s[k]);
  if (n('font_size') !== undefined) p.fontSize = n('font_size');
  if (s.font !== undefined) p.fontFamily = pick(FONTS.map((f) => ({ label: f.label, value: f.value })), s.font, 'font');
  if (c('color')) p.color = c('color');
  if (bool(s.bold) !== undefined) p.bold = !!s.bold;
  if (bool(s.italic) !== undefined) p.italic = !!s.italic;
  if (n('x') !== undefined) p.x = n('x');
  if (n('y') !== undefined) p.y = n('y');
  if (s.align === 'left' || s.align === 'center' || s.align === 'right') p.align = s.align;
  if (n('outline_width') !== undefined) p.outlineWidth = n('outline_width');
  if (c('outline_color')) p.outlineColor = c('outline_color');
  if (n('glow') !== undefined) p.glow = n('glow');
  if (c('glow_color')) p.glowColor = c('glow_color');
  if (s.bg_style === 'none' || s.bg_style === 'box' || s.bg_style === 'highlight') p.bgStyle = s.bg_style;
  if (c('bg_color')) p.bgColor = c('bg_color');
  if (n('bg_opacity') !== undefined) p.bgOpacity = n('bg_opacity');
  if (n('bg_radius') !== undefined) p.bgRadius = n('bg_radius');
  if (n('bg_padding') !== undefined) p.bgPadding = n('bg_padding');
  if (s.anim_in !== undefined) p.animIn = animOf(s.anim_in);
  if (s.anim_out !== undefined) p.animOut = animOf(s.anim_out);
  if (s.karaoke !== undefined) p.karaoke = pick(KARAOKE_STYLES, s.karaoke, 'karaoke style') as KaraokeStyle;
  if (c('karaoke_color')) p.karaokeColor = c('karaoke_color');
  return p;
}

function overlayTrack(a: Args): Track {
  const t = str(a.track_id) ? trackById(String(a.track_id)) : ensureTextTrack();
  return t.kind === 'text' ? t : fail(`${t.id} is a ${t.kind} track; titles, shapes and stickers go on text tracks.`);
}

async function addText(a: Args): Promise<string> {
  const style = stylePatch(a.style);
  const id = await oneStep(() => {
    const track = overlayTrack(a);
    st().addText();
    const sel = st().selectedIds;
    const cid = sel[sel.length - 1];
    st().updateClip(cid, { ...style, text: String(a.text), start: num(a.start) ?? 0, duration: Math.max(MIN_CLIP, num(a.duration) ?? 3), trackId: track.id });
    return cid;
  });
  const c = clipById(id);
  return `Added text clip ${id} on ${c.trackId}, ${r2(c.start)}–${r2(c.start + c.duration)}s.`;
}

function shapePatch(a: Args): Partial<ShapeClip> {
  const p: Partial<ShapeClip> = {};
  if (typeof a.fill === 'string') p.fill = a.fill;
  if (typeof a.stroke === 'string') p.stroke = a.stroke;
  const n = (k: string): number | undefined => num(a[k]);
  if (n('stroke_width') !== undefined) p.strokeWidth = n('stroke_width');
  for (const k of ['x', 'y', 'w', 'h', 'rotation', 'opacity'] as const) if (n(k) !== undefined) p[k] = n(k);
  if (a.anim_in !== undefined) p.animIn = animOf(a.anim_in);
  if (a.anim_out !== undefined) p.animOut = animOf(a.anim_out);
  return p;
}

async function addShape(a: Args): Promise<string> {
  const shape = pick(SHAPES, a.shape, 'shape') as ShapeKind;
  const patch = shapePatch(a);
  const id = await oneStep(() => {
    const track = overlayTrack(a);
    st().addShape(shape);
    const cid = st().selectedIds[0];
    st().updateClip(cid, { ...patch, start: num(a.start) ?? 0, duration: Math.max(MIN_CLIP, num(a.duration) ?? 3), trackId: track.id });
    return cid;
  });
  const c = clipById(id);
  return `Added ${shape} ${id} on ${c.trackId}, ${r2(c.start)}–${r2(c.start + c.duration)}s.`;
}

function resolveLut(v: unknown): string {
  const k = String(v).trim().toLowerCase();
  const luts = useLutStore.getState().luts;
  const hit = luts.find((l) => l.id.toLowerCase() === k || l.name.toLowerCase() === k || l.name.toLowerCase().replace(/\.cube$/, '') === k);
  return hit ? hit.id : fail(luts.length ? `No LUT "${String(v)}". Imported: ${luts.map((l) => l.name).join(', ')}.` : 'No LUTs imported yet: use import_lut first.');
}

function patchFor(c: Clip, a: Args, notes: Set<string>): ClipPatch {
  const patch: ClipPatch = {};
  const set = <K extends keyof ClipPatch>(k: K, v: ClipPatch[K] | undefined): void => {
    if (v !== undefined) patch[k] = v;
  };
  set('start', num(a.start));
  if (str(a.move_to_track)) {
    const t = trackById(String(a.move_to_track));
    if ((c.type === 'media') === (t.kind === 'text')) fail(c.type === 'media' ? 'Media clips go on video or audio tracks.' : 'Text, shapes and drawings go on text tracks.');
    patch.trackId = t.id;
  }
  const maxFade = Math.min(MAX_FADE, c.duration);
  if (num(a.fade_in) !== undefined) patch.fadeIn = clamp(num(a.fade_in)!, 0, maxFade);
  if (num(a.fade_out) !== undefined) patch.fadeOut = clamp(num(a.fade_out)!, 0, maxFade);

  if (c.type === 'media') {
    const kind = media().find((m) => m.id === c.mediaId)?.kind;
    set('volume', num(a.volume));
    set('muted', bool(a.muted));
    set('denoise', bool(a.denoise));
    set('speed', num(a.speed));
    set('opacity', num(a.opacity));
    set('posX', num(a.pos_x));
    set('posY', num(a.pos_y));
    set('rotation', num(a.rotation));
    set('brightness', num(a.brightness));
    set('contrast', num(a.contrast));
    set('saturation', num(a.saturation));
    set('hue', num(a.hue));
    set('vignette', num(a.vignette));
    set('cropTop', num(a.crop_top));
    set('cropBottom', num(a.crop_bottom));
    set('cropLeft', num(a.crop_left));
    set('cropRight', num(a.crop_right));
    set('scaleX', num(a.scale) ?? num(a.scale_x));
    set('scaleY', num(a.scale) ?? num(a.scale_y));
    if (a.blend !== undefined) patch.blend = pick(BLEND_MODES, a.blend, 'blend mode');
    if (a.effect !== undefined) {
      patch.effect = pick(EFFECTS.map((e) => ({ label: e.label, value: e.value })), a.effect, 'effect');
      if (fxMode(patch.effect) > 0 && c.lut && a.lut === undefined) {
        patch.lut = undefined;
        notes.add('the LUT was cleared (a GPU effect replaces it)');
      }
    }
    if (a.lut !== undefined) {
      if (a.lut === null || a.lut === '') patch.lut = undefined;
      else {
        if (patch.effect && fxMode(patch.effect) > 0) fail('A GPU effect and a LUT can\'t be on the same clip; pick one.');
        patch.lut = resolveLut(a.lut);
        if (fxMode(c.effect) > 0 && patch.effect === undefined) {
          patch.effect = 'none';
          notes.add(`the ${c.effect} effect was cleared (the LUT replaces it)`);
        }
      }
    }
    set('lutAmount', num(a.lut_amount));
    if (a.transition !== undefined) patch.transition = pick(TRANSITIONS, a.transition, 'transition');
    if (num(a.transition_duration) !== undefined) patch.transitionDur = Math.min(num(a.transition_duration)!, c.duration);
    const ck = obj(a.chroma_key);
    if (ck) {
      if (bool(ck.enabled) !== undefined) patch.chromaKey = !!ck.enabled;
      if (str(ck.color)) patch.chromaColor = String(ck.color);
      if (num(ck.similarity) !== undefined) patch.chromaSimilarity = num(ck.similarity);
      if (num(ck.smoothness) !== undefined) patch.chromaSmoothness = num(ck.smoothness);
      if (patch.chromaKey) patch.bgRemove = false;
    }
    if (bool(a.bg_remove) !== undefined) {
      if (a.bg_remove === true && patch.chromaKey) fail('chroma_key and bg_remove are exclusive; pick one.');
      patch.bgRemove = !!a.bg_remove;
      if (patch.bgRemove) patch.chromaKey = false;
    }
    if (a.mask !== undefined) {
      const m = obj(a.mask);
      if (!m) patch.mask = undefined;
      else {
        const next: ClipMask = { ...DEFAULT_MASK, ...c.mask };
        if (m.type === 'linear' || m.type === 'rect' || m.type === 'ellipse') next.type = m.type;
        for (const k of ['x', 'y', 'w', 'h', 'rotation', 'feather'] as const) if (num(m[k]) !== undefined) next[k] = num(m[k])!;
        if (bool(m.invert) !== undefined) next.invert = !!m.invert;
        patch.mask = next;
      }
    }
    const dur = num(a.duration);
    if (dur !== undefined || patch.speed !== undefined) {
      const probe = { ...c, ...patch } as MediaClip;
      const want = dur ?? (c.duration * c.speed) / (patch.speed ?? c.speed);
      patch.duration = Math.max(MIN_CLIP, Math.min(want, maxDuration(probe, kind)));
      if (dur !== undefined && patch.duration < dur - 1e-3) notes.add(`duration capped at ${r2(patch.duration)}s on ${c.id} (end of the source)`);
    }
  } else {
    set('duration', num(a.duration) !== undefined ? Math.max(MIN_CLIP, num(a.duration)!) : undefined);
    if (c.type === 'text') {
      if (typeof a.text === 'string') patch.text = a.text;
      Object.assign(patch, stylePatch(a.style));
      set('opacity', num(a.opacity));
    } else if (c.type === 'shape') {
      Object.assign(patch, shapePatch(a));
    } else {
      set('opacity', num(a.opacity));
      if (a.anim_in !== undefined) patch.animIn = animOf(a.anim_in);
      if (a.anim_out !== undefined) patch.animOut = animOf(a.anim_out);
    }
  }
  return patch;
}

function updateClips(a: Args): string {
  const clips = resolveTargets(a);
  const notes = new Set<string>();
  const patches = clips.map((c) => [c, patchFor(c, a, notes)] as const);
  const changed = patches.filter(([, p]) => Object.keys(p).length > 0);
  if (changed.length === 0) {
    const types = [...new Set(clips.map((c) => c.type))].join('/');
    fail(`Nothing to change on ${types} clips with those fields. Media-only settings (effect, lut, blend, crop, chroma_key…) don't apply to text or shapes, and text style only applies to text.`);
  }
  st().pushHistory();
  for (const [c, p] of changed) st().updateClip(c.id, p);
  const keys = [...new Set(changed.flatMap(([, p]) => Object.keys(p)))];
  const skipped = clips.length - changed.length;
  const who = changed.length === 1 ? changed[0][0].id : plural(changed.length, 'clip');
  return `Updated ${who}: ${keys.join(', ')}.${skipped ? ` ${plural(skipped, 'clip')} skipped (those fields don't apply to them).` : ''}${notes.size ? ` Note: ${[...notes].join('; ')}.` : ''}`;
}

function setKeyframes(a: Args): string {
  const c = clipById(String(a.clip_id));
  const table = c.type === 'media' ? KEYABLE.media : KEYABLE.overlay;
  const prop = String(a.property ?? '').toLowerCase().replace(/^posx$/, 'pos_x').replace(/^posy$/, 'pos_y');
  const fields = table[prop] ?? fail(`${c.type} clips can keyframe: ${Object.keys(table).join(', ')}.`);
  const raw = Array.isArray(a.keyframes) ? (a.keyframes as Args[]) : [];
  const lo = prop === 'speed' ? MIN_KEY_SPEED : prop === 'opacity' ? 0 : prop === 'volume' ? 0 : -Infinity;
  const hi = prop === 'speed' ? MAX_KEY_SPEED : prop === 'opacity' ? 1 : prop === 'volume' ? 2 : Infinity;
  let outside = 0;
  const keys: Keyframe[] = [];
  for (const k of raw) {
    const t = num(k.time);
    const v = num(k.value);
    if (t === undefined || v === undefined) fail('Each keyframe needs a time and a value.');
    const local = t! - c.start;
    if (local < -0.05 || local > c.duration + 0.05) outside++;
    const ease = (EASINGS.some((e) => e.value === k.ease) ? k.ease : undefined) as Easing | undefined;
    for (const f of fields) keys.push({ id: uid('k'), prop: f, t: clamp(local, 0, c.duration), value: clamp(v!, lo, hi), ease });
  }
  if (outside) fail(`${plural(outside, 'keyframe')} fall outside the clip (${r2(c.start)}–${r2(c.start + c.duration)}s). Times are timeline seconds.`);
  const kept = (c.keyframes ?? []).filter((k) => !fields.includes(k.prop));
  let next = { ...c, keyframes: [...kept, ...keys] } as Clip;
  let note = '';
  if (next.type === 'media' && fields.includes('speed')) {
    const cap = maxClipDuration(next);
    if (next.duration > cap + 1e-6) {
      next = { ...next, duration: Math.max(MIN_CLIP, cap) };
      note = ` The clip was shortened to ${r2(next.duration)}s so the faster speed doesn't run past the end of the footage.`;
    }
  }
  st().pushHistory();
  st().updateClip(c.id, { keyframes: next.keyframes, duration: next.duration });
  return raw.length === 0 ? `Removed the ${prop} animation from ${c.id}.` : `Set ${plural(raw.length, 'keyframe')} for ${prop} on ${c.id}.${note}`;
}

async function retimeClip(a: Args, progress: Progress): Promise<string> {
  const c = mediaClipById(String(a.clip_id));
  const actions = [a.speed_preset !== undefined, a.freeze_at !== undefined, a.reverse === true].filter(Boolean).length;
  if (actions !== 1) fail('Pass exactly one of speed_preset, freeze_at or reverse.');
  if (c.freezeAt != null) fail(`${c.id} is a freeze frame; retime the clip it came from.`);
  const m = mediaById(c.mediaId);
  if (a.speed_preset !== undefined) {
    if (m.kind === 'image') fail('Images have no speed.');
    const preset = pick(SPEED_PRESETS, a.speed_preset, 'speed preset');
    st().applySpeedPreset(c.id, preset);
    const after = clipById(c.id);
    return preset === 'none' ? `${c.id} is back to constant speed.` : `Applied the ${preset} speed curve to ${c.id} (${r2(after.duration)}s).`;
  }
  if (a.freeze_at !== undefined) {
    if (m.kind !== 'video') fail('Freeze frames need a video clip.');
    const t = num(a.freeze_at)!;
    if (t < c.start || t >= c.start + c.duration) fail(`freeze_at must be inside ${c.id} (${r2(c.start)}–${r2(c.start + c.duration)}s).`);
    const want = num(a.freeze_duration) ?? 3;
    const id = await oneStep(() => {
      const prevHead = st().playhead;
      st().setSelection([c.id]);
      st().setPlayhead(t);
      if (!st().freezeFrameAtPlayhead()) fail('Could not freeze there.');
      st().setPlayhead(prevHead);
      const frozen = clipById(st().selectedIds[0]);
      const delta = want - frozen.duration;
      if (Math.abs(delta) > 1e-6) {
        const after = frozen.start + frozen.duration - 1e-6;
        useTimelineStore.setState((s) => ({
          clips: s.clips.map((x) =>
            x.id === frozen.id ? { ...x, duration: want } : x.trackId === frozen.trackId && x.start >= after ? { ...x, start: x.start + delta } : x,
          ),
        }));
      }
      return frozen.id;
    });
    return `Inserted a ${r2(want)}s freeze frame (${id}) at ${r2(t)}s; the rest of the track moved right.`;
  }
  if (m.kind !== 'video') fail('Reverse needs a video clip.');
  if (hasSpeedKeys(c)) fail('Remove the speed curve first (retime_clip speed_preset none).');
  progress(0, 'Reversing…');
  const { data, span } = await renderReversedClip(c, m, st().fps, (r) => progress(r, 'Reversing…'));
  const r = await window.krypt.media.saveDerived(data, `reversed-${Date.now().toString(36)}.mp4`);
  if (!r.ok || !r.data) fail(r.message ?? 'Could not store the reversed clip.');
  useMediaStore.getState().add([r.data!]);
  st().pushHistory();
  st().updateClip(c.id, { mediaId: r.data!.id, inPoint: 0, sourceDuration: span });
  return `Reversed ${c.id}.`;
}

function splitClips(a: Args): string {
  const t = num(a.time) ?? fail('time is required.');
  const s = st();
  const locked = new Set(s.tracks.filter((tr) => tr.locked).map((tr) => tr.id));
  const ids = Array.isArray(a.clip_ids) && a.clip_ids.length > 0 ? new Set(a.clip_ids.map(String)) : null;
  const next: Clip[] = [];
  const made: string[] = [];
  for (const c of s.clips) {
    const end = c.start + c.duration;
    const hit = (ids ? ids.has(c.id) : !locked.has(c.trackId)) && t - c.start >= MIN_CLIP && end - t >= MIN_CLIP;
    if (!hit) {
      next.push(c);
      continue;
    }
    const right = sliceClip(c, t, end);
    next.push(sliceClip(c, c.start, t, { keepId: true }), right);
    made.push(right.id);
  }
  if (made.length === 0) fail(`No clip can be split at ${r2(t)}s (nothing spans it, or the split would leave a piece under ${MIN_CLIP}s).`);
  st().commitClips(next);
  return `Split ${plural(made.length, 'clip')} at ${r2(t)}s; the right-hand pieces are ${made.join(', ')}.`;
}

async function duplicateClip(a: Args): Promise<string> {
  const c = clipById(String(a.clip_id));
  const tr = str(a.track_id) ? trackById(String(a.track_id)) : null;
  if (tr && (c.type === 'media') === (tr.kind === 'text')) fail(c.type === 'media' ? 'Media clips go on video or audio tracks.' : 'Text, shapes and drawings go on text tracks.');
  const id = await oneStep(() => {
    st().duplicateClip(c.id);
    const cid = st().selectedIds[0];
    const patch: ClipPatch = {};
    if (num(a.start) !== undefined) patch.start = num(a.start);
    if (tr) patch.trackId = tr.id;
    if (Object.keys(patch).length) st().updateClip(cid, patch);
    return cid;
  });
  const d = clipById(id);
  return `Duplicated ${c.id} as ${id} on ${d.trackId}, ${r2(d.start)}–${r2(d.start + d.duration)}s.`;
}

function detachAudio(a: Args): string {
  const c = mediaClipById(String(a.clip_id));
  if (mediaById(c.mediaId).kind !== 'video') fail('Only video clips have audio to detach.');
  st().detachAudio(c.id);
  const id = st().selectedIds[0];
  return `Detached the audio of ${c.id} to ${id} on ${clipById(id).trackId}; ${c.id} is now muted.`;
}

function deleteClips(a: Args): string {
  const ids = new Set((Array.isArray(a.clip_ids) ? a.clip_ids : []).map(String));
  const s = st();
  const gone = s.clips.filter((c) => ids.has(c.id));
  if (gone.length === 0) fail('None of those clip ids exist.');
  let next = s.clips.filter((c) => !ids.has(c.id));
  if (a.ripple === true) {
    const byTrack = new Map<string, Range[]>();
    for (const c of gone) byTrack.set(c.trackId, [...(byTrack.get(c.trackId) ?? []), [c.start, c.start + c.duration]]);
    next = next.map((c) => {
      const spans = mergeRanges(byTrack.get(c.trackId) ?? []);
      const shift = spans.filter(([, e]) => e <= c.start + 1e-6).reduce((acc, [b, e]) => acc + (e - b), 0);
      return shift > 0 ? { ...c, start: c.start - shift } : c;
    });
  }
  st().commitClips(next);
  return `Deleted ${plural(gone.length, 'clip')}${a.ripple === true ? ' and closed the gaps on their tracks' : ''}.`;
}

async function editTrack(a: Args): Promise<string> {
  const flags: Partial<Pick<Track, 'muted' | 'solo' | 'locked' | 'hidden' | 'name'>> = {};
  for (const k of ['muted', 'solo', 'locked', 'hidden'] as const) if (bool(a[k]) !== undefined) flags[k] = !!a[k];
  if (str(a.name)) flags.name = String(a.name);
  if (a.action === 'add') {
    const kind = (a.kind === 'video' || a.kind === 'audio' || a.kind === 'text' ? a.kind : fail('kind is required: video, audio or text.')) as TrackKind;
    const id = await oneStep(() => {
      st().addTrack(kind);
      const t = st().tracks[st().tracks.length - 1];
      if (Object.keys(flags).length) st().updateTrack(t.id, flags);
      return t.id;
    });
    return `Added ${kind} track ${id} (${trackById(id).name}).`;
  }
  const t = trackById(str(a.track_id) ?? fail('track_id is required.'));
  if (a.action === 'remove') {
    const n = st().clips.filter((c) => c.trackId === t.id).length;
    st().removeTrack(t.id);
    return `Removed track ${t.name}${n ? ` and its ${plural(n, 'clip')}` : ''}.`;
  }
  if (Object.keys(flags).length === 0) fail('Nothing to change: pass name, muted, solo, locked or hidden.');
  st().updateTrack(t.id, flags);
  return `Track ${t.id}: ${Object.entries(flags).map(([k, v]) => `${k}=${String(v)}`).join(', ')}.`;
}

async function addCaptions(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const clips = resolveScope(str(a.track_id) ? { track_id: a.track_id } : undefined);
  const ids = [...new Set(clips.map((c) => c.mediaId))];
  const transcripts = await transcriptsFor(ids, modelFor(a.language), progress, signal);
  const s = st();
  let tracks: Track[] | undefined;
  let tt = s.tracks.find((t) => t.kind === 'text');
  if (!tt) {
    tt = { id: uid('tr'), kind: 'text', name: 'T1' };
    tracks = [...s.tracks, tt];
  }
  const karaoke = (['none', 'color', 'pop', 'box'] as KaraokeStyle[]).includes(a.karaoke as KaraokeStyle) ? (a.karaoke as KaraokeStyle) : DEFAULT_CAPTION_STYLE.karaoke;
  const caps: Clip[] = [];
  for (const [id, segs] of transcripts) {
    const pieces = clips.filter((c) => c.mediaId === id);
    caps.push(...captionClipsFor(remapSegments(segs, pieces), { ...DEFAULT_CAPTION_STYLE, karaoke }, tt.id));
  }
  if (caps.length === 0) return 'No speech found to caption.';
  st().commitClips([...st().clips, ...caps], tracks);
  return `Added ${plural(caps.length, 'caption')} on ${tt.id}.`;
}

async function addVoiceover(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const voice = a.voice !== undefined ? pick(TTS_VOICES, a.voice, 'voice') : TTS_VOICES[0].value;
  let status = 'Loading voice model…';
  progress(-1, status);
  const out = await synthesize(String(a.text), {
    model: voice,
    signal,
    onStatus: (s) => progress(-1, (status = s)),
    onProgress: (r) => progress(r, status),
  });
  const r = await window.krypt.media.saveDerived(encodeWavPcm16(out.audio, out.sampleRate), `voiceover-${Date.now().toString(36)}.wav`);
  if (!r.ok || !r.data) fail(r.message ?? 'Could not store the voice-over.');
  useMediaStore.getState().add([r.data!]);
  const at = num(a.start) ?? st().playhead;
  const id = await oneStep(async () => {
    const cid = await st().addMedia(r.data!);
    if (!cid) fail('Could not add the voice-over to the timeline.');
    st().updateClip(cid!, { start: at });
    return cid!;
  });
  const c = clipById(id);
  return `Added a ${r2(c.duration)}s voice-over (${id}) on ${c.trackId} at ${r2(at)}s.`;
}

async function reframeTool(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const r0 = RESOLUTIONS.find((r) => r.label === a.aspect) ?? fail('aspect must be one of 9:16, 1:1, 4:5, 16:9.');
  const ids = Array.isArray(a.clip_ids) ? new Set((a.clip_ids as unknown[]).map(String)) : undefined;
  ids?.forEach((id) => clipById(id));
  const follow = a.follow === 'center' ? 'center' : 'face';
  const r = await runReframe({ canvas: { width: r0.width, height: r0.height }, follow, only: ids, signal, onProgress: (ratio, status) => progress(ratio > 0 ? ratio : -1, status) });
  const faces = follow === 'face' ? (r.followed.length ? `; following the face in ${r.followed.join(', ')}` : '; no face big enough to follow, so centred') : '; centred';
  return `Reframed ${plural(r.clips, 'clip')} to ${r0.label} (${st().canvas.width}×${st().canvas.height})${faces}${r.moving ? `; the camera pans in ${plural(r.moving, 'clip')}` : ''}. One undo step.`;
}

async function duckTool(a: Args): Promise<string> {
  const s = st();
  const lib = media();
  const d = defaultDuckTracks(s.clips, s.tracks, new Map(lib.map((m) => [m.id, m.kind])), new Map(lib.map((m) => [m.id, m.name])));
  const voice = str(a.voice_track_id) ?? d.voice ?? fail('No track with sound to use as the voice.');
  trackById(voice);
  const targets = Array.isArray(a.track_ids) ? (a.track_ids as unknown[]).map(String) : d.targets;
  targets.forEach((id) => trackById(id));
  const r = await runDucking({ voiceTrack: voice, targetTracks: targets, amountDb: num(a.amount_db) });
  if (r.clips === 0) return 'No speech overlaps the other tracks; nothing changed.';
  return `Ducked ${plural(r.clips, 'clip')} by ${-(num(a.amount_db) ?? -12)} dB under ${r.spans} stretches of speech (found by ${r.source === 'speech' ? 'the transcript' : 'loudness'}). One undo step.`;
}

async function revoiceTool(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const m = str(a.media_id) ? mediaById(String(a.media_id)) : (defaultRevoiceMedia() ?? fail('Nothing on the timeline has audio to re-voice.'));
  if (m.kind !== 'video' && m.kind !== 'audio') fail(`${m.name} has no audio.`);
  const voice = a.voice !== undefined ? pick(TTS_VOICES, a.voice, 'voice') : TTS_VOICES[0].value;
  if (!voice.startsWith('kokoro:')) fail('Re-voice needs an English voice (list_options → voices).');
  const original = a.original === 'lower' || a.original === 'keep' ? a.original : 'mute';
  const lines = Array.isArray(a.lines)
    ? joinLines((a.lines as Array<{ start: unknown; end?: unknown; text: unknown }>).map((l) => ({ start: Number(l.start), end: Number(l.end ?? l.start), text: String(l.text ?? '') })))
    : await loadRevoiceLines(m, { signal, onProgress: (p) => progress(p.ratio > 0 ? p.ratio : -1, p.status) });
  const r = await runRevoice({ media: m, lines, voice, original, signal, onProgress: (ratio, status) => progress(ratio, status) });
  const notes = [r.stretched ? `${r.stretched} sped up to fit` : '', r.moved ? `${r.moved} pushed later` : ''].filter(Boolean).join(', ');
  return `Re-voiced ${plural(r.lines, 'line')} of ${m.name} as ${r2(r.duration)}s of audio (${r.clipId} on new track ${r.trackId}); original ${original === 'mute' ? 'muted' : original === 'lower' ? 'lowered to 20%' : 'kept'}${notes ? `; ${notes}` : ''}.`;
}

async function importLut(a: Args): Promise<string> {
  const r = await window.krypt.media.readLut(String(a.path));
  if (!r.ok || !r.data) fail(r.message ?? 'Could not read that LUT.');
  const parsed = parseCube(r.data!.name, r.data!.text);
  const id = `lut-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  useLutStore.getState().add({ id, ...parsed });
  const wantsApply = (Array.isArray(a.clip_ids) && a.clip_ids.length > 0) || str(a.track_id);
  if (!wantsApply) return `Imported LUT "${parsed.name}" (id ${id}). Apply it with update_clip lut.`;
  const res = updateClips({ clip_ids: a.clip_ids, track_id: a.track_id, lut: id, ...(num(a.amount) !== undefined ? { lut_amount: a.amount } : {}) });
  return `Imported LUT "${parsed.name}" (id ${id}). ${res}`;
}

async function setCanvas(a: Args): Promise<string> {
  const presets: Record<string, [number, number]> = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
  let w = num(a.width);
  let h = num(a.height);
  if (typeof a.aspect === 'string' && presets[a.aspect]) [w, h] = presets[a.aspect];
  if ((w === undefined) !== (h === undefined)) fail('Pass both width and height (or an aspect preset).');
  const bg: { type?: BackgroundType; color?: string; color2?: string } = {};
  if (a.background !== undefined) bg.type = pick(BACKGROUNDS, a.background, 'background');
  if (str(a.background_color)) bg.color = String(a.background_color);
  if (str(a.background_color2)) bg.color2 = String(a.background_color2);
  const fps = num(a.fps);
  if (w === undefined && fps === undefined && Object.keys(bg).length === 0) fail('Nothing to change: pass an aspect, width/height, fps or background.');
  await oneStep(() => {
    st().pushHistory();
    if (w !== undefined && h !== undefined) st().setCanvas({ width: Math.round(w), height: Math.round(h) });
    if (fps !== undefined) st().setFps(fps);
    if (Object.keys(bg).length) st().setBackground(bg);
  });
  const s = st();
  return `Canvas ${s.canvas.width}×${s.canvas.height} at ${s.fps} fps, ${s.background.type} background.`;
}

async function saveProject(a: Args): Promise<string> {
  const ps = useProjectStore.getState();
  const json = serializeProject();
  const requested = str(a.path);
  const r = !requested && ps.path ? await window.krypt.project.saveToPath(json, ps.path) : await window.krypt.project.saveAs(json, requested ?? '', ps.name || 'project');
  if (!r.ok || !r.data) fail(r.message ?? 'Could not save the project.');
  useProjectStore.getState().setSaved(r.data!);
  return `Saved the project to ${r.data}.`;
}

async function openProject(a: Args): Promise<string> {
  if (useProjectStore.getState().dirty && hasContent() && a.discard_unsaved !== true) {
    fail('The open project has unsaved changes. Call save_project first, or pass discard_unsaved: true only if the user wants them thrown away.');
  }
  const r = await window.krypt.project.openPath(String(a.path));
  if (!r.ok) fail(r.message ?? 'Could not open that project.');
  if (!r.data) fail('No .krypt project at that path.');
  st().pause();
  const res = await applyProject(r.data!.json);
  if (!res.ok) fail(res.error ?? 'That file is not a valid Krypt project.');
  useProjectStore.getState().setOpened(r.data!.path);
  const s = st();
  return `Opened ${r.data!.path}: ${plural(s.clips.length, 'clip')}, ${r2(timelineDuration(s.clips))}s.${res.missing.length ? ` Missing media (clips using it will be empty): ${res.missing.join(', ')}.` : ''}`;
}

async function previewFrames(a: Args): Promise<McpToolResult> {
  const times = (Array.isArray(a.times) ? a.times : []).map(Number).filter((t) => Number.isFinite(t)).slice(0, 6);
  if (times.length === 0) fail('Pass 1 to 6 times.');
  const s = st();
  if (timelineDuration(s.clips) <= 0) fail('The timeline is empty.');
  const imgs = await renderStills({ clips: s.clips, tracks: s.tracks, canvas: s.canvas, background: s.background, media: media() }, times, num(a.height) ?? 360);
  return { ok: true, text: `Frames at ${times.map((t) => `${r2(t)}s`).join(', ')} (${s.canvas.width}×${s.canvas.height} canvas).`, images: imgs.map((data) => ({ data, mimeType: 'image/jpeg' })) };
}

function history(a: Args, dir: 'undo' | 'redo'): string {
  const steps = Math.max(1, Math.min(50, num(a.steps) ?? 1));
  let done = 0;
  for (let i = 0; i < steps; i++) {
    const before = dir === 'undo' ? st().past.length : st().future.length;
    if (before === 0) break;
    if (dir === 'undo') st().undo();
    else st().redo();
    done++;
  }
  return done === 0 ? `Nothing to ${dir}.` : `${dir === 'undo' ? 'Undid' : 'Redid'} ${plural(done, 'step')}.`;
}

async function exportVideo(a: Args, progress: Progress, signal: AbortSignal): Promise<string> {
  const s = st();
  if (timelineDuration(s.clips) <= 0) fail('Nothing on the timeline to export.');
  s.pause();
  const settings: ExportSettings = {
    ...DEFAULT_EXPORT_SETTINGS,
    ...(a.format === 'webm' || a.format === 'mp4' ? { format: a.format } : {}),
    ...(num(a.height) ? { height: num(a.height)! } : {}),
    ...(num(a.fps) ? { fps: num(a.fps)! } : {}),
    ...(a.quality === 'low' || a.quality === 'medium' || a.quality === 'high' ? { quality: a.quality } : {}),
    ...(num(a.loudness) != null ? { loudness: Math.min(-5, Math.max(-36, num(a.loudness)!)) } : {}),
  };
  const lib = media();
  const kind = new Map(lib.map((m) => [m.id, m.kind]));
  const hasVisual = s.clips.some((c) => c.type !== 'media' || kind.get(c.mediaId) !== 'audio');
  const ext = hasVisual ? settings.format : 'm4a';
  const begin = await window.krypt.media.exportBeginAt(str(a.path) ?? '', ext);
  if (!begin.ok || !begin.data) fail(begin.message ?? 'Could not start the export.');
  const { token, path } = begin.data!;
  const cancel = { cancelled: false };
  signal.addEventListener('abort', () => (cancel.cancelled = true), { once: true });
  try {
    const result = await exportTimeline({
      clips: s.clips,
      tracks: s.tracks,
      canvas: s.canvas,
      background: s.background,
      media: lib,
      settings,
      signal: cancel,
      onProgress: (p) => progress(p.ratio, `Exporting (${p.phase})`),
      onChunk: async (data, position) => {
        const w = await window.krypt.media.exportWrite(token, data, position);
        if (!w.ok) throw new Error(w.message ?? 'Could not write to the export file.');
      },
    });
    const end = await window.krypt.media.exportEnd(token, true);
    if (!end.ok) fail(end.message ?? 'Could not finish the export file.');
    const loud = result.loudness ? ` Loudness ${result.loudness.before.toFixed(1)} → ${result.loudness.after.toFixed(1)} LUFS.` : '';
    const copied = result.copiedVideo ? ' Video copied losslessly from the source (no re-encode).' : '';
    return `Exported ${r2(timelineDuration(s.clips))}s to ${end.data ?? path}.${copied}${loud}${result.warnings.length ? ` Warnings: ${result.warnings.join(' ')}` : ''}`;
  } catch (e) {
    void window.krypt.media.exportEnd(token, false);
    throw e;
  }
}

type Handler = (a: Args, progress: Progress, signal: AbortSignal) => string | McpToolResult | Promise<string | McpToolResult>;

const HANDLERS: Record<string, Handler> = {
  get_project: () => getProject(),
  list_options: () => listOptions(),
  get_transcript: getTranscriptTool,
  detect_pauses: detectPauses,
  auto_edit: autoEdit,
  cut_ranges: cutRanges,
  import_media: importMedia,
  add_clip: addClip,
  add_text: addText,
  add_shape: addShape,
  update_clip: updateClips,
  set_keyframes: setKeyframes,
  retime_clip: (a, p) => retimeClip(a, p),
  split_clips: splitClips,
  duplicate_clip: duplicateClip,
  detach_audio: detachAudio,
  delete_clips: deleteClips,
  edit_track: editTrack,
  add_captions: addCaptions,
  add_voiceover: addVoiceover,
  revoice: revoiceTool,
  reframe: reframeTool,
  duck_audio: duckTool,
  import_lut: importLut,
  set_canvas: setCanvas,
  preview_frames: previewFrames,
  undo: (a) => history(a, 'undo'),
  redo: (a) => history(a, 'redo'),
  save_project: saveProject,
  open_project: openProject,
  export_video: exportVideo,
};

export const AGENT_TOOL_NAMES = Object.keys(HANDLERS);

async function dispatch(call: McpToolCall, progress: Progress, signal: AbortSignal): Promise<McpToolResult> {
  const a = obj(call.args) ?? {};
  const h = HANDLERS[call.tool];
  if (!h) return { ok: false, text: `Unknown tool "${call.tool}".` };
  const out = await h(a, progress, signal);
  return typeof out === 'string' ? { ok: true, text: out } : out;
}

let markReady: () => void = () => {};
const sessionReady = new Promise<void>((resolve) => {
  markReady = resolve;
});
export function markSessionReady(): void {
  markReady();
}

let chain: Promise<unknown> = sessionReady;

export function runAgentTool(call: McpToolCall, progress: Progress, signal: AbortSignal): Promise<McpToolResult> {
  const job = chain.then(async (): Promise<McpToolResult> => {
    if (signal.aborted) return { ok: false, text: 'Cancelled.' };
    try {
      return await dispatch(call, progress, signal);
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      return { ok: false, text: e instanceof ToolError ? msg : `${call.tool} failed: ${msg}` };
    }
  });
  chain = job.catch(() => {});
  return job;
}

export function serveAgentTools(): () => void {
  return (
    window.krypt?.mcp?.serve((call, progress, onCancel) => {
      const ac = new AbortController();
      onCancel(() => ac.abort());
      return runAgentTool(call, progress, ac.signal);
    }) ?? (() => {})
  );
}
