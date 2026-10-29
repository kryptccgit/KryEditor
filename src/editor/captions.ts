import type { MediaFile } from '@shared/types';
import type { Clip, MediaClip } from './timelineStore';
import type { CaptionWord, SpeechDevice, WorkerSegment } from './captionWorker';
import { decodeMono } from './audioDecode';

export type { CaptionWord } from './captionWorker';

export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
  words?: CaptionWord[];
}

export interface SpeechModel {
  label: string;
  value: string;
  gpu?: boolean;
}

export const CAPTION_MODELS: SpeechModel[] = [
  { label: 'English (fast)', value: 'Xenova/whisper-base.en' },
  { label: 'Multilingual (fast)', value: 'Xenova/whisper-base' },
  { label: 'English (accurate)', value: 'onnx-community/whisper-large-v3-turbo_timestamped#en', gpu: true },
  { label: 'Multilingual (accurate)', value: 'onnx-community/whisper-large-v3-turbo_timestamped', gpu: true },
];

const ACCURATE_F32 = ['onnx-community/whisper-small.en_timestamped', 'onnx-community/whisper-small_timestamped'];

export const isGpuModel = (model: string): boolean => !!CAPTION_MODELS.find((m) => m.value === model)?.gpu;

export const offeredModels = (): SpeechModel[] => CAPTION_MODELS.filter((m) => !m.gpu || (gpuAvailable !== false && !gpuFailed));

export const modelHint = (model: string): string =>
  isGpuModel(model)
    ? `Fewer missed words. Downloads ${/large/.test(model) ? '1.6 GB' : '1 GB'} once, runs on your graphics card.`
    : 'Quick, ~300 MB download. Pick accurate for difficult audio.';

export const accurateModelName = (): string => (/large/.test(CAPTION_MODELS[2].value) ? 'Whisper large-v3-turbo · 1.6 GB' : 'Whisper small · 1 GB');

let gpuProbe: Promise<boolean> | null = null;
export let gpuAvailable: boolean | null = null;
let gpuFailed = false;

export function hasWebGpu(): Promise<boolean> {
  gpuProbe ??= (async () => {
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(o?: object): Promise<{ features: Set<string> } | null> } }).gpu;
      const adapter = gpu && (await gpu.requestAdapter({ powerPreference: 'high-performance' }));
      if (!adapter) return false;
      if (!adapter.features.has('shader-f16')) ACCURATE_F32.forEach((value, i) => (CAPTION_MODELS[2 + i].value = value));
      return true;
    } catch {
      return false;
    }
  })().then((ok) => (gpuAvailable = ok));
  return gpuProbe;
}

export type SpeechAccuracy = 'fast' | 'accurate';
const ACCURACY_KEY = 'krypt.speech.accuracy';

export function speechAccuracy(): SpeechAccuracy {
  try {
    return localStorage.getItem(ACCURACY_KEY) === 'accurate' ? 'accurate' : 'fast';
  } catch {
    return 'fast';
  }
}

export function setSpeechAccuracy(a: SpeechAccuracy): void {
  try {
    localStorage.setItem(ACCURACY_KEY, a);
  } catch {
  }
}

export function speechModelFor(lang: 'english' | 'multilingual' = 'english', accuracy: SpeechAccuracy = speechAccuracy()): string {
  const accurate = accuracy === 'accurate' && gpuAvailable !== false && !gpuFailed;
  return CAPTION_MODELS[(lang === 'multilingual' ? 1 : 0) + (accurate ? 2 : 0)].value;
}

export interface TranscribeOptions {
  model?: string;
  onStatus?: (status: string) => void;
  onProgress?: (ratio: number) => void;
  signal?: AbortSignal;
}

const isMediaClip = (c: Clip): c is MediaClip => c.type === 'media';

export function captionSources(clips: Clip[], media: MediaFile[]): MediaClip[] {
  const mediaById = new Map(media.map((m) => [m.id, m]));
  return clips.filter(
    (c): c is MediaClip =>
      isMediaClip(c) && !c.muted && c.freezeAt == null && c.volume > 0 && (mediaById.get(c.mediaId)?.kind === 'video' || mediaById.get(c.mediaId)?.kind === 'audio'),
  );
}

