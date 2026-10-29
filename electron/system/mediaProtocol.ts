import { app, protocol } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { logger } from './logger';
import { isAllowed } from './allowlist';

export const SCHEME = 'krypteditor';

function mimeFor(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'mp4':
    case 'm4v':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mov':
      return 'video/quicktime';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'ogg':
      return 'audio/ogg';
    case 'm4a':
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'application/octet-stream';
  }
}

export function registerScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
    },
  ]);
}

export function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  if (rawStart === '' && rawEnd === '') return null;

  let start: number;
  let end: number;
  if (rawStart === '') {
    const n = parseInt(rawEnd, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = parseInt(rawStart, 10);
    end = rawEnd === '' ? size - 1 : parseInt(rawEnd, 10);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
};

export function installHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const res = new URL(request.url).hostname === 'models' ? await serveModel(request) : await serve(request);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  });
}

const modelDir = (): string => path.join(app.getPath('userData'), 'models', 'speech');
const MODEL_ORIGIN = 'https://huggingface.co/';

async function serveModel(request: Request): Promise<Response> {
  try {
    const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''));
    if (!key.startsWith(MODEL_ORIGIN)) return new Response('not found', { status: 404 });
    const file = path.join(modelDir(), crypto.createHash('sha256').update(key).digest('hex'));
    if (request.method === 'PUT') {
      if (!request.body) return new Response('bad request', { status: 400 });
      await fs.promises.mkdir(modelDir(), { recursive: true });
      const part = `${file}.${process.pid}-${Date.now()}.part`;
      try {
        await fs.promises.writeFile(part, Readable.fromWeb(request.body as import('node:stream/web').ReadableStream<Uint8Array>));
        await fs.promises.rename(part, file);
      } catch (err) {
        await fs.promises.rm(part, { force: true });
        throw err;
      }
      return new Response(null, { status: 201 });
    }
    let size: number;
    try {
      size = (await fs.promises.stat(file)).size;
    } catch {
      return new Response('not found', { status: 404 });
    }
    const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(size) } });
  } catch (err) {
    logger.warn(`[media] model cache failed: ${(err as Error).message}`);
    return new Response('error', { status: 500 });
  }
}

async function serve(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    if (url.hostname !== 'media') return new Response('not found', { status: 404 });
    const filePath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!filePath) return new Response('bad request', { status: 400 });
    if (!isAllowed(filePath)) {
      logger.warn(`[media] blocked non-allowlisted path: ${filePath}`);
      return new Response('forbidden', { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return new Response('not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('not found', { status: 404 });

    const size = stat.size;
    const mime = mimeFor(path.extname(filePath).slice(1));
    const range = parseRange(request.headers.get('range'), size);

    if (range) {
      const { start, end } = range;
      const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>;
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        },
      });
    }

    const body = Readable.toWeb(fs.createReadStream(filePath)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err) {
    logger.warn(`[media] protocol handler failed: ${(err as Error).message}`);
    return new Response('error', { status: 500 });
  }
}

export function mediaUrl(filePath: string): string {
  return `${SCHEME}://media/${encodeURIComponent(filePath)}`;
}
