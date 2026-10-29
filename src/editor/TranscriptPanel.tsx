import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ScrollText, Search, Trash2, X } from 'lucide-react';
import type { MediaFile } from '@shared/types';
import { useToast } from '../state/ToastProvider';
import { cls, fmtTimecode } from '../utils/format';
import { planCuts, rangesTotal, remapSegments, SEAM_FADE } from './autoEdit';
import type { CaptionSegment } from './captions';
import { useMediaStore } from './mediaStore';
import { defaultRevoiceMedia, revoicePieces } from './revoice';
import { getTranscript, transcriptModelFor, type SpeechProgress } from './speechAnalysis';
import { cutRangesForWords, findPhrase, transcriptWordsFrom, wordIndexAt, type TranscriptWord } from './transcriptEdit';
import { useTimelineStore } from './timelineStore';

interface WordsProps {
  words: TranscriptWord[];
  from: number;
  to: number;
  selLo: number;
  selHi: number;
  picked: ReadonlySet<number> | null;
  active: number;
  matches: ReadonlySet<number>;
  onDown: (i: number, e: ReactMouseEvent) => void;
  onEnter: (i: number) => void;
}

const Paragraph = memo(function Paragraph({ words, from, to, selLo, selHi, picked, active, matches, onDown, onEnter }: WordsProps) {
  const spans = [];
  for (let i = from; i <= to; i++) {
    const sel = (i >= selLo && i <= selHi) || !!picked?.has(i);
    spans.push(
      <span
        key={i}
        data-i={i}
        onMouseDown={(e) => onDown(i, e)}
        onMouseEnter={() => onEnter(i)}
        className={cls(
          'cursor-text rounded-[3px] px-[1px] transition-colors',
          sel ? 'bg-krypt-purple/45 text-white' : i === active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10',
          matches.has(i) && 'underline decoration-krypt-pink decoration-2 underline-offset-2',
        )}
      >
        {words[i].text}
      </span>,
      ' ',
    );
  }
  return (
    <div className="flex gap-2">
      <button
        className="w-12 flex-shrink-0 pt-0.5 text-left font-mono text-[10px] text-krypt-muted hover:text-white"
        onMouseDown={(e) => onDown(from, e)}
        title="Jump here"
      >
        {fmtTimecode(words[from].start).replace(/\.\d+$/, '')}
      </button>
      <p className="min-w-0 flex-1 select-none text-[13px] leading-relaxed">{spans}</p>
    </div>
  );
});

