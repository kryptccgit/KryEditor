import path from 'node:path';

const allowed = new Set<string>();

function norm(p: string): string {
  const resolved = path.resolve(p.normalize('NFC'));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function allowPath(p: string): void {
  if (p) allowed.add(norm(p));
}

export function allowPaths(paths: string[]): void {
  for (const p of paths) allowPath(p);
}

export function isAllowed(p: string): boolean {
  return allowed.has(norm(p));
}
