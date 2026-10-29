#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const CLIENT = flag('--client') || process.env.KRYPT_MCP_CLIENT || 'mcp-client';
const NO_LAUNCH = argv.includes('--no-launch') || process.env.KRYPT_AUTOLAUNCH === '0';

function userDataDir() {
  const name = 'Krypt Editor';
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), name);
}
const CONFIG = flag('--config') || process.env.KRYPT_EDITOR_MCP_CONFIG || path.join(userDataDir(), 'mcp.json');
const MANIFEST = path.join(path.dirname(CONFIG), 'mcp-manifest.json');

if (argv.includes('--print-config-path')) {
  process.stdout.write(`${CONFIG}\n`);
  process.exit(0);
}

const LAUNCH_WAIT_MS = 25000;
const REPLAY_ID = 'krypt-replay-initialize';

function lineReader(stream, onLine) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.trim()) onLine(line);
    }
  });
}
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const log = (...a) => process.stderr.write(`[krypt-editor-mcp] ${a.join(' ')}\n`);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch {
    return null;
  }
}

let savedInit = null;
let conn = null;
let connecting = null;
const inflight = new Map();
const heldListens = [];

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(cfg.pipe);
    let buf = '';
    let done = false;
    const fail = (e) => {
      if (done) return;
      done = true;
      sock.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('timed out waiting for Krypt Editor')), 5000);
    sock.once('error', fail);
    sock.on('connect', () => sock.write(`${JSON.stringify({ krypt: 'hello', token: cfg.token, client: CLIENT })}\n`));
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      clearTimeout(timer);
      sock.removeListener('data', onData);
      sock.removeListener('error', fail);
      let reply = null;
      try {
        reply = JSON.parse(buf.slice(0, nl));
      } catch {
      }
      if (!reply || reply.krypt !== 'ok') return fail(new Error((reply && reply.message) || 'Krypt Editor refused the connection'));
      done = true;
      const rest = buf.slice(nl + 1);
      resolve({ sock, rest });
    };
    sock.on('data', onData);
  });
}

function attach(sock, rest) {
  conn = sock;
  let buf = rest;
  const handle = (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg && msg.id === REPLAY_ID) return;
    if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) inflight.delete(JSON.stringify(msg.id));
    out(msg);
  };
  const drain = () => {
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.trim()) handle(line);
    }
  };
  drain();
  sock.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    drain();
  });
  const gone = () => {
    if (conn !== sock) return;
    conn = null;
    for (const [, id] of inflight) out({ jsonrpc: '2.0', id, error: { code: -32603, message: 'Krypt Editor closed while handling this request. Retry to reopen it.' } });
    inflight.clear();
  };
  sock.on('close', gone);
  sock.on('error', gone);
}

function send(msg) {
  if (msg.id !== undefined && msg.method) inflight.set(JSON.stringify(msg.id), msg.id);
  conn.write(`${JSON.stringify(msg)}\n`);
}

function launchApp(cfg) {
  if (NO_LAUNCH || !cfg || !cfg.appExePath || !fs.existsSync(cfg.appExePath)) return false;
  try {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(cfg.appExePath, [...(cfg.appArgs || []), `--launched-by-agent=${CLIENT}`], { detached: true, stdio: 'ignore', env, windowsHide: false });
    child.unref();
    return true;
  } catch (e) {
    log('launch failed:', e.message);
    return false;
  }
}

async function ensureConnected(launch) {
  if (conn) return true;
  if (connecting) return connecting;
  connecting = (async () => {
    const tryOnce = async () => {
      const cfg = readJson(CONFIG);
      if (!cfg || !cfg.pipe || !cfg.token) return false;
      try {
        const { sock, rest } = await connect(cfg);
        attach(sock, rest);
        if (savedInit) {
          send({ ...savedInit, id: REPLAY_ID });
          inflight.delete(JSON.stringify(REPLAY_ID));
          sock.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        }
        for (const m of heldListens.splice(0)) send(m);
        return true;
      } catch {
        return false;
      }
    };
    if (await tryOnce()) return true;
    if (!launch || !launchApp(readJson(CONFIG))) return false;
    const until = Date.now() + LAUNCH_WAIT_MS;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 500));
      if (await tryOnce()) return true;
    }
    return false;
  })();
  try {
    return await connecting;
  } finally {
    connecting = null;
  }
}

const LIST_METHODS = new Set(['tools/list', 'prompts/list', 'resources/list', 'resources/templates/list']);

function offlineAnswer(msg) {
  const man = readJson(MANIFEST);
  if (!man) return null;
  if (msg.method === 'initialize') {
    const init = man.legacy && man.legacy.initialize;
    if (!init || init.error) return null;
    const asked = msg.params && msg.params.protocolVersion;
    const versions = man.legacyVersions || [];
    return { ...init, protocolVersion: versions.includes(asked) ? asked : init.protocolVersion };
  }
  if (msg.method === 'server/discover') {
    const d = man.modern && man.modern['server/discover'];
    return d && !d.error ? d : null;
  }
  if (LIST_METHODS.has(msg.method)) {
    const modern = !!(msg.params && msg.params._meta && msg.params._meta['io.modelcontextprotocol/protocolVersion']);
    const src = (modern ? man.modern : man.legacy) || man.legacy;
    const r = src && src[msg.method];
    return r && !r.error ? r : null;
  }
  return null;
}

const notRunning = 'Krypt Editor isn\'t running. Open Krypt Editor, then retry.';

async function onClientMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.method === 'initialize' && msg.id !== undefined) savedInit = msg;
  const isRequest = msg.id !== undefined && typeof msg.method === 'string';

  if (conn) return send(msg);

  if (!isRequest) return;

  if (msg.method === 'ping') return out({ jsonrpc: '2.0', id: msg.id, result: {} });

  if (msg.method === 'subscriptions/listen') {
    if (await ensureConnected(false)) return send(msg);
    heldListens.push(msg);
    return;
  }

  if (msg.method === 'initialize' || msg.method === 'server/discover' || LIST_METHODS.has(msg.method)) {
    if (await ensureConnected(false)) return send(msg);
    const answer = offlineAnswer(msg);
    if (answer) return out({ jsonrpc: '2.0', id: msg.id, result: answer });
    return out({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `${notRunning} (No cached tool list yet: start Krypt Editor once.)` } });
  }

  if (await ensureConnected(true)) return send(msg);
  if (msg.method === 'tools/call') return out({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: notRunning }], isError: true } });
  return out({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: notRunning } });
}

let chain = Promise.resolve();
lineReader(process.stdin, (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  chain = chain.then(() => onClientMessage(msg)).catch((e) => log('error:', e && e.message));
});
process.stdin.on('end', () => {
  chain.finally(() => {
    if (conn) conn.end();
    process.exit(0);
  });
});
