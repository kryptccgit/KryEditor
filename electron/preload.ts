import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ActionResult, AppState, KokoroStatus, KryptApi, MediaFile, McpClientSnippet, McpStatus, McpToolCall } from '../shared/types';

function sub<T>(channel: string, cb: (payload: T) => void): () => void {
  const handler = (_e: unknown, payload: T): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const krypt: KryptApi = {
  app: {
    version: () => ipcRenderer.invoke('app:version'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    showItemInFolder: (p) => ipcRenderer.invoke('app:showItemInFolder', p),
    getUserDataPath: () => ipcRenderer.invoke('app:getUserDataPath'),
    quit: () => ipcRenderer.invoke('app:quit'),
    minimize: () => ipcRenderer.invoke('app:minimize'),
    copyText: (text) => ipcRenderer.invoke('app:copyText', text) as Promise<void>,
    pickDirectory: () => ipcRenderer.invoke('app:pickDirectory') as Promise<string | null>,
    onStateChanged: (cb) => sub<AppState>('state:changed', cb),
  },
  state: {
    get: () => ipcRenderer.invoke('state:get') as Promise<AppState>,
    update: (patch) => ipcRenderer.invoke('state:update', patch) as Promise<AppState>,
    reset: () => ipcRenderer.invoke('state:reset') as Promise<AppState>,
  },
  media: {
    pickFiles: () => ipcRenderer.invoke('media:pickFiles') as Promise<ActionResult<MediaFile[]>>,
    resolvePaths: (paths: string[]) =>
      ipcRenderer.invoke('media:resolvePaths', paths) as Promise<ActionResult<MediaFile[]>>,
    urlForPath: (p: string) => ipcRenderer.invoke('media:urlForPath', p) as Promise<string>,
    pathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    },
    takeLaunchFiles: () => ipcRenderer.invoke('media:takeLaunchFiles') as Promise<MediaFile[]>,
    onOpened: (cb) => sub<MediaFile[]>('media:opened', cb),
    saveExport: (data: Uint8Array, suggestedName: string) =>
      ipcRenderer.invoke('media:saveExport', data, suggestedName) as Promise<ActionResult<string | null>>,
    readLut: (p: string) => ipcRenderer.invoke('media:readLut', p) as Promise<ActionResult<{ name: string; text: string }>>,
    pickLuts: () => ipcRenderer.invoke('media:pickLuts') as Promise<ActionResult<Array<{ name: string; text: string }>>>,
    saveDerived: (data: Uint8Array, name: string) => ipcRenderer.invoke('media:saveDerived', data, name) as Promise<ActionResult<MediaFile>>,
    exportBegin: (suggestedName: string) =>
      ipcRenderer.invoke('media:exportBegin', suggestedName) as Promise<ActionResult<{ token: string; path: string } | null>>,
    exportBeginAt: (p: string, ext: string) =>
      ipcRenderer.invoke('media:exportBeginAt', p, ext) as Promise<ActionResult<{ token: string; path: string }>>,
    exportWrite: (token: string, data: Uint8Array, position: number) =>
      ipcRenderer.invoke('media:exportWrite', token, data, position) as Promise<ActionResult>,
    exportEnd: (token: string, commit: boolean) =>
      ipcRenderer.invoke('media:exportEnd', token, commit) as Promise<ActionResult<string | null>>,
    allow: (paths: string[]) => ipcRenderer.invoke('media:allow', paths) as Promise<void>,
  },
  project: {
    save: (json: string, suggestedName: string) =>
      ipcRenderer.invoke('project:save', json, suggestedName) as Promise<ActionResult<string | null>>,
    open: () => ipcRenderer.invoke('project:open') as Promise<ActionResult<{ path: string; json: string } | null>>,
    saveToPath: (json: string, p: string) => ipcRenderer.invoke('project:saveToPath', json, p) as Promise<ActionResult<string>>,
    saveAs: (json: string, p: string, name: string) => ipcRenderer.invoke('project:saveAs', json, p, name) as Promise<ActionResult<string>>,
    openPath: (p: string) => ipcRenderer.invoke('project:openPath', p) as Promise<ActionResult<{ path: string; json: string } | null>>,
    autosaveWrite: (json: string) => ipcRenderer.invoke('project:autosaveWrite', json) as Promise<void>,
    autosaveRead: () => ipcRenderer.invoke('project:autosaveRead') as Promise<string | null>,
  },
  tts: {
    kokoroStatus: () => ipcRenderer.invoke('tts:kokoroStatus') as Promise<KokoroStatus>,
    kokoroEnsure: () => ipcRenderer.invoke('tts:kokoroEnsure') as Promise<ActionResult<{ model: string; voices: Record<string, string> }>>,
    kokoroCancel: () => ipcRenderer.invoke('tts:kokoroCancel') as Promise<void>,
    kokoroRemove: () => ipcRenderer.invoke('tts:kokoroRemove') as Promise<ActionResult>,
    onKokoroProgress: (cb) => sub('tts:kokoroProgress', cb),
    onKokoroState: (cb) => sub('tts:kokoroState', cb),
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status') as Promise<McpStatus>,
    onStatus: (cb) => sub<McpStatus>('mcp:status', cb),
    setEnabled: (on: boolean) => ipcRenderer.invoke('mcp:setEnabled', on) as Promise<McpStatus>,
    snippets: () => ipcRenderer.invoke('mcp:snippets') as Promise<McpClientSnippet[]>,
    install: (client: string, opts?: { allowAll?: boolean }) => ipcRenderer.invoke('mcp:install', client, opts ?? {}) as Promise<ActionResult>,
    serve: (run) => {
      const cancels = new Map<number, Array<() => void>>();
      const onCall = (_e: unknown, call: McpToolCall): void => {
        cancels.set(call.rid, []);
        const progress = (fraction: number, message: string): void => ipcRenderer.send('mcp:progress', call.rid, fraction, message);
        const whenCancelled = (cb: () => void): void => void cancels.get(call.rid)?.push(cb);
        void run(call, progress, whenCancelled)
          .catch((e: unknown) => ({ ok: false, text: (e as Error)?.message ?? String(e) }))
          .then((result) => {
            cancels.delete(call.rid);
            ipcRenderer.send('mcp:result', call.rid, result);
          });
      };
      const onCancel = (_e: unknown, rid: number): void => cancels.get(rid)?.forEach((cb) => cb());
      ipcRenderer.on('mcp:call', onCall);
      ipcRenderer.on('mcp:cancel', onCancel);
      ipcRenderer.send('mcp:ready', true);
      return () => {
        ipcRenderer.removeListener('mcp:call', onCall);
        ipcRenderer.removeListener('mcp:cancel', onCancel);
        ipcRenderer.send('mcp:ready', false);
      };
    },
  },
  log: {
    onAppend: (cb) => sub<{ level: 'info' | 'warn' | 'error'; message: string; ts: string }>('log:append', cb),
  },
};

contextBridge.exposeInMainWorld('krypt', krypt);