export function TranscriptPanel({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const allMedia = useMediaStore((s) => s.media);
  const clips = useTimelineStore((s) => s.clips);
  const sources = useMemo(() => {
    const onTimeline = new Set(clips.flatMap((c) => (c.type === 'media' ? [c.mediaId] : [])));
    return allMedia.filter((m) => onTimeline.has(m.id) && (m.kind === 'video' || m.kind === 'audio'));
  }, [allMedia, clips]);
  const [source, setSource] = useState<MediaFile | null>(() => defaultRevoiceMedia());
  const [segs, setSegs] = useState<CaptionSegment[] | null>(null);
  const [busy, setBusy] = useState<SpeechProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [picked, setPicked] = useState<Set<number> | null>(null);
  const [find, setFind] = useState('');
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!source) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setSegs(null);
    setError(null);
    setRange(null);
    setPicked(null);
    setBusy({ status: 'Loading transcript…', ratio: 0 });
    void (async () => {
      try {
        const model = await transcriptModelFor(source);
        const s = await getTranscript(source, { model, signal: abort.signal, onProgress: (p) => !abort.signal.aborted && setBusy(p) });
        if (!abort.signal.aborted) setSegs(s);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      } finally {
        if (!abort.signal.aborted) setBusy(null);
      }
    })();
    return () => abort.abort();
  }, [source]);

  const words = useMemo(() => {
    if (!source || !segs) return [];
    const kinds = new Map(allMedia.map((m) => [m.id, m.kind]));
    return transcriptWordsFrom(remapSegments(segs, revoicePieces(clips, kinds, source.id)));
  }, [source, segs, clips, allMedia]);
  const paras = useMemo(() => {
    const out: Array<[number, number]> = [];
    words.forEach((w, i) => {
      if (w.para || out.length === 0) out.push([i, i]);
      else out[out.length - 1][1] = i;
    });
    return out;
  }, [words]);

  useEffect(() => {
    setRange(null);
    setPicked(null);
  }, [words.length]);

  const active = useTimelineStore(useCallback((s) => wordIndexAt(words, s.playhead), [words]));
  useEffect(() => {
    if (active < 0 || !useTimelineStore.getState().playing) return;
    boxRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const qLen = find.trim().split(/\s+/).filter(Boolean).length;
  const starts = useMemo(() => (find.trim() ? findPhrase(words, find) : []), [words, find]);
  const matches = useMemo(() => {
    const s = new Set<number>();
    for (const i of starts) for (let k = 0; k < qLen; k++) s.add(i + k);
    return s;
  }, [starts, qLen]);
  const jumpTo = (i: number): void => {
    if (!words[i]) return;
    useTimelineStore.getState().setPlayhead(words[i].start);
    boxRef.current?.querySelector(`[data-i="${i}"]`)?.scrollIntoView({ block: 'center' });
  };
  const next = (): void => {
    if (starts.length === 0) return;
    const c = cursor % starts.length;
    setCursor(c + 1);
    setRange({ a: starts[c], b: starts[c] + qLen - 1 });
    setPicked(null);
    jumpTo(starts[c]);
  };

  const rangeRef = useRef(range);
  rangeRef.current = range;
  const drag = useRef<number | null>(null);
  const wordsRef = useRef(words);
  wordsRef.current = words;
  const onDown = useCallback((i: number, e: ReactMouseEvent) => {
    e.preventDefault();
    boxRef.current?.focus();
    setPicked(null);
    const r = rangeRef.current;
    if (e.shiftKey && r) {
      setRange({ a: r.a, b: i });
      return;
    }
    drag.current = i;
    setRange({ a: i, b: i });
    const w = wordsRef.current[i];
    if (w) useTimelineStore.getState().setPlayhead(w.start);
  }, []);
  const onEnter = useCallback((i: number) => {
    if (drag.current != null) setRange({ a: drag.current, b: i });
  }, []);
  useEffect(() => {
    const up = (): void => {
      drag.current = null;
    };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  const lo = range ? Math.min(range.a, range.b) : -1;
  const hi = range ? Math.max(range.a, range.b) : -1;
  const selected = useMemo(() => {
    if (picked) return [...picked];
    return lo < 0 ? [] : Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
  }, [picked, lo, hi]);
  const cuts = useMemo(() => cutRangesForWords(words, selected), [words, selected]);

  const remove = (): void => {
    if (cuts.length === 0) return;
    const s = useTimelineStore.getState();
    s.pause();
    s.commitClips(planCuts(s.clips, s.tracks, useMediaStore.getState().media, cuts, { remove: true, zoom: null, seamFade: SEAM_FADE }));
    useTimelineStore.getState().setPlayhead(cuts[0][0]);
    toast.success(`Cut ${selected.length} word${selected.length === 1 ? '' : 's'} (${rangesTotal(cuts).toFixed(1)}s) from every track. Undo reverts it.`);
    setRange(null);
    setPicked(null);
  };

  const onKey = (e: React.KeyboardEvent): void => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      remove();
    } else if (e.key === 'Escape' && selected.length > 0) {
      e.stopPropagation();
      setRange(null);
      setPicked(null);
    }
  };

  const inputCls = 'w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white outline-none focus:border-krypt-purple/60';
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-krypt-panel/60 shadow-krypt-card">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <ScrollText className="h-4 w-4 text-krypt-purple" />
        <span className="text-xs font-bold uppercase tracking-[0.06em] text-white">Transcript</span>
        <button onClick={onClose} title="Back to the media library" className="ml-auto rounded-md p-1 text-krypt-muted transition hover:bg-white/10 hover:text-white">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {sources.length === 0 ? (
        <div className="p-4 text-xs text-krypt-muted">Put a video or audio clip with speech on the timeline, and its transcript shows up here.</div>
      ) : (
        <>
          <div className="space-y-2 px-3 pt-2">
            {sources.length > 1 && (
              <select value={source?.id ?? ''} onChange={(e) => setSource(sources.find((m) => m.id === e.target.value) ?? null)} className={inputCls}>
                {!source && <option value="">Choose a clip…</option>}
                {sources.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            )}
            <div className="flex items-center gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-krypt-muted" />
                <input
                  value={find}
                  onChange={(e) => {
                    setFind(e.target.value);
                    setCursor(0);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && next()}
                  placeholder="Find words…"
                  className={cls(inputCls, 'pl-6')}
                />
              </div>
              {find.trim() && <span className="flex-shrink-0 font-mono text-[10px] text-krypt-muted">{starts.length}</span>}
              {starts.length > 0 && (
                <button
                  onClick={() => {
                    setPicked(new Set(matches));
                    setRange(null);
                  }}
                  title="Select every match (then Delete to cut them all)"
                  className="flex-shrink-0 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/90 transition hover:bg-white/10"
                >
                  Select all
                </button>
              )}
            </div>
          </div>

          <div ref={boxRef} tabIndex={0} onKeyDown={onKey} className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-3 outline-none">
            {busy && (
              <div className="pt-2">
                <div className="flex items-center justify-between text-[11px] text-krypt-muted">
                  <span className="truncate">{busy.status}</span>
                  {busy.ratio > 0 && <span className="font-mono text-white">{Math.round(busy.ratio * 100)}%</span>}
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  {busy.ratio > 0 ? (
                    <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
                  ) : (
                    <div className="h-full w-full animate-pulse bg-krypt-gradient" />
                  )}
                </div>
                <button onClick={() => abortRef.current?.abort()} className="mt-2 text-[11px] text-krypt-muted underline hover:text-white">
                  Cancel
                </button>
              </div>
            )}
            {error && <div className="pt-2 text-xs text-red-400">{error}</div>}
            {segs && words.length === 0 && <div className="pt-2 text-xs text-krypt-muted">No speech found in this clip.</div>}
            {paras.map(([from, to]) => (
              <Paragraph
                key={from}
                words={words}
                from={from}
                to={to}
                selLo={hi < from || lo > to ? -1 : lo}
                selHi={hi < from || lo > to ? -1 : hi}
                picked={picked}
                active={active >= from && active <= to ? active : -1}
                matches={matches}
                onDown={onDown}
                onEnter={onEnter}
              />
            ))}
          </div>

          <div className="flex items-center gap-2 border-t border-white/10 px-3 py-2">
            {selected.length > 0 ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[11px] text-krypt-muted">
                  {selected.length} word{selected.length === 1 ? '' : 's'} · {rangesTotal(cuts).toFixed(1)}s
                </span>
                <button onClick={remove} className="flex items-center gap-1 rounded-md border border-red-400/30 bg-red-500/15 px-2 py-1 text-[11px] font-semibold text-red-200 transition hover:bg-red-500/25">
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </>
            ) : (
              <span className="text-[11px] leading-snug text-krypt-muted">Click a word to jump there. Drag or Shift+click to select, then Delete cuts it from the video.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
