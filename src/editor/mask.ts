export interface ClipMask {
  type: 'linear' | 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  feather: number;
  invert: boolean;
}

export const DEFAULT_MASK: ClipMask = { type: 'ellipse', x: 0.5, y: 0.5, w: 0.6, h: 0.6, rotation: 0, feather: 0.05, invert: false };

export function maskKey(m: ClipMask, pw: number, ph: number): string {
  return `${m.type}|${m.x}|${m.y}|${m.w}|${m.h}|${m.rotation}|${m.feather}|${m.invert}|${pw}x${ph}`;
}

export function makeMaskCanvas(pw: number, ph: number, m: ClipMask): HTMLCanvasElement {
  const cnv = document.createElement('canvas');
  cnv.width = Math.max(2, Math.round(pw));
  cnv.height = Math.max(2, Math.round(ph));
  const ctx = cnv.getContext('2d');
  if (!ctx) return cnv;

  const W = cnv.width;
  const H = cnv.height;
  const cx = m.x * W;
  const cy = m.y * H;
  const f = Math.max(0.5, m.feather * Math.min(W, H));
  const rad = (m.rotation * Math.PI) / 180;

  if (m.type === 'linear') {
    const nx = Math.sin(rad);
    const ny = Math.cos(rad);
    const g = ctx.createLinearGradient(cx - nx * f, cy - ny * f, cx + nx * f, cy + ny * f);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  } else if (m.type === 'ellipse') {
    const rw = Math.max(1, (m.w * W) / 2);
    const rh = Math.max(1, (m.h * H) / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.scale(rw, rh);
    const fe = Math.min(0.99, f / Math.min(rw, rh));
    const g = ctx.createRadialGradient(0, 0, Math.max(0, 1 - fe), 0, 0, 1);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1.5, -1.5, 3, 3);
    ctx.restore();
  } else {
    const rw = Math.max(1, (m.w * W) / 2);
    const rh = Math.max(1, (m.h * H) / 2);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad);
    ctx.filter = m.feather > 0 ? `blur(${f}px)` : 'none';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-rw, -rh, rw * 2, rh * 2);
    ctx.restore();
  }

  if (m.invert) {
    const inv = document.createElement('canvas');
    inv.width = W;
    inv.height = H;
    const ictx = inv.getContext('2d');
    if (ictx) {
      ictx.fillStyle = '#ffffff';
      ictx.fillRect(0, 0, W, H);
      ictx.globalCompositeOperation = 'destination-out';
      ictx.drawImage(cnv, 0, 0);
      return inv;
    }
  }
  return cnv;
}
