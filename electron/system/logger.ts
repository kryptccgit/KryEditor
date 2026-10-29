import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  ts: string;
}

let logFile: string | null = null;
function fileSink(): string | null {
  try {
    if (!logFile) {
      logFile = path.join(app.getPath('userData'), 'krypt.log');
      try {
        if (fs.statSync(logFile).size > 1_000_000) fs.writeFileSync(logFile, '');
      } catch {
      }
    }
    return logFile;
  } catch {
    return null;
  }
}

function emit(entry: LogEntry): void {
  const tag = entry.level === 'error' ? '\x1b[31m' : entry.level === 'warn' ? '\x1b[33m' : '\x1b[36m';
  const reset = '\x1b[0m';
  console.log(`${tag}[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}${reset}`);
  try {
    const p = fileSink();
    if (p) fs.appendFileSync(p, `[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}\n`);
  } catch {
  }
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) {
      w.webContents.send('log:append', entry);
    }
  }
}

export const logger = {
  info(message: string): void {
    emit({ level: 'info', message, ts: new Date().toISOString() });
  },
  warn(message: string): void {
    emit({ level: 'warn', message, ts: new Date().toISOString() });
  },
  error(message: string): void {
    emit({ level: 'error', message, ts: new Date().toISOString() });
  },
};
