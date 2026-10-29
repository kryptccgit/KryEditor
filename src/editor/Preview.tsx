import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Play, Pause, SkipBack, Volume2, Clapperboard, Pencil, Maximize2, Minimize2 } from 'lucide-react';
import type { MediaFile } from '@shared/types';
import { useMediaStore } from './mediaStore';
import {
  activeClipAt,
  activeOverlays,
  activeVisualLayers,
  upcomingVideoClips,
  activeWordAt,
  backgroundCss,
  DEFAULT_KARAOKE_COLOR,
  karaokeActive,
  clipFilter,
  fadeFactor,
  hexToRgba,
  keyOpacity,
  REF_HEIGHT,
  resolvedValue,
  sourceTimeAt,
  speedAt,
  textAnim,
  timelineDuration,
  useTimelineStore,
  visibleText,
  withKeyframes,
  type Canvas,
  type DrawClip,
  type MediaClip,
  type ShapeClip,
  type Stroke,
  type TextClip,
  type VisualLayer,
} from './timelineStore';
import { polyPoints } from './shapes';
import { CHROMA_FRAG, CHROMA_VERT, hexToRgb01 } from './chroma';
import { FX_FRAG, FX_VERT, fxMode } from './fx';
import { getVideoSegmenter, maskToCanvas } from './segmenter';
import { makeMaskCanvas } from './mask';
import { LUT_FRAG, LUT_VERT, lutAtlasPixels, type LutDef } from './lut';
import { useLutStore } from './lutStore';
import { cls, fmtTimecode } from '../utils/format';
import { IconButton } from '../components/common';
import { useToast } from '../state/ToastProvider';

const warnedOnce = new Set<string>();

const SEEK_TOLERANCE = 0.3;
const PRELOAD_AHEAD = 2.5;
const MIN_SCALE = 0.05;
const MAX_SCALE = 12;

function fit(cw: number, ch: number, aw: number, ah: number): { width: number; height: number } {
  if (cw <= 0 || ch <= 0 || aw <= 0 || ah <= 0) return { width: 0, height: 0 };
  const s = Math.min(cw / aw, ch / ah);
  return { width: aw * s, height: ah * s };
}

function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

function mediaBox(clip: MediaClip, stageW: number, stageH: number, canvas: Canvas) {
  const stageScale = canvas.width > 0 ? stageW / canvas.width : 0;
  const srcW = clip.sourceWidth || canvas.width;
  const srcH = clip.sourceHeight || canvas.height;
  const cfW = Math.max(0.01, 1 - clip.cropLeft - clip.cropRight);
  const cfH = Math.max(0.01, 1 - clip.cropTop - clip.cropBottom);
  const sw = srcW * cfW;
  const sh = srcH * cfH;
  const fitScale = Math.min(canvas.width / sw, canvas.height / sh);
  return {
    bw: sw * fitScale * clip.scaleX * stageScale,
    bh: sh * fitScale * clip.scaleY * stageScale,
    bcx: stageW / 2 + clip.posX * stageW,
    bcy: stageH / 2 + clip.posY * stageH,
    rotation: clip.rotation,
    cfW,
    cfH,
  };
}

interface LayerFx {
  dx: number;
  scale: number;
  blur: number;
  reveal?: { l: number; t: number; r: number; b: number };
}

function layerStyles(clip: MediaClip, stageW: number, stageH: number, canvas: Canvas, fx: LayerFx): { window: CSSProperties; media: CSSProperties } {
  const { bw, bh, bcx, bcy, rotation, cfW, cfH } = mediaBox(clip, stageW, stageH, canvas);
  const fullW = bw / cfW;
  const fullH = bh / cfH;
  const blurPx = fx.blur > 0 ? fx.blur * (stageH / REF_HEIGHT) : 0;
  const rv = fx.reveal;
  return {
    window: {
      position: 'absolute',
      left: bcx - bw / 2,
      top: bcy - bh / 2,
      width: bw,
      height: bh,
      overflow: 'hidden',
      transform: `translate(${fx.dx * stageW}px, 0) rotate(${rotation}deg) scale(${fx.scale})`,
      filter: blurPx > 0 ? `blur(${blurPx}px)` : undefined,
      clipPath: rv ? `inset(${rv.t * 100}% ${rv.r * 100}% ${rv.b * 100}% ${rv.l * 100}%)` : undefined,
    },
    media: {
      position: 'absolute',
      left: -clip.cropLeft * fullW,
      top: -clip.cropTop * fullH,
      width: fullW,
      height: fullH,
      objectFit: 'fill',
      filter: clipFilter(clip),
    },
  };
}

function syncMediaEl(el: HTMLMediaElement | null, clip: MediaClip | null, media: MediaFile | undefined, playing: boolean, t: number, gain: number, preload = false): void {
  if (!el) return;
  if (!clip || !media || (media.kind !== 'video' && media.kind !== 'audio')) {
    if (!el.paused) el.pause();
    return;
  }
  if (el.dataset.media !== media.id) {
    el.dataset.media = media.id;
    el.crossOrigin = 'anonymous';
    el.src = media.mediaUrl;
    el.load();
  }
  if (preload) {
    el.volume = 0;
    if (!el.paused) el.pause();
    const first = sourceTimeAt(clip, clip.start);
    if (Math.abs(el.currentTime - first) > 0.05) {
      try {
        el.currentTime = first;
      } catch {
      }
    }
    return;
  }
  const frozen = clip.freezeAt != null;
  el.playbackRate = frozen ? 1 : speedAt(clip, t - clip.start);
  el.preservesPitch = true;
  const vol = resolvedValue(clip, 'volume', t, clip.volume);
  el.volume = clip.muted || frozen ? 0 : Math.max(0, Math.min(1, vol * fadeFactor(clip, t) * gain));
  const local = sourceTimeAt(clip, t);
  if (Math.abs(el.currentTime - local) > (frozen ? 0.05 : SEEK_TOLERANCE)) {
    try {
      el.currentTime = local;
    } catch {
    }
  }
  if (playing && !frozen) {
    if (el.paused) void el.play().catch(() => {});
  } else if (!el.paused) {
    el.pause();
  }
}