export async function extractAudioMono16k(clips: Clip[], media: MediaFile[], total: number): Promise<Float32Array | null> {
  const mediaById = new Map(media.map((m) => [m.id, m]));
  const contributors = captionSources(clips, media);
  if (contributors.length === 0 || total <= 0) return null;

  const sampleRate = 16000;
  const octx = new OfflineAudioContext(1, Math.ceil(total * sampleRate), sampleRate);
  const spans = new Map<string, [number, number]>();
  for (const c of contributors) {
    const [a, b] = spans.get(c.mediaId) ?? [Infinity, -Infinity];
    spans.set(c.mediaId, [Math.min(a, c.inPoint), Math.max(b, c.inPoint + c.duration * c.speed)]);
  }
  const decoded = new Map<string, { buf: AudioBuffer; off: number } | null>();
  for (const [id, [a, b]] of spans) {
    const m = mediaById.get(id);
    const off = Math.max(0, a - 0.5);
    try {
      const pcm = m ? await decodeMono(m.mediaUrl, sampleRate, { start: off, end: b + 0.5 }) : null;
      if (!pcm) throw new Error('no audio');
      const buf = octx.createBuffer(1, pcm.length, sampleRate);
      buf.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      decoded.set(id, { buf, off });
    } catch {
      decoded.set(id, null);
    }
  }

  for (const c of contributors) {
    const d = decoded.get(c.mediaId);
    if (!d) continue;
    const node = octx.createBufferSource();
    node.buffer = d.buf;
    node.playbackRate.value = c.speed;
    node.connect(octx.destination);
    node.start(c.start, Math.max(0, c.inPoint - d.off), c.duration * c.speed);
  }

  const rendered = await octx.startRendering();
  return rendered.getChannelData(0).slice();
}

const SR = 16000;

export function planSlices(audio: Float32Array, target: number, search = 5, sampleRate = SR): number[] {
  const n = audio.length;
  const count = Math.max(1, Math.round(n / sampleRate / Math.max(1, target)));
  if (count <= 1) return [0, n];
  const hop = Math.round(sampleRate / 10);
  const frames = Math.floor(n / hop);
  const energy = (f: number): number => {
    let s = 0;
    for (let i = f * hop, e = Math.min(n, i + hop); i < e; i++) s += audio[i] * audio[i];
    return s;
  };
  const win = Math.round(search * 10);
  const minGap = Math.max(1, Math.round(frames / count / 3));
  const pts = [0];
  let lastFrame = 0;
  for (let k = 1; k < count; k++) {
    const centre = Math.round((frames * k) / count);
    const lo = Math.max(lastFrame + minGap, centre - win);
    const hi = Math.min(frames - minGap, centre + win);
    if (hi <= lo) continue;
    let best = lo;
    let bestE = Infinity;
    for (let f = lo; f < hi; f++) {
      const e = energy(f);
      if (e < bestE) {
        bestE = e;
        best = f;
      }
    }
    pts.push(best * hop + (hop >> 1));
    lastFrame = best;
  }
  pts.push(n);
  return pts;
}

export const SKIP_MIN = 2.5;
export const SKIP_PAD = 0.5;

export function speechRanges(audio: Float32Array, sampleRate = SR): Array<[number, number]> {
  const n = audio.length;
  const hop = Math.round(sampleRate / 10);
  const frames = Math.floor(n / hop);
  if (frames < 2) return n > 0 ? [[0, n]] : [];
  const db = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let acc = 0;
    for (let i = f * hop, e = i + hop; i < e; i++) acc += audio[i] * audio[i];
    const rms = Math.sqrt(acc / hop);
    db[f] = rms > 1e-5 ? 20 * Math.log10(rms) : -100;
  }
  const audible = Array.from(db).filter((d) => d > -90).sort((a, b) => a - b);
  if (audible.length === 0) return [];
  const ref = audible[Math.min(audible.length - 1, Math.floor(audible.length * 0.95))];
  const quiet = Math.min(-55, ref - 35);
  const minRun = Math.round(SKIP_MIN * 10);
  const pad = Math.round(SKIP_PAD * 10);
  const kept: Array<[number, number]> = [];
  const lastFrame = Math.ceil(n / hop);
  let keepFrom = 0;
  let removed = 0;
  let f = 0;
  while (f < frames) {
    if (db[f] >= quiet) {
      f++;
      continue;
    }
    const runStart = f;
    while (f < frames && db[f] < quiet) f++;
    if (f - runStart < minRun) continue;
    const cutA = runStart === 0 ? 0 : runStart + pad;
    const cutB = f === frames ? lastFrame : f - pad;
    if (cutA * hop > keepFrom) kept.push([keepFrom, cutA * hop]);
    keepFrom = Math.min(n, cutB * hop);
    removed += cutB - cutA;
  }
  if (keepFrom < n) kept.push([keepFrom, n]);
  if (removed * hop < n * 0.1) return [[0, n]];
  return kept.filter(([a, b]) => b > a);
}

