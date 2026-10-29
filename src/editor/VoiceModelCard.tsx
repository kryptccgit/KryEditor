import { useCallback, useEffect, useState } from 'react';
import { Check, Download, Trash2, X } from 'lucide-react';
import type { KokoroStatus } from '@shared/types';
import { GhostButton, PrimaryButton } from '../components/common';
import { fmtBytes } from '../utils/format';

const STAGE: Record<string, string> = { downloading: 'Downloading', copying: 'Copying from Krypt Studio', verifying: 'Checking' };

export function useVoiceModel(): { status: KokoroStatus | null; error: string | null; download: () => Promise<void>; cancel: () => void; remove: () => Promise<void> } {
  const [status, setStatus] = useState<KokoroStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => void window.krypt.tts.kokoroStatus().then(setStatus), []);

  useEffect(() => {
    refresh();
    const offState = window.krypt.tts.onKokoroState(setStatus);
    const offProgress = window.krypt.tts.onKokoroProgress((progress) => setStatus((s) => s && { ...s, installing: true, progress }));
    return () => {
      offState();
      offProgress();
    };
  }, [refresh]);

  const download = async (): Promise<void> => {
    setError(null);
    const r = await window.krypt.tts.kokoroEnsure();
    if (!r.ok && !/cancelled/i.test(r.message ?? '')) setError(r.message ?? 'The download failed.');
    refresh();
  };
  const remove = async (): Promise<void> => {
    const r = await window.krypt.tts.kokoroRemove();
    if (!r.ok) setError(r.message ?? 'Could not remove the voice model.');
    refresh();
  };
  return { status, error, download, cancel: () => void window.krypt.tts.kokoroCancel(), remove };
}

export function VoiceModelCard({ compact = false }: { compact?: boolean }) {
  const { status, error, download, cancel, remove } = useVoiceModel();
  if (!status || (compact && status.installed && !error)) return null;

  const p = status.progress;
  const ratio = p && p.total > 0 ? p.done / p.total : 0;
  const fromStudio = status.downloadBytes === 0;

  let body;
  if (status.installing) {
    body = (
      <>
        <div className="flex items-center justify-between gap-3 text-xs">
          <span className="text-krypt-muted">
            {STAGE[p?.stage ?? 'downloading']} voice model… {p ? `${fmtBytes(p.done)} of ${fmtBytes(p.total)}` : ''}
          </span>
          <button type="button" onClick={cancel} className="flex items-center gap-1 text-krypt-muted hover:text-white">
            <X className="h-3.5 w-3.5" />
            Cancel
          </button>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      </>
    );
  } else if (status.installed) {
    body = (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-white">
            <Check className="h-4 w-4 text-emerald-400" />
            Voice model installed
          </div>
          <div className="mt-0.5 text-xs text-krypt-muted">28 English voices, {fmtBytes(status.totalBytes)} on disk. Works offline.</div>
        </div>
        <GhostButton destructive onClick={() => void remove()}>
          <Trash2 className="h-4 w-4" />
          Remove
        </GhostButton>
      </div>
    );
  } else {
    body = (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-white">English voices need a one-time download</div>
          <div className="mt-0.5 text-xs text-krypt-muted">
            {fromStudio
              ? 'Krypt Studio already has the voice model; it will be copied, no download needed.'
              : `${fmtBytes(status.downloadBytes)}, then it works offline. You can also just press Generate.`}
          </div>
        </div>
        <PrimaryButton onClick={() => void download()}>
          <Download className="h-4 w-4" />
          {fromStudio ? 'Copy' : 'Download'}
        </PrimaryButton>
      </div>
    );
  }

  return (
    <div className={compact ? 'mt-3 rounded-lg border border-white/10 bg-black/30 p-3' : ''}>
      {body}
      {error && <div className="mt-2 text-xs text-red-400">{error}</div>}
    </div>
  );
}
