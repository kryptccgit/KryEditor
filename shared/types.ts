export interface ActionResult<T = void> {
  ok: boolean;
  message?: string;
  data?: T;
}

export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaFile {
  id: string;
  name: string;
  filePath: string;
  kind: MediaKind;
  sizeBytes: number;
  mediaUrl: string;
}

export interface AppState {
  schemaVersion: number;
  workingDirectory: string | null;
  recentProjects: string[];
  agentAccess: boolean;
}

export interface McpClientInfo {
  id: number;
  name: string;
  since: number;
  calls: number;
}

export interface McpActivity {
  id: string;
  ts: number;
  client: string;
  tool: string;
  args: string;
  state: 'running' | 'ok' | 'error';
  ms: number;
  result: string;
}

export interface McpStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  clients: McpClientInfo[];
  activity: McpActivity[];
  shimPath: string | null;
  exePath: string;
  toolCount: number;
}

export interface McpClientSnippet {
  id: string;
  label: string;
  description: string;
  snippet: string;
  installable: boolean;
}

export interface McpToolCall {
  rid: number;
  tool: string;
  args: unknown;
  client: string;
}

export interface McpToolResult {
  ok: boolean;
  text: string;
  images?: Array<{ data: string; mimeType: string }>;
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

export interface KryptApi {
  app: {
    version: () => Promise<string>;
    openExternal: (url: string) => Promise<void>;
    showItemInFolder: (path: string) => Promise<void>;
    getUserDataPath: () => Promise<string>;
    quit: () => Promise<void>;
    minimize: () => Promise<void>;
    copyText: (text: string) => Promise<void>;
    pickDirectory: () => Promise<string | null>;
    onStateChanged: (cb: (state: AppState) => void) => () => void;
  };
  state: {
    get: () => Promise<AppState>;
    update: (patch: Partial<AppState>) => Promise<AppState>;
    reset: () => Promise<AppState>;
  };
  media: {
    pickFiles: () => Promise<ActionResult<MediaFile[]>>;
    resolvePaths: (paths: string[]) => Promise<ActionResult<MediaFile[]>>;
    urlForPath: (path: string) => Promise<string>;
    pathForFile: (file: File) => string;
    takeLaunchFiles: () => Promise<MediaFile[]>;
    onOpened: (cb: (files: MediaFile[]) => void) => () => void;
    saveExport: (data: Uint8Array, suggestedName: string) => Promise<ActionResult<string | null>>;
    pickLuts: () => Promise<ActionResult<Array<{ name: string; text: string }>>>;
    readLut: (path: string) => Promise<ActionResult<{ name: string; text: string }>>;
    saveDerived: (data: Uint8Array, name: string) => Promise<ActionResult<MediaFile>>;
    exportBegin: (suggestedName: string) => Promise<ActionResult<{ token: string; path: string } | null>>;
    exportBeginAt: (path: string, ext: string) => Promise<ActionResult<{ token: string; path: string }>>;
    exportWrite: (token: string, data: Uint8Array, position: number) => Promise<ActionResult>;
    exportEnd: (token: string, commit: boolean) => Promise<ActionResult<string | null>>;
    allow: (paths: string[]) => Promise<void>;
  };
  project: {
    save: (json: string, suggestedName: string) => Promise<ActionResult<string | null>>;
    saveToPath: (json: string, path: string) => Promise<ActionResult<string>>;
    open: () => Promise<ActionResult<{ path: string; json: string } | null>>;
    openPath: (path: string) => Promise<ActionResult<{ path: string; json: string } | null>>;
    saveAs: (json: string, path: string, name: string) => Promise<ActionResult<string>>;
    autosaveWrite: (json: string) => Promise<void>;
    autosaveRead: () => Promise<string | null>;
  };
  tts: {
    kokoroStatus: () => Promise<KokoroStatus>;
    kokoroEnsure: () => Promise<ActionResult<{ model: string; voices: Record<string, string> }>>;
    kokoroCancel: () => Promise<void>;
    kokoroRemove: () => Promise<ActionResult>;
    onKokoroProgress: (cb: (p: KokoroProgress) => void) => () => void;
    onKokoroState: (cb: (s: KokoroStatus) => void) => () => void;
  };
  log: {
    onAppend: (cb: (e: { level: 'info' | 'warn' | 'error'; message: string; ts: string }) => void) => () => void;
  };
  mcp: {
    status: () => Promise<McpStatus>;
    onStatus: (cb: (s: McpStatus) => void) => () => void;
    setEnabled: (on: boolean) => Promise<McpStatus>;
    snippets: () => Promise<McpClientSnippet[]>;
    install: (client: string, opts?: { allowAll?: boolean }) => Promise<ActionResult>;
    serve: (run: (call: McpToolCall, progress: (fraction: number, message: string) => void, onCancel: (cb: () => void) => void) => Promise<McpToolResult>) => () => void;
  };
}
