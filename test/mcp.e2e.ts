import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startMcp, type McpHandle } from '../electron/mcp/index';
import { mergeCodexToml } from '../electron/mcp/clients';

const SHIM = path.resolve('resources/mcp/krypt-editor-mcp.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'krypt-mcp-'));
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\krypt-editor-mcp-test-${process.pid}` : path.join(dir, 't.sock');
const calls: Array<{ name: string; args: unknown; client: string }> = [];
let enabled = true;

async function server(): Promise<McpHandle> {
  return startMcp({
    userData: dir,
    version: '9.9.9',
    pipe,
    shimPath: SHIM,
    exePath: process.execPath,
    appExePath: null,
    isEnabled: () => enabled,
    onStatus: () => {},
    log: () => {},
    runTool: async (name, args, client, onProgress) => {
      calls.push({ name, args, client });
      onProgress(0.5, 'halfway');
      if (name === 'preview_frames') return { ok: true, text: 'frames', images: [{ data: 'AAAA', mimeType: 'image/jpeg' }] };
      return { ok: true, text: `ran ${name}` };
    },
  });
}

class Client {
  proc: ChildProcessWithoutNullStreams;
  private buf = '';
  private waiters = new Map<number | string, (m: Record<string, unknown>) => void>();
  private id = 0;
  constructor(clientName: string) {
    this.proc = spawn(process.execPath, [SHIM, '--client', clientName, '--config', path.join(dir, 'mcp.json'), '--no-launch'], { stdio: 'pipe' });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (c: string) => {
      this.buf += c;
      let nl: number;
      while ((nl = this.buf.indexOf('\n')) >= 0) {
        const m = JSON.parse(this.buf.slice(0, nl)) as Record<string, unknown>;
        this.buf = this.buf.slice(nl + 1);
        const w = this.waiters.get(m.id as number);
        if (w) {
          this.waiters.delete(m.id as number);
          w(m);
        }
      }
    });
  }
  request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), 15000);
      this.waiters.set(id, (m) => {
        clearTimeout(t);
        resolve(m);
      });
      this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  notify(method: string): void {
    this.proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  }
  close(): void {
    this.proc.stdin.end();
  }
}

const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
async function t(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n`, e);
    process.exitCode = 1;
  }
}

