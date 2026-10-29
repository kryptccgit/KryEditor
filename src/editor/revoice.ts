import type { MediaFile } from '@shared/types';
import { remapSegments, type Segment } from './autoEdit';
import { useMediaStore } from './mediaStore';
import { getTranscript, transcriptModelFor, type SpeechProgress } from './speechAnalysis';
import { timeStretch } from './stretch';
import { useTimelineStore, uid, type Clip, type MediaClip, type Track } from './timelineStore';
import { encodeWavPcm16, synthesize } from './tts';

export interface RevoiceLine {
  start: number;
  end: number;
  text: string;
}

export type OriginalAudio = 'mute' | 'lower' | 'keep';
export const LOWERED_VOLUME = 0.2;
export const MAX_FIT_RATE = 1.3;
const MIN_GAP = 0.08;
const JOIN_GAP = 0.3;
const MAX_LINE = 12;

const isAudible = (c: Clip, kinds: Map<string, string>): c is MediaClip =>
  c.type === 'media' && c.freezeAt == null && (kinds.get(c.mediaId) === 'video' || kinds.get(c.mediaId) === 'audio');

export function revoicePieces(clips: Clip[], kinds: Map<string, string>, mediaId: string): MediaClip[] {
  const all = clips.filter((c): c is MediaClip => isAudible(c, kinds) && c.mediaId === mediaId);
  const track = (all.find((c) => !c.muted) ?? all[0])?.trackId;
  return all.filter((c) => c.trackId === track).sort((a, b) => a.start - b.start);
}

