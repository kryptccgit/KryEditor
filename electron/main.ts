import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import type { MediaFile } from '../shared/types';
import { registerIpc } from './ipc';
import * as store from './system/settings-store';
import * as files from './system/files';
import * as tray from './system/tray';
import * as discord from './system/discord';
import * as mediaProtocol from './system/mediaProtocol';
import { setStartWithWindows } from './system/autostart';
import { resolveClientContext } from './system/identity';
import { logger } from './system/logger';
import { startAgentHost } from './mcp/host';

process.env.DIST_ELECTRON = __dirname;
process.env.DIST = path.join(__dirname, '..', 'dist');
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(__dirname, '..', 'public');

const ctx = resolveClientContext();

mediaProtocol.registerScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const win = showMainWindow();
    deliverOpenMedia(win, mediaArgs(argv));
  });
  app.on('open-file', (e, filePath) => {
    e.preventDefault();
    if (app.isReady()) {
      deliverOpenMedia(showMainWindow(), [filePath]);
    } else {
      earlyOpenPaths.push(filePath);
    }
  });
  app.whenReady().then(bootstrap);
}

let mainWindow: BrowserWindow | null = null;
let isQuitting = false;

let launchFiles: MediaFile[] = [];
const earlyOpenPaths: string[] = [];

function mediaArgs(argv: string[]): string[] {
  return argv.slice(1).filter((a) => a && a !== '.' && !a.startsWith('-'));
}

function deliverOpenMedia(win: BrowserWindow, paths: string[]): void {
  const resolved = files.resolveMediaFiles(paths);
  if (resolved.length === 0) return;
  const send = (): void => {
    if (!win.isDestroyed()) win.webContents.send('media:opened', resolved);
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
  else send();
}

function showMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1024,
    minHeight: 660,
    backgroundColor: '#0A0A0F',
    title: ctx.productName,
    autoHideMenuBar: true,
    icon: path.join(
      app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', 'resources'),
      process.platform === 'win32' ? 'krypt.ico' : 'krypt.png',
    ),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: !app.isPackaged,
    },
    show: false,
  });

  const reveal = (): void => {
    if (win.isDestroyed() || win.isVisible()) return;
    win.show();
    win.focus();
  };
  win.once('ready-to-show', reveal);
  win.webContents.once('did-finish-load', reveal);
  const revealTimer = setTimeout(reveal, 4000);

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logger.error(`mainWindow: did-fail-load ${code} "${desc}" ${url}`);
    reveal();
  });

  win.on('close', (e) => {
    if (isQuitting) return;
    e.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    clearTimeout(revealTimer);
    if (mainWindow === win) mainWindow = null;
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl).catch((err) => logger.error(`loadURL failed: ${err}`));
  } else {
    win.loadFile(path.join(process.env.DIST!, 'index.html')).catch((err) => logger.error(`loadFile failed: ${err}`));
  }
  mainWindow = win;
  return win;
}

async function bootstrap(): Promise<void> {
  mediaProtocol.installHandler();

  if (process.platform === 'darwin') {
    const { Menu } = await import('electron');
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'fileMenu' },
        { role: 'editMenu' },
        ...(app.isPackaged ? [] : [{ role: 'viewMenu' } as const]),
        { role: 'windowMenu' },
      ]),
    );
  }

  launchFiles = files.resolveMediaFiles([...mediaArgs(process.argv), ...earlyOpenPaths.splice(0)]);

  registerIpc({
    showMainWindow,
    takeLaunchFiles: () => {
      const f = launchFiles;
      launchFiles = [];
      return f;
    },
  });
  void startAgentHost({ getMainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null), showMainWindow });

  if (app.isPackaged) setStartWithWindows(true);

  const launchedAtLogin =
    (() => {
      try {
        const s = app.getLoginItemSettings();
        return s.wasOpenedAtLogin === true || s.wasOpenedAsHidden === true;
      } catch {
        return false;
      }
    })() || process.argv.some((a) => a === '--hidden' || a === '--autostart');

  if (!launchedAtLogin) showMainWindow();

  tray.installTray({
    show: () => showMainWindow(),
    quit: () => {
      isQuitting = true;
      app.quit();
    },
  });

  discord.startDiscordRpc().catch(() => {});
  discord.setActivity('Idle', 'Editing video');

  logger.info(`${ctx.productName} ready`);
}

app.on('before-quit', () => {
  isQuitting = true;
  discord.stopDiscordRpc();
  tray.destroyTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (app.isReady()) showMainWindow();
});

process.on('uncaughtException', (err) => logger.error(`uncaughtException: ${err?.stack ?? err}`));
process.on('unhandledRejection', (reason) => logger.error(`unhandledRejection: ${String(reason)}`));
app.on('render-process-gone', (_e, _wc, details) => logger.error(`render-process-gone: ${details.reason} (${details.exitCode})`));
app.on('child-process-gone', (_e, details) => logger.error(`child-process-gone: ${details.type}/${details.name ?? ''} ${details.reason}`));