export function Preview() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [masterVol, setMasterVol] = useState(1);
  const masterRef = useRef(1);

  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = (): void => setIsFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const media = useMediaStore((s) => s.media);
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  const clips = useTimelineStore((s) => s.clips);
  const tracks = useTimelineStore((s) => s.tracks);
  const canvas = useTimelineStore((s) => s.canvas);
  const background = useTimelineStore((s) => s.background);
  const playing = useTimelineStore((s) => s.playing);
  const playhead = useTimelineStore((s) => s.playhead);
  const selectedIds = useTimelineStore((s) => s.selectedIds);
  const drawMode = useTimelineStore((s) => s.drawMode);
  const setPlayhead = useTimelineStore((s) => s.setPlayhead);
  const pause = useTimelineStore((s) => s.pause);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const pushHistory = useTimelineStore((s) => s.pushHistory);

  const total = useMemo(() => timelineDuration(clips), [clips]);

  const layers = useMemo(() => activeVisualLayers(clips, tracks, playhead), [clips, tracks, playhead]);
  const upcoming = useMemo(
    () =>
      upcomingVideoClips(clips, tracks, playhead, PRELOAD_AHEAD)
        .filter((c) => mediaById.get(c.mediaId)?.kind === 'video' && !layers.some((L) => L.clip.id === c.id))
        .map((clip) => ({ clip, opacity: 0, dx: 0, scale: 1, blur: 0, audioGain: 0 })),
    [clips, tracks, playhead, mediaById, layers],
  );
  const audioClip = useMemo(() => activeClipAt(clips, tracks, 'audio', playhead), [clips, tracks, playhead]);
  const overlays = useMemo(() => activeOverlays(clips, playhead, tracks), [clips, playhead, tracks]);
  const audioMedia = audioClip ? mediaById.get(audioClip.mediaId) : undefined;

  const anyVisual = layers.length > 0 || overlays.length > 0;

  const [outerRef, outerSize] = useElementSize<HTMLDivElement>();
  const stage = fit(outerSize.w, outerSize.h, canvas.width, canvas.height);
  const fontScale = stage.height / REF_HEIGHT;
  const selLayer = selectedIds.length === 1 ? layers.find((L) => L.clip.id === selectedIds[0] && L.dx === 0) : undefined;
  const showBox = !!selLayer && stage.width > 0 && !isFullscreen;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let anchorWall = performance.now();
    let anchorHead = useTimelineStore.getState().playhead;
    let lastWritten = anchorHead;
    const tick = (): void => {
      const cur = useTimelineStore.getState().playhead;
      if (Math.abs(cur - lastWritten) > 1e-6) {
        anchorWall = performance.now();
        anchorHead = cur;
      }
      const t = anchorHead + (performance.now() - anchorWall) / 1000;
      if (t >= total) {
        setPlayhead(total);
        pause();
        return;
      }
      if (t - lastWritten >= 1 / 62) {
        setPlayhead(t);
        lastWritten = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, total, setPlayhead, pause]);

  useEffect(() => {
    syncMediaEl(audioRef.current, audioClip, audioMedia, playing, playhead, masterRef.current);
  }, [audioClip, audioMedia, playing, playhead, masterVol, mediaById]);

  const onVolume = useCallback((v: number) => {
    masterRef.current = v;
    setMasterVol(v);
  }, []);

  const onLayerDown = (clip: MediaClip) => (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id);
    pushHistory();
    const sx = e.clientX;
    const sy = e.clientY;
    const px0 = clip.posX;
    const py0 = clip.posY;
    const mv = (ev: PointerEvent): void => {
      updateClip(clip.id, { posX: px0 + (ev.clientX - sx) / stage.width, posY: py0 + (ev.clientY - sy) / stage.height });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const toStart = (): void => {
    pause();
    setPlayhead(0);
  };
  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen().catch(() => {});
  };
  const toggle = (): void => {
    const st = useTimelineStore.getState();
    if (st.playing) {
      st.pause();
      return;
    }
    if (st.playhead >= total - 0.001) st.setPlayhead(0);
    st.play();
  };

  const empty = clips.length === 0;

  return (
    <div ref={rootRef} className={cls('flex h-full min-h-0 flex-col gap-3 px-1', isFullscreen && 'bg-krypt-void p-6')}>
      <div ref={outerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-krypt-surface shadow-krypt-card">
        <div
          ref={stageRef}
          className="relative overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_10px_40px_rgba(0,0,0,0.6)]"
          style={{ width: stage.width, height: stage.height, background: background.type === 'blur' ? '#000' : backgroundCss(background) }}
        >
          {background.type === 'blur' && layers[0] && (
            <BlurBackdrop layer={layers[0]} media={mediaById.get(layers[0].clip.mediaId)} playing={playing} playhead={playhead} />
          )}

          {[...layers.map((L) => ({ L, preload: false })), ...upcoming.map((L) => ({ L, preload: true }))].map(({ L, preload }) => (
            <MediaLayerView
              key={L.clip.id}
              layer={L}
              media={mediaById.get(L.clip.mediaId)}
              stageW={stage.width}
              stageH={stage.height}
              canvas={canvas}
              playing={playing}
              playhead={playhead}
              masterVol={masterVol}
              preload={preload}
              onDown={onLayerDown(L.clip)}
            />
          ))}

          {overlays.map((oc) =>
            oc.type === 'text' ? (
              <TextOverlay key={oc.id} clip={oc} stageW={stage.width} stageH={stage.height} fontScale={fontScale} t={playhead} />
            ) : oc.type === 'shape' ? (
              <ShapeOverlay key={oc.id} clip={oc} stageW={stage.width} stageH={stage.height} fontScale={fontScale} t={playhead} />
            ) : (
              <DrawOverlay key={oc.id} clip={oc} stageW={stage.width} stageH={stage.height} fontScale={fontScale} t={playhead} />
            ),
          )}

          {showBox && selLayer && <TransformBox clip={selLayer.clip} stageRef={stageRef} stageW={stage.width} stageH={stage.height} canvas={canvas} />}

          {drawMode && stage.width > 0 && <DrawCapture stageW={stage.width} stageH={stage.height} />}
        </div>

        {!anyVisual && (
          <div className="pointer-events-none absolute flex flex-col items-center gap-3 text-center text-krypt-muted">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-krypt-panel/80">
              <Clapperboard className="h-8 w-8 text-krypt-purple" />
            </div>
            <div className="text-sm">{empty ? 'Add clips to the timeline to preview your edit.' : audioMedia ? 'Playing audio…' : 'No clip under the playhead.'}</div>
          </div>
        )}
        <audio ref={audioRef} className="hidden" />
      </div>

      <div className="flex items-center gap-3 px-1">
        <IconButton title="Jump to start" onClick={toStart} disabled={empty}>
          <SkipBack className="h-4 w-4" />
        </IconButton>
        <IconButton title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={toggle} active={playing} disabled={empty}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </IconButton>
        <div className="font-mono text-sm tabular-nums text-white">
          {fmtTimecode(playhead)}
          <span className="text-krypt-muted"> / {fmtTimecode(total)}</span>
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(0.01, total)}
          step={0.01}
          value={Math.min(playhead, total)}
          disabled={empty}
          onChange={(e) => {
            const st = useTimelineStore.getState();
            st.setPlayhead(Number(e.target.value));
          }}
          className="h-1 min-w-0 flex-1 cursor-pointer accent-krypt-pink disabled:opacity-30"
          title="Seek"
        />
        {!isFullscreen && <DrawControls />}
        <div className="flex items-center gap-2">
          <Volume2 className="h-4 w-4 text-krypt-muted" />
          <input type="range" min={0} max={1} step={0.01} value={masterVol} onChange={(e) => onVolume(Number(e.target.value))} className="h-1 w-28 cursor-pointer accent-krypt-purple" title="Preview volume" />
        </div>
        <IconButton title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen preview'} onClick={toggleFullscreen} active={isFullscreen} disabled={empty && !isFullscreen}>
          {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </IconButton>
      </div>
    </div>
  );
}

