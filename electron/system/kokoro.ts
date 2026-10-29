import { app, net } from 'electron';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { allowPaths } from './allowlist';
import { mediaUrl } from './mediaProtocol';
import { logger } from './logger';

interface ModelFile {
  name: string;
  url: string;
  sha256: string;
  bytes: number;
}

const KOKORO_FILES: readonly ModelFile[] = [
  { name: 'model.onnx', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/onnx/model.onnx', sha256: '8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb', bytes: 325532232 },
  { name: 'af_heart.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_heart.bin', sha256: 'd583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b', bytes: 522240 },
  { name: 'af_bella.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_bella.bin', sha256: 'f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b', bytes: 522240 },
  { name: 'af_nicole.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nicole.bin', sha256: 'cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a', bytes: 522240 },
  { name: 'af_aoede.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_aoede.bin', sha256: '4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361', bytes: 522240 },
  { name: 'af_kore.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_kore.bin', sha256: '9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e', bytes: 522240 },
  { name: 'af_sarah.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sarah.bin', sha256: '4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a', bytes: 522240 },
  { name: 'af_alloy.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_alloy.bin', sha256: 'c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45', bytes: 522240 },
  { name: 'af_nova.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nova.bin', sha256: '18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f', bytes: 522240 },
  { name: 'af_sky.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_sky.bin', sha256: '4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9', bytes: 522240 },
  { name: 'af_jessica.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_jessica.bin', sha256: 'a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8', bytes: 522240 },
  { name: 'af_river.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_river.bin', sha256: '00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30', bytes: 522240 },
  { name: 'am_michael.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_michael.bin', sha256: '1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1', bytes: 522240 },
  { name: 'am_fenrir.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_fenrir.bin', sha256: 'c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43', bytes: 522240 },
  { name: 'am_puck.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_puck.bin', sha256: 'fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0', bytes: 522240 },
  { name: 'am_echo.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_echo.bin', sha256: '3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3', bytes: 522240 },
  { name: 'am_eric.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_eric.bin', sha256: 'e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832', bytes: 522240 },
  { name: 'am_liam.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_liam.bin', sha256: '52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade', bytes: 522240 },
  { name: 'am_onyx.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_onyx.bin', sha256: 'da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6', bytes: 522240 },
  { name: 'am_adam.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_adam.bin', sha256: '162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716', bytes: 522240 },
  { name: 'am_santa.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/am_santa.bin', sha256: '61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a', bytes: 522240 },
  { name: 'bf_emma.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_emma.bin', sha256: '669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73', bytes: 522240 },
  { name: 'bf_isabella.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_isabella.bin', sha256: '3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f', bytes: 522240 },
  { name: 'bf_alice.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_alice.bin', sha256: '08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573', bytes: 522240 },
  { name: 'bf_lily.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bf_lily.bin', sha256: '5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335', bytes: 522240 },
  { name: 'bm_george.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_george.bin', sha256: 'c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc', bytes: 522240 },
  { name: 'bm_fable.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_fable.bin', sha256: 'f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1', bytes: 522240 },
  { name: 'bm_lewis.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_lewis.bin', sha256: 'b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97', bytes: 522240 },
  { name: 'bm_daniel.bin', url: 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/bm_daniel.bin', sha256: '6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8', bytes: 522240 },
];

export const KOKORO_BYTES = KOKORO_FILES.reduce((s, f) => s + f.bytes, 0);

const modelDir = (): string => path.join(app.getPath('userData'), 'models', 'kokoro');
const studioDir = (): string => path.join(app.getPath('appData'), 'Krypt Studio', 'models', 'kokoro');

type Marker = Record<string, { sha256: string; size: number; mtimeMs: number }>;
const markerPath = (): string => path.join(modelDir(), 'verified.json');

function readMarker(): Marker {
  try {
    return JSON.parse(fs.readFileSync(markerPath(), 'utf8')) as Marker;
  } catch {
    return {};
  }
}

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return -1;
  }
}

function isVerified(marker: Marker, f: ModelFile): boolean {
  const m = marker[f.name];
  if (!m || m.sha256 !== f.sha256) return false;
  try {
    const st = fs.statSync(path.join(modelDir(), f.name));
    return st.size === f.bytes && st.mtimeMs === m.mtimeMs;
  } catch {
    return false;
  }
}

export interface KokoroProgress {
  stage: 'copying' | 'downloading' | 'verifying';
  done: number;
  total: number;
}

export interface KokoroStatus {
  installed: boolean;
  downloadBytes: number;
  totalBytes: number;
  installing: boolean;
  progress: KokoroProgress | null;
}

export function status(): KokoroStatus {
  const marker = readMarker();
  const missing = KOKORO_FILES.filter((f) => !isVerified(marker, f));
  const downloadBytes = missing.filter((f) => sizeOf(path.join(studioDir(), f.name)) !== f.bytes).reduce((s, f) => s + f.bytes, 0);
  return { installed: missing.length === 0, downloadBytes, totalBytes: KOKORO_BYTES, installing: running !== null, progress: running ? lastProgress : null };
}

const watchers = new Set<() => void>();
export function onChange(fn: () => void): () => void {
  watchers.add(fn);
  return () => watchers.delete(fn);
}
const changed = (): void => watchers.forEach((w) => w());
let lastProgress: KokoroProgress | null = null;

export interface KokoroUrls {
  model: string;
  voices: Record<string, string>;
}

