/// <reference lib="webworker" />
import ortWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs?url';
import { modelCache } from './modelCache';

interface RunMessage {
  type: 'run';
  text: string;
  model: string;
}

type OutMessage =
  | { type: 'status'; status: string }
  | { type: 'progress'; ratio: number }
  | { type: 'done'; audio: Float32Array; sampleRate: number }
  | { type: 'error'; message: string };

const post = (m: OutMessage, transfer?: Transferable[]): void => self.postMessage(m, { transfer });

self.onmessage = async (e: MessageEvent<RunMessage>): Promise<void> => {
  if (e.data?.type !== 'run') return;
  const { text, model } = e.data;
  try {
    post({ type: 'status', status: 'Loading voice model…' });
    const tf = await import('@huggingface/transformers');
    const { pipeline, env } = tf;
    env.allowLocalModels = false;
    env.useBrowserCache = false;
    env.useCustomCache = true;
    env.customCache = modelCache;
    try {
      const wasm = (env.backends as { onnx?: { wasm?: Record<string, unknown> } })?.onnx?.wasm;
      if (wasm) {
        wasm.wasmPaths = { wasm: ortWasmUrl, mjs: ortMjsUrl };
        wasm.numThreads = 1;
      }
    } catch {
    }

    const tts = (await pipeline('text-to-speech', model, {
      dtype: 'fp32',
      device: 'wasm',
      progress_callback: (p: { status?: string; progress?: number }) => {
        if (p?.status === 'progress' && typeof p.progress === 'number') post({ type: 'progress', ratio: Math.max(0, Math.min(1, p.progress / 100)) });
      },
    })) as (input: string) => Promise<{ audio: Float32Array; sampling_rate: number }>;

    post({ type: 'status', status: 'Generating speech…' });
    const out = await tts(text);
    if (!out?.audio || out.audio.length === 0) throw new Error('The voice model produced no audio.');
    post({ type: 'done', audio: out.audio, sampleRate: out.sampling_rate }, [out.audio.buffer]);
  } catch (err) {
    post({ type: 'error', message: (err as Error)?.message ?? String(err) });
  }
};
