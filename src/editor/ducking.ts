import { clipSilences, ENVELOPE_HZ, mapSourceRanges, mergeRanges, sourceWindow, subtractRanges, transcriptWords, type Range, type SilenceSettings, type TimedWord } from './autoEdit';
import { useMediaStore } from './mediaStore';
import { getEnvelope } from './peaks';
import { storedTranscript } from './speechAnalysis';
import { easeProgress, uid, useTimelineStore, type Clip, type Easing, type Keyframe, type MediaClip, type Track } from './timelineStore';

export interface DuckSettings {
  amountDb: number;
  attack: number;
  release: number;
  bridge: number;
}

export const DUCK: DuckSettings = { amountDb: -12, attack: 0.2, release: 0.5, bridge: 1.2 };

const VOICE_GATE: SilenceSettings = { sensitivityDb: 12, minPause: 0.5, padBefore: 0.05, padAfter: 0.1, minKeep: 0.2 };

export function joinClose(ranges: Range[], gap: number): Range[] {
  const out: Range[] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a - last[1] < gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function voicedFromWords(clip: MediaClip, words: TimedWord[]): Range[] {
  const [a, b] = sourceWindow(clip);
  const inside = words.filter((w) => w.end > a && w.start < b).map((w): Range => [w.start, w.end]);
  return mapSourceRanges(clip, joinClose(inside, 0.3));
}

export function voicedFromEnvelope(clip: MediaClip, env: Float32Array, hz = ENVELOPE_HZ): Range[] {
  if (env.length === 0) return [];
  return subtractRanges([[clip.start, clip.start + clip.duration]], clipSilences(clip, env, hz, VOICE_GATE));
}

export function duckSpans(voiced: Range[], s: DuckSettings = DUCK): Range[] {
  return joinClose(mergeRanges(voiced), Math.max(s.bridge, s.attack + s.release));
}

export function duckKeys(clip: MediaClip, spans: Range[], s: DuckSettings = DUCK): Keyframe[] | null {
  const base = clip.volume;
  const low = base * Math.pow(10, s.amountDb / 20);
  const end = clip.start + clip.duration;
  const pts: Array<{ t: number; v: number; ease?: Easing }> = [];
  for (const [a, b] of spans) {
    if (b + s.release <= clip.start || a - s.attack >= end) continue;
    pts.push({ t: a - s.attack, v: base }, { t: a, v: low, ease: 'inout' }, { t: b, v: low }, { t: b + s.release, v: base, ease: 'inout' });
  }
  if (pts.length === 0) return null;
  const at = (t: number): number => {
    if (t <= pts[0].t) return pts[0].v;
    for (let i = 1; i < pts.length; i++) {
      if (t <= pts[i].t) {
        const p = pts[i - 1];
        const q = pts[i];
        return p.v + (q.v - p.v) * easeProgress(q.ease, q.t === p.t ? 1 : (t - p.t) / (q.t - p.t));
      }
    }
    return pts[pts.length - 1].v;
  };
  const keys = [{ t: clip.start, v: at(clip.start) }, ...pts.filter((p) => p.t > clip.start + 1e-3 && p.t < end - 1e-3), { t: end, v: at(end) }];
  return keys.map((k) => ({ id: uid('kf'), prop: 'volume', t: k.t - clip.start, value: k.v, ...('ease' in k && k.ease ? { ease: k.ease } : {}) }));
}

const hasAudio = (c: Clip, kinds: Map<string, string>): c is MediaClip =>
  c.type === 'media' && c.freezeAt == null && (kinds.get(c.mediaId) === 'video' || kinds.get(c.mediaId) === 'audio');

export function defaultDuckTracks(clips: Clip[], tracks: Track[], kinds: Map<string, string>, names: Map<string, string>): { voice: string | null; targets: string[] } {
  const withSound = tracks.filter((t) => !t.muted && clips.some((c) => c.trackId === t.id && hasAudio(c, kinds) && !c.muted));
  const isVoiceMedia = (c: Clip): boolean => c.type === 'media' && /^(voiceover|revoice)-/.test(names.get(c.mediaId) ?? '');
  const voice =
    withSound.find((t) => clips.some((c) => c.trackId === t.id && isVoiceMedia(c)))?.id ??
    clips.find((c) => hasAudio(c, kinds) && !c.muted && kinds.get(c.mediaId) === 'video' && withSound.some((t) => t.id === c.trackId))?.trackId ??
    withSound[0]?.id ??
    null;
  return { voice, targets: withSound.filter((t) => t.id !== voice && !t.locked).map((t) => t.id) };
}

export interface DuckResult {
  spans: number;
  clips: number;
  source: 'speech' | 'loudness';
}

export async function runDucking(opts: { voiceTrack: string; targetTracks: string[]; amountDb?: number }): Promise<DuckResult> {
  const settings: DuckSettings = { ...DUCK, amountDb: Math.min(-1, Math.max(-40, opts.amountDb ?? DUCK.amountDb)) };
  const mediaList = useMediaStore.getState().media;
  const kinds = new Map(mediaList.map((m) => [m.id, m.kind]));
  const s0 = useTimelineStore.getState();
  const locked = new Set(s0.tracks.filter((t) => t.locked).map((t) => t.id));
  const targetSet = new Set(opts.targetTracks.filter((id) => id !== opts.voiceTrack && !locked.has(id)));
  const voiceClips = s0.clips.filter((c): c is MediaClip => hasAudio(c, kinds) && c.trackId === opts.voiceTrack && !c.muted);
  if (voiceClips.length === 0) throw new Error('The voice track has no clips with sound.');
  if (!s0.clips.some((c) => hasAudio(c, kinds) && targetSet.has(c.trackId))) throw new Error('Nothing to duck: put music or game audio on another track first.');

  const voiced: Range[] = [];
  let speech = 0;
  for (const id of new Set(voiceClips.map((c) => c.mediaId))) {
    const m = mediaList.find((x) => x.id === id);
    if (!m) continue;
    const mine = voiceClips.filter((c) => c.mediaId === id);
    const segs = await storedTranscript(m);
    if (segs) {
      const words = transcriptWords(segs);
      for (const c of mine) voiced.push(...voicedFromWords(c, words));
      speech++;
    } else {
      const env = await getEnvelope(m);
      for (const c of mine) voiced.push(...voicedFromEnvelope(c, env));
    }
  }
  const spans = duckSpans(voiced, settings);

  const s = useTimelineStore.getState();
  let touched = 0;
  const clips = s.clips.map((c) => {
    if (!hasAudio(c, kinds) || !targetSet.has(c.trackId)) return c;
    const keys = duckKeys(c, spans, settings);
    const others = (c.keyframes ?? []).filter((k) => k.prop !== 'volume');
    if (keys) touched++;
    return { ...c, keyframes: [...others, ...(keys ?? [])] };
  });
  s.pushHistory();
  useTimelineStore.setState({ clips });
  return { spans: spans.length, clips: touched, source: speech > 0 ? 'speech' : 'loudness' };
}