export function speakable(text: string): string {
  return text
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function linesFromTranscript(segments: Segment[], pieces: MediaClip[]): RevoiceLine[] {
  return joinLines(remapSegments(segments, pieces));
}

export function joinLines(lines: RevoiceLine[]): RevoiceLine[] {
  const cleaned = lines
    .map((s) => ({ start: s.start, end: s.end, text: speakable(s.text) }))
    .filter((s) => /[\p{L}\p{N}]/u.test(s.text))
    .sort((a, b) => a.start - b.start);
  const out: RevoiceLine[] = [];
  for (const s of cleaned) {
    const prev = out[out.length - 1];
    const joinable = prev && s.start - prev.end < JOIN_GAP && s.end - prev.start <= MAX_LINE && !/[.!?…]$/.test(prev.text);
    if (joinable) {
      prev.end = Math.max(prev.end, s.end);
      prev.text = `${prev.text} ${s.text}`;
    } else out.push({ ...s });
  }
  return out;
}

export function layoutLines(
  spoken: Array<{ start: number; audio: Float32Array }>,
  sampleRate: number,
  maxRate = MAX_FIT_RATE,
): { audio: Float32Array; offset: number; stretched: number; moved: number } {
  const items = spoken.filter((s) => s.audio.length > 0).sort((a, b) => a.start - b.start);
  if (items.length === 0) return { audio: new Float32Array(0), offset: 0, stretched: 0, moved: 0 };
  const placed: Array<{ start: number; audio: Float32Array }> = [];
  let cursor = -Infinity;
  let stretched = 0;
  let moved = 0;
  items.forEach((item, i) => {
    const start = Math.max(item.start, cursor + MIN_GAP);
    if (start > item.start + 1e-6) moved++;
    const room = (items[i + 1]?.start ?? Infinity) - MIN_GAP - start;
    let audio = item.audio;
    const dur = audio.length / sampleRate;
    if (dur > room && room > 0) {
      const rate = Math.min(maxRate, dur / room);
      if (rate > 1.01) {
        audio = timeStretch([audio as Float32Array<ArrayBuffer>], rate)[0];
        stretched++;
      }
    }
    placed.push({ start, audio });
    cursor = start + audio.length / sampleRate;
  });
  const offset = placed[0].start;
  const out = new Float32Array(Math.ceil((cursor - offset) * sampleRate) + 1);
  for (const p of placed) out.set(p.audio, Math.min(out.length - p.audio.length, Math.round((p.start - offset) * sampleRate)));
  return { audio: out, offset, stretched, moved };
}

const kindsNow = (): Map<string, string> => new Map(useMediaStore.getState().media.map((m) => [m.id, m.kind]));

export function defaultRevoiceMedia(): MediaFile | null {
  const s = useTimelineStore.getState();
  const kinds = kindsNow();
  const audible = s.clips.filter((c): c is MediaClip => isAudible(c, kinds));
  const sel = audible.find((c) => s.selectedIds.includes(c.id));
  const id = sel?.mediaId ?? audible.find((c) => !c.muted)?.mediaId ?? audible[0]?.mediaId;
  return useMediaStore.getState().media.find((m) => m.id === id) ?? null;
}

export async function loadRevoiceLines(media: MediaFile, opts: { signal?: AbortSignal; onProgress?: (p: SpeechProgress) => void } = {}): Promise<RevoiceLine[]> {
  const pieces = revoicePieces(useTimelineStore.getState().clips, kindsNow(), media.id);
  if (pieces.length === 0) throw new Error(`${media.name} isn't on the timeline.`);
  const segs = await getTranscript(media, { model: await transcriptModelFor(media), signal: opts.signal, onProgress: opts.onProgress });
  return linesFromTranscript(segs, pieces);
}

export interface RevoiceResult {
  clipId: string;
  trackId: string;
  lines: number;
  duration: number;
  stretched: number;
  moved: number;
}

export async function runRevoice(opts: {
  media: MediaFile;
  lines: RevoiceLine[];
  voice: string;
  original: OriginalAudio;
  signal?: AbortSignal;
  onProgress?: (ratio: number, status: string) => void;
}): Promise<RevoiceResult> {
  const lines = opts.lines.map((l) => ({ ...l, text: speakable(l.text) })).filter((l) => l.text);
  if (lines.length === 0) throw new Error('There are no lines to speak.');
  const spoken: Array<{ start: number; audio: Float32Array }> = [];
  let sampleRate = 24000;
  for (let i = 0; i < lines.length; i++) {
    if (opts.signal?.aborted) throw new Error('Re-voice cancelled.');
    const label = `Speaking line ${i + 1} of ${lines.length}…`;
    opts.onProgress?.(i / lines.length, label);
    const out = await synthesize(lines[i].text, {
      model: opts.voice,
      signal: opts.signal,
      onStatus: (s) => {
        if (/model/i.test(s)) opts.onProgress?.(0, s);
      },
      onProgress: (r) => opts.onProgress?.((i + Math.min(1, r)) / lines.length, label),
    });
    sampleRate = out.sampleRate;
    spoken.push({ start: lines[i].start, audio: out.audio });
  }
  opts.onProgress?.(1, 'Placing the lines…');
  const laid = layoutLines(spoken, sampleRate);
  const base = opts.media.name.replace(/\.[^.]+$/, '').slice(0, 40);
  const saved = await window.krypt.media.saveDerived(encodeWavPcm16(laid.audio, sampleRate), `revoice-${base}-${Date.now().toString(36)}.wav`);
  if (!saved.ok || !saved.data) throw new Error(saved.message ?? 'Could not store the re-voiced audio.');
  if (opts.signal?.aborted) throw new Error('Re-voice cancelled.');
  useMediaStore.getState().add([saved.data]);

  const clipId = await useTimelineStore.getState().addMedia(saved.data);
  if (!clipId) throw new Error('Could not add the re-voiced audio to the timeline.');
  const now = useTimelineStore.getState();
  const track: Track = { id: uid('tr'), kind: 'audio', name: 'Re-voice' };
  const patch: Partial<MediaClip> = opts.original === 'mute' ? { muted: true } : opts.original === 'lower' ? { volume: LOWERED_VOLUME } : {};
  const clips = now.clips.map((c): Clip => {
    if (c.id === clipId) return { ...c, trackId: track.id, start: laid.offset };
    if (c.type === 'media' && c.mediaId === opts.media.id) return { ...c, ...patch };
    return c;
  });
  useTimelineStore.setState({ clips, tracks: [...now.tracks, track], selectedIds: [clipId] });
  return { clipId, trackId: track.id, lines: lines.length, duration: laid.audio.length / sampleRate, stretched: laid.stretched, moved: laid.moved };
}
