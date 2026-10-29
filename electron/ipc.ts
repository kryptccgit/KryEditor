import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import type { ActionResult, AppState, MediaFile } from '../shared/types';
import * as store from './system/settings-store';
import * as files from './system/files';
import * as discord from './system/discord';
import { allowPaths } from './system/allowlist';
import { mediaUrl } from './system/mediaProtocol';
import { setStartWithWindows } from './system/autostart';
import * as kokoro from './system/kokoro';

const ok = <T>(data?: T, message?: string): ActionResult<T> => ({ ok: true, data, message });
const err = (message: string): ActionResult => ({ ok: false, message });

const EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
function safeOpenExternal(url: string): Promise<void> {
  try {
    if (EXTERNAL_SCHEMES.has(new URL(url).protocol)) return shell.openExternal(url);
  } catch {
  }
  return Promise.resolve();
}

export interface IpcDeps {
  showMainWindow: () => BrowserWindow;
  takeLaunchFiles: () => MediaFile[];
}

export function registerIpc(deps: IpcDeps): void {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:openExternal', (_e, url: string) => safeOpenExternal(url));
  ipcMain.handle('app:showItemInFolder', (_e, p: string) => shell.showItemInFolder(p));
  ipcMain.handle('app:getUserDataPath', () => app.getPath('userData'));
  ipcMain.handle('app:quit', () => app.quit());
  ipcMain.handle('app:minimize', () => {
    for (const w of BrowserWindow.getAllWindows()) w.minimize();
  });
  ipcMain.handle('app:copyText', (_e, text: string) => clipboard.writeText(text ?? ''));
  ipcMain.handle('app:pickDirectory', () => files.pickDirectory());

  ipcMain.handle('state:get', () => store.load());
  ipcMain.handle('state:update', (_e, patch: Partial<AppState>) => store.update(patch));
  ipcMain.handle('state:reset', () => store.reset());

  ipcMain.handle('media:pickFiles', async () => {
    try {
      return ok<MediaFile[]>(await files.pickMediaFiles());
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:resolvePaths', (_e, paths: string[]) => {
    try {
      return ok<MediaFile[]>(files.resolveMediaFiles(Array.isArray(paths) ? paths : []));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:urlForPath', (_e, p: string) => mediaUrl(p));
  ipcMain.handle('media:allow', (_e, paths: string[]) =>
    allowPaths((Array.isArray(paths) ? paths : []).filter((p) => typeof p === 'string' && files.isMediaFilePath(p))),
  );
  ipcMain.handle('media:takeLaunchFiles', () => deps.takeLaunchFiles());
  ipcMain.handle('media:saveExport', async (_e, data: Uint8Array, suggestedName: string) => {
    try {
      return ok<string | null>(await files.saveExport(data, suggestedName));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:saveDerived', (_e, data: Uint8Array, name: string) => {
    try {
      const m = files.saveDerivedMedia(data, String(name));
      return m ? ok<MediaFile>(m) : err('Could not store the generated media.');
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:pickLuts', async () => {
    try {
      return ok<Array<{ name: string; text: string }>>(await files.pickLutFiles());
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:readLut', (_e, p: string) => {
    try {
      return ok<{ name: string; text: string }>(files.readLutFile(String(p)));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:exportBegin', async (_e, suggestedName: string) => {
    try {
      return ok<{ token: string; path: string } | null>(await files.exportBegin(String(suggestedName)));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:exportBeginAt', (_e, p: string, ext: string) => {
    try {
      return ok<{ token: string; path: string }>(files.exportBeginAt(String(p ?? ''), String(ext || 'mp4')));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:exportWrite', (_e, token: string, data: Uint8Array, position: number) => {
    try {
      files.exportWrite(String(token), data, Number(position));
      return ok();
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('media:exportEnd', (_e, token: string, commit: boolean) => {
    try {
      return ok<string | null>(files.exportEnd(String(token), !!commit));
    } catch (e) {
      return err((e as Error).message);
    }
  });

  ipcMain.handle('tts:kokoroStatus', () => kokoro.status());
  ipcMain.handle('tts:kokoroEnsure', async (e) => {
    try {
      return ok<kokoro.KokoroUrls>(
        await kokoro.ensure((p) => {
          if (!e.sender.isDestroyed()) e.sender.send('tts:kokoroProgress', p);
        }),
      );
    } catch (x) {
      return err((x as Error).message);
    }
  });
  ipcMain.handle('tts:kokoroCancel', () => kokoro.cancel());
  ipcMain.handle('tts:kokoroRemove', () => {
    try {
      kokoro.remove();
      return ok();
    } catch (x) {
      return err((x as Error).message);
    }
  });
  kokoro.onChange(() => {
    const st = kokoro.status();
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('tts:kokoroState', st);
  });

  ipcMain.handle('project:save', async (_e, json: string, suggestedName: string) => {
    try {
      return ok<string | null>(await files.saveProject(json, suggestedName));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('project:open', async () => {
    try {
      return ok<{ path: string; json: string } | null>(await files.openProject());
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('project:saveToPath', (_e, json: string, p: string) => {
    try {
      return ok<string>(files.saveProjectToPath(json, p));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('project:saveAs', (_e, json: string, p: string, name: string) => {
    try {
      return ok<string>(files.saveProjectAs(json, String(p ?? ''), String(name ?? 'project')));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('project:openPath', (_e, p: string) => {
    try {
      return ok<{ path: string; json: string } | null>(files.openProjectPath(p));
    } catch (e) {
      return err((e as Error).message);
    }
  });
  ipcMain.handle('project:autosaveWrite', (_e, json: string) => files.autosaveWrite(json));
  ipcMain.handle('project:autosaveRead', () => files.autosaveRead());
}

export type { AppState };
