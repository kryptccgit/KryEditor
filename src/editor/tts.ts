import { fmtBytes } from '../utils/format';

const KOKORO_VOICES: Array<[id: string, name: string, about: string]> = [
  ['af_heart', 'Heart', 'US female, warm'],
  ['af_bella', 'Bella', 'US female, bright'],
  ['af_nicole', 'Nicole', 'US female, soft'],
  ['af_aoede', 'Aoede', 'US female'],
  ['af_kore', 'Kore', 'US female'],
  ['af_sarah', 'Sarah', 'US female'],
  ['af_alloy', 'Alloy', 'US female'],
  ['af_nova', 'Nova', 'US female'],
  ['af_sky', 'Sky', 'US female'],
  ['af_jessica', 'Jessica', 'US female'],
  ['af_river', 'River', 'US female'],
  ['am_michael', 'Michael', 'US male'],
  ['am_fenrir', 'Fenrir', 'US male, deep'],
  ['am_puck', 'Puck', 'US male, lively'],
  ['am_echo', 'Echo', 'US male'],
  ['am_eric', 'Eric', 'US male'],
  ['am_liam', 'Liam', 'US male'],
  ['am_onyx', 'Onyx', 'US male, low'],
  ['am_adam', 'Adam', 'US male'],
  ['am_santa', 'Santa', 'US male, jolly'],
  ['bf_emma', 'Emma', 'UK female'],
  ['bf_isabella', 'Isabella', 'UK female'],
  ['bf_alice', 'Alice', 'UK female'],
  ['bf_lily', 'Lily', 'UK female'],
  ['bm_george', 'George', 'UK male'],
  ['bm_fable', 'Fable', 'UK male'],
  ['bm_lewis', 'Lewis', 'UK male'],
  ['bm_daniel', 'Daniel', 'UK male'],
];

const KOKORO = 'kokoro:';

export const TTS_VOICES: Array<{ label: string; value: string }> = [
  ...KOKORO_VOICES.map(([id, name, about]) => ({ label: `${name} (${about})`, value: KOKORO + id })),
  { label: 'Spanish', value: 'Xenova/mms-tts-spa' },
  { label: 'French', value: 'Xenova/mms-tts-fra' },
  { label: 'German', value: 'Xenova/mms-tts-deu' },
  { label: 'Portuguese', value: 'Xenova/mms-tts-por' },
  { label: 'Korean', value: 'Xenova/mms-tts-kor' },
];

export interface SynthesizeOptions {
  model?: string;
  onStatus?: (status: string) => void;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

type Synthesized = { audio: Float32Array; sampleRate: number };

export function synthesize(text: string, opts: SynthesizeOptions = {}): Promise<Synthesized> {
  const model = opts.model ?? TTS_VOICES[0].value;
  return model.startsWith(KOKORO) ? kokoroSynthesize(text, model.slice(KOKORO.length), opts) : mmsSynthesize(text, model, opts);
}

function mmsSynthesize(text: string, model: string, opts: SynthesizeOptions): Promise<Synthesized> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ttsWorker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      worker.terminate();
      fn();
    };
    const onAbort = (): void => finish(() => reject(new Error('Speech generation cancelled.')));
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<{ type: string; status?: string; ratio?: number; audio?: Float32Array; sampleRate?: number; message?: string }>) => {
      const m = e.data;
      if (m.type === 'status' && m.status) opts.onStatus?.(m.status);
      else if (m.type === 'progress' && typeof m.ratio === 'number') opts.onProgress?.(m.ratio);
      else if (m.type === 'done' && m.audio && m.sampleRate) finish(() => resolve({ audio: m.audio!, sampleRate: m.sampleRate! }));
      else if (m.type === 'error') finish(() => reject(new Error(m.message ?? 'Speech generation failed. Check your internet connection (the voice downloads on first use).')));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'The speech worker crashed.')));
    worker.postMessage({ type: 'run', text, model });
  });
}

const CANCELLED = 'Speech generation cancelled.';

const STAGES: Record<string, string> = {
  downloading: 'Downloading voice model (first use only)…',
  copying: 'Copying voice model from Krypt Studio…',
  verifying: 'Checking voice model…',
};

