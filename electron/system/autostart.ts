import { app } from 'electron';

export function setStartWithWindows(enabled: boolean): void {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return;
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings(
      process.platform === 'darwin'
        ? { openAtLogin: enabled }
        : { openAtLogin: enabled, args: enabled ? ['--hidden'] : [] },
    );
  } catch (err) {
    console.warn('[autostart] failed to set login item:', err);
  }
}

export function isStartWithWindows(): boolean {
  if (process.platform !== 'win32' && process.platform !== 'darwin') return false;
  if (!app.isPackaged) return false;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return false;
  }
}
