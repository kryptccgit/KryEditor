import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { AppState } from '../../shared/types';

const FILE = 'config.json';

export const DEFAULT_STATE: AppState = {
  schemaVersion: 1,
  workingDirectory: null,
  recentProjects: [],
  agentAccess: true,
};

let cache: AppState | null = null;

export function storePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

export function load(): AppState {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppState>;
    cache = mergeState(DEFAULT_STATE, parsed);
  } catch {
    cache = structuredClone(DEFAULT_STATE);
  }
  return cache;
}

export function save(next: AppState): AppState {
  cache = next;
  const dir = path.dirname(storePath());
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${storePath()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
    fs.renameSync(tmp, storePath());
  } catch (err) {
    console.error('[settings-store] failed to persist state', err);
  }
  broadcast(cache);
  return cache;
}

export function update(patch: Partial<AppState>): AppState {
  return save(mergeState(load(), patch));
}

export function reset(): AppState {
  return save(structuredClone(DEFAULT_STATE));
}

function broadcast(state: AppState): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    w.webContents.send('state:changed', state);
  }
}

function mergeState(base: AppState, override: Partial<AppState>): AppState {
  return {
    schemaVersion: 1,
    workingDirectory:
      typeof override.workingDirectory !== 'undefined' ? override.workingDirectory : base.workingDirectory,
    recentProjects: Array.isArray(override.recentProjects) ? override.recentProjects.slice(0, 12) : base.recentProjects,
    agentAccess: typeof override.agentAccess === 'boolean' ? override.agentAccess : base.agentAccess,
  };
}