let kokoroWorker: Worker | null = null;
let kokoroQueue: Promise<unknown> = Promise.resolve();

const kokoroWorkerFor = (): Worker => (kokoroWorker ??= new Worker(new URL('./kokoro/kokoroWorker.ts', import.meta.url), { type: 'module' }));

export async function warmUpVoice(model: string = TTS_VOICES[0].value): Promise<void> {
  if (!model.startsWith(KOKORO) || !window.krypt?.tts) return;
  try {
    if (!(await window.krypt.tts.kokoroStatus()).installed) return;
    const r = await window.krypt.tts.kokoroEnsure();
    const voiceUrl = r.data?.voices[model.slice(KOKORO.length)];
    if (r.ok && r.data && voiceUrl) kokoroWorkerFor().postMessage({ type: 'warm', modelUrl: r.data.model, voiceUrl });
  } catch {
  }
}

function kokoroSynthesize(text: string, voice: string, opts: SynthesizeOptions): Promise<Synthesized> {
  const job = (): Promise<Synthesized> => kokoroRun(text, voice, opts);
  const p = kokoroQueue.then(job, job);
  kokoroQueue = p.catch(() => undefined);
  return p;
}

async function kokoroRun(text: string, voice: string, opts: SynthesizeOptions): Promise<Synthesized> {
  if (opts.signal?.aborted) throw new Error(CANCELLED);
  const api = window.krypt.tts;
  const status = await api.kokoroStatus();
  if (!status.installed) opts.onStatus?.(status.downloadBytes > 0 ? `Downloading voice model (${fmtBytes(status.downloadBytes)}, first use only)…` : STAGES.copying);
  const off = api.onKokoroProgress((p) => {
    opts.onStatus?.(STAGES[p.stage] ?? STAGES.downloading);
    opts.onProgress?.(p.total > 0 ? p.done / p.total : 0);
  });
  const onAbort = (): void => void api.kokoroCancel();
  opts.signal?.addEventListener('abort', onAbort);
  let urls: Awaited<ReturnType<typeof api.kokoroEnsure>>;
  try {
    urls = await api.kokoroEnsure();
  } finally {
    off();
    opts.signal?.removeEventListener('abort', onAbort);
  }
  if (opts.signal?.aborted) throw new Error(CANCELLED);
  if (!urls.ok || !urls.data) throw new Error(urls.message ?? 'Could not install the voice model.');
  const voiceUrl = urls.data.voices[voice];
  if (!voiceUrl) throw new Error(`Unknown voice "${voice}".`);
  const modelUrl = urls.data.model;

  return new Promise((resolve, reject) => {
    const worker = kokoroWorkerFor();
    let settled = false;
    const finish = (fn: () => void, kill = false): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onCancel);
      worker.onmessage = null;
      worker.onerror = null;
      if (kill) {
        worker.terminate();
        if (kokoroWorker === worker) kokoroWorker = null;
      }
      fn();
    };
    const onCancel = (): void => finish(() => reject(new Error(CANCELLED)), true);
    opts.signal?.addEventListener('abort', onCancel);
    worker.onmessage = (e: MessageEvent<{ type: string; status?: string; ratio?: number; audio?: Float32Array; sampleRate?: number; message?: string }>) => {
      const m = e.data;
      if (m.type === 'status' && m.status) opts.onStatus?.(m.status);
      else if (m.type === 'progress' && typeof m.ratio === 'number') opts.onProgress?.(m.ratio);
      else if (m.type === 'done' && m.audio && m.sampleRate) finish(() => resolve({ audio: m.audio!, sampleRate: m.sampleRate! }));
      else if (m.type === 'error') finish(() => reject(new Error(m.message ?? 'Speech generation failed.')));
    };
    worker.onerror = (e) => finish(() => reject(new Error(e.message || 'The speech worker crashed.')), true);
    worker.postMessage({ type: 'run', text, speed: 1, modelUrl, voiceUrl });
  });
}

export function encodeWavPcm16(audio: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = audio.length * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, dataLen, true);
  for (let i = 0; i < audio.length; i++) {
    const s = Math.max(-1, Math.min(1, audio[i]));
    dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}
