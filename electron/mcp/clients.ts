import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { ActionResult, McpClientSnippet } from '../../shared/types';
import { SERVER_NAME } from './index';

const ENV = { ELECTRON_RUN_AS_NODE: '1' };

const appData = (): string =>
  process.platform === 'win32'
    ? (process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'))
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const localAppData = (): string => process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');

interface Launch {
  exe: string;
  shim: string;
}

type JsonKey = 'mcpServers' | 'servers';
interface JsonTarget {
  id: string;
  label: string;
  files: () => string[];
  detect: () => string;
  key: JsonKey;
  entry: (l: Launch) => Record<string, unknown>;
  where: string;
  after: string;
}

const stdioEntry = (client: string, typed: boolean) => (l: Launch): Record<string, unknown> => ({
  ...(typed ? { type: 'stdio' } : {}),
  command: l.exe,
  args: [l.shim, '--client', client],
  env: ENV,
});

function claudeDesktopFiles(): string[] {
  const out = [path.join(appData(), 'Claude', 'claude_desktop_config.json')];
  if (process.platform !== 'win32') return out;
  try {
    const pkgs = path.join(localAppData(), 'Packages');
    for (const d of fs.readdirSync(pkgs)) {
      if (!/^Claude_/i.test(d)) continue;
      const dir = path.join(pkgs, d, 'LocalCache', 'Roaming', 'Claude');
      if (fs.existsSync(dir)) out.push(path.join(dir, 'claude_desktop_config.json'));
    }
  } catch {
  }
  return out;
}

const JSON_TARGETS: JsonTarget[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    files: () => [path.join(os.homedir(), '.cursor', 'mcp.json')],
    detect: () => path.join(os.homedir(), '.cursor'),
    key: 'mcpServers',
    entry: stdioEntry('cursor', true),
    where: '~/.cursor/mcp.json',
    after: 'Cursor picks it up within a few seconds (Settings → MCP shows it).',
  },
  {
    id: 'claude-desktop',
    label: 'Claude Desktop',
    files: claudeDesktopFiles,
    detect: () => path.join(appData(), 'Claude'),
    key: 'mcpServers',
    entry: stdioEntry('claude-desktop', false),
    where: 'claude_desktop_config.json',
    after: 'Fully quit Claude Desktop (tray icon → Quit) and reopen it.',
  },
  {
    id: 'vscode',
    label: 'VS Code',
    files: () => [path.join(appData(), 'Code', 'User', 'mcp.json')],
    detect: () => path.join(appData(), 'Code', 'User'),
    key: 'servers',
    entry: stdioEntry('vscode', true),
    where: 'your VS Code user mcp.json',
    after: 'Copilot agent mode lists it under MCP servers; start it there if asked.',
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    files: () => [path.join(os.homedir(), '.codeium', 'windsurf', 'mcp_config.json')],
    detect: () => path.join(os.homedir(), '.codeium', 'windsurf'),
    key: 'mcpServers',
    entry: stdioEntry('windsurf', false),
    where: '~/.codeium/windsurf/mcp_config.json',
    after: 'Press refresh in Cascade → MCP servers.',
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    files: () => [path.join(os.homedir(), '.gemini', 'settings.json')],
    detect: () => path.join(os.homedir(), '.gemini'),
    key: 'mcpServers',
    entry: stdioEntry('gemini-cli', false),
    where: '~/.gemini/settings.json',
    after: 'Start a new Gemini CLI session; /mcp lists it.',
  },
];