export interface TimePiece {
  from: number;
  to: number;
  at: number;
}

export function compactRanges(audio: Float32Array, ranges: Array<[number, number]>, sampleRate = SR): { audio: Float32Array; pieces: TimePiece[] } {
  if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === audio.length) return { audio, pieces: [{ from: 0, to: audio.length / sampleRate, at: 0 }] };
  const total = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const out = new Float32Array(total);
  const pieces: TimePiece[] = [];
  let w = 0;
  for (const [a, b] of ranges) {
    out.set(audio.subarray(a, b), w);
    pieces.push({ from: a / sampleRate, to: b / sampleRate, at: w / sampleRate });
    w += b - a;
  }
  return { audio: out, pieces };
}

export function sourceTime(pieces: TimePiece[], t: number): number {
  let lo = 0;
  let hi = pieces.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pieces[mid].at <= t) lo = mid;
    else hi = mid - 1;
  }
  const p = pieces[lo];
  return Math.min(p.to, p.from + Math.max(0, t - p.at));
}

export function restoreTimes(segs: CaptionSegment[], pieces: TimePiece[]): CaptionSegment[] {
  if (pieces.length === 1 && pieces[0].from === 0 && pieces[0].at === 0) return segs;
  const out: CaptionSegment[] = [];
  for (const s of segs) {
    if (!s.words?.length) {
      const start = sourceTime(pieces, s.start);
      out.push({ ...s, start, end: Math.max(start + 0.3, sourceTime(pieces, s.end)) });
      continue;
    }
    let cur: CaptionWord[] = [];
    const flush = (): void => {
      if (cur.length === 0) return;
      out.push({ start: cur[0].start, end: Math.max(cur[cur.length - 1].end, cur[0].start + 0.3), text: cur.map((w) => w.text).join('').trim(), words: cur });
      cur = [];
    };
    for (const w of s.words) {
      const start = sourceTime(pieces, w.start);
      const word = { ...w, start, end: Math.max(start, sourceTime(pieces, w.end)) };
      const prev = cur[cur.length - 1];
      if (prev && word.start - prev.end > 0.8) flush();
      cur.push(word);
    }
    flush();
  }
  return out;
}

export function poolSize(cores: number, memoryGb: number): number {
  let k = Math.max(1, Math.min(8, Math.floor(cores / 2)));
  if (memoryGb < 8) k = Math.min(k, 4);
  if (memoryGb < 4) k = Math.min(k, 2);
  return k;
}

function fmtEta(s: number): string {
  if (s < 60) return 'under a minute left';
  const m = Math.round(s / 60);
  return `about ${m} min left`;
}

type WorkerOut = { type: string; status?: string; ratio?: number; id?: number; segments?: WorkerSegment[]; message?: string };

export async function transcribe(audio: Float32Array, opts: TranscribeOptions = {}): Promise<CaptionSegment[]> {
  const model = opts.model ?? speechModelFor();
  const gpu = !gpuFailed && (await hasWebGpu());
  if (!gpu && isGpuModel(model)) throw new Error('The accurate speech model needs a graphics card (WebGPU). Pick a fast model instead.');
  const kept = speechRanges(audio);
  if (kept.length === 0) return [];
  const { audio: compact, pieces } = compactRanges(audio, kept);
  const run = (device: SpeechDevice) => runPool(compact, model, device, opts).then((segs) => restoreTimes(segs, pieces));
  if (!gpu) return run('wasm');
  try {
    return await run('webgpu');
  } catch (err) {
    if (!(err as PoolError).beforeReady || isGpuModel(model) || opts.signal?.aborted) throw err;
    console.warn('[captions] WebGPU failed, transcribing on the CPU', err);
    gpuFailed = true;
    return run('wasm');
  }
}

type PoolError = Error & { beforeReady?: boolean };

