const FRAME = 2048;
const HOP_OUT = FRAME / 2;
const SEARCH = 448;
const SEARCH_STEP = 2;
const CORR = 192;

let hannCache: Float32Array | null = null;
function hann(): Float32Array {
  if (!hannCache) {
    hannCache = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) hannCache[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / FRAME));
  }
  return hannCache;
}

function bestOffset(ref: Float32Array, natural: number, nominal: number, inLen: number): number {
  const nat = Math.max(0, Math.min(inLen - CORR, natural));
  let best = nominal;
  let bestScore = -Infinity;
  for (let delta = -SEARCH; delta <= SEARCH; delta += SEARCH_STEP) {
    const cand = nominal + delta;
    if (cand < 0 || cand > inLen - FRAME) continue;
    let score = 0;
    for (let i = 0; i < CORR; i++) score += ref[nat + i] * ref[cand + i];
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

export function timeStretch(channels: Float32Array<ArrayBuffer>[], rate: number): Float32Array<ArrayBuffer>[] {
  if (channels.length === 0 || Math.abs(rate - 1) < 1e-3) return channels;
  const inLen = channels[0].length;
  if (inLen < FRAME * 2) return channels;
  const outLen = Math.max(1, Math.round(inLen / rate));
  const hopIn = HOP_OUT * rate;
  const ref = channels[0];
  const win = hann();
  const out = channels.map(() => new Float32Array(outLen + FRAME));

  let prevIn = 0;
  const nFrames = Math.ceil(outLen / HOP_OUT);
  for (let k = 0; k < nFrames; k++) {
    const outPos = k * HOP_OUT;
    let inPos = Math.round(k * hopIn);
    if (k > 0) inPos = bestOffset(ref, prevIn + HOP_OUT, inPos, inLen);
    inPos = Math.max(0, Math.min(inLen - FRAME, inPos));
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch];
      const dst = out[ch];
      for (let i = 0; i < FRAME; i++) dst[outPos + i] += src[inPos + i] * win[i];
    }
    prevIn = inPos;
  }
  return out.map((o) => o.slice(0, outLen));
}
