import type { MediaFile } from '@shared/types';
import { analyzeAudio } from './audioDecode';

export const PEAKS_PER_SEC = 60;

interface Analysis {
  peaks: Float32Array;
  envelope: Float32Array;
}

const EMPTY: Analysis = { peaks: new Float32Array(0), envelope: new Float32Array(0) };
const cache = new Map<string, Analysis>();
const pending = new Map<string, Promise<Analysis>>();

function analyze(media: MediaFile): Promise<Analysis> {
  const cached = cache.get(media.id);
  if (cached) return Promise.resolve(cached);
  const inflight = pending.get(media.id);
  if (inflight) return inflight;

  const job = (async (): Promise<Analysis> => {
    try {
      const out: Analysis = (await analyzeAudio(media.mediaUrl, PEAKS_PER_SEC)) ?? EMPTY;
      cache.set(media.id, out);
      return out;
    } catch {
      return EMPTY;
    } finally {
      pending.delete(media.id);
    }
  })();

  pending.set(media.id, job);
  return job;
}

export function getPeaks(media: MediaFile): Promise<Float32Array> {
  return analyze(media).then((a) => a.peaks);
}

export function getEnvelope(media: MediaFile): Promise<Float32Array> {
  return analyze(media).then((a) => a.envelope);
}
