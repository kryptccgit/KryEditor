/// <reference lib="webworker" />
import { tokenTimestamps, type TimestampOutputs } from './whisperTimestamps';
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import ortMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import { modelCache } from './modelCache';

export interface CaptionWord {
  start: number;
  end: number;
  text: string;
}

export interface WorkerSegment {
  start: number;
  end: number;
  text: string;
  words?: CaptionWord[];
}

type InMessage = { type: 'init'; model: string; device: SpeechDevice; split?: boolean } | { type: 'run'; id: number; audio: Float32Array; offset: number };

export type SpeechDevice = 'webgpu' | 'wasm';

type OutMessage =
  | { type: 'status'; status: string }
  | { type: 'progress'; ratio: number }
  | { type: 'ready' }
  | { type: 'done'; id: number; segments: WorkerSegment[] }
  | { type: 'error'; id?: number; message: string };

const post = (m: OutMessage): void => self.postMessage(m);

function groupWords(words: CaptionWord[]): WorkerSegment[] {
  const MAX_CHARS = 42;
  const MAX_DUR = 5;
  const GAP = 0.8;
  const out: WorkerSegment[] = [];
  let cur: CaptionWord[] = [];
  const flush = (): void => {
    if (cur.length === 0) return;
    out.push({
      start: cur[0].start,
      end: Math.max(cur[cur.length - 1].end, cur[0].start + 0.3),
      text: cur.map((w) => w.text).join('').trim(),
      words: cur,
    });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length, 0);
    if (prev && (w.start - prev.end > GAP || chars + w.text.length > MAX_CHARS || w.end - cur[0].start > MAX_DUR)) flush();
    cur.push(w);
  }
  flush();
  return out;
}

function dedupe(segs: WorkerSegment[]): WorkerSegment[] {
  const out: WorkerSegment[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (prev && prev.text.trim().toLowerCase() === s.text.trim().toLowerCase()) {
      prev.end = s.end;
      continue;
    }
    out.push({ ...s });
  }
  return out;
}

type Asr = (input: Float32Array, options: object) => Promise<unknown>;

type ExtractFn = (out: TimestampOutputs, heads: number[][], frames?: number | null, precision?: number, inputIds?: number) => unknown;
interface WhisperModel {
  config: { decoder_layers: number; median_filter_width?: number };
  _extract_token_timestamps?: ExtractFn;
}

async function gpuHasF16(): Promise<boolean> {
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    return !!(await gpu?.requestAdapter())?.features.has('shader-f16');
  } catch {
    return false;
  }
}

function fastTimestamps(model: WhisperModel | undefined, Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown): void {
  const original = model?._extract_token_timestamps;
  if (!model || !original) return;
  model._extract_token_timestamps = function (this: WhisperModel, out, heads, frames = null, precision = 0.02, inputIds = 0) {
    try {
      const r = tokenTimestamps(out, heads, this.config.decoder_layers, this.config.median_filter_width ?? 7, frames, precision, inputIds);
      return new Tensor('float32', r.data, r.dims);
    } catch {
      return original.call(this, out, heads, frames, precision, inputIds);
    }
  };
}
let asr: Asr | null = null;
let language: string | null = null;

async function load(model: string, device: SpeechDevice, split = false): Promise<void> {
  const [repo, lang] = model.split('#');
  language = lang ?? null;
  post({ type: 'status', status: 'Loading speech model…' });
  const tf = await import('@huggingface/transformers');
  const { pipeline, env } = tf;
  env.allowLocalModels = false;
  env.useBrowserCache = false;
  env.useCustomCache = true;
  env.customCache = modelCache;
  caches?.delete('transformers-cache').catch(() => undefined);
  try {
    const wasm = (env.backends as { onnx?: { wasm?: Record<string, unknown> } })?.onnx?.wasm;
    if (wasm) {
      wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
      wasm.numThreads = 1;
    }
  } catch {
  }
  const large = /large/.test(repo);
  if (large && !(device === 'webgpu' && (await gpuHasF16()))) throw new Error("This graphics card can't run the large speech model (no fp16 support).");
  const pipe = (await pipeline('automatic-speech-recognition', repo, {
    dtype: large ? 'fp16' : 'fp32',
    device: device === 'webgpu' && split ? { encoder_model: 'webgpu', decoder_model_merged: 'wasm' } : device,
    progress_callback: (p: { status?: string; progress?: number }) => {
      if (p?.status === 'progress' && typeof p.progress === 'number') post({ type: 'progress', ratio: Math.max(0, Math.min(1, p.progress / 100)) });
    },
  })) as unknown as Asr & { model?: WhisperModel };
  fastTimestamps(pipe.model, tf.Tensor);
  asr = pipe;
}

async function run(audio: Float32Array, offset: number): Promise<WorkerSegment[]> {
  if (!asr) throw new Error('Speech model not loaded.');
  const common = { chunk_length_s: 30, stride_length_s: 5, no_repeat_ngram_size: 3, ...(language ? { language, task: 'transcribe' } : {}) };
  const shift = (segs: WorkerSegment[]): WorkerSegment[] =>
    segs.map((g) => ({ ...g, start: g.start + offset, end: g.end + offset, words: g.words?.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })) }));

  try {
    const out = (await asr(audio, { ...common, return_timestamps: 'word' })) as {
      chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
    };
    const words: CaptionWord[] = (out.chunks ?? [])
      .filter((c) => (c.text ?? '').trim().length > 0)
      .map((c) => ({ start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 0.3, text: c.text }));
    if (words.length > 0) return shift(dedupe(groupWords(words)));
  } catch (err) {
    console.warn('[captions] word-level timestamps unavailable, falling back to chunks', err);
  }

  const out = (await asr(audio, { ...common, return_timestamps: true })) as {
    text?: string;
    chunks?: Array<{ timestamp: [number, number | null]; text: string }>;
  };
  const raw: WorkerSegment[] = [];
  for (const ch of out.chunks ?? []) {
    const text = (ch.text ?? '').trim();
    if (!text) continue;
    const start = ch.timestamp?.[0] ?? 0;
    const end = ch.timestamp?.[1] ?? start + 2;
    raw.push({ start, end: Math.max(end, start + 0.3), text });
  }
  if (raw.length === 0 && out.text?.trim()) raw.push({ start: 0, end: Math.min(5, audio.length / 16000), text: out.text.trim() });
  return shift(dedupe(raw));
}

self.onmessage = async (e: MessageEvent<InMessage>): Promise<void> => {
  const m = e.data;
  if (m?.type === 'init') {
    try {
      await load(m.model, m.device ?? 'wasm', m.split);
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: (err as Error)?.message ?? String(err) });
    }
  } else if (m?.type === 'run') {
    try {
      post({ type: 'done', id: m.id, segments: await run(m.audio, m.offset) });
    } catch (err) {
      post({ type: 'error', id: m.id, message: (err as Error)?.message ?? String(err) });
    }
  }
};
