export const LOUDNESS_TARGETS: Array<{ label: string; value: number | null; hint: string }> = [
  { label: 'Off', value: null, hint: 'Leave the mix as it is' },
  { label: '−14 LUFS', value: -14, hint: 'YouTube, Spotify, TikTok' },
  { label: '−16 LUFS', value: -16, hint: 'Podcasts, Apple' },
  { label: '−23 LUFS', value: -23, hint: 'Broadcast (EBU R128)' },
];

export const PEAK_CEILING_DB = -1;
export const CEILING_BY_QUALITY: Record<'low' | 'medium' | 'high', number> = { low: -3.5, medium: -3, high: -1.5 };
export const MAX_BOOST_DB = 20;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

function kWeighting(fs: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = Math.pow(10, G / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = { b0: (Vh + (Vb * K) / Q + K * K) / a0, b1: (2 * (K * K - Vh)) / a0, b2: (Vh - (Vb * K) / Q + K * K) / a0, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = { b0: 1, b1: -2, b2: 1, a1: (2 * (K * K - 1)) / a0, a2: (1 - K / Q + K * K) / a0 };
  return [shelf, hp];
}

export function integratedLoudness(channels: Float32Array[], sampleRate: number): number {
  const hop = Math.round(sampleRate * 0.1);
  const n = channels[0]?.length ?? 0;
  const subs = Math.floor(n / hop);
  if (subs < 4) return -Infinity;
  const sub = new Float64Array(subs);
  const [s, h] = kWeighting(sampleRate);
  for (const x of channels) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < subs * hop; i++) {
      const x0 = x[i];
      const y0 = s.b0 * x0 + s.b1 * x1 + s.b2 * x2 - s.a1 * y1 - s.a2 * y2;
      const z0 = h.b0 * y0 + h.b1 * y1 + h.b2 * y2 - h.a1 * z1 - h.a2 * z2;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
      z2 = z1;
      z1 = z0;
      sub[(i / hop) | 0] += z0 * z0;
    }
  }
  const blockLen = hop * 4;
  const blocks = new Float64Array(subs - 3);
  for (let k = 0; k < blocks.length; k++) blocks[k] = (sub[k] + sub[k + 1] + sub[k + 2] + sub[k + 3]) / blockLen;
  const lufs = (z: number): number => -0.691 + 10 * Math.log10(z);
  const mean = (keep: (z: number) => boolean): number => {
    let sum = 0;
    let count = 0;
    for (const z of blocks) {
      if (z > 0 && keep(z)) {
        sum += z;
        count++;
      }
    }
    return count ? sum / count : 0;
  };
  const absMean = mean((z) => lufs(z) > -70);
  if (absMean <= 0) return -Infinity;
  const rel = lufs(absMean) - 10;
  const gated = mean((z) => lufs(z) > -70 && lufs(z) > rel);
  return gated > 0 ? lufs(gated) : -Infinity;
}

export function peakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const x of channels) for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

export function applyGainLimited(channels: Float32Array[], sampleRate: number, gain: number, ceiling: number): number {
  const n = channels[0]?.length ?? 0;
  const B = Math.max(1, Math.round(sampleRate / 1000));
  const nb = Math.ceil(n / B);
  const need = new Float32Array(nb).fill(1);
  for (const x of channels) {
    for (let k = 0; k < nb; k++) {
      let p = 0;
      const end = Math.min(n, (k + 1) * B);
      for (let i = k * B; i < end; i++) {
        p = Math.max(p, Math.abs(x[i]));
        if (i > 0 && i + 2 < n) p = Math.max(p, Math.abs((9 * (x[i] + x[i + 1]) - x[i - 1] - x[i + 2]) / 16));
      }
      const g = p * gain > ceiling ? ceiling / (p * gain) : 1;
      if (g < need[k]) need[k] = g;
    }
  }
  const ahead = 5;
  const release = Math.exp(-1 / 80);
  const env = new Float32Array(nb + 1);
  let g = 1;
  let deepest = 1;
  for (let k = 0; k < nb; k++) {
    let m = 1;
    for (let j = Math.max(0, k - 1); j <= Math.min(nb - 1, k + ahead); j++) if (need[j] < m) m = need[j];
    g = m < g ? m : m - (m - g) * release;
    env[k] = g;
    if (g < deepest) deepest = g;
  }
  env[nb] = env[nb - 1] ?? 1;
  for (const x of channels) {
    for (let i = 0; i < n; i++) {
      const k = (i / B) | 0;
      const r = (i - k * B) / B;
      const lim = Math.min(env[k] + (env[k + 1] - env[k]) * r, need[k]);
      x[i] *= gain * lim;
    }
  }
  return 20 * Math.log10(deepest);
}

export interface LoudnessResult {
  before: number;
  after: number;
  gainDb: number;
  limitedDb: number;
}

export function normalizeLoudness(channels: Float32Array[], sampleRate: number, target: number, ceilingDb = PEAK_CEILING_DB): LoudnessResult | null {
  const before = integratedLoudness(channels, sampleRate);
  if (!Number.isFinite(before)) return null;
  const ceiling = Math.pow(10, ceilingDb / 20);
  let gainDb = Math.min(MAX_BOOST_DB, target - before);
  let limitedDb = applyGainLimited(channels, sampleRate, Math.pow(10, gainDb / 20), ceiling);
  let after = integratedLoudness(channels, sampleRate);
  for (let pass = 0; pass < 2; pass++) {
    const more = Math.min(MAX_BOOST_DB - gainDb, target - after);
    if (more <= 0.1) break;
    limitedDb = Math.min(limitedDb, applyGainLimited(channels, sampleRate, Math.pow(10, more / 20), ceiling));
    gainDb += more;
    after = integratedLoudness(channels, sampleRate);
  }
  return { before, after, gainDb, limitedDb };
}
