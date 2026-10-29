import type { MediaFile } from '@shared/types';
import { decodeMono } from './audioDecode';
import { remapSegments } from './autoEdit';
import { CAPTION_MODELS, speechModelFor, transcribe, type CaptionSegment } from './captions';
import type { MediaClip } from './timelineStore';

export interface SpeechProgress {
  status: string;
  ratio: number;
}

const cache = new Map<string, CaptionSegment[]>();
const pending = new Map<string, Promise<CaptionSegment[]>>();

const keyOf = (media: MediaFile, model: string): string => `${media.filePath}|${media.sizeBytes}|${model}`;

export function cachedTranscript(media: MediaFile, model: string): CaptionSegment[] | undefined {
  return cache.get(keyOf(media, model));
}

const DB_NAME = 'krypt-transcripts';
const STORE = 'transcripts';

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function dbGet(key: string): Promise<CaptionSegment[] | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as CaptionSegment[]) : undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function dbPut(key: string, segs: CaptionSegment[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(segs, key);
  } catch {
  }
}

export async function decodeMono16k(media: MediaFile): Promise<Float32Array> {
  const out = await decodeMono(media.mediaUrl, 16000);
  if (!out) throw new Error(`${media.name} has no audio.`);
  return out;
}

export function getTranscript(media: MediaFile, opts: { model: string; signal?: AbortSignal; onProgress?: (p: SpeechProgress) => void }): Promise<CaptionSegment[]> {
  const k = keyOf(media, opts.model);
  const hit = cache.get(k);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(k);
  if (inflight) return inflight;

  const job = (async (): Promise<CaptionSegment[]> => {
    try {
      const stored = await dbGet(k);
      if (stored) {
        cache.set(k, stored);
        return stored;
      }
      opts.onProgress?.({ status: `Decoding ${media.name}…`, ratio: 0 });
      const audio = await decodeMono16k(media);
      if (opts.signal?.aborted) throw new Error('Transcription cancelled.');
      let status = 'Loading speech model…';
      let ratio = 0;
      const emit = (): void => opts.onProgress?.({ status: `${status} · ${media.name}`, ratio });
      const segs = await transcribe(audio, {
        model: opts.model,
        signal: opts.signal,
        onStatus: (st) => {
          status = st;
          emit();
        },
        onProgress: (r) => {
          ratio = r;
          emit();
        },
      });
      cache.set(k, segs);
      void dbPut(k, segs);
      return segs;
    } finally {
      pending.delete(k);
    }
  })();
  pending.set(k, job);
  return job;
}

export async function transcriptModelFor(media: MediaFile): Promise<string> {
  for (const { value } of [...CAPTION_MODELS].reverse()) {
    const k = keyOf(media, value);
    if (cache.has(k)) return value;
    const stored = await dbGet(k);
    if (stored) {
      cache.set(k, stored);
      return value;
    }
  }
  return speechModelFor();
}

export async function hasTranscript(media: MediaFile, model: string): Promise<boolean> {
  const k = keyOf(media, model);
  if (cache.has(k)) return true;
  const stored = await dbGet(k);
  if (stored) cache.set(k, stored);
  return !!stored;
}

export async function captionsFromTranscripts(
  sources: MediaClip[],
  media: MediaFile[],
  model: string,
  opts: { signal?: AbortSignal; onProgress?: (p: SpeechProgress) => void } = {},
): Promise<CaptionSegment[] | null> {
  const ids = [...new Set(sources.map((c) => c.mediaId))];
  const files = ids.map((id) => media.find((m) => m.id === id));
  if (files.length === 0 || files.some((m) => !m)) return null;
  const stored = await Promise.all(files.map((m) => hasTranscript(m!, model)));
  if (!stored.every(Boolean)) {
    if (files.length > 1) return null;
    const used = sources.reduce((s, c) => s + c.duration * c.speed, 0);
    if (used < 0.5 * (sources[0].sourceDuration || Infinity)) return null;
  }
  const out: CaptionSegment[] = [];
  for (const m of files) {
    const segs = await getTranscript(m!, { model, signal: opts.signal, onProgress: opts.onProgress });
    out.push(...remapSegments(segs, sources.filter((c) => c.mediaId === m!.id).sort((a, b) => a.start - b.start)));
  }
  return out.sort((a, b) => a.start - b.start);
}

export async function storedTranscript(media: MediaFile): Promise<CaptionSegment[] | null> {
  const model = await transcriptModelFor(media);
  return cache.get(keyOf(media, model)) ?? null;
}
