import type { MediaFile } from '@shared/types';

export interface Thumb {
  t: number;
  canvas: HTMLCanvasElement;
}

const THUMB_H = 44;
const MAX_THUMBS = 16;
const MIN_THUMBS = 3;
const EXTRACT_TIMEOUT = 15000;

const cache = new Map<string, Promise<Thumb[]>>();

export function getThumbs(media: MediaFile): Promise<Thumb[]> {
  if (media.kind !== 'video') return Promise.resolve([]);
  let p = cache.get(media.id);
  if (!p) {
    p = extract(media).catch(() => []);
    cache.set(media.id, p);
  }
  return p;
}

function extract(media: MediaFile): Promise<Thumb[]> {
  return new Promise<Thumb[]>((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = media.mediaUrl;

    const thumbs: Thumb[] = [];
    let times: number[] = [];
    let i = 0;
    let tileW = Math.round(THUMB_H * (16 / 9));
    let done = false;

    const cleanup = (): void => {
      try {
        video.removeAttribute('src');
        video.load();
      } catch {
      }
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(thumbs);
    };
    const fail = (e: unknown): void => {
      if (done) return;
      done = true;
      cleanup();
      reject(e);
    };

    const seekNext = (): void => {
      if (i >= times.length) {
        finish();
        return;
      }
      try {
        video.currentTime = times[i];
      } catch {
        finish();
      }
    };

    video.onloadedmetadata = (): void => {
      const dur = video.duration;
      if (!isFinite(dur) || dur <= 0) {
        fail(new Error('thumb: no duration'));
        return;
      }
      const vw = video.videoWidth || 16;
      const vh = video.videoHeight || 9;
      tileW = Math.max(8, Math.round(THUMB_H * (vw / vh)));
      const count = Math.max(MIN_THUMBS, Math.min(MAX_THUMBS, Math.round(dur / 2)));
      times = Array.from({ length: count }, (_, k) => (dur * (k + 0.5)) / count);
      seekNext();
    };

    video.onseeked = (): void => {
      try {
        const cnv = document.createElement('canvas');
        cnv.width = tileW;
        cnv.height = THUMB_H;
        const ctx = cnv.getContext('2d');
        if (ctx && video.videoWidth > 0) {
          ctx.drawImage(video, 0, 0, tileW, THUMB_H);
          thumbs.push({ t: times[i], canvas: cnv });
        }
      } catch {
      }
      i++;
      seekNext();
    };

    video.onerror = (): void => fail(new Error('thumb: video error'));
    setTimeout(finish, EXTRACT_TIMEOUT);
  });
}
