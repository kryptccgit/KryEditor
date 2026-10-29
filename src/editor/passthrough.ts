import { ALL_FORMATS, EncodedPacketSink, EncodedVideoPacketSource, Input, UrlSource, type Output } from 'mediabunny';
import type { MediaFile } from '@shared/types';
import type { Clip, MediaClip, Track } from './timelineStore';

const FRAME_SLOP = 0.05;

function untouched(c: MediaClip): boolean {
  return (
    c.speed === 1 &&
    c.freezeAt == null &&
    (c.keyframes ?? []).every((k) => k.prop === 'volume') &&
    c.brightness === 100 &&
    c.contrast === 100 &&
    c.saturation === 100 &&
    !c.hue &&
    !c.vignette &&
    (!c.effect || c.effect === 'none') &&
    c.scaleX === 1 &&
    c.scaleY === 1 &&
    c.posX === 0 &&
    c.posY === 0 &&
    c.rotation === 0 &&
    c.opacity === 1 &&
    (!c.blend || c.blend === 'normal') &&
    c.cropTop === 0 &&
    c.cropRight === 0 &&
    c.cropBottom === 0 &&
    c.cropLeft === 0 &&
    c.transition === 'none' &&
    !c.chromaKey &&
    !c.bgRemove &&
    !c.mask &&
    !c.lut &&
    c.fadeIn === 0 &&
    c.fadeOut === 0
  );
}

export function passthroughClip(
  clips: Clip[],
  tracks: Track[],
  mediaById: Map<string, MediaFile>,
  out: { format: string; quality: string; width: number; height: number },
  total: number,
): MediaClip | null {
  if (out.format !== 'mp4' || out.quality !== 'high') return null;
  const hidden = new Set(tracks.filter((t) => t.hidden).map((t) => t.id));
  const visual = clips.filter((c) => !hidden.has(c.trackId) && (c.type !== 'media' || mediaById.get(c.mediaId)?.kind !== 'audio'));
  if (visual.length !== 1) return null;
  const c = visual[0];
  if (c.type !== 'media' || mediaById.get(c.mediaId)?.kind !== 'video') return null;
  if (c.start > 1e-3 || c.inPoint > 1e-3 || Math.abs(c.duration - c.sourceDuration) > FRAME_SLOP || total > c.duration + FRAME_SLOP) return null;
  if (c.sourceWidth !== out.width || c.sourceHeight !== out.height) return null;
  return untouched(c) ? c : null;
}

export interface PassthroughSource {
  input: Input;
  sink: EncodedPacketSink;
  decoderConfig: VideoDecoderConfig;
}

export async function openPassthrough(url: string, fps: number): Promise<PassthroughSource | null> {
  const input = new Input({ source: new UrlSource(url), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || track.codec !== 'avc' || track.rotation !== 0) throw new Error('not copyable');
    const decoderConfig = await track.getDecoderConfig();
    if (!decoderConfig) throw new Error('no decoder config');
    const stats = await track.computePacketStats(300);
    if (Math.abs(stats.averagePacketRate - fps) > 0.5) throw new Error(`frame rate ${stats.averagePacketRate.toFixed(2)} ≠ ${fps}`);
    return { input, sink: new EncodedPacketSink(track), decoderConfig };
  } catch {
    input.dispose();
    return null;
  }
}

export function addPassthroughTrack(out: Output, src: PassthroughSource, fps: number): (onProgress: (ratio: number) => void, total: number) => Promise<void> {
  const vsrc = new EncodedVideoPacketSource('avc');
  out.addVideoTrack(vsrc, { frameRate: fps });
  return async (onProgress, total) => {
    let first = true;
    for await (const packet of src.sink.packets()) {
      await vsrc.add(packet, first ? { decoderConfig: src.decoderConfig } : undefined);
      first = false;
      onProgress(Math.min(1, packet.timestamp / Math.max(1e-3, total)));
    }
    vsrc.close();
  };
}
