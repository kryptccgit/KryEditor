import type { ShapeKind } from './timelineStore';

function star(points: number, outer: number, inner: number): number[] {
  const out: number[] = [];
  const cx = 0.5;
  const cy = 0.5;
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI * i) / points - Math.PI / 2;
    out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return out;
}

function heart(): number[] {
  const out: number[] = [];
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    out.push(0.5 + (x / 36) * 1.1, 0.5 - (y / 36) * 1.1);
  }
  return out;
}

export function polyPoints(kind: ShapeKind): number[] | null {
  switch (kind) {
    case 'triangle':
      return [0.5, 0, 1, 1, 0, 1];
    case 'star':
      return star(5, 0.5, 0.21);
    case 'arrow':
      return [0, 0.32, 0.58, 0.32, 0.58, 0.1, 1, 0.5, 0.58, 0.9, 0.58, 0.68, 0, 0.68];
    case 'heart':
      return heart();
    default:
      return null;
  }
}
