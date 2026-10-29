import { ALL_FORMATS, Input, UrlSource } from 'mediabunny';
import type { MediaFile } from '@shared/types';

export const IMAGE_DEFAULT_DURATION = 5;

export interface MediaInfo {
  duration: number;
  width: number;
  height: number;
}

const cache = new Map<string, MediaInfo>();

async function diagnose(media: MediaFile): Promise<string> {
  const name = media.name;
  try {
    const input = new Input({ source: new UrlSource(media.mediaUrl), formats: ALL_FORMATS });
    const track = media.kind === 'audio' ? await input.getPrimaryAudioTrack() : await input.getPrimaryVideoTrack();
    if (!track) return `"${name}" has no ${media.kind === 'audio' ? 'audio' : 'video'} track.`;
    if (await track.canDecode()) {
      return `"${name}" can't be previewed by the editor. Convert it to MP4 (H.264) or WebM and re-import.`;
    }
    return `"${name}" uses a codec this editor can't decode (e.g. ProRes, or HEVC without hardware support). Convert it to MP4 (H.264) and re-import.`;
  } catch {
    return `"${name}" couldn't be read — the file may be corrupt or use an unsupported format.`;
  }
}

export function probeMedia(media: MediaFile): Promise<MediaInfo> {
  const cached = cache.get(media.id);
  if (cached) return Promise.resolve(cached);

  if (media.kind === 'image') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const info = { duration: IMAGE_DEFAULT_DURATION, width: img.naturalWidth, height: img.naturalHeight };
        cache.set(media.id, info);
        resolve(info);
      };
      img.onerror = () => reject(new Error(`"${media.name}" couldn't be read as an image.`));
      img.src = media.mediaUrl;
    });
  }

  return new Promise((resolve, reject) => {
    const el = document.createElement(media.kind === 'audio' ? 'audio' : 'video');
    el.preload = 'metadata';

    let settled = false;
    const cleanup = (): void => {
      el.removeEventListener('loadedmetadata', onMeta);
      el.removeEventListener('error', onErr);
      window.clearTimeout(timer);
      el.src = '';
    };
    const onMeta = (): void => {
      if (settled) return;
      const rawDur = el.duration;
      const w = (el as HTMLVideoElement).videoWidth ?? 0;
      const h = (el as HTMLVideoElement).videoHeight ?? 0;
      if (!Number.isFinite(rawDur) || rawDur <= 0 || (media.kind === 'video' && (w === 0 || h === 0))) {
        onErr();
        return;
      }
      settled = true;
      cleanup();
      const info = { duration: rawDur, width: w, height: h };
      cache.set(media.id, info);
      resolve(info);
    };
    const onErr = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      diagnose(media).then((message) => reject(new Error(message)));
    };

    const timer = window.setTimeout(onErr, 8000);
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('error', onErr);
    el.src = media.mediaUrl;
  });
}
