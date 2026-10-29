import {
  ALL_FORMATS,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  UrlSource,
} from 'mediabunny';
import type { MediaFile } from '@shared/types';
import { sourceTimeAt, type MediaClip } from './timelineStore';

export const MAX_REVERSE_SPAN = 60;

interface DecodedFrame {
  canvas: HTMLCanvasElement;
  timestamp: number;
}

const even = (n: number): number => (n % 2 === 0 ? Math.max(2, n) : n + 1);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export async function renderReversedClip(
  clip: MediaClip,
  media: MediaFile,
  fps: number,
  onProgress?: (ratio: number) => void,
): Promise<{ data: Uint8Array; span: number }> {
  const srcA = clamp(clip.inPoint, 0, Math.max(0, clip.sourceDuration - 0.05));
  const srcB = clamp(sourceTimeAt(clip, clip.start + clip.duration), srcA + 0.05, clip.sourceDuration);
  const span = srcB - srcA;
  if (span > MAX_REVERSE_SPAN) {
    throw new Error(`Reverse supports up to ${MAX_REVERSE_SPAN}s of source footage (this clip uses ${Math.round(span)}s) — split it first.`);
  }

  const input = new Input({ source: new UrlSource(media.mediaUrl), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('This clip has no video track to reverse.');
    const w = even(track.displayWidth);
    const h = even(track.displayHeight);

    let abuf: AudioBuffer | null = null;
    try {
      const octx = new OfflineAudioContext(2, 2, 48000);
      const full = await octx.decodeAudioData(await (await fetch(media.mediaUrl)).arrayBuffer());
      const sr = full.sampleRate;
      const off = Math.max(0, Math.floor(srcA * sr));
      const len = Math.min(full.length - off, Math.ceil(span * sr));
      if (len > 0) {
        abuf = octx.createBuffer(full.numberOfChannels, len, sr);
        for (let ch = 0; ch < full.numberOfChannels; ch++) {
          const src = full.getChannelData(ch);
          const dst = abuf.getChannelData(ch);
          for (let i = 0; i < len; i++) dst[i] = src[off + len - 1 - i];
        }
      }
    } catch {
    }

    const cnv = document.createElement('canvas');
    cnv.width = w;
    cnv.height = h;
    const ctx = cnv.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing canvas.');

    const out = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const vsrc = new CanvasSource(cnv, { codec: 'avc', bitrate: QUALITY_HIGH });
    out.addVideoTrack(vsrc);
    let asrc: AudioBufferSource | null = null;
    if (abuf) {
      asrc = new AudioBufferSource({ codec: 'aac', bitrate: QUALITY_HIGH });
      out.addAudioTrack(asrc);
    }
    await out.start();

    const totalFrames = Math.max(1, Math.round(span * fps));
    const chunkFrames = Math.max(1, Math.min(totalFrames, Math.floor(240e6 / (w * h * 4))));

    let outIdx = 0;
    for (let end = totalFrames; end > 0; end -= chunkFrames) {
      const startIdx = Math.max(0, end - chunkFrames);
      const copies: HTMLCanvasElement[] = [];
      const iter = new CanvasSink(track).canvases(srcA + startIdx / fps) as AsyncGenerator<DecodedFrame, void, unknown>;
      try {
        let cur = (await iter.next()).value ?? null;
        let nxt = (await iter.next()).value ?? null;
        for (let i = startIdx; i < end; i++) {
          const tt = srcA + (i + 0.5) / fps;
          while (nxt && nxt.timestamp <= tt) {
            cur = nxt;
            nxt = (await iter.next()).value ?? null;
          }
          const copy = document.createElement('canvas');
          copy.width = w;
          copy.height = h;
          const cctx = copy.getContext('2d');
          if (cctx && cur) cctx.drawImage(cur.canvas, 0, 0, w, h);
          copies.push(copy);
        }
      } finally {
        await iter.return?.();
      }
      for (let i = copies.length - 1; i >= 0; i--) {
        ctx.drawImage(copies[i], 0, 0);
        await vsrc.add(outIdx / fps, 1 / fps);
        outIdx++;
        onProgress?.(outIdx / totalFrames);
      }
      copies.length = 0;
    }

    if (asrc && abuf) await asrc.add(abuf);
    await out.finalize();
    const buffer = out.target.buffer;
    if (!buffer) throw new Error('Reversal produced no data.');
    return { data: new Uint8Array(buffer), span };
  } finally {
    input.dispose();
  }
}
