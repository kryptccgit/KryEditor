import { app, dialog, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { MediaFile, MediaKind } from '../../shared/types';
import { mediaUrl } from './mediaProtocol';
import { allowPath } from './allowlist';
import * as store from './settings-store';

export function defaultWorkingDir(): string {
  return path.join(app.getPath('userData'), 'Projects');
}

function parentWindow(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

function kindFor(ext: string): MediaKind | null {
  const e = ext.toLowerCase();
  if (VIDEO_EXT.has(e)) return 'video';
  if (AUDIO_EXT.has(e)) return 'audio';
  if (IMAGE_EXT.has(e)) return 'image';
  return null;
}

export function isMediaFilePath(p: string): boolean {
  if (kindFor(path.extname(p).slice(1)) === null) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function writeFileAtomicSync(target: string, data: string | Buffer): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, typeof data === 'string' ? 'utf8' : undefined);
  fs.renameSync(tmp, target);
}

export function resolveMediaFile(filePath: string): MediaFile | null {
  const ext = path.extname(filePath).slice(1);
  const kind = kindFor(ext);
  if (!kind) return null;
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(filePath).size;
  } catch {
    return null;
  }
  allowPath(filePath);
  return {
    id: `m-${randomUUID()}`,
    name: path.basename(filePath),
    filePath,
    kind,
    sizeBytes,
    mediaUrl: mediaUrl(filePath),
  };
}

export function resolveMediaFiles(paths: string[]): MediaFile[] {
  return paths.map(resolveMediaFile).filter((m): m is MediaFile => m !== null);
}