function urls(): KokoroUrls {
  const dir = modelDir();
  allowPaths(KOKORO_FILES.map((f) => path.join(dir, f.name)));
  const voices: Record<string, string> = {};
  for (const f of KOKORO_FILES) if (f.name.endsWith('.bin')) voices[f.name.slice(0, -4)] = mediaUrl(path.join(dir, f.name));
  return { model: mediaUrl(path.join(dir, 'model.onnx')), voices };
}

const cancelled = (): Error => new Error('Voice model download cancelled.');

async function hashInto(src: string, hash: ReturnType<typeof createHash>, onBytes: (n: number) => void, signal: AbortSignal, copyTo?: string): Promise<void> {
  const out = copyTo ? await fs.promises.open(copyTo, 'w') : null;
  try {
    for await (const chunk of fs.createReadStream(src, { highWaterMark: 1 << 20 })) {
      if (signal.aborted) throw cancelled();
      const buf = chunk as Buffer;
      hash.update(buf);
      if (out) await out.write(buf);
      onBytes(buf.length);
    }
  } finally {
    await out?.close();
  }
}

async function download(f: ModelFile, part: string, onBytes: (n: number) => void, signal: AbortSignal): Promise<string> {
  let have = sizeOf(part);
  if (have < 0 || have > f.bytes) have = 0;
  let hash = createHash('sha256');
  if (have > 0) await hashInto(part, hash, onBytes, signal);
  let res: Response;
  try {
    res = await net.fetch(f.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal });
  } catch (e) {
    if (signal.aborted) throw cancelled();
    throw new Error(`Couldn't download the voice model (${(e as Error).message}). Check your internet connection.`);
  }
  if (have > 0 && res.status !== 206) {
    onBytes(-have);
    have = 0;
    hash = createHash('sha256');
  }
  if (!res.ok || !res.body) throw new Error(`Couldn't download the voice model (${f.name}: HTTP ${res.status}).`);
  const out = await fs.promises.open(part, have > 0 ? 'a' : 'w');
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) throw cancelled();
      hash.update(value);
      await out.write(value);
      onBytes(value.length);
    }
  } catch (e) {
    if (signal.aborted) throw cancelled();
    throw e;
  } finally {
    await out.close();
  }
  return hash.digest('hex');
}

async function install(signal: AbortSignal, emit: (p: KokoroProgress) => void): Promise<KokoroUrls> {
  const dir = modelDir();
  fs.mkdirSync(dir, { recursive: true });
  const marker = readMarker();
  const todo = KOKORO_FILES.filter((f) => !isVerified(marker, f));
  const total = todo.reduce((s, f) => s + f.bytes, 0);
  let base = 0;
  let last = 0;
  for (const f of todo) {
    const dest = path.join(dir, f.name);
    const part = `${dest}.part`;
    let current = 0;
    let stage: KokoroProgress['stage'] = 'verifying';
    const progress = (st: KokoroProgress['stage']) => (n: number): void => {
      stage = st;
      current = Math.max(0, current + n);
      const now = Date.now();
      if (now - last > 150) {
        last = now;
        emit({ stage, done: base + Math.min(current, f.bytes), total });
      }
    };
    const restart = (): void => {
      current = 0;
    };
    let digest = '';
    if (sizeOf(dest) === f.bytes) {
      const h = createHash('sha256');
      await hashInto(dest, h, progress('verifying'), signal);
      digest = h.digest('hex');
      if (digest !== f.sha256) restart();
    }
    const studio = path.join(studioDir(), f.name);
    if (digest !== f.sha256 && sizeOf(studio) === f.bytes) {
      const h = createHash('sha256');
      await hashInto(studio, h, progress('copying'), signal, part);
      digest = h.digest('hex');
      if (digest === f.sha256) fs.renameSync(part, dest);
      else {
        logger.warn(`[kokoro] Krypt Studio's ${f.name} failed its checksum; downloading instead`);
        fs.rmSync(part, { force: true });
        restart();
      }
    }
    if (digest !== f.sha256) {
      digest = await download(f, part, progress('downloading'), signal);
      if (digest !== f.sha256) {
        fs.rmSync(part, { force: true });
        throw new Error(`The downloaded voice model is damaged (${f.name} failed its checksum). Try again.`);
      }
      fs.renameSync(part, dest);
    }
    marker[f.name] = { sha256: f.sha256, size: f.bytes, mtimeMs: fs.statSync(dest).mtimeMs };
    fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 1));
    base += f.bytes;
    emit({ stage, done: base, total });
  }
  if (todo.length) logger.info(`[kokoro] installed ${todo.length} file(s) into ${dir}`);
  return urls();
}

let running: { promise: Promise<KokoroUrls>; abort: AbortController } | null = null;
const listeners = new Set<(p: KokoroProgress) => void>();

export async function ensure(onProgress: (p: KokoroProgress) => void): Promise<KokoroUrls> {
  listeners.add(onProgress);
  try {
    let job = running;
    if (!job) {
      const current: NonNullable<typeof running> = { promise: Promise.resolve() as never, abort: new AbortController() };
      lastProgress = null;
      current.promise = install(current.abort.signal, (p) => {
        lastProgress = p;
        listeners.forEach((l) => l(p));
      }).finally(() => {
        if (running === current) running = null;
        changed();
      });
      running = job = current;
      changed();
    }
    return await job.promise;
  } finally {
    listeners.delete(onProgress);
  }
}

export function cancel(): void {
  running?.abort.abort();
}

export function remove(): void {
  if (running) throw new Error('The voice model is still downloading. Cancel it first.');
  fs.rmSync(modelDir(), { recursive: true, force: true });
  changed();
}