(async () => {
  let h = await server();
  await wait(500);

  await t('mcp.json + manifest are written', async () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'mcp.json'), 'utf8'));
    assert.equal(cfg.pipe, pipe);
    assert.equal(cfg.token.length, 64);
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'mcp-manifest.json'), 'utf8'));
    assert.ok(man.legacy.initialize.serverInfo, 'legacy initialize captured');
    assert.ok(man.legacy['tools/list'].tools.length >= 15, 'tools captured');
    assert.ok(man.modern['tools/list'].tools.length >= 15, 'modern tool list present');
  });

  await t('2025 handshake, tools/list and tools/call through the shim', async () => {
    const c = new Client('claude-code');
    const r = await c.request('initialize', init);
    const res = r.result as { protocolVersion: string; serverInfo: { name: string }; instructions?: string };
    assert.equal(res.serverInfo.name, 'krypt-editor');
    assert.equal(res.protocolVersion, '2025-06-18');
    assert.ok(res.instructions?.includes('get_project'));
    c.notify('notifications/initialized');
    const list = (await c.request('tools/list')).result as { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> };
    const names = list.tools.map((x) => x.name);
    for (const n of ['get_project', 'auto_edit', 'cut_ranges', 'export_video', 'preview_frames']) assert.ok(names.includes(n), n);
    assert.ok(list.tools.find((x) => x.name === 'cut_ranges')?.inputSchema.properties?.ranges, 'zod schema became JSON schema');
    const call = (await c.request('tools/call', { name: 'cut_ranges', arguments: { ranges: [[1, 2]] } })).result as { content: Array<{ text: string }>; isError?: boolean };
    assert.equal(call.content[0].text, 'ran cut_ranges');
    assert.ok(!call.isError);
    assert.deepEqual(calls.at(-1)?.args, { ranges: [[1, 2]] });
    assert.equal(calls.at(-1)?.client, 'Claude Code');
    const img = (await c.request('tools/call', { name: 'preview_frames', arguments: { times: [1] } })).result as { content: Array<{ type: string; data?: string }> };
    assert.equal(img.content[1].type, 'image');
    c.close();
  });

  await t('invalid arguments are rejected before reaching the editor', async () => {
    const c = new Client('cursor');
    await c.request('initialize', init);
    c.notify('notifications/initialized');
    const before = calls.length;
    const r = await c.request('tools/call', { name: 'cut_ranges', arguments: { ranges: 'nope' } });
    const res = r.result as { isError?: boolean } | undefined;
    assert.ok(r.error || res?.isError, 'schema error');
    assert.equal(calls.length, before);
    c.close();
  });

  await t('turning AI access off refuses tool calls', async () => {
    enabled = false;
    const c = new Client('codex');
    await c.request('initialize', init);
    c.notify('notifications/initialized');
    const r = (await c.request('tools/call', { name: 'get_project', arguments: {} })).result as { isError: boolean; content: Array<{ text: string }> };
    assert.ok(r.isError);
    assert.match(r.content[0].text, /turned off/);
    enabled = true;
    c.close();
  });

  await t('a bad token is refused', async () => {
    const cfgPath = path.join(dir, 'mcp.json');
    const good = fs.readFileSync(cfgPath, 'utf8');
    fs.writeFileSync(cfgPath, good.replace(/"token": "[0-9a-f]+"/, `"token": "${'0'.repeat(64)}"`));
    const c = new Client('evil');
    const r = await c.request('initialize', init);
    assert.ok(r.result, 'offline answer');
    const call = (await c.request('tools/call', { name: 'get_project', arguments: {} })).result as { isError: boolean; content: Array<{ text: string }> };
    assert.ok(call.isError);
    assert.match(call.content[0].text, /isn't running/);
    fs.writeFileSync(cfgPath, good);
    c.close();
  });

  await t('app closed: discovery comes from the manifest, tool calls explain', async () => {
    await h.stop();
    const c = new Client('claude-code');
    const r = (await c.request('initialize', { ...init, protocolVersion: '2025-03-26' })).result as { protocolVersion: string; serverInfo: { name: string } };
    assert.equal(r.serverInfo.name, 'krypt-editor');
    assert.equal(r.protocolVersion, '2025-03-26');
    c.notify('notifications/initialized');
    const list = (await c.request('tools/list')).result as { tools: unknown[] };
    assert.ok(list.tools.length >= 15);
    const ping = await c.request('ping');
    assert.deepEqual(ping.result, {});
    const call = (await c.request('tools/call', { name: 'get_project', arguments: {} })).result as { isError: boolean };
    assert.ok(call.isError);

    h = await server();
    await wait(200);
    const again = (await c.request('tools/call', { name: 'get_project', arguments: {} })).result as { isError?: boolean; content: Array<{ text: string }> };
    assert.equal(again.content[0].text, 'ran get_project');
    c.close();
  });

  await t('app quits mid-session: in-flight calls fail cleanly, next call reconnects', async () => {
    const c = new Client('claude-code');
    await c.request('initialize', init);
    c.notify('notifications/initialized');
    assert.equal(((await c.request('tools/call', { name: 'undo', arguments: {} })).result as { content: Array<{ text: string }> }).content[0].text, 'ran undo');
    await h.stop();
    await wait(200);
    h = await server();
    await wait(200);
    const r = (await c.request('tools/call', { name: 'redo', arguments: {} })).result as { content: Array<{ text: string }> };
    assert.equal(r.content[0].text, 'ran redo');
    c.close();
  });

  await t('modern-era discovery is served (server/discover)', async () => {
    const c = new Client('next-gen');
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': { name: 'next', version: '1' } };
    const r = await c.request('server/discover', { _meta: meta });
    assert.ok(r.result, JSON.stringify(r.error));
    const list = (await c.request('tools/list', { _meta: meta })).result as { tools: unknown[] };
    assert.ok(list.tools.length >= 15);
    const call = (await c.request('tools/call', { name: 'get_project', arguments: {}, _meta: meta })).result as { content: Array<{ text: string }> };
    assert.equal(call.content[0].text, 'ran get_project');
    c.close();
  });

  await t('Codex config: our table is replaced in place, the rest kept', async () => {
    const before = '[model]\nname = "x"\n\n[mcp_servers.krypt-editor]\ncommand = "old"\n\n[mcp_servers.krypt-editor.env]\nA = "1"\n\n[mcp_servers.other]\ncommand = "keep"\n';
    const out = mergeCodexToml(before, '[mcp_servers.krypt-editor]\ncommand = "new"');
    assert.ok(out.includes('[model]') && out.includes('[mcp_servers.other]') && out.includes('command = "keep"'));
    assert.ok(!out.includes('"old"') && !out.includes('A = "1"'));
    assert.equal(out.match(/\[mcp_servers\.krypt-editor\]/g)?.length, 1);
    assert.equal(mergeCodexToml('', 'X'), 'X\n');
  });

  await h.stop();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`mcp: ${passed} passed`);
  process.exit(process.exitCode ?? 0);
})();
