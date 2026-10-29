import { app, Menu, nativeImage, Tray } from 'electron';
import path from 'node:path';
import { resolveClientContext } from './identity';

export interface TrayHandlers {
  show: () => void;
  quit: () => void;
}

const ctx = resolveClientContext();
let tray: Tray | null = null;
let handlers: TrayHandlers | null = null;

export function installTray(h: TrayHandlers): void {
  if (tray) return;
  handlers = h;
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'krypt.png')
    : path.join(__dirname, '..', '..', 'resources', 'krypt.png');
  let img = nativeImage.createFromPath(iconPath);
  const size = process.platform === 'darwin' ? 18 : 16;
  img = img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: size, height: size, quality: 'best' });
  tray = new Tray(img);
  tray.setToolTip(ctx.productName);
  tray.on('click', () => h.show());
  rebuildMenu();
}

export function rebuildMenu(): void {
  if (!tray || !handlers) return;
  const menu = Menu.buildFromTemplate([
    { label: `Open ${ctx.productName}`, click: () => handlers!.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => handlers!.quit() },
  ]);
  tray.setContextMenu(menu);
}

export function destroyTray(): void {
  try {
    tray?.destroy();
  } catch {
  }
  tray = null;
  handlers = null;
}
