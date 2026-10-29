export interface LutDef {
  id: string;
  name: string;
  size: number;
  table: Float32Array;
}

const MAX_LUT_SIZE = 65;

export function parseCube(name: string, text: string): Omit<LutDef, 'id'> {
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values: number[] = [];
  let title = '';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) {
      title = line.slice(5).trim().replace(/^"|"$/g, '');
    } else if (up.startsWith('LUT_3D_SIZE')) {
      size = Number(line.split(/\s+/)[1]);
    } else if (up.startsWith('LUT_1D_SIZE')) {
      throw new Error(`${name}: 1D LUTs aren't supported — use a 3D .cube (LUT_3D_SIZE).`);
    } else if (up.startsWith('DOMAIN_MIN')) {
      domainMin = line.split(/\s+/).slice(1, 4).map(Number);
    } else if (up.startsWith('DOMAIN_MAX')) {
      domainMax = line.split(/\s+/).slice(1, 4).map(Number);
    } else if (/^[-\d.]/.test(line)) {
      const parts = line.split(/\s+/);
      if (parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE) {
    throw new Error(`${name}: missing or unsupported LUT_3D_SIZE (got ${size || 'none'}, supported 2–${MAX_LUT_SIZE}).`);
  }
  const expected = size * size * size * 3;
  if (values.length < expected) throw new Error(`${name}: expected ${expected / 3} entries for size ${size}, found ${values.length / 3}.`);
  const table = new Float32Array(expected);
  for (let i = 0; i < expected; i++) {
    const c = i % 3;
    const span = domainMax[c] - domainMin[c] || 1;
    const v = (values[i] - domainMin[c]) / span;
    table[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  }
  return { name: title || name.replace(/\.cube$/i, ''), size, table };
}

export function lutAtlasPixels(lut: Pick<LutDef, 'size' | 'table'>): Uint8Array {
  const N = lut.size;
  const out = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const src = (r + g * N + b * N * N) * 3;
        const dst = (g * N * N + b * N + r) * 4;
        out[dst] = Math.round(lut.table[src] * 255);
        out[dst + 1] = Math.round(lut.table[src + 1] * 255);
        out[dst + 2] = Math.round(lut.table[src + 2] * 255);
        out[dst + 3] = 255;
      }
    }
  }
  return out;
}

export function lutToBase64(table: Float32Array): string {
  const bytes = new Uint8Array(table.buffer, table.byteOffset, table.byteLength);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function lutFromBase64(b64: string): Float32Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export const LUT_VERT = `
attribute vec2 p;
varying vec2 v;
void main() {
  v = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

export const LUT_FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D u_tex;
uniform sampler2D u_lut;
uniform float u_size;
uniform float u_amount;

vec3 lutLookup(vec3 c) {
  float N = u_size;
  float b = c.b * (N - 1.0);
  float b0 = floor(b);
  float f = b - b0;
  float b1 = min(b0 + 1.0, N - 1.0);
  float y = (c.g * (N - 1.0) + 0.5) / N;
  float xr = c.r * (N - 1.0) + 0.5;
  vec2 uv0 = vec2((b0 * N + xr) / (N * N), y);
  vec2 uv1 = vec2((b1 * N + xr) / (N * N), y);
  return mix(texture2D(u_lut, uv0).rgb, texture2D(u_lut, uv1).rgb, f);
}

void main() {
  vec4 src = texture2D(u_tex, v);
  vec3 graded = lutLookup(clamp(src.rgb, 0.0, 1.0));
  gl_FragColor = vec4(mix(src.rgb, graded, u_amount), src.a);
}`;

type LutSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

class LutProcessor {
  private cnv = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private uSize: WebGLUniformLocation | null = null;
  private uAmount: WebGLUniformLocation | null = null;
  private srcTex: WebGLTexture | null = null;
  private lutTextures = new Map<string, WebGLTexture>();
  private ready = false;
  private failed = false;

  private init(): boolean {
    if (this.ready) return true;
    if (this.failed) return false;
    const gl = this.cnv.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true });
    if (!gl) {
      this.failed = true;
      return false;
    }
    const compile = (type: number, src: string): WebGLShader | null => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, LUT_VERT);
    const fs = compile(gl.FRAGMENT_SHADER, LUT_FRAG);
    const prog = vs && fs ? gl.createProgram() : null;
    if (!prog || !vs || !fs) {
      this.failed = true;
      return false;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.failed = true;
      return false;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.srcTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    setTexParams(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_tex'), 0);
    gl.uniform1i(gl.getUniformLocation(prog, 'u_lut'), 1);
    this.uSize = gl.getUniformLocation(prog, 'u_size');
    this.uAmount = gl.getUniformLocation(prog, 'u_amount');
    this.gl = gl;
    this.ready = true;
    return true;
  }

  private lutTexture(gl: WebGLRenderingContext, lut: LutDef): WebGLTexture | null {
    const hit = this.lutTextures.get(lut.id);
    if (hit) return hit;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    setTexParams(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lutAtlasPixels(lut));
    this.lutTextures.set(lut.id, tex);
    return tex;
  }

  render(src: LutSource, lut: LutDef, amount: number, w: number, h: number): HTMLCanvasElement | null {
    if (!this.init() || !this.gl) return null;
    const gl = this.gl;
    if (this.cnv.width !== w || this.cnv.height !== h) {
      this.cnv.width = w;
      this.cnv.height = h;
    }
    const lt = this.lutTexture(gl, lut);
    if (!lt) return null;
    gl.viewport(0, 0, w, h);
    try {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lt);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.uniform1f(this.uSize, lut.size);
      gl.uniform1f(this.uAmount, amount);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return this.cnv;
    } catch {
      return null;
    }
  }
}

function setTexParams(gl: WebGLRenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

let processor: LutProcessor | null = null;
export function getLutProcessor(): LutProcessor {
  processor ??= new LutProcessor();
  return processor;
}