function shellQuote(s: string): string {
  if (!/[\s"'$`&|<>()^%!;]/.test(s)) return s;
  return process.platform === 'win32' ? `"${s.replace(/"/g, '""')}"` : `'${s.replace(/'/g, `'\\''`)}'`;
}

function claudeArgs(l: Launch): string[] {
  return ['mcp', 'add', '--scope', 'user', SERVER_NAME, '-e', 'ELECTRON_RUN_AS_NODE=1', '--', l.exe, l.shim, '--client', 'claude-code'];
}

function tomlString(s: string): string {
  return JSON.stringify(s);
}

function codexBlock(l: Launch): string {
  return [
    `[mcp_servers.${SERVER_NAME}]`,
    `command = ${tomlString(l.exe)}`,
    `args = [${[l.shim, '--client', 'codex'].map(tomlString).join(', ')}]`,
    `env = { ELECTRON_RUN_AS_NODE = "1" }`,
    'startup_timeout_sec = 30',
    'tool_timeout_sec = 3600',
  ].join('\n');
}

function codexConfigFile(): string {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

export function clientSnippets(exe: string, shim: string | null): McpClientSnippet[] {
  const l: Launch = { exe, shim: shim ?? '<krypt-editor-mcp.cjs is missing from this build>' };
  const json = (t: JsonTarget): string => JSON.stringify({ [t.key]: { [SERVER_NAME]: t.entry(l) } }, null, 2);
  const installable = !!shim;
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      description: 'Adds krypt-editor for all your projects (user scope) with the claude CLI. Then start a new session and ask Claude to edit your video.',
      snippet: `claude ${claudeArgs(l).map(shellQuote).join(' ')}`,
      installable,
    },
    {
      id: 'codex',
      label: 'Codex',
      description: `Adds a [mcp_servers.${SERVER_NAME}] table to ~/.codex/config.toml. Start a new Codex session afterwards.`,
      snippet: codexBlock(l),
      installable,
    },
    ...JSON_TARGETS.map((t) => ({ id: t.id, label: t.label, description: `Adds ${SERVER_NAME} to ${t.where}. ${t.after}`, snippet: json(t), installable })),
    {
      id: 'other',
      label: 'Other',
      description: 'Any MCP client that launches stdio servers: command, args and env below.',
      snippet: JSON.stringify({ command: l.exe, args: [l.shim, '--client', 'mcp-client'], env: ENV }, null, 2),
      installable: false,
    },
  ];
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function mergeJsonConfig(file: string, key: JsonKey, entry: Record<string, unknown>): { changed: boolean; backup: string | null } {
  let data: Record<string, unknown> = {};
  let original: string | null = null;
  if (fs.existsSync(file)) {
    original = fs.readFileSync(file, 'utf8');
    if (original.trim()) {
      try {
        const parsed: unknown = JSON.parse(original.replace(/^﻿/, ''));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not a JSON object');
        data = parsed as Record<string, unknown>;
      } catch (e) {
        throw new Error(`${file} isn't plain JSON (${(e as Error).message}), so it was left alone. Add the snippet by hand.`);
      }
    }
  }
  const cur = data[key];
  const servers = cur && typeof cur === 'object' && !Array.isArray(cur) ? (cur as Record<string, unknown>) : {};
  if (JSON.stringify(servers[SERVER_NAME]) === JSON.stringify(entry)) return { changed: false, backup: null };
  const next = { ...data, [key]: { ...servers, [SERVER_NAME]: entry } };
  let backup: string | null = null;
  if (original !== null) {
    backup = `${file}.bak`;
    fs.writeFileSync(backup, original, 'utf8');
  } else fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return { changed: true, backup };
}

export function mergeCodexToml(original: string, block: string): string {
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const header = new RegExp(`^\\s*\\[\\s*mcp_servers\\.(?:"${SERVER_NAME}"|${SERVER_NAME.replace(/-/g, '\\-')})(\\.[^\\]]*)?\\s*\\]\\s*(#.*)?$`);
  const anyHeader = /^\s*\[/;
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (header.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && anyHeader.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return `${out.join('\n')}${out.length > 0 ? '\n\n' : ''}${block}\n`;
}

function installCodex(l: Launch): ActionResult {
  const file = codexConfigFile();
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = mergeCodexToml(original, codexBlock(l));
  if (next === original) return { ok: true, message: `Codex already has ${SERVER_NAME}.` };
  if (original) fs.writeFileSync(`${file}.bak`, original, 'utf8');
  else fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, next);
  return { ok: true, message: `Connected Codex (${file}${original ? ', backup: config.toml.bak' : ''}). Start a new Codex session to use it.` };
}

function findClaude(): Promise<string | null> {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(finder, ['claude'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      const found = err ? [] : stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const exe = found.find((p) => /\.exe$/i.test(p)) ?? found[0];
      if (exe) return resolve(exe);
      const guess = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
      resolve(fs.existsSync(guess) ? guess : null);
    });
  });
}

function cmdQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

function runClaude(bin: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    const done = (err: Error | null, stdout: string, stderr: string): void =>
      resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() || (err ? err.message : '') });
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
      const line = [bin, ...args].map(cmdQuote).join(' ');
      execFile('cmd.exe', ['/d', '/s', '/c', `"${line}"`], { windowsHide: true, timeout: 30_000, windowsVerbatimArguments: true }, (e, o, er) => done(e, o, er));
    } else {
      execFile(bin, args, { windowsHide: true, timeout: 30_000 }, (e, o, er) => done(e, o, er));
    }
  });
}

export const CLAUDE_CODE_ALLOW_RULE = `mcp__${SERVER_NAME}`;

function claudeSettingsFile(): string {
  return path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'settings.json');
}

export function allowClaudeCodeTools(file = claudeSettingsFile()): boolean {
  let data: Record<string, unknown> = {};
  let original: string | null = null;
  if (fs.existsSync(file)) {
    original = fs.readFileSync(file, 'utf8');
    if (original.trim()) {
      const parsed: unknown = JSON.parse(original.replace(/^﻿/, ''));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} isn't a JSON object`);
      data = parsed as Record<string, unknown>;
    }
  }
  const perms = data.permissions && typeof data.permissions === 'object' && !Array.isArray(data.permissions) ? (data.permissions as Record<string, unknown>) : {};
  const allow = Array.isArray(perms.allow) ? (perms.allow as unknown[]) : [];
  if (allow.includes(CLAUDE_CODE_ALLOW_RULE)) return false;
  const next = { ...data, permissions: { ...perms, allow: [...allow, CLAUDE_CODE_ALLOW_RULE] } };
  if (original !== null) fs.writeFileSync(`${file}.bak`, original, 'utf8');
  else fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
  return true;
}

async function installClaudeCode(l: Launch, allowAll: boolean): Promise<ActionResult> {
  const bin = await findClaude();
  const manual = `claude ${claudeArgs(l).map(shellQuote).join(' ')}`;
  if (!bin) return { ok: false, message: `The Claude Code CLI ("claude") wasn't found. Run this in a terminal instead: ${manual}` };
  let r = await runClaude(bin, claudeArgs(l));
  if (!r.ok && /already exists/i.test(r.out)) {
    await runClaude(bin, ['mcp', 'remove', '--scope', 'user', SERVER_NAME]);
    r = await runClaude(bin, claudeArgs(l));
  }
  if (!r.ok) return { ok: false, message: `claude mcp add failed: ${r.out.slice(0, 300)}` };
  let note = '';
  if (allowAll) {
    try {
      note = allowClaudeCodeTools() ? ' It can use Krypt Editor without asking before each step.' : '';
    } catch (e) {
      note = ` (Claude Code will still ask before each step: ${(e as Error).message})`;
    }
  }
  return { ok: true, message: `Connected Claude Code (user scope).${note} Start a new Claude Code session to use it.` };
}

export async function installClient(id: string, exe: string, shim: string | null, opts: { allowAll?: boolean } = {}): Promise<ActionResult> {
  if (!shim) return { ok: false, message: 'The agent bridge (krypt-editor-mcp.cjs) is missing from this build.' };
  const l: Launch = { exe, shim };
  try {
    if (id === 'claude-code') return await installClaudeCode(l, opts.allowAll !== false);
    if (id === 'codex') return installCodex(l);
    const t = JSON_TARGETS.find((x) => x.id === id);
    if (!t) return { ok: false, message: `Unknown client "${id}".` };
    if (!fs.existsSync(t.detect())) return { ok: false, message: `${t.label} doesn't seem to be installed (no ${t.detect()}). Install it first, or copy the snippet by hand.` };
    const done: string[] = [];
    for (const file of t.files()) {
      const r = mergeJsonConfig(file, t.key, t.entry(l));
      done.push(r.changed ? `${file}${r.backup ? ' (backup kept)' : ''}` : `${file} (already set)`);
    }
    return { ok: true, message: `Connected ${t.label}: ${done.join('; ')}. ${t.after}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
