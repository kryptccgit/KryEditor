import { app, Notification, shell } from 'electron';
import path from 'node:path';
import { resolveClientContext } from './identity';

const ctx = resolveClientContext();

export function notify(title: string, body: string, onClickPath?: string): void {
  try {
    if (!Notification.isSupported()) return;
    const iconPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'krypt.png')
      : path.join(__dirname, '..', '..', 'resources', 'krypt.png');
    const n = new Notification({ title: `${ctx.productName} · ${title}`, body, icon: iconPath, silent: true });
    if (onClickPath) {
      n.on('click', () => {
        shell.showItemInFolder(onClickPath);
      });
    }
    n.show();
  } catch {
  }
}
