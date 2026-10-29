import { EFFECTS, SHAPES, STICKERS, TRANSITIONS, effectSwatch, useTimelineStore, type ShapeKind } from './timelineStore';
import { isShaderEffect } from './fx';
import { polyPoints } from './shapes';
import { DND_EFFECT, DND_TRANSITION, useDnd } from './dndStore';

export function EffectsLibrary({ kind }: { kind: 'effects' | 'transitions' }) {
  const setKind = useDnd((s) => s.setKind);
  const isEffects = kind === 'effects';
  const items = isEffects ? EFFECTS : TRANSITIONS.filter((t) => t.value !== 'none');
  const mime = isEffects ? DND_EFFECT : DND_TRANSITION;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 pt-2 text-[11px] leading-relaxed text-krypt-muted/80">
        {isEffects ? 'Drag an effect onto a clip.' : 'Drag a transition onto the seam between two clips on a video track.'}
      </p>
      <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-auto p-2">
        {items.map((it) => (
          <div
            key={it.value}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(mime, it.value);
              e.dataTransfer.effectAllowed = 'copy';
              setKind(isEffects ? 'effect' : 'transition');
            }}
            onDragEnd={() => setKind(null)}
            title={`Drag to apply: ${it.label}`}
            className="flex cursor-grab select-none flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1.5 text-center transition hover:border-krypt-purple/50 hover:bg-krypt-purple/10 active:cursor-grabbing"
          >
            <div className="relative flex h-10 w-full items-center justify-center overflow-hidden rounded bg-black/40">
              {isEffects ? (
                <>
                  <div className="h-full w-full bg-gradient-to-br from-indigo-400 via-pink-400 to-amber-300" style={{ filter: effectSwatch(it.value) }} />
                  {isShaderEffect(it.value) && (
                    <span className="absolute right-0.5 top-0.5 rounded bg-black/60 px-1 text-[8px] font-semibold uppercase tracking-wide text-krypt-purple">FX</span>
                  )}
                </>
              ) : (
                <span className="text-lg text-krypt-purple">⇄</span>
              )}
            </div>
            <span className="truncate text-[11px] font-medium text-white/90">{it.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ShapesLibrary() {
  const addShape = useTimelineStore((s) => s.addShape);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 pt-2 text-[11px] leading-relaxed text-krypt-muted/80">Click a shape to add it at the playhead.</p>
      <div className="grid flex-1 grid-cols-3 content-start gap-2 overflow-auto p-2">
        {SHAPES.map((s) => (
          <button
            key={s.value}
            onClick={() => addShape(s.value)}
            title={`Add ${s.label}`}
            className="flex select-none flex-col items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-1.5 text-center transition hover:border-krypt-purple/50 hover:bg-krypt-purple/10"
          >
            <div className="flex h-10 w-full items-center justify-center rounded bg-black/40">
              <ShapeThumb kind={s.value} />
            </div>
            <span className="truncate text-[11px] font-medium text-white/90">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ShapeThumb({ kind }: { kind: ShapeKind }) {
  const fill = '#7c5cff';
  const pp = polyPoints(kind);
  const pts = pp ? pp.map((v) => 4 + v * 20).join(' ') : '';
  return (
    <svg width="28" height="28" viewBox="0 0 28 28">
      {kind === 'rect' && <rect x="4" y="6" width="20" height="16" fill={fill} />}
      {kind === 'rounded' && <rect x="4" y="6" width="20" height="16" rx="4" fill={fill} />}
      {kind === 'ellipse' && <ellipse cx="14" cy="14" rx="11" ry="9" fill={fill} />}
      {kind === 'line' && <line x1="4" y1="14" x2="24" y2="14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />}
      {pp && <polygon points={pts} fill={fill} />}
    </svg>
  );
}

export function StickersLibrary() {
  const addSticker = useTimelineStore((s) => s.addSticker);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-3 pt-2 text-[11px] leading-relaxed text-krypt-muted/80">Click a sticker to add it at the playhead.</p>
      <div className="grid flex-1 grid-cols-5 content-start gap-1 overflow-auto p-2">
        {STICKERS.map((e) => (
          <button
            key={e}
            onClick={() => addSticker(e)}
            title="Add sticker"
            className="flex h-10 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-2xl leading-none transition hover:border-krypt-purple/50 hover:bg-krypt-purple/10"
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
