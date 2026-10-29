export const FX_VERT = `attribute vec2 p; varying vec2 v_uv; void main(){ v_uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

export const FX_FRAG = `precision highp float;
uniform sampler2D u_tex; uniform float u_time; uniform vec2 u_res; uniform int u_mode;
varying vec2 v_uv;
float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = v_uv;
  vec4 base = texture2D(u_tex, uv);
  vec3 col = base.rgb;
  if (u_mode == 6) {
    vec2 g = vec2(96.0, 96.0 * u_res.y / max(u_res.x, 1.0));
    col = texture2D(u_tex, (floor(uv * g) + 0.5) / g).rgb;
  } else if (u_mode == 1) {
    float t = floor(u_time * 12.0);
    float band = floor(uv.y * 28.0);
    float n = rand(vec2(band, t));
    float shift = step(0.82, n) * (rand(vec2(band, t + 7.0)) - 0.5) * 0.12;
    vec2 g = vec2(uv.x + shift, uv.y);
    float ca = 0.006 + step(0.82, n) * 0.012;
    col = vec3(texture2D(u_tex, g + vec2(ca, 0.0)).r, texture2D(u_tex, g).g, texture2D(u_tex, g - vec2(ca, 0.0)).b);
    col += (rand(uv * u_res + t) - 0.5) * 0.09;
  } else if (u_mode == 2) {
    float wob = sin(uv.y * 120.0 + u_time * 6.0) * 0.0016;
    vec2 g = vec2(uv.x + wob, uv.y);
    float ca = 0.0045;
    col = vec3(texture2D(u_tex, g + vec2(ca, 0.0)).r, texture2D(u_tex, g).g, texture2D(u_tex, g - vec2(ca, 0.0)).b);
    col *= 0.85 + 0.15 * sin(uv.y * u_res.y * 1.6);
    col += (rand(uv * u_res + floor(u_time * 30.0)) - 0.5) * 0.06;
    col *= smoothstep(0.95, 0.35, distance(uv, vec2(0.5)));
    col *= vec3(1.06, 1.0, 1.03);
  } else if (u_mode == 3) {
    float ca = 0.006;
    col = vec3(texture2D(u_tex, uv + vec2(ca, 0.0)).r, texture2D(u_tex, uv).g, texture2D(u_tex, uv - vec2(ca, 0.0)).b);
  } else if (u_mode == 4) {
    col *= 0.78 + 0.22 * sin(uv.y * u_res.y * 2.0);
    col *= smoothstep(1.05, 0.45, distance(uv, vec2(0.5)));
  } else if (u_mode == 5) {
    col += (rand(uv * u_res + floor(u_time * 24.0)) - 0.5) * 0.18;
    col *= 0.9 + 0.1 * rand(vec2(floor(u_time * 24.0), 3.0));
    col = mix(col, vec3(dot(col, vec3(0.39, 0.49, 0.2)), dot(col, vec3(0.35, 0.34, 0.17)), dot(col, vec3(0.27, 0.27, 0.13))), 0.22);
  }
  gl_FragColor = vec4(col, base.a);
}`;

export const FX_MODES: Record<string, number> = {
  glitch: 1,
  vhs: 2,
  chromatic: 3,
  scanlines: 4,
  grain: 5,
  pixelate: 6,
};

export function fxMode(effect: string): number {
  return FX_MODES[effect] ?? 0;
}

export function isShaderEffect(effect: string): boolean {
  return fxMode(effect) > 0;
}

export function makeFxProgram(gl: WebGLRenderingContext): WebGLProgram | null {
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const v = compile(gl.VERTEX_SHADER, FX_VERT);
  const f = compile(gl.FRAGMENT_SHADER, FX_FRAG);
  if (!v || !f) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

type FxSource = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement;

class FxProcessor {
  private cnv = document.createElement('canvas');
  private gl: WebGLRenderingContext | null = null;
  private uTime: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uMode: WebGLUniformLocation | null = null;
  private tex: WebGLTexture | null = null;
  private ready = false;
  private failed = false;

  private init(): boolean {
    if (this.ready) return true;
    if (this.failed) return false;
    const gl = this.cnv.getContext('webgl', { premultipliedAlpha: false, alpha: true, preserveDrawingBuffer: true });
    const prog = gl ? makeFxProgram(gl) : null;
    if (!gl || !prog) {
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
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.uTime = gl.getUniformLocation(prog, 'u_time');
    this.uRes = gl.getUniformLocation(prog, 'u_res');
    this.uMode = gl.getUniformLocation(prog, 'u_mode');
    this.gl = gl;
    this.ready = true;
    return true;
  }

  render(src: FxSource, mode: number, w: number, h: number, timeSec: number): HTMLCanvasElement | null {
    if (w <= 0 || h <= 0 || !this.init() || !this.gl) return null;
    const gl = this.gl;
    if (this.cnv.width !== w || this.cnv.height !== h) {
      this.cnv.width = w;
      this.cnv.height = h;
    }
    gl.viewport(0, 0, w, h);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      return null;
    }
    gl.uniform1f(this.uTime, timeSec);
    gl.uniform2f(this.uRes, w, h);
    gl.uniform1i(this.uMode, mode);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return this.cnv;
  }
}

let processor: FxProcessor | null = null;
export function getFxProcessor(): FxProcessor {
  if (!processor) processor = new FxProcessor();
  return processor;
}
