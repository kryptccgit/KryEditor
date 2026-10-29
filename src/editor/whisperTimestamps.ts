interface AttnTensor {
  dims: number[];
  data: Float32Array;
}

export interface TimestampOutputs {
  cross_attentions: AttnTensor[][];
  sequences: { dims: number[] };
}

const f32 = Math.fround;

function medianFilter(data: Float32Array, width: number): Float32Array {
  const out = new Float32Array(data.length);
  const buf = new Float32Array(width);
  const half = Math.floor(width / 2);
  const n = data.length;
  for (let i = 0; i < n; ++i) {
    let k = 0;
    for (let j = -half; j <= half; ++j) {
      let idx = i + j;
      if (idx < 0) idx = Math.abs(idx);
      else if (idx >= n) idx = 2 * (n - 1) - idx;
      buf[k++] = data[idx];
    }
    buf.sort();
    out[i] = buf[half];
  }
  return out;
}

function dtw(m: Float32Array, rows: number, cols: number): [number[], number[]] {
  const W = cols + 1;
  const cost = new Float64Array((rows + 1) * W).fill(Infinity);
  const trace = new Int8Array((rows + 1) * W).fill(-1);
  cost[0] = 0;
  for (let j = 1; j <= cols; ++j) {
    for (let i = 1; i <= rows; ++i) {
      const c0 = cost[(i - 1) * W + j - 1];
      const c1 = cost[(i - 1) * W + j];
      const c2 = cost[i * W + j - 1];
      let c: number;
      let t: number;
      if (c0 < c1 && c0 < c2) {
        c = c0;
        t = 0;
      } else if (c1 < c0 && c1 < c2) {
        c = c1;
        t = 1;
      } else {
        c = c2;
        t = 2;
      }
      cost[i * W + j] = m[(i - 1) * cols + j - 1] + c;
      trace[i * W + j] = t;
    }
  }
  for (let j = 0; j <= cols; ++j) trace[j] = 2;
  for (let i = 0; i <= rows; ++i) trace[i * W] = 1;
  let i = rows;
  let j = cols;
  const text: number[] = [];
  const time: number[] = [];
  while (i > 0 || j > 0) {
    text.push(i - 1);
    time.push(j - 1);
    const t = trace[i * W + j];
    if (t === 0) {
      --i;
      --j;
    } else if (t === 1) --i;
    else if (t === 2) --j;
    else throw new Error(`Internal error in dynamic time warping at ${i}, ${j}.`);
  }
  text.reverse();
  time.reverse();
  return [text, time];
}

export function tokenTimestamps(
  out: TimestampOutputs,
  alignmentHeads: number[][],
  decoderLayers: number,
  medianWidth: number,
  numFrames: number | null,
  timePrecision = 0.02,
  numInputIds = 0,
): { data: Float32Array; dims: number[] } {
  const steps = out.cross_attentions;
  if (!steps?.length) throw new Error('no cross attentions');
  const seqDims = out.sequences.dims;
  if (seqDims[0] !== 1) throw new Error('batch > 1');
  const first = steps[0][0];
  const F = first.dims[3];
  const nf = numFrames ? Math.min(numFrames, F) : F;
  const T = steps.reduce((s, layers) => s + layers[0].dims[2], 0);
  const H = alignmentHeads.length;

  const weights: Float32Array[] = alignmentHeads.map(([l, h]) => {
    if (l >= decoderLayers) throw new Error(`layer ${l} out of range`);
    const w = new Float32Array(T * nf);
    let row = 0;
    for (const layers of steps) {
      const x = layers[l];
      const [b, heads, s, f] = x.dims;
      if (b !== 1 || f !== F || h >= heads) throw new Error('unexpected attention shape');
      for (let r = 0; r < s; r++, row++) {
        const off = (h * s + r) * F;
        w.set(x.data.subarray(off, off + nf), row * nf);
      }
    }
    return w;
  });

  for (const w of weights) {
    const mean = new Float32Array(nf);
    for (let t = 0; t < T; t++) for (let f = 0; f < nf; f++) mean[f] = f32(mean[f] + w[t * nf + f]);
    for (let f = 0; f < nf; f++) mean[f] = f32(mean[f] / T);
    const std = new Float32Array(nf);
    for (let t = 0; t < T; t++) for (let f = 0; f < nf; f++) std[f] = f32(std[f] + (w[t * nf + f] - mean[f]) ** 2);
    for (let f = 0; f < nf; f++) std[f] = f32(Math.sqrt(std[f] / T));
    for (let t = 0; t < T; t++) {
      const rowData = w.subarray(t * nf, (t + 1) * nf);
      for (let f = 0; f < nf; f++) rowData[f] = (rowData[f] - mean[f]) / std[f];
      rowData.set(medianFilter(rowData, medianWidth));
    }
  }

  const rows = T - numInputIds;
  const avg = new Float32Array(rows * nf);
  for (const w of weights) for (let i = 0; i < rows * nf; i++) avg[i] = f32(avg[i] + w[numInputIds * nf + i]);
  for (let i = 0; i < avg.length; i++) avg[i] = -f32(avg[i] / H);

  const [text, time] = dtw(avg, rows, nf);
  const jumpTimes: number[] = [];
  for (let i = 0; i < text.length; i++) if (i === 0 || text[i] - text[i - 1] !== 0) jumpTimes.push(time[i] * timePrecision);
  const data = new Float32Array(seqDims[0] * seqDims[1]);
  const padded = new Array<number>(numInputIds).fill(0);
  padded.push(...jumpTimes);
  if (jumpTimes.length > 0) padded.push(jumpTimes[jumpTimes.length - 1]);
  data.set(padded);
  return { data, dims: seqDims };
}
