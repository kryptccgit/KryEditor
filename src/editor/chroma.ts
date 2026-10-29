export function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 1, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function chroma(r: number, g: number, b: number): [number, number] {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [(b - y) * 0.565, (r - y) * 0.713];
}

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
function scratchOf(w: number, h: number): { cnv: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null } {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
  }
  if (scratch.width !== w) scratch.width = w;
  if (scratch.height !== h) scratch.height = h;
  return { cnv: scratch, ctx: scratchCtx };
}

export function keyFrame(
  src: CanvasImageSource & { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number },
  color: string,
  sim: number,
  smooth: number,
): HTMLCanvasElement {
  const w = (src.naturalWidth as number) || (src.width as number) || 1;
  const h = (src.naturalHeight as number) || (src.height as number) || 1;
  const { cnv, ctx } = scratchOf(w, h);
  if (!ctx) return cnv;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [kr, kg, kb] = hexToRgb01(color);
  const [kcb, kcr] = chroma(kr, kg, kb);
  const edge = smooth + 0.001;
  for (let i = 0; i < d.length; i += 4) {
    const [cb, cr] = chroma(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    let a = (Math.hypot(cb - kcb, cr - kcr) - sim) / edge;
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    a = a * a * (3 - 2 * a);
    d[i + 3] = Math.round(d[i + 3] * a);
  }
  ctx.putImageData(img, 0, 0);
  return cnv;
}

export const CHROMA_VERT = `attribute vec2 p; varying vec2 v_uv; void main(){ v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

export const CHROMA_FRAG = `precision mediump float;
uniform sampler2D u_tex; uniform vec3 u_key; uniform float u_sim; uniform float u_smooth; varying vec2 v_uv;
vec2 cc(vec3 c){ float y = 0.299*c.r + 0.587*c.g + 0.114*c.b; return vec2((c.b - y) * 0.565, (c.r - y) * 0.713); }
void main(){
  vec4 col = texture2D(u_tex, v_uv);
  float dist = distance(cc(col.rgb), cc(u_key));
  float a = smoothstep(u_sim, u_sim + u_smooth + 0.001, dist);
  gl_FragColor = vec4(col.rgb, a);
}`;