function DrawControls() {
  const drawMode = useTimelineStore((s) => s.drawMode);
  const setDrawMode = useTimelineStore((s) => s.setDrawMode);
  const brush = useTimelineStore((s) => s.brush);
  const setBrush = useTimelineStore((s) => s.setBrush);
  return (
    <div className="flex items-center gap-2">
      <IconButton title={drawMode ? 'Drawing on — click to stop' : 'Draw on the canvas'} onClick={() => setDrawMode(!drawMode)} active={drawMode}>
        <Pencil className="h-4 w-4" />
      </IconButton>
      {drawMode && (
        <>
          <input type="color" value={brush.color} onChange={(e) => setBrush({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border border-white/10 bg-transparent" title="Brush color" />
          <input type="range" min={2} max={40} step={1} value={brush.width} onChange={(e) => setBrush({ width: Number(e.target.value) })} className="h-1 w-20 cursor-pointer accent-krypt-pink" title="Brush size" />
        </>
      )}
    </div>
  );
}

function DrawCapture({ stageW, stageH }: { stageW: number; stageH: number }) {
  const brush = useTimelineStore((s) => s.brush);
  const addStroke = useTimelineStore((s) => s.addStroke);
  const drawClipRef = useRef<string | null>(null);
  const [live, setLive] = useState<number[] | null>(null);

  useEffect(() => () => void (drawClipRef.current = null), []);

  const onDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pts: number[] = [(e.clientX - rect.left) / stageW, (e.clientY - rect.top) / stageH];
    setLive([...pts]);
    const mv = (ev: PointerEvent): void => {
      pts.push((ev.clientX - rect.left) / stageW, (ev.clientY - rect.top) / stageH);
      setLive([...pts]);
    };
    const up = (): void => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (pts.length >= 4) {
        const stroke: Stroke = { color: brush.color, width: brush.width, points: pts };
        drawClipRef.current = addStroke(drawClipRef.current, stroke);
      }
      setLive(null);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="absolute inset-0 z-10 cursor-crosshair" onPointerDown={onDown}>
      {live && live.length >= 4 && (
        <svg className="pointer-events-none absolute inset-0 h-full w-full" width={stageW} height={stageH}>
          <polyline
            points={polyToPx(live, stageW, stageH)}
            fill="none"
            stroke={brush.color}
            strokeWidth={brush.width * (stageH / REF_HEIGHT)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

function polyToPx(frac: number[], w: number, h: number): string {
  let s = '';
  for (let i = 0; i + 1 < frac.length; i += 2) s += `${frac[i] * w},${frac[i + 1] * h} `;
  return s.trim();
}

function MediaLayerView({
  layer,
  media,
  stageW,
  stageH,
  canvas,
  playing,
  playhead,
  masterVol,
  preload = false,
  onDown,
}: {
  layer: VisualLayer;
  media: MediaFile | undefined;
  stageW: number;
  stageH: number;
  canvas: Canvas;
  playing: boolean;
  playhead: number;
  masterVol: number;
  preload?: boolean;
  onDown: (e: ReactPointerEvent) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = media?.kind === 'video';
  const isImage = media?.kind === 'image';

  useEffect(() => {
    if (isVideo) syncMediaEl(videoRef.current, layer.clip, media, playing, playhead, masterVol * layer.audioGain, preload);
  });
  useEffect(
    () => () => {
      const el = videoRef.current;
      if (el && !el.paused) el.pause();
    },
    [],
  );

  const toast = useToast();
  const [broken, setBroken] = useState<{ fx?: boolean; chroma?: boolean; seg?: boolean; lut?: boolean }>({});
  const degrade = (kind: 'fx' | 'chroma' | 'seg' | 'lut', message: string) => (): void => {
    setBroken((b) => (b[kind] ? b : { ...b, [kind]: true }));
    if (!warnedOnce.has(kind)) {
      warnedOnce.add(kind);
      toast.warn(message);
    }
  };

  const lut = useLutStore((s) => (layer.clip.lut ? s.luts.find((l) => l.id === layer.clip.lut) : undefined));

  const maskUrl = useMemo(() => {
    const mk = layer.clip.mask;
    if (!mk) return null;
    const { bw, bh } = mediaBox(layer.clip, stageW, stageH, canvas);
    const s = Math.min(1, 512 / Math.max(bw, bh, 1));
    return makeMaskCanvas(bw * s, bh * s, mk).toDataURL();
  }, [layer.clip, stageW, stageH, canvas]);

  const eff = withKeyframes(layer.clip, playhead);
  const st = layerStyles(eff, stageW, stageH, canvas, { dx: layer.dx, scale: layer.scale, blur: layer.blur, reveal: layer.reveal });
  st.window.opacity = preload ? 0 : layer.opacity;
  if (preload) st.window.pointerEvents = 'none';
  if (eff.blend && eff.blend !== 'normal') st.window.mixBlendMode = eff.blend;
  if (maskUrl) {
    st.window.maskImage = `url(${maskUrl})`;
    st.window.maskSize = '100% 100%';
    st.window.WebkitMaskImage = `url(${maskUrl})`;
    st.window.WebkitMaskSize = '100% 100%';
  }
  const live = !preload;
  const seg = live && !!(isVideo && layer.clip.bgRemove) && !broken.seg;
  const keyed = live && !!(isVideo && layer.clip.chromaKey && !seg) && !broken.chroma;
  const fxOn = live && fxMode(layer.clip.effect) > 0 && !seg && !keyed && (isVideo || isImage) && !broken.fx;
  const lutOn = live && !!lut && !seg && !keyed && !fxOn && (isVideo || isImage) && !broken.lut;
  const hideRaw = keyed || seg || fxOn || lutOn;

  return (
    <div style={st.window} onPointerDown={onDown}>
      <video ref={videoRef} playsInline style={isVideo ? { ...st.media, opacity: hideRaw ? 0 : 1 } : { display: 'none' }} />
      {keyed && (
        <ChromaCanvas videoRef={videoRef} clip={layer.clip} style={st.media} onUnavailable={degrade('chroma', 'Chroma key is unavailable on this device (WebGL failed) — showing the clip unkeyed.')} />
      )}
      {seg && (
        <SegmentCanvas videoRef={videoRef} style={st.media} onUnavailable={degrade('seg', 'Background removal is unavailable (model not downloaded, or offline) — showing the clip without it.')} />
      )}
      {fxOn && (
        <EffectCanvas
          videoRef={isVideo ? videoRef : undefined}
          imageUrl={isImage ? media?.mediaUrl : undefined}
          effect={layer.clip.effect}
          style={st.media}
          onUnavailable={degrade('fx', 'GPU effects are unavailable on this device (WebGL failed) — clips show without them.')}
        />
      )}
      {lutOn && lut && (
        <LutCanvas
          videoRef={isVideo ? videoRef : undefined}
          imageUrl={isImage ? media?.mediaUrl : undefined}
          lut={lut}
          amount={layer.clip.lutAmount ?? 1}
          style={st.media}
          onUnavailable={degrade('lut', 'LUT rendering is unavailable on this device (WebGL failed) — showing the clip ungraded.')}
        />
      )}
      {isImage && !fxOn && media && <img src={media.mediaUrl} alt="" style={st.media} draggable={false} />}
      {(layer.clip.vignette ?? 0) > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 60%, rgba(0,0,0,${layer.clip.vignette}) 100%)`,
          }}
        />
      )}
    </div>
  );
}

function EffectCanvas({
  videoRef,
  imageUrl,
  effect,
  style,
  onUnavailable,
}: {
  videoRef?: React.RefObject<HTMLVideoElement>;
  imageUrl?: string;
  effect: string;
  style: CSSProperties;
  onUnavailable?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const modeRef = useRef(fxMode(effect));
  modeRef.current = fxMode(effect);

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv) return;
    const gl = cnv.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    const prog = gl ? makeProgram(gl, FX_VERT, FX_FRAG) : null;
    if (!gl || !prog) {
      onUnavailable?.();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const uTime = gl.getUniformLocation(prog, 'u_time');
    const uRes = gl.getUniformLocation(prog, 'u_res');
    const uMode = gl.getUniformLocation(prog, 'u_mode');

    let img: HTMLImageElement | null = null;
    let imgReady = false;
    if (imageUrl) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imgReady = true;
      };
      img.src = imageUrl;
    }

    let raf = 0;
    let uploaded = -1;
    const t0 = performance.now();
    const render = (): void => {
      const v = videoRef?.current;
      let src: TexImageSource | null = null;
      let w = 0;
      let h = 0;
      let frameTime = 0;
      if (v && v.videoWidth > 0 && v.readyState >= 2) {
        src = v;
        w = v.videoWidth;
        h = v.videoHeight;
        frameTime = v.paused ? v.currentTime : performance.now() / 1000;
      } else if (img && imgReady) {
        src = img;
        w = img.naturalWidth;
        h = img.naturalHeight;
      }
      if (src && w > 0) {
        if (cnv.width !== w || cnv.height !== h) {
          cnv.width = w;
          cnv.height = h;
        }
        gl.viewport(0, 0, w, h);
        try {
          if (frameTime !== uploaded) {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
            uploaded = frameTime;
          }
          gl.uniform1f(uTime, (performance.now() - t0) / 1000);
          gl.uniform2f(uRes, w, h);
          gl.uniform1i(uMode, modeRef.current);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } catch {
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
    };
  }, [videoRef, imageUrl]);

  return <canvas ref={ref} style={style} />;
}

function LutCanvas({
  videoRef,
  imageUrl,
  lut,
  amount,
  style,
  onUnavailable,
}: {
  videoRef?: React.RefObject<HTMLVideoElement>;
  imageUrl?: string;
  lut: LutDef;
  amount: number;
  style: CSSProperties;
  onUnavailable?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const amountRef = useRef(amount);
  amountRef.current = amount;

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv) return;
    const gl = cnv.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    const prog = gl ? makeProgram(gl, LUT_VERT, LUT_FRAG) : null;
    if (!gl || !prog) {
      onUnavailable?.();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const setParams = (): void => {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    };
    const srcTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    setParams();
    const lutTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    setParams();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutAtlasPixels(lut));
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_lut'), 1);
    const uSize = gl.getUniformLocation(prog, 'u_size');
    const uAmount = gl.getUniformLocation(prog, 'u_amount');

    let img: HTMLImageElement | null = null;
    let imgReady = false;
    if (imageUrl) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imgReady = true;
      };
      img.src = imageUrl;
    }

    let raf = 0;
    let last = '';
    const render = (): void => {
      const v = videoRef?.current;
      let src: TexImageSource | null = null;
      let w = 0;
      let h = 0;
      let key = '';
      if (v && v.videoWidth > 0 && v.readyState >= 2) {
        src = v;
        w = v.videoWidth;
        h = v.videoHeight;
        key = v.paused ? `${v.currentTime}|${amountRef.current}` : `live${performance.now()}`;
      } else if (img && imgReady) {
        src = img;
        w = img.naturalWidth;
        h = img.naturalHeight;
        key = `img|${amountRef.current}`;
      }
      if (src && w > 0 && key !== last) {
        last = key;
        if (cnv.width !== w || cnv.height !== h) {
          cnv.width = w;
          cnv.height = h;
        }
        gl.viewport(0, 0, w, h);
        try {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, srcTex);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
          gl.uniform1f(uSize, lut.size);
          gl.uniform1f(uAmount, amountRef.current);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } catch {
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteTexture(srcTex);
      gl.deleteTexture(lutTex);
    };
  }, [videoRef, imageUrl, lut]);

  return <canvas ref={ref} style={style} />;
}

function BlurBackdrop({ layer, media, playing, playhead }: { layer: VisualLayer; media: MediaFile | undefined; playing: boolean; playhead: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = media?.kind === 'video';
  const isImage = media?.kind === 'image';

  useEffect(() => {
    if (isVideo) syncMediaEl(videoRef.current, layer.clip, media, playing, playhead, 0);
  });
  useEffect(
    () => () => {
      const el = videoRef.current;
      if (el && !el.paused) el.pause();
    },
    [],
  );

  const style: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(26px) brightness(0.65)', transform: 'scale(1.12)' };
  return (
    <div className="absolute inset-0 overflow-hidden">
      {isVideo && <video ref={videoRef} playsInline muted style={style} />}
      {isImage && media && <img src={media.mediaUrl} alt="" style={style} draggable={false} />}
    </div>
  );
}

type HandleType = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w' | 'rot';

function TransformBox({ clip, stageRef, stageW, stageH, canvas }: { clip: MediaClip; stageRef: React.RefObject<HTMLDivElement>; stageW: number; stageH: number; canvas: Canvas }) {
  const updateClip = useTimelineStore((s) => s.updateClip);
  const pushHistory = useTimelineStore((s) => s.pushHistory);
  const { bw, bh, bcx, bcy, rotation } = mediaBox(clip, stageW, stageH, canvas);
  const clampS = (v: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

  const onHandle = (e: ReactPointerEvent, type: HandleType): void => {
    e.preventDefault();
    e.stopPropagation();
    pushHistory();
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    const θ = (rotation * Math.PI) / 180;
    const cos = Math.cos(θ);
    const sin = Math.sin(θ);
    const C = { x: bcx, y: bcy };
    const hx0 = bw / 2;
    const hy0 = bh / 2;
    const sx0 = clip.scaleX;
    const sy0 = clip.scaleY;

    const mv = (ev: PointerEvent): void => {
      const px = ev.clientX - rect.left;
      const py = ev.clientY - rect.top;
      if (type === 'rot') {
        const deg = (Math.atan2(py - C.y, px - C.x) * 180) / Math.PI + 90;
        updateClip(clip.id, { rotation: Math.round(((deg + 180) % 360) - 180) });
        return;
      }
      const vx = px - C.x;
      const vy = py - C.y;
      const lx = cos * vx + sin * vy;
      const ly = -sin * vx + cos * vy;
      if (type === 'e' || type === 'w') {
        updateClip(clip.id, { scaleX: clampS((sx0 * Math.abs(lx)) / hx0) });
      } else if (type === 'n' || type === 's') {
        updateClip(clip.id, { scaleY: clampS((sy0 * Math.abs(ly)) / hy0) });
      } else {
        const f = Math.hypot(lx, ly) / Math.hypot(hx0, hy0);
        updateClip(clip.id, { scaleX: clampS(sx0 * f), scaleY: clampS(sy0 * f) });
      }
    };
    const up = (): void => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const corners: Array<{ t: HandleType; x: number; y: number; c: string }> = [
    { t: 'nw', x: 0, y: 0, c: 'nwse-resize' },
    { t: 'ne', x: bw, y: 0, c: 'nesw-resize' },
    { t: 'sw', x: 0, y: bh, c: 'nesw-resize' },
    { t: 'se', x: bw, y: bh, c: 'nwse-resize' },
  ];
  const edges: Array<{ t: HandleType; x: number; y: number; c: string }> = [
    { t: 'n', x: bw / 2, y: 0, c: 'ns-resize' },
    { t: 's', x: bw / 2, y: bh, c: 'ns-resize' },
    { t: 'w', x: 0, y: bh / 2, c: 'ew-resize' },
    { t: 'e', x: bw, y: bh / 2, c: 'ew-resize' },
  ];

  return (
    <div className="pointer-events-none absolute" style={{ left: bcx - bw / 2, top: bcy - bh / 2, width: bw, height: bh, transform: `rotate(${rotation}deg)`, transformOrigin: 'center' }}>
      <div className="absolute inset-0 border-[1.5px] border-krypt-pink/90" />
      <div className="absolute left-1/2 w-px -translate-x-1/2 bg-krypt-pink/80" style={{ height: 22, top: -22 }} />
      <Handle x={bw / 2} y={-22} cursor="grab" round onDown={(e) => onHandle(e, 'rot')} />
      {edges.map((h) => (
        <Handle key={h.t} x={h.x} y={h.y} cursor={h.c} onDown={(e) => onHandle(e, h.t)} />
      ))}
      {corners.map((h) => (
        <Handle key={h.t} x={h.x} y={h.y} cursor={h.c} round onDown={(e) => onHandle(e, h.t)} />
      ))}
    </div>
  );
}

function Handle({ x, y, cursor, round, onDown }: { x: number; y: number; cursor: string; round?: boolean; onDown: (e: ReactPointerEvent) => void }) {
  return (
    <div
      onPointerDown={onDown}
      className={cls('pointer-events-auto absolute h-3 w-3 border-2 border-krypt-pink bg-white shadow', round ? 'rounded-full' : 'rounded-[2px]')}
      style={{ left: x - 6, top: y - 6, cursor }}
    />
  );
}

function makeProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram | null {
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

function ChromaCanvas({
  videoRef,
  clip,
  style,
  onUnavailable,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  clip: MediaClip;
  style: CSSProperties;
  onUnavailable?: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const params = useRef(clip);
  params.current = clip;

  useEffect(() => {
    const cnv = ref.current;
    if (!cnv) return;
    const gl = cnv.getContext('webgl', { premultipliedAlpha: false, alpha: true });
    const prog = gl ? makeProgram(gl, CHROMA_VERT, CHROMA_FRAG) : null;
    if (!gl || !prog) {
      onUnavailable?.();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const uKey = gl.getUniformLocation(prog, 'u_key');
    const uSim = gl.getUniformLocation(prog, 'u_sim');
    const uSm = gl.getUniformLocation(prog, 'u_smooth');

    let raf = 0;
    let lastKey = '';
    const render = (): void => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0 && v.readyState >= 2) {
        const c = params.current;
        const key = `${v.currentTime}|${c.chromaColor}|${c.chromaSimilarity}|${c.chromaSmoothness}`;
        if (!v.paused || key !== lastKey) {
          lastKey = key;
          if (cnv.width !== v.videoWidth || cnv.height !== v.videoHeight) {
            cnv.width = v.videoWidth;
            cnv.height = v.videoHeight;
          }
          gl.viewport(0, 0, cnv.width, cnv.height);
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
            const [r, g, b] = hexToRgb01(c.chromaColor);
            gl.uniform3f(uKey, r, g, b);
            gl.uniform1f(uSim, c.chromaSimilarity);
            gl.uniform1f(uSm, c.chromaSmoothness);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          } catch {
          }
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
    };
  }, [videoRef]);

  return <canvas ref={ref} style={style} />;
}

function SegmentCanvas({ videoRef, style, onUnavailable }: { videoRef: React.RefObject<HTMLVideoElement>; style: CSSProperties; onUnavailable?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    let stopped = false;
    let segmenter: Awaited<ReturnType<typeof getVideoSegmenter>> | null = null;
    let lastTs = -1;
    let lastFrame = -1;
    void getVideoSegmenter().then(
      (s) => {
        if (!stopped) segmenter = s;
      },
      (err) => {
        console.warn('[bg-remove] segmenter unavailable', err);
        if (!stopped) onUnavailable?.();
      },
    );

    const render = (): void => {
      const v = videoRef.current;
      const cnv = ref.current;
      const ctx = cnv?.getContext('2d');
      const stale = v ? v.paused && v.currentTime === lastFrame : true;
      if (v && cnv && ctx && segmenter && v.videoWidth > 0 && v.readyState >= 2 && !stale) {
        lastFrame = v.currentTime;
        if (cnv.width !== v.videoWidth) {
          cnv.width = v.videoWidth;
          cnv.height = v.videoHeight;
        }
        let ts = performance.now();
        if (ts <= lastTs) ts = lastTs + 1;
        lastTs = ts;
        try {
          const result = segmenter.segmentForVideo(v, ts);
          const mask = result.confidenceMasks?.[0];
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, cnv.width, cnv.height);
          ctx.drawImage(v, 0, 0, cnv.width, cnv.height);
          if (mask) {
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(maskToCanvas(mask), 0, 0, cnv.width, cnv.height);
            ctx.globalCompositeOperation = 'source-over';
          }
          result.close();
        } catch {
        }
      }
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [videoRef]);

  return <canvas ref={ref} style={style} />;
}

function TextOverlay({ clip, stageW, stageH, fontScale, t }: { clip: TextClip; stageW: number; stageH: number; fontScale: number; t: number }) {
  const pushHistory = useTimelineStore((s) => s.pushHistory);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const selectedIds = useTimelineStore((s) => s.selectedIds);
  const anim = textAnim(clip, t);
  const ex = resolvedValue(clip, 'x', t, clip.x);
  const ey = resolvedValue(clip, 'y', t, clip.y);
  const opacity = fadeFactor(clip, t) * anim.opacity * keyOpacity(clip, t);

  const onDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id);
    pushHistory();
    const startX = e.clientX;
    const startY = e.clientY;
    const ox = clip.x;
    const oy = clip.y;
    const mv = (ev: PointerEvent): void => {
      updateClip(clip.id, {
        x: Math.max(0, Math.min(1, ox + (ev.clientX - startX) / stageW)),
        y: Math.max(0, Math.min(1, oy + (ev.clientY - startY) / stageH)),
      });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const bgStyle = clip.bgStyle ?? 'none';
  const padX = (clip.bgPadding ?? 16) * fontScale;
  const padY = padX * 0.55;
  const rad = (clip.bgRadius ?? 10) * fontScale;
  const bgCss = hexToRgba(clip.bgColor ?? '#000000', clip.bgOpacity ?? 1);
  const box = bgStyle === 'box';
  const highlight = bgStyle === 'highlight';

  return (
    <div
      onPointerDown={onDown}
      className={cls('absolute cursor-move select-none whitespace-pre-wrap leading-tight', selectedIds.includes(clip.id) ? 'outline outline-1 outline-krypt-pink/70' : '')}
      style={{
        left: ex * stageW + anim.dxFrac * stageW,
        top: ey * stageH + anim.dyFrac * stageH,
        transform: `translate(-50%, -50%) rotate(${anim.rotate}deg) scale(${anim.scale})`,
        maxWidth: stageW,
        fontSize: clip.fontSize * fontScale,
        fontFamily: clip.fontFamily,
        color: clip.color,
        fontWeight: clip.bold ? 800 : 500,
        fontStyle: clip.italic ? 'italic' : 'normal',
        textAlign: clip.align,
        opacity,
        filter: anim.blur > 0 ? `blur(${anim.blur * fontScale}px)` : undefined,
        textShadow:
          clip.glow > 0
            ? `0 0 ${clip.glow * fontScale}px ${clip.glowColor}, 0 0 ${clip.glow * fontScale * 2}px ${clip.glowColor}`
            : '0 2px 8px rgba(0,0,0,0.55)',
        WebkitTextStroke: clip.outlineWidth > 0 ? `${clip.outlineWidth * fontScale}px ${clip.outlineColor}` : undefined,
        paintOrder: 'stroke',
        ...(box ? { background: bgCss, padding: `${padY}px ${padX}px`, borderRadius: rad } : null),
      }}
    >
      {highlight ? (
        <span
          style={{
            background: bgCss,
            padding: `${padY}px ${padX}px`,
            borderRadius: rad,
            WebkitBoxDecorationBreak: 'clone',
            boxDecorationBreak: 'clone',
          }}
        >
          {karaokeActive(clip) ? <KaraokeWords clip={clip} t={t} fontScale={fontScale} /> : visibleText(clip, t)}
        </span>
      ) : karaokeActive(clip) ? (
        <KaraokeWords clip={clip} t={t} fontScale={fontScale} />
      ) : (
        visibleText(clip, t)
      )}
    </div>
  );
}

function KaraokeWords({ clip, t, fontScale }: { clip: TextClip; t: number; fontScale: number }) {
  const wi = activeWordAt(clip, t);
  const mode = clip.karaoke ?? 'color';
  const color = clip.karaokeColor ?? DEFAULT_KARAOKE_COLOR;
  return (
    <>
      {clip.words!.map((w, i) => {
        const lead = i === 0 ? '' : (/^\s*/.exec(w.text)?.[0] ?? '');
        const word = i === 0 ? w.text.trimStart() : w.text.slice(lead.length);
        let style: CSSProperties | undefined;
        if (i === wi) {
          if (mode === 'pop') style = { color, display: 'inline-block', transform: 'scale(1.18)', transformOrigin: '50% 80%' };
          else if (mode === 'box')
            style = { background: color, color: '#111111', borderRadius: 6 * fontScale, padding: `0 ${4 * fontScale}px`, WebkitTextStroke: '0px transparent', textShadow: 'none' };
          else style = { color };
        }
        return (
          <span key={i}>
            {lead}
            <span style={style}>{word}</span>
          </span>
        );
      })}
    </>
  );
}

function ShapeOverlay({ clip, stageW, stageH, fontScale, t }: { clip: ShapeClip; stageW: number; stageH: number; fontScale: number; t: number }) {
  const pushHistory = useTimelineStore((s) => s.pushHistory);
  const updateClip = useTimelineStore((s) => s.updateClip);
  const selectClip = useTimelineStore((s) => s.selectClip);
  const selectedIds = useTimelineStore((s) => s.selectedIds);
  const anim = textAnim(clip, t);
  const ex = resolvedValue(clip, 'x', t, clip.x) + anim.dxFrac;
  const ey = resolvedValue(clip, 'y', t, clip.y) + anim.dyFrac;
  const opacity = fadeFactor(clip, t) * anim.opacity * keyOpacity(clip, t);
  const w = Math.max(2, clip.w * stageW);
  const h = Math.max(2, clip.h * stageH);

  const onDown = (e: ReactPointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    selectClip(clip.id);
    pushHistory();
    const sx = e.clientX;
    const sy = e.clientY;
    const ox = clip.x;
    const oy = clip.y;
    const mv = (ev: PointerEvent): void => {
      updateClip(clip.id, { x: Math.max(0, Math.min(1, ox + (ev.clientX - sx) / stageW)), y: Math.max(0, Math.min(1, oy + (ev.clientY - sy) / stageH)) });
    };
    const up = (): void => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      onPointerDown={onDown}
      className={cls('absolute cursor-move', selectedIds.includes(clip.id) ? 'outline outline-1 outline-krypt-pink/70' : '')}
      style={{ left: ex * stageW - w / 2, top: ey * stageH - h / 2, width: w, height: h, transform: `rotate(${clip.rotation + anim.rotate}deg) scale(${anim.scale})`, opacity }}
    >
      <ShapeSvg kind={clip.shape} w={w} h={h} fill={clip.fill} stroke={clip.stroke} strokeWidth={clip.strokeWidth * fontScale} />
    </div>
  );
}

function ShapeSvg({ kind, w, h, fill, stroke, strokeWidth }: { kind: ShapeClip['shape']; w: number; h: number; fill: string; stroke: string; strokeWidth: number }) {
  const fillC = fill || 'none';
  const strokeC = strokeWidth > 0 && stroke ? stroke : 'none';
  const inset = strokeWidth / 2;
  const common = { fill: fillC, stroke: strokeC, strokeWidth, strokeLinejoin: 'round' as const };
  const pp = polyPoints(kind);
  return (
    <svg width={w} height={h} className="pointer-events-none absolute inset-0 overflow-visible">
      {kind === 'rect' && <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} {...common} />}
      {kind === 'rounded' && <rect x={inset} y={inset} width={Math.max(0, w - strokeWidth)} height={Math.max(0, h - strokeWidth)} rx={Math.min(w, h) * 0.18} {...common} />}
      {kind === 'ellipse' && <ellipse cx={w / 2} cy={h / 2} rx={Math.max(0, w / 2 - inset)} ry={Math.max(0, h / 2 - inset)} {...common} />}
      {kind === 'line' && <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={stroke || '#ffffff'} strokeWidth={Math.max(1, strokeWidth)} strokeLinecap="round" />}
      {pp && <polygon points={polyToPx(pp, w, h)} {...common} />}
    </svg>
  );
}

function DrawOverlay({ clip, stageW, stageH, fontScale, t }: { clip: DrawClip; stageW: number; stageH: number; fontScale: number; t: number }) {
  const anim = textAnim(clip, t);
  const ox = (resolvedValue(clip, 'x', t, clip.x) + anim.dxFrac) * stageW;
  const oy = (resolvedValue(clip, 'y', t, clip.y) + anim.dyFrac) * stageH;
  const opacity = fadeFactor(clip, t) * anim.opacity * keyOpacity(clip, t);
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" width={stageW} height={stageH} style={{ opacity, transform: `translate(${ox}px, ${oy}px) scale(${anim.scale})` }}>
      {clip.strokes.map((s, i) => (
        <polyline key={i} points={polyToPx(s.points, stageW, stageH)} fill="none" stroke={s.color} strokeWidth={s.width * fontScale} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