export async function pickMediaFiles(): Promise<MediaFile[]> {
  const win = parentWindow();
  const opts = {
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [
      { name: 'Media', extensions: [...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT] },
      { name: 'Video', extensions: [...VIDEO_EXT] },
      { name: 'Audio', extensions: [...AUDIO_EXT] },
      { name: 'Images', extensions: [...IMAGE_EXT] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return [];
  return resolveMediaFiles(result.filePaths);
}

export async function saveExport(data: Uint8Array, suggestedName: string): Promise<string | null> {
  const win = parentWindow();
  const ext = path.extname(suggestedName).slice(1).toLowerCase() || 'mp4';
  const filters =
    ext === 'mp4' || ext === 'webm'
      ? [{ name: 'Video', extensions: [ext] }]
      : [{ name: 'Audio', extensions: [ext] }];
  const baseDir = store.load().workingDirectory ?? defaultWorkingDir();
  const opts = { defaultPath: path.join(baseDir, suggestedName), filters };
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (result.canceled || !result.filePath) return null;
  writeFileAtomicSync(result.filePath, Buffer.from(data));
  return result.filePath;
}

export function saveDerivedMedia(data: Uint8Array, name: string): MediaFile | null {
  const dir = path.join(app.getPath('userData'), 'MediaCache');
  fs.mkdirSync(dir, { recursive: true });
  const safe = path.basename(name).replace(/[^\w.-]+/g, '_');
  const p = path.join(dir, safe);
  fs.writeFileSync(p, Buffer.from(data));
  return resolveMediaFile(p);
}

export async function pickLutFiles(): Promise<Array<{ name: string; text: string }>> {
  const win = parentWindow();
  const opts = {
    properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>,
    filters: [{ name: 'Color LUT', extensions: ['cube'] }],
  };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled) return [];
  const out: Array<{ name: string; text: string }> = [];
  for (const p of result.filePaths) {
    try {
      if (fs.statSync(p).size > 8 * 1024 * 1024) continue;
      out.push({ name: path.basename(p), text: fs.readFileSync(p, 'utf8') });
    } catch {
    }
  }
  return out;
}

const exportStreams = new Map<string, { fd: number; partPath: string; finalPath: string }>();

export async function exportBegin(suggestedName: string): Promise<{ token: string; path: string } | null> {
  const win = parentWindow();
  const ext = path.extname(suggestedName).slice(1).toLowerCase() || 'mp4';
  const filters = ext === 'mp4' || ext === 'webm' ? [{ name: 'Video', extensions: [ext] }] : [{ name: 'Audio', extensions: [ext] }];
  const baseDir = store.load().workingDirectory ?? defaultWorkingDir();
  const opts = { defaultPath: path.join(baseDir, suggestedName), filters };
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (result.canceled || !result.filePath) return null;
  fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
  const partPath = `${result.filePath}.part`;
  const fd = fs.openSync(partPath, 'w');
  const token = randomUUID();
  exportStreams.set(token, { fd, partPath, finalPath: result.filePath });
  return { token, path: result.filePath };
}

export function exportBeginAt(requested: string, ext: string): { token: string; path: string } {
  const baseDir = store.load().workingDirectory ?? defaultWorkingDir();
  let target = requested.trim() ? requested.trim() : path.join(baseDir, `krypt-export-${Date.now().toString(36)}.${ext}`);
  if (!path.isAbsolute(target)) target = path.join(baseDir, target);
  const want = ext.toLowerCase();
  if (path.extname(target).slice(1).toLowerCase() !== want) target = `${target.replace(/.[A-Za-z0-9]{1,5}$/, '')}.${want}`;
  const dir = path.dirname(target);
  const stem = path.basename(target, path.extname(target));
  let finalPath = target;
  for (let n = 2; fs.existsSync(finalPath) || fs.existsSync(`${finalPath}.part`); n++) finalPath = path.join(dir, `${stem} (${n}).${want}`);
  fs.mkdirSync(dir, { recursive: true });
  const partPath = `${finalPath}.part`;
  const fd = fs.openSync(partPath, 'wx');
  const token = randomUUID();
  exportStreams.set(token, { fd, partPath, finalPath });
  return { token, path: finalPath };
}

export function exportWrite(token: string, data: Uint8Array, position: number): void {
  const s = exportStreams.get(token);
  if (!s) throw new Error('Export stream is not open.');
  fs.writeSync(s.fd, Buffer.from(data), 0, data.byteLength, position);
}

export function exportEnd(token: string, commit: boolean): string | null {
  const s = exportStreams.get(token);
  if (!s) return null;
  exportStreams.delete(token);
  try {
    fs.closeSync(s.fd);
  } catch {
  }
  if (commit) {
    fs.renameSync(s.partPath, s.finalPath);
    return s.finalPath;
  }
  try {
    fs.unlinkSync(s.partPath);
  } catch {
  }
  return null;
}

const PROJECT_FILTERS = [{ name: 'Krypt project', extensions: ['krypt'] }];

const grantedProjectPaths = new Set<string>();
const grantKey = (p: string): string => {
  const n = path.normalize(p.normalize('NFC'));
  return process.platform === 'win32' ? n.toLowerCase() : n;
};
const grantProjectPath = (p: string): void => void grantedProjectPaths.add(grantKey(p));
const isKryptPath = (p: string): boolean => path.extname(p).toLowerCase() === '.krypt';

export async function saveProject(json: string, suggestedName: string): Promise<string | null> {
  const win = parentWindow();
  const baseDir = store.load().workingDirectory ?? defaultWorkingDir();
  const opts = { defaultPath: path.join(baseDir, suggestedName), filters: PROJECT_FILTERS };
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
  if (result.canceled || !result.filePath) return null;
  writeFileAtomicSync(result.filePath, json);
  grantProjectPath(result.filePath);
  return result.filePath;
}

export async function openProject(): Promise<{ path: string; json: string } | null> {
  const win = parentWindow();
  const opts = { properties: ['openFile'] as Array<'openFile'>, filters: PROJECT_FILTERS };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return null;
  const p = result.filePaths[0];
  const json = fs.readFileSync(p, 'utf8');
  grantProjectPath(p);
  return { path: p, json };
}

export function saveProjectToPath(json: string, p: string): string {
  if (!isKryptPath(p) || !grantedProjectPaths.has(grantKey(p))) {
    throw new Error('Save location not granted — use Save As.');
  }
  writeFileAtomicSync(p, json);
  return p;
}

export function saveProjectAs(json: string, requested: string, fallbackName: string): string {
  const baseDir = store.load().workingDirectory ?? defaultWorkingDir();
  let target = requested.trim() || path.join(baseDir, `${fallbackName.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'project'}.krypt`);
  if (!path.isAbsolute(target)) target = path.join(baseDir, target);
  if (!isKryptPath(target)) target = `${target}.krypt`;
  const dir = path.dirname(target);
  const stem = path.basename(target, '.krypt');
  let finalPath = target;
  for (let n = 2; fs.existsSync(finalPath); n++) finalPath = path.join(dir, `${stem} (${n}).krypt`);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomicSync(finalPath, json);
  grantProjectPath(finalPath);
  return finalPath;
}

export function readLutFile(p: string): { name: string; text: string } {
  if (path.extname(p).toLowerCase() !== '.cube') throw new Error('Not a .cube LUT file.');
  if (fs.statSync(p).size > 8 * 1024 * 1024) throw new Error('That file is too big to be a LUT.');
  return { name: path.basename(p), text: fs.readFileSync(p, 'utf8') };
}

export function openProjectPath(p: string): { path: string; json: string } | null {
  if (!isKryptPath(p)) return null;
  try {
    const json = fs.readFileSync(p, 'utf8');
    grantProjectPath(p);
    return { path: p, json };
  } catch {
    return null;
  }
}

function autosavePath(): string {
  return path.join(app.getPath('userData'), 'autosave.krypt');
}

export function autosaveWrite(json: string): void {
  try {
    const target = autosavePath();
    try {
      fs.copyFileSync(target, `${target}.bak`);
    } catch {
    }
    writeFileAtomicSync(target, json);
  } catch {
  }
}

export function autosaveRead(): string | null {
  for (const p of [autosavePath(), `${autosavePath()}.bak`]) {
    try {
      return fs.readFileSync(p, 'utf8');
    } catch {
    }
  }
  return null;
}

export async function pickDirectory(): Promise<string | null> {
  const win = parentWindow();
  const opts = { properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
}
