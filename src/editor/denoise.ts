const FRAME = 1024;
const HOP = FRAME / 4;
const NOISE_PCT = 0.2;
const OVERSUB = 2.5;
const GAIN_FLOOR = 0.12;
const SMOOTH = 0.6;

let hannCache: Float32Array | null = null;
function hann(): Float32Array {
  if (!hannCache) {
    hannCache = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) hannCache[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FRAME));
  }
  return hannCache;
}

function fft(re: Float32Array, im: Float32Array, invert: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((invert ? 1 : -1) * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + len / 2] * cwr - im[i + j + len / 2] * cwi;
        const vi = re[i + j + len / 2] * cwi + im[i + j + len / 2] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
  if (invert) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function denoiseChannel(input: Float32Array, strength = 1): Float32Array {
  const n = input.length;
  if (n < FRAME * 4 || strength <= 0) return input.slice();
  const win = hann();
  const frames = Math.floor((n - FRAME) / HOP) + 1;
  const bins = FRAME / 2 + 1;

  const mags = new Float32Array(frames * bins);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = input[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let b = 0; b < bins; b++) mags[f * bins + b] = Math.hypot(re[b], im[b]);
  }
  const noise = new Float32Array(bins);
  const column = new Float32Array(frames);
  for (let b = 0; b < bins; b++) {
    for (let f = 0; f < frames; f++) column[f] = mags[f * bins + b];
    column.sort();
    noise[b] = column[Math.floor(frames * NOISE_PCT)] * OVERSUB * strength;
  }

  const out = new Float32Array(n);
  const norm = new Float32Array(n);
  const gain = new Float32Array(bins).fill(1);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = input[off + i] * win[i];
      im[i] = 0;
    }
    fft(re, im, false);
    for (let b = 0; b < bins; b++) {
      const mag = mags[f * bins + b];
      const g = mag > 1e-9 ? Math.max(GAIN_FLOOR, Math.min(1, (mag - noise[b]) / mag)) : GAIN_FLOOR;
      gain[b] = g < gain[b] ? SMOOTH * gain[b] + (1 - SMOOTH) * g : g;
      const gg = gain[b];
      re[b] *= gg;
      im[b] *= gg;
      if (b > 0 && b < bins - 1) {
        re[FRAME - b] *= gg;
        im[FRAME - b] *= gg;
      }
    }
    fft(re, im, true);
    for (let i = 0; i < FRAME; i++) {
      out[off + i] += re[i] * win[i];
      norm[off + i] += win[i] * win[i];
    }
  }
  for (let i = 0; i < n; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : input[i];
  return out;
}
