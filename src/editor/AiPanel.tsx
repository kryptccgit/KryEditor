import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Loader2, Plug, Sparkles, XCircle } from 'lucide-react';
import type { McpActivity, McpClientSnippet, McpStatus } from '@shared/types';
import { PrimaryButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { cls } from '../utils/format';

export function useMcpStatus(): McpStatus | null {
  const [status, setStatus] = useState<McpStatus | null>(null);
  useEffect(() => {
    const api = window.krypt?.mcp;
    if (!api) return;
    let alive = true;
    void api.status().then((s) => alive && setStatus(s));
    const off = api.onStatus((s) => setStatus(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

const EXAMPLES = [
  'Use krypt-editor to cut the pauses out of my video.',
  'Remove every part where I talk about sponsors, then add captions.',
  'Make it vertical for TikTok with a blurred background and a title "Day 1" for the first 3 seconds.',
  'Give it a VHS look, crossfade between the cuts, and slowly zoom in on the intro.',
  'Export it to my Desktop as final.mp4.',
];

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

export function AiPanel() {
  const toast = useToast();
  const status = useMcpStatus();
  const [snippets, setSnippets] = useState<McpClientSnippet[]>([]);
  const [pick, setPick] = useState('claude-code');
  const [allowAll, setAllowAll] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSnippet, setShowSnippet] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    void window.krypt?.mcp?.snippets().then(setSnippets);
  }, []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const current = snippets.find((s) => s.id === pick);
  const activity = useMemo(() => [...(status?.activity ?? [])].reverse(), [status]);

  const toggle = async (on: boolean): Promise<void> => {
    await window.krypt.mcp.setEnabled(on);
  };
  const connect = async (): Promise<void> => {
    if (!current) return;
    setBusy(true);
    try {
      const r = await window.krypt.mcp.install(current.id, { allowAll });
      if (r.ok) toast.success(r.message ?? `Connected ${current.label}.`);
      else {
        toast.error(r.message ?? `Couldn't connect ${current.label}.`);
        setShowSnippet(true);
      }
    } finally {
      setBusy(false);
    }
  };
  const copy = async (): Promise<void> => {
    if (!current) return;
    await window.krypt.app.copyText(current.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!status) {
    return <div className="p-4 text-xs text-krypt-muted">Starting the agent bridge…</div>;
  }
  const state = !status.listening ? 'error' : !status.enabled ? 'off' : status.clients.length > 0 ? 'connected' : 'ready';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 pt-2">
      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="flex items-center gap-2">
          <span
            className={cls(
              'h-2 w-2 flex-shrink-0 rounded-full',
              state === 'connected' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : state === 'ready' ? 'bg-krypt-purple' : state === 'off' ? 'bg-white/30' : 'bg-red-400',
            )}
          />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">
            {state === 'connected'
              ? `${status.clients.map((c) => c.name).join(', ')} connected`
              : state === 'ready'
                ? 'Ready for AI agents'
                : state === 'off'
                  ? 'AI access is off'
                  : 'Agent bridge unavailable'}
          </span>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-krypt-muted" title="Let connected AI agents edit this project">
            <input type="checkbox" checked={status.enabled} onChange={(e) => void toggle(e.target.checked)} className="accent-krypt-purple" />
            Allow
          </label>
        </div>
        <p className="mt-1.5 text-[11px] leading-snug text-krypt-muted">
          {status.error
            ? status.error
            : `AI coding agents can edit this project live through ${status.toolCount} tools (cut, auto edit, captions, titles, export…). Every change is one undo step.`}
        </p>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
          <Plug className="h-3.5 w-3.5 text-krypt-purple" />
          Connect an AI
        </div>
        <div className="flex flex-wrap gap-1">
          {snippets.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setPick(s.id);
                setShowSnippet(s.id === 'other');
              }}
              className={cls(
                'rounded-md px-2 py-1 text-[11px] font-semibold transition',
                pick === s.id ? 'bg-krypt-purple/25 text-white ring-1 ring-krypt-purple/60' : 'bg-white/5 text-krypt-muted hover:text-white',
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        {current && (
          <div className="mt-2 space-y-2">
            <p className="text-[11px] leading-snug text-krypt-muted">{current.description}</p>
            {current.id === 'claude-code' && (
              <label className="flex cursor-pointer items-start gap-1.5 text-[11px] text-krypt-muted">
                <input type="checkbox" checked={allowAll} onChange={(e) => setAllowAll(e.target.checked)} className="mt-0.5 accent-krypt-purple" />
                <span>Don&apos;t ask before each step (adds mcp__krypt-editor to your Claude Code permissions; every edit stays undoable)</span>
              </label>
            )}
            <div className="flex items-center gap-2">
              {current.installable && (
                <PrimaryButton onClick={() => void connect()} disabled={busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                  Connect {current.label}
                </PrimaryButton>
              )}
              <button onClick={() => setShowSnippet((v) => !v)} className="flex items-center gap-0.5 text-[11px] text-krypt-muted transition hover:text-white">
                {showSnippet ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {current.installable ? 'Set up by hand' : 'Config'}
              </button>
            </div>
            {showSnippet && (
              <div className="relative">
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-white/10 bg-black/50 p-2 pr-8 font-mono text-[10px] leading-relaxed text-white/85">{current.snippet}</pre>
                <button onClick={() => void copy()} title="Copy" className="absolute right-1.5 top-1.5 rounded-md p-1 text-krypt-muted transition hover:bg-white/10 hover:text-white">
                  {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3">
        <div className="mb-2 text-xs font-semibold text-white">Activity</div>
        {activity.length === 0 ? (
          <div className="space-y-1.5">
            <p className="text-[11px] text-krypt-muted">Nothing yet. Once connected, try asking:</p>
            {EXAMPLES.map((e) => (
              <p key={e} className="rounded-md bg-white/5 px-2 py-1 text-[11px] italic text-white/75">
                “{e}”
              </p>
            ))}
          </div>
        ) : (
          <ul className="space-y-1">
            {activity.map((a) => (
              <ActivityRow key={a.id} a={a} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ a }: { a: McpActivity }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-md bg-white/[0.03] px-2 py-1.5">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-1.5 text-left">
        {a.state === 'running' ? (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-krypt-purple" />
        ) : a.state === 'ok' ? (
          <CheckCircle2 className="h-3 w-3 flex-shrink-0 text-emerald-400" />
        ) : (
          <XCircle className="h-3 w-3 flex-shrink-0 text-red-400" />
        )}
        <span className="font-mono text-[11px] text-white">{a.tool}</span>
        <span className="min-w-0 flex-1 truncate text-[10px] text-krypt-muted">{a.client}</span>
        <span className="flex-shrink-0 text-[10px] text-krypt-muted">{a.state === 'running' ? 'running' : ago(a.ts)}</span>
      </button>
      {(open || a.state === 'error') && a.result && (
        <p className={cls('mt-1 break-words text-[10px] leading-snug', a.state === 'error' ? 'text-red-300/90' : 'text-krypt-muted')}>
          {a.state === 'error' && <AlertTriangle className="mr-1 inline h-3 w-3" />}
          {a.result}
        </p>
      )}
      {open && a.args && <p className="mt-1 break-all font-mono text-[10px] text-white/50">{a.args}</p>}
    </li>
  );
}

export function AiButton() {
  const status = useMcpStatus();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const busy = !!status?.activity.some((a) => a.state === 'running');
  const live = !!status && status.enabled && status.clients.length > 0;
  const title = !status
    ? 'AI agents'
    : !status.listening
      ? 'Agent bridge unavailable'
      : !status.enabled
        ? 'AI access is off'
        : live
          ? `${status.clients.map((c) => c.name).join(', ')} connected`
          : 'Connect Claude Code, Codex, Cursor… to edit this project';
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        title={title}
        className={cls(
          'group flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition',
          open ? 'border-krypt-purple/50 bg-krypt-purple/15 text-white' : 'border-white/10 bg-white/5 text-krypt-muted hover:border-krypt-purple/40 hover:bg-krypt-purple/10 hover:text-white',
        )}
      >
        <Sparkles className={cls('h-3.5 w-3.5 transition', busy ? 'animate-pulse text-krypt-purple' : 'group-hover:text-krypt-purple')} />
        AI agents
        <span
          className={cls(
            'h-1.5 w-1.5 rounded-full',
            !status || !status.listening ? 'bg-red-400' : !status.enabled ? 'bg-white/30' : live ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]' : 'bg-krypt-purple',
          )}
        />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[calc(100vh-80px)] w-[380px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-krypt-panel/95 shadow-krypt-card backdrop-blur-md animate-fade-in">
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2.5">
            <Sparkles className="h-4 w-4 text-krypt-purple" />
            <span className="text-sm font-bold text-white">AI agents</span>
            <span className="text-[11px] text-krypt-muted">let an AI edit your project</span>
          </div>
          <AiPanel />
        </div>
      )}
    </div>
  );
}