function runPool(audio: Float32Array, model: string, device: SpeechDevice, opts: TranscribeOptions): Promise<CaptionSegment[]> {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cpu = poolSize(nav.hardwareConcurrency || 4, nav.deviceMemory ?? 8);
  const maxWorkers = device === 'webgpu' ? 2 : cpu;
  const split = device === 'webgpu' && /base/.test(model);
  const secs = audio.length / SR;
  const target = Math.max(30, Math.min(120, secs / (maxWorkers * 3)));
  const bounds = planSlices(audio, target);
  const jobs = bounds.slice(0, -1).map((a, i) => ({ id: i, a, b: bounds[i + 1] }));
  const workerCount = Math.min(maxWorkers, jobs.length);

  return new Promise((resolve, reject) => {
    const workers: Worker[] = [];
    const results: WorkerSegment[][] = new Array(jobs.length);
    let next = 0;
    let doneSamples = 0;
    let doneJobs = 0;
    let started = 0;
    let alive = 0;
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      for (const w of workers) w.terminate();
      fn();
    };
    const onAbort = (): void => finish(() => reject(new Error('Transcription cancelled.')));
    if (opts.signal?.aborted) {
      onAbort();
      return;
    }
    opts.signal?.addEventListener('abort', onAbort);

    const report = (): void => {
      const ratio = doneSamples / Math.max(1, audio.length);
      const elapsed = (performance.now() - started) / 1000;
      const eta = ((audio.length - doneSamples) / Math.max(1, doneSamples)) * elapsed;
      const parts = jobs.length > 1 ? ` ${doneJobs}/${jobs.length} parts ·` : '';
      const tail = doneJobs >= Math.min(workerCount, jobs.length) ? fmtEta(eta) : doneJobs > 0 ? 'estimating time…' : `${workerCount} worker${workerCount === 1 ? '' : 's'}`;
      opts.onStatus?.(`Transcribing…${parts} ${tail}`);
      opts.onProgress?.(ratio);
    };

    const feed = (w: Worker): void => {
      const job = jobs[next++];
      if (!job) return;
      const slice = audio.slice(job.a, job.b);
      w.postMessage({ type: 'run', id: job.id, audio: slice, offset: job.a / SR }, [slice.buffer]);
    };

    const spawn = (first: boolean): void => {
      const w = new Worker(new URL('./captionWorker.ts', import.meta.url), { type: 'module' });
      workers.push(w);
      alive++;
      let ready = false;
      const drop = (message: string): void => {
        alive--;
        w.terminate();
        if (first || ready || alive === 0) {
          const err: PoolError = new Error(message);
          err.beforeReady = first && !ready;
          finish(() => reject(err));
        }
      };
      w.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        if (m.type === 'status' && m.status && first && !ready) opts.onStatus?.(m.status);
        else if (m.type === 'progress' && typeof m.ratio === 'number' && first && !ready) opts.onProgress?.(m.ratio);
        else if (m.type === 'ready') {
          ready = true;
          if (first) {
            started = performance.now();
            report();
            for (let i = 1; i < workerCount; i++) spawn(false);
          }
          feed(w);
        } else if (m.type === 'done' && typeof m.id === 'number') {
          results[m.id] = m.segments ?? [];
          doneJobs++;
          doneSamples += jobs[m.id].b - jobs[m.id].a;
          report();
          if (doneJobs === jobs.length) finish(() => resolve(results.flat().sort((x, y) => x.start - y.start)));
          else feed(w);
        } else if (m.type === 'error') {
          drop(m.message ?? 'Transcription failed. Check your internet connection (the model downloads on first use).');
        }
      };
      w.onerror = (e) => drop(e.message || 'The caption worker crashed.');
      w.postMessage({ type: 'init', model, device, split });
    };

    spawn(true);
  });
}

function parseTimecode(tc: string): number {
  const m = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/.exec(tc);
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;
}

export function parseSubtitles(text: string): CaptionSegment[] {
  const segs: CaptionSegment[] = [];
  const blocks = text.replace(/\r/g, '').split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.trim() && l.trim().toUpperCase() !== 'WEBVTT' && !/^\d+$/.test(l.trim()));
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [a, b] = timeLine.split('-->');
    const body = lines.filter((l) => l !== timeLine).join('\n').trim();
    if (!body) continue;
    segs.push({ start: parseTimecode(a), end: parseTimecode(b), text: body });
  }
  return segs;
}

function srtTime(s: number): string {
  const t = Math.max(0, s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = Math.floor(t % 60);
  const ms = Math.round((t - Math.floor(t)) * 1000);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(sec)},${p(ms, 3)}`;
}

export function toSRT(segs: CaptionSegment[]): string {
  return segs
    .slice()
    .sort((a, b) => a.start - b.start)
    .map((s, i) => `${i + 1}\n${srtTime(s.start)} --> ${srtTime(s.end)}\n${s.text}\n`)
    .join('\n');
}
