import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import {
  Clapperboard,
  FolderOpen,
  Film,
  Music,
  Image as ImageIcon,
  Upload,
  Trash2,
  Plus,
  Type,
  Undo2,
  Redo2,
  Download,
  X,
  Captions,
  FileUp,
  FileDown,
  Save,
  FilePlus,
  FolderInput,
  HelpCircle,
  Youtube,
  AudioLines,
  ScrollText,
  ScanFace,
  Volume1,
  Mic,
  Wand2,
} from 'lucide-react';
import type { MediaFile, MediaKind } from '@shared/types';
import { PrimaryButton, GhostButton } from '../components/common';
import { useToast } from '../state/ToastProvider';
import { useModal } from '../state/ModalProvider';
import { useApp } from '../state/AppStateProvider';
import { useMediaStore } from '../editor/mediaStore';
import { nameFromPath, useProjectStore } from '../editor/projectStore';
import { DEFAULT_CAPTION_STYLE, FONTS, KARAOKE_STYLES, RESOLUTIONS, timelineDuration, useTimelineStore, type CaptionStyle } from '../editor/timelineStore';
import { exportTimeline, DEFAULT_EXPORT_SETTINGS, type ExportProgress, type ExportSettings } from '../editor/export';
import { LOUDNESS_TARGETS } from '../editor/loudness';
import { captionSources, hasWebGpu, modelHint, offeredModels, extractAudioMono16k, parseSubtitles, speechModelFor, toSRT, transcribe } from '../editor/captions';
import { captionsFromTranscripts } from '../editor/speechAnalysis';
import { applyProject, serializeProject } from '../editor/project';
import { probeMedia } from '../editor/probe';
import { useLutStore } from '../editor/lutStore';
import { encodeWavPcm16, synthesize, TTS_VOICES, warmUpVoice } from '../editor/tts';
import { VoiceModelCard } from '../editor/VoiceModelCard';
import { RevoiceDialog } from '../editor/RevoiceDialog';
import { TranscriptPanel } from '../editor/TranscriptPanel';
import { ReframeDialog } from '../editor/ReframeDialog';
import { DuckDialog } from '../editor/DuckDialog';
import { ONBOARD_KEY, TUTORIAL_URL } from '../utils/guide';
import { TEMPLATES, type Template } from '../editor/templates';
import { Preview } from '../editor/Preview';
import { Timeline } from '../editor/Timeline';
import { Inspector } from '../editor/Inspector';
import { AutoEditDialog } from '../editor/AutoEditDialog';
import { EffectsLibrary, ShapesLibrary, StickersLibrary } from '../editor/EffectsLibrary';
import { cls, fmtBytes, MOD_KEY } from '../utils/format';

export function EditorPage() {
  const toast = useToast();
  const media = useMediaStore((s) => s.media);
  const clips = useTimelineStore((s) => s.clips);
  const canvasUserSet = useTimelineStore((s) => s.canvasUserSet);
  const add = useMediaStore((s) => s.add);

  const report = (resolved: MediaFile[], skipped: number): void => {
    const added = add(resolved);
    added.forEach((m) =>
      probeMedia(m).catch((e: Error) => {
        useMediaStore.getState().remove(m.id);
        toast.error(e.message);
      }),
    );
    if (added.length > 0) {
      const base = `Imported ${added.length} file${added.length === 1 ? '' : 's'} to the bin`;
      toast.success(skipped > 0 ? `${base} · skipped ${skipped} unsupported` : base);
    } else if (resolved.length > 0) {
      toast.info('Those files are already in your media bin.');
    } else if (skipped > 0) {
      toast.warn(`Skipped ${skipped} unsupported file${skipped === 1 ? '' : 's'}.`);
    }
  };

  const importViaPicker = async (): Promise<void> => {
    const r = await window.krypt.media.pickFiles();
    if (!r.ok) {
      toast.error(r.message ?? 'Could not open media.');
      return;
    }
    const files = r.data ?? [];
    if (files.length === 0) return;
    report(files, 0);
  };

  const importViaDrop = async (list: FileList): Promise<void> => {
    const dropped = Array.from(list);
    if (dropped.length === 0) return;
    const paths = dropped.map((f) => window.krypt.media.pathForFile(f)).filter(Boolean);
    if (paths.length === 0) {
      toast.error('Could not read the dropped files.');
      return;
    }
    const r = await window.krypt.media.resolvePaths(paths);
    if (!r.ok) {
      toast.error(r.message ?? 'Could not import the dropped files.');
      return;
    }
    const files = r.data ?? [];
    report(files, paths.length - files.length);
  };

  const [exportState, setExportState] = useState<ExportProgress | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const cancelRef = useRef({ cancelled: false });

  const doExport = async (settings: ExportSettings): Promise<void> => {
    const st = useTimelineStore.getState();
    if (timelineDuration(st.clips) <= 0) {
      toast.warn('Add something to the timeline first.');
      return;
    }
    st.pause();
    st.setFps(settings.fps);

    const mediaById = new Map(useMediaStore.getState().media.map((m) => [m.id, m]));
    const hasVisual = st.clips.some((c) => c.type !== 'media' || mediaById.get(c.mediaId)?.kind !== 'audio');
    const ext = hasVisual ? (settings.format === 'webm' ? 'webm' : 'mp4') : 'm4a';
    const begin = await window.krypt.media.exportBegin(`krypt-export-${Date.now().toString(36)}.${ext}`);
    if (!begin.ok) {
      toast.error(begin.message ?? 'Could not start the export.');
      return;
    }
    if (!begin.data) return;
    const { token, path } = begin.data;

    cancelRef.current = { cancelled: false };
    setExportState({ phase: 'audio', ratio: 0 });
    try {
      const result = await exportTimeline({
        clips: st.clips,
        tracks: st.tracks,
        canvas: st.canvas,
        background: st.background,
        media: useMediaStore.getState().media,
        settings,
        onProgress: setExportState,
        signal: cancelRef.current,
        onChunk: async (data, position) => {
          const r = await window.krypt.media.exportWrite(token, data, position);
          if (!r.ok) throw new Error(r.message ?? 'Could not write to the export file.');
        },
      });
      const end = await window.krypt.media.exportEnd(token, true);
      if (end.ok) toast.success(`Exported to ${path}${result.copiedVideo ? ' (video copied losslessly, no re-encode)' : ''}`);
      else toast.error(end.message ?? 'Could not finish the export file.');
      result.warnings.forEach((w) => toast.warn(w));
    } catch (e) {
      void window.krypt.media.exportEnd(token, false);
      if (!cancelRef.current.cancelled) toast.error(`Export failed: ${(e as Error).message}`);
    } finally {
      setExportState(null);
    }
  };

  const addCaptions = useTimelineStore((s) => s.addCaptions);
  const [captionState, setCaptionState] = useState<{ status: string; ratio: number } | null>(null);
  const [captionSettingsOpen, setCaptionSettingsOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(() => localStorage.getItem(ONBOARD_KEY) !== '1');
  const [ttsOpen, setTtsOpen] = useState(false);
  const [revoiceOpen, setRevoiceOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [reframeOpen, setReframeOpen] = useState(false);
  const [duckOpen, setDuckOpen] = useState(false);
  const [autoEditOpen, setAutoEditOpen] = useState(false);

  const insertTtsClip = async (audio: Float32Array, sampleRate: number): Promise<void> => {
    const wav = encodeWavPcm16(audio, sampleRate);
    const r = await window.krypt.media.saveDerived(wav, `voiceover-${Date.now().toString(36)}.wav`);
    if (!r.ok || !r.data) {
      toast.error(r.message ?? 'Could not store the voice-over.');
      return;
    }
    useMediaStore.getState().add([r.data]);
    const st = useTimelineStore.getState();
    const at = st.playhead;
    const id = await st.addMedia(r.data);
    if (id) st.updateClip(id, { start: at });
    toast.success('Voice-over added at the playhead.');
  };
  const srtInputRef = useRef<HTMLInputElement>(null);
  const captionAbortRef = useRef<AbortController | null>(null);

  const runAutoCaptions = async (style: CaptionStyle, model?: string): Promise<void> => {
    const st = useTimelineStore.getState();
    const total = timelineDuration(st.clips);
    if (total <= 0) {
      toast.warn('Add media to the timeline first.');
      return;
    }
    st.pause();
    const abort = new AbortController();
    captionAbortRef.current = abort;
    setCaptionState({ status: 'Preparing audio…', ratio: 0 });
    try {
      const media = useMediaStore.getState().media;
      const chosen = model ?? speechModelFor();
      const fromFiles = await captionsFromTranscripts(captionSources(st.clips, media), media, chosen, {
        signal: abort.signal,
        onProgress: (p) => setCaptionState({ status: p.status, ratio: p.ratio }),
      });
      const audio = fromFiles ? null : await extractAudioMono16k(st.clips, media, total);
      if (!fromFiles && !audio) {
        toast.warn('No audio found to caption.');
        return;
      }
      const segs =
        fromFiles ??
        (await transcribe(audio!, {
          model: chosen,
          signal: abort.signal,
          onStatus: (status) => setCaptionState((s) => ({ status, ratio: s?.ratio ?? 0 })),
          onProgress: (ratio) => setCaptionState((s) => ({ status: s?.status ?? 'Loading model…', ratio })),
        }));
      if (segs.length === 0) toast.info('No speech detected in the audio.');
      else {
        addCaptions(segs, style);
        toast.success(`Added ${segs.length} caption${segs.length === 1 ? '' : 's'}`);
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error('[captions] failed', e);
        toast.error(`Captions failed: ${(e as Error)?.message ?? e}`);
      }
    } finally {
      captionAbortRef.current = null;
      setCaptionState(null);
    }
  };

  const onSrtFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const segs = parseSubtitles(await file.text());
      if (segs.length === 0) toast.warn('No subtitles found in that file.');
      else {
        addCaptions(segs);
        toast.success(`Imported ${segs.length} subtitle${segs.length === 1 ? '' : 's'}`);
      }
    } catch {
      toast.error('Could not read the subtitle file.');
    }
  };

  const exportSrt = async (): Promise<void> => {
    const text = useTimelineStore.getState().clips.filter((c): c is import('../editor/timelineStore').TextClip => c.type === 'text');
    const tagged = text.filter((c) => c.role === 'caption');
    const caps = (tagged.length > 0 ? tagged : text).map((c) => ({ start: c.start, end: c.start + c.duration, text: c.text }));
    if (caps.length === 0) {
      toast.warn('No text or captions to export.');
      return;
    }
    const data = new TextEncoder().encode(toSRT(caps));
    const r = await window.krypt.media.saveExport(data, `captions-${Date.now().toString(36)}.srt`);
    if (r.ok && r.data) toast.success(`Saved ${r.data}`);
    else if (!r.ok) toast.error(r.message ?? 'Could not save subtitles.');
  };

  const modal = useModal();
  const app = useApp();
  const recents = app.state?.recentProjects ?? [];
  const [templateOpen, setTemplateOpen] = useState(false);

  const addRecent = (p: string): void => {
    void app.update({ recentProjects: [p, ...recents.filter((r) => r !== p)].slice(0, 8) });
  };
  const guardUnsaved = async (): Promise<boolean> => {
    if (!useProjectStore.getState().dirty) return true;
    return modal.confirm({ title: 'Discard changes?', message: 'You have unsaved changes that will be lost.', confirmLabel: 'Discard', destructive: true });
  };

  const doSave = async (): Promise<void> => {
    const st = useProjectStore.getState();
    if (st.path) {
      const r = await window.krypt.project.saveToPath(serializeProject(), st.path);
      if (r.ok && r.data) {
        st.setSaved(r.data);
        toast.success('Saved');
      } else if (!r.ok) toast.error(r.message ?? 'Could not save the project.');
      return;
    }
    const r = await window.krypt.project.save(serializeProject(), `${st.name || 'project'}.krypt`);
    if (r.ok && r.data) {
      st.setSaved(r.data);
      addRecent(r.data);
      toast.success(`Saved to ${r.data}`);
    } else if (!r.ok) toast.error(r.message ?? 'Could not save the project.');
  };
  const doOpen = async (): Promise<void> => {
    if (!(await guardUnsaved())) return;
    const r = await window.krypt.project.open();
    if (!r.ok) {
      toast.error(r.message ?? 'Could not open the project.');
      return;
    }
    if (!r.data) return;
    const res = await applyProject(r.data.json);
    if (res.ok) {
      useProjectStore.getState().setOpened(r.data.path);
      addRecent(r.data.path);
      toast.success('Project opened.');
      if (res.missing.length > 0) toast.warn(`Missing media: ${res.missing.join(', ')} — clips using ${res.missing.length === 1 ? 'it' : 'them'} will be empty.`);
    } else toast.error(res.error ?? 'That file is not a valid Krypt project.');
  };
  const doOpenPath = async (p: string): Promise<void> => {
    if (!(await guardUnsaved())) return;
    const r = await window.krypt.project.openPath(p);
    if (!r.ok) {
      toast.error(r.message ?? 'Could not open the project.');
      return;
    }
    if (!r.data) {
      toast.warn('That project file is missing — removing it from recents.');
      void app.update({ recentProjects: recents.filter((x) => x !== p) });
      return;
    }
    const res = await applyProject(r.data.json);
    if (res.ok) {
      useProjectStore.getState().setOpened(r.data.path);
      addRecent(r.data.path);
      toast.success('Project opened.');
      if (res.missing.length > 0) toast.warn(`Missing media: ${res.missing.join(', ')} — clips using ${res.missing.length === 1 ? 'it' : 'them'} will be empty.`);
    } else toast.error(res.error ?? 'That file is not a valid Krypt project.');
  };
  const handleNew = async (): Promise<void> => {
    if (await guardUnsaved()) setTemplateOpen(true);
  };
  const applyTemplate = (tpl: Template): void => {
    useMediaStore.getState().clear();
    useLutStore.getState().replaceAll([]);
    useTimelineStore.getState().loadDoc(tpl.build());
    useProjectStore.getState().setNew(tpl.label);
    setTemplateOpen(false);
    toast.success(`Started "${tpl.label}"`);
  };
  const saveRef = useRef(doSave);
  saveRef.current = doSave;
  const openRef = useRef(doOpen);
  openRef.current = doOpen;

  useEffect(() => {
    void hasWebGpu();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      const st = useTimelineStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod) {
        const k = e.key.toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) st.redo();
          else st.undo();
        } else if (k === 'y') {
          e.preventDefault();
          st.redo();
        } else if (k === 's') {
          e.preventDefault();
          void saveRef.current();
        } else if (k === 'o') {
          e.preventDefault();
          void openRef.current();
        } else if (k === 'c') {
          if (st.selectedIds.length > 0) {
            e.preventDefault();
            st.copySelected();
          }
        } else if (k === 'x') {
          if (st.selectedIds.length > 0) {
            e.preventDefault();
            st.cutSelected();
          }
        } else if (k === 'v') {
          if (st.paste() > 0) e.preventDefault();
        }
        return;
      }
      const total = timelineDuration(st.clips);
      if (e.code === 'Space') {
        e.preventDefault();
        if (total === 0) return;
        if (st.playing) st.pause();
        else {
          if (st.playhead >= total - 0.001) st.setPlayhead(0);
          st.play();
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.shiftKey) st.rippleDeleteSelected();
        else st.removeSelected();
      } else if (e.key.toLowerCase() === 's') {
        st.splitSelectedAtPlayhead();
      } else if (e.key.toLowerCase() === 't') {
        st.addText();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        st.pause();
        st.setPlayhead(Math.max(0, st.playhead - (e.shiftKey ? 1 : 1 / st.fps)));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        st.pause();
        st.setPlayhead(Math.min(total, st.playhead + (e.shiftKey ? 1 : 1 / st.fps)));
      } else if (e.key === 'Home') {
        st.setPlayhead(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);
  const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer.types).includes('Files');

  const onDragEnter = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current += 1;
    setDragActive(true);
  };
  const onDragOver = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = (e: DragEvent): void => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth.current -= 1;
    if (dragDepth.current <= 0) {
      dragDepth.current = 0;
      setDragActive(false);
    }
  };
  const onDrop = (e: DragEvent): void => {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    void importViaDrop(e.dataTransfer.files);
  };

  return (
    <div
      id="krypt-editor-root"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="relative flex h-full min-h-[600px] flex-col gap-3 p-3"
    >
      {media.length === 0 && clips.length === 0 && !canvasUserSet ? (
        <EmptyEditor
          onImport={() => void importViaPicker()}
          onNew={() => void handleNew()}
          onOpen={() => void doOpen()}
          recents={recents}
          onOpenRecent={(p) => void doOpenPath(p)}
        />
      ) : (
        <>
          <EditorToolbar
            onImport={() => void importViaPicker()}
            onExport={() => setExportOpen(true)}
            exporting={!!exportState}
            onAutoCaptions={() => setCaptionSettingsOpen(true)}
            onImportSrt={() => srtInputRef.current?.click()}
            onExportSrt={() => void exportSrt()}
            onNew={() => void handleNew()}
            onOpen={() => void doOpen()}
            onSave={() => void doSave()}
            onHelp={() => setOnboardOpen(true)}
            onTts={() => setTtsOpen(true)}
            onRevoice={() => setRevoiceOpen(true)}
            transcriptOpen={transcriptOpen}
            onTranscript={() => setTranscriptOpen((o) => !o)}
            onReframe={() => setReframeOpen(true)}
            onDuck={() => setDuckOpen(true)}
            onAutoEdit={() => setAutoEditOpen(true)}
          />
          <PanelGroup direction="vertical" autoSaveId="krypt-rows" className="min-h-0 flex-1">
            <Panel defaultSize={64} minSize={35}>
              <PanelGroup direction="horizontal" autoSaveId="krypt-cols">
                <Panel defaultSize={22} minSize={14}>
                  {transcriptOpen ? <TranscriptPanel onClose={() => setTranscriptOpen(false)} /> : <LibraryPanel onImport={() => void importViaPicker()} />}
                </Panel>
                <ResizeHandle vertical />
                <Panel defaultSize={52} minSize={28}>
                  <Preview />
                </Panel>
                <ResizeHandle vertical />
                <Panel defaultSize={26} minSize={16}>
                  <InspectorPanel />
                </Panel>
              </PanelGroup>
            </Panel>
            <ResizeHandle />
            <Panel defaultSize={36} minSize={15}>
              <Timeline />
            </Panel>
          </PanelGroup>
        </>
      )}

      <input ref={srtInputRef} type="file" accept=".srt,.vtt" className="hidden" onChange={(e) => void onSrtFile(e)} />
      {dragActive && <DropOverlay />}
      {exportOpen && (
        <ExportSettingsModal
          onCancel={() => setExportOpen(false)}
          onExport={(settings) => {
            setExportOpen(false);
            void doExport(settings);
          }}
        />
      )}
      {exportState && <ExportModal state={exportState} onCancel={() => (cancelRef.current.cancelled = true)} />}
      {captionState && <CaptionModal status={captionState.status} ratio={captionState.ratio} onCancel={() => captionAbortRef.current?.abort()} />}
      {templateOpen && <TemplatePicker onPick={applyTemplate} onClose={() => setTemplateOpen(false)} />}
      {captionSettingsOpen && (
        <CaptionSettingsModal
          onCancel={() => setCaptionSettingsOpen(false)}
          onGenerate={(style, model) => {
            setCaptionSettingsOpen(false);
            void runAutoCaptions(style, model);
          }}
        />
      )}
      {onboardOpen && (
        <OnboardingModal
          onClose={() => {
            localStorage.setItem(ONBOARD_KEY, '1');
            setOnboardOpen(false);
          }}
        />
      )}
      {autoEditOpen && <AutoEditDialog onClose={() => setAutoEditOpen(false)} />}
      {revoiceOpen && <RevoiceDialog onClose={() => setRevoiceOpen(false)} />}
      {reframeOpen && <ReframeDialog onClose={() => setReframeOpen(false)} />}
      {duckOpen && <DuckDialog onClose={() => setDuckOpen(false)} />}
      {ttsOpen && (
        <TtsModal
          onClose={() => setTtsOpen(false)}
          onDone={(audio, sampleRate) => {
            setTtsOpen(false);
            void insertTtsClip(audio, sampleRate);
          }}
        />
      )}
    </div>
  );
}

function TtsModal({ onClose, onDone }: { onClose: () => void; onDone: (audio: Float32Array, sampleRate: number) => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(TTS_VOICES[0].value);
  const [busy, setBusy] = useState<{ status: string; ratio: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => void warmUpVoice(), []);

  const generate = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy({ status: 'Loading voice model…', ratio: 0 });
    try {
      const out = await synthesize(trimmed, {
        model: voice,
        signal: abort.signal,
        onStatus: (status) => setBusy((s) => ({ status, ratio: s?.ratio ?? 0 })),
        onProgress: (ratio) => setBusy((s) => ({ status: s?.status ?? 'Loading voice model…', ratio })),
      });
      onDone(out.audio, out.sampleRate);
    } catch (e) {
      if (!abort.signal.aborted) toast.error(`Text to speech failed: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  const downloading = busy ? /model/i.test(busy.status) && busy.ratio > 0 && busy.ratio < 1 : false;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[440px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Mic className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Text to speech</div>
            <div className="text-xs text-krypt-muted">Generated on your device; lands on an audio track at the playhead.</div>
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Type the voice-over line…"
          disabled={!!busy}
          className="w-full resize-none rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50"
        />

        <div className="mt-3">
          <div className="mb-1 text-xs text-krypt-muted">Voice / language</div>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            disabled={!!busy}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60 disabled:opacity-50"
          >
            {TTS_VOICES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        {!busy && voice.startsWith('kokoro:') && <VoiceModelCard compact />}

        {busy && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-krypt-muted">
              <span>{busy.status}</span>
              {downloading && <span className="font-mono text-white">{Math.round(busy.ratio * 100)}%</span>}
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/10">
              {downloading ? (
                <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${Math.round(busy.ratio * 100)}%` }} />
              ) : (
                <div className="h-full w-full animate-pulse bg-krypt-gradient" />
              )}
            </div>
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton
            onClick={() => {
              abortRef.current?.abort();
              onClose();
            }}
          >
            Cancel
          </GhostButton>
          <PrimaryButton onClick={() => void generate()} disabled={!!busy || text.trim().length === 0}>
            <Mic className="h-4 w-4" />
            Generate
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function CaptionSettingsModal({ onCancel, onGenerate }: { onCancel: () => void; onGenerate: (style: CaptionStyle, model: string) => void }) {
  const [style, setStyle] = useState<CaptionStyle>(DEFAULT_CAPTION_STYLE);
  const [model, setModel] = useState<string>(() => speechModelFor());
  const set = (patch: Partial<CaptionStyle>): void => setStyle((s) => ({ ...s, ...patch }));
  const POSITIONS: Array<{ label: string; y: number }> = [
    { label: 'Top', y: 0.12 },
    { label: 'Middle', y: 0.5 },
    { label: 'Bottom', y: 0.86 },
  ];

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[400px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Captions className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Caption style</div>
            <div className="text-xs text-krypt-muted">Applied to every caption it generates.</div>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="mb-1 text-xs text-krypt-muted">Font</div>
            <select
              value={style.fontFamily}
              onChange={(e) => set({ fontFamily: e.target.value })}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60"
            >
              {FONTS.map((f) => (
                <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-krypt-muted">Size</span>
              <span className="font-mono text-white/90">{style.fontSize}</span>
            </div>
            <input type="range" min={24} max={160} step={1} value={style.fontSize} onChange={(e) => set({ fontSize: Number(e.target.value) })} className="mt-1 w-full cursor-pointer accent-krypt-purple" />
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-krypt-muted">Color</span>
              <input type="color" value={style.color} onChange={(e) => set({ color: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent" />
            </div>
            <button
              onClick={() => set({ bold: !style.bold })}
              className={cls('rounded-lg border px-3 py-1.5 text-xs font-bold transition', style.bold ? 'border-krypt-purple/50 bg-krypt-purple/15 text-white' : 'border-white/10 bg-white/5 text-white/80')}
            >
              Bold
            </button>
            <button
              onClick={() => set({ italic: !style.italic })}
              className={cls('rounded-lg border px-3 py-1.5 transition', style.italic ? 'border-krypt-purple/50 bg-krypt-purple/15 text-white' : 'border-white/10 bg-white/5 text-white/80')}
            >
              <span className="text-xs font-bold italic">I</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-krypt-muted">Outline</span>
              <input type="color" value={style.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} className="h-7 w-12 cursor-pointer rounded border border-white/10 bg-transparent" />
            </div>
            <div className="flex flex-1 items-center gap-2">
              <input type="range" min={0} max={16} step={1} value={style.outlineWidth} onChange={(e) => set({ outlineWidth: Number(e.target.value) })} className="w-full cursor-pointer accent-krypt-purple" />
              <span className="w-8 text-right font-mono text-xs text-white/90">{style.outlineWidth === 0 ? 'Off' : style.outlineWidth}</span>
            </div>
          </div>

          <div>
            <div className="mb-1 text-xs text-krypt-muted">Position</div>
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              {POSITIONS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => set({ y: p.y })}
                  className={cls('flex-1 py-1.5 text-xs font-semibold transition', Math.abs(style.y - p.y) < 0.01 ? 'bg-krypt-purple/20 text-white' : 'bg-white/5 text-krypt-muted hover:text-white')}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="flex h-16 items-end justify-center rounded-lg border border-white/10 bg-black/50 p-2"
            title="Preview"
          >
            <span
              style={{
                fontFamily: style.fontFamily,
                color: style.color,
                fontWeight: style.bold ? 800 : 500,
                fontStyle: style.italic ? 'italic' : 'normal',
                fontSize: Math.min(22, style.fontSize / 4),
                WebkitTextStroke: style.outlineWidth > 0 ? `${Math.max(1, style.outlineWidth / 4)}px ${style.outlineColor}` : undefined,
                paintOrder: 'stroke',
              }}
            >
              Sample caption
            </span>
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs text-krypt-muted">Karaoke (word-by-word highlight)</div>
          <div className="flex items-center gap-2">
            <div className="grid flex-1 grid-cols-4 gap-1">
              {KARAOKE_STYLES.map((k) => (
                <button
                  key={k.value}
                  onClick={() => set({ karaoke: k.value })}
                  className={cls(
                    'rounded-md px-1.5 py-1.5 text-[11px] transition',
                    style.karaoke === k.value ? 'bg-krypt-purple/25 text-white ring-1 ring-krypt-purple/50' : 'bg-white/5 text-krypt-muted hover:text-white',
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {style.karaoke !== 'none' && (
              <input type="color" value={style.karaokeColor} onChange={(e) => set({ karaokeColor: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-white/10 bg-transparent" title="Highlight color" />
            )}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 text-xs text-krypt-muted">Language</div>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-sm text-white outline-none focus:border-krypt-purple/60"
          >
            {offeredModels().map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-krypt-muted">{modelHint(model)}</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onGenerate(style, model)}>
            <Captions className="h-4 w-4" />
            Generate
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function EditorToolbar({
  onImport,
  onExport,
  exporting,
  onAutoCaptions,
  onImportSrt,
  onExportSrt,
  onNew,
  onOpen,
  onSave,
  onHelp,
  onTts,
  onRevoice,
  transcriptOpen,
  onTranscript,
  onReframe,
  onDuck,
  onAutoEdit,
}: {
  onImport: () => void;
  onExport: () => void;
  exporting: boolean;
  onAutoCaptions: () => void;
  onImportSrt: () => void;
  onExportSrt: () => void;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onHelp: () => void;
  onTts: () => void;
  onRevoice: () => void;
  transcriptOpen: boolean;
  onTranscript: () => void;
  onReframe: () => void;
  onDuck: () => void;
  onAutoEdit: () => void;
}) {
  const canvas = useTimelineStore((s) => s.canvas);
  const setCanvas = useTimelineStore((s) => s.setCanvas);
  const addText = useTimelineStore((s) => s.addText);
  const undo = useTimelineStore((s) => s.undo);
  const redo = useTimelineStore((s) => s.redo);
  const canUndo = useTimelineStore((s) => s.past.length > 0);
  const canRedo = useTimelineStore((s) => s.future.length > 0);

  const ratio = (w: number, h: number): boolean => Math.abs(w / h - canvas.width / canvas.height) < 0.001;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-krypt-panel/60 px-3 py-2 shadow-krypt-card">
      <ToolButton title="New project / template" onClick={onNew}>
        <FilePlus className="h-4 w-4" />
      </ToolButton>
      <ToolButton title={`Open project (${MOD_KEY}+O)`} onClick={onOpen}>
        <FolderInput className="h-4 w-4" />
      </ToolButton>
      <ToolButton title={`Save project (${MOD_KEY}+S)`} onClick={onSave}>
        <Save className="h-4 w-4" />
      </ToolButton>
      <div className="mx-1 h-6 w-px bg-white/10" />
      <ToolButton title="Import media" onClick={onImport}>
        <FolderOpen className="h-4 w-4" />
        <span className="text-xs font-semibold">Import</span>
      </ToolButton>
      <div className="mx-1 h-6 w-px bg-white/10" />
      <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-krypt-muted">Canvas</span>
      <div className="flex overflow-hidden rounded-lg border border-white/10">
        {RESOLUTIONS.map((a) => (
          <button
            key={a.label}
            onClick={() => setCanvas({ width: a.width, height: a.height })}
            title={`${a.hint} · ${a.width}×${a.height}`}
            className={cls(
              'px-2.5 py-1.5 text-xs font-semibold transition',
              ratio(a.width, a.height) ? 'bg-krypt-purple/25 text-white' : 'bg-white/5 text-krypt-muted hover:text-white',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <span className="font-mono text-[11px] text-krypt-muted">{canvas.width}×{canvas.height}</span>

      <div className="mx-1 h-6 w-px bg-white/10" />

      <ToolButton title={`Undo (${MOD_KEY}+Z)`} onClick={undo} disabled={!canUndo}>
        <Undo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton title={`Redo (${MOD_KEY}+Shift+Z)`} onClick={redo} disabled={!canRedo}>
        <Redo2 className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="Add text (T)" onClick={addText}>
        <Type className="h-4 w-4" />
        <span className="text-xs font-semibold">Text</span>
      </ToolButton>

      <div className="mx-1 h-6 w-px bg-white/10" />
      <ToolButton title="Auto-captions (on-device speech to text)" onClick={onAutoCaptions}>
        <Captions className="h-4 w-4" />
        <span className="text-xs font-semibold">Captions</span>
      </ToolButton>
      <ToolButton title="Text to speech (on-device voice-over)" onClick={onTts}>
        <Mic className="h-4 w-4" />
        <span className="text-xs font-semibold">TTS</span>
      </ToolButton>
      <ToolButton title="Re-voice: replace the speech with an AI voice at the same timing" onClick={onRevoice}>
        <AudioLines className="h-4 w-4" />
        <span className="text-xs font-semibold">Re-voice</span>
      </ToolButton>
      <ToolButton title="Transcript: edit the video by deleting words" onClick={onTranscript} active={transcriptOpen}>
        <ScrollText className="h-4 w-4" />
        <span className="text-xs font-semibold">Transcript</span>
      </ToolButton>
      <ToolButton title="Auto edit (cut the dead air, add punch-in zooms)" onClick={onAutoEdit}>
        <Wand2 className="h-4 w-4" />
        <span className="text-xs font-semibold">Auto edit</span>
      </ToolButton>
      <ToolButton title="Auto reframe: go vertical and keep the speaker in shot" onClick={onReframe}>
        <ScanFace className="h-4 w-4" />
        <span className="text-xs font-semibold">Reframe</span>
      </ToolButton>
      <ToolButton title="Auto duck: lower the music while someone talks" onClick={onDuck}>
        <Volume1 className="h-4 w-4" />
        <span className="text-xs font-semibold">Duck</span>
      </ToolButton>
      <ToolButton title="Import .srt / .vtt subtitles" onClick={onImportSrt}>
        <FileUp className="h-4 w-4" />
      </ToolButton>
      <ToolButton title="Export subtitles (.srt)" onClick={onExportSrt}>
        <FileDown className="h-4 w-4" />
      </ToolButton>

      <div className="ml-auto flex items-center gap-2">
        <ToolButton title="Getting started guide" onClick={onHelp}>
          <HelpCircle className="h-4 w-4" />
        </ToolButton>
        <PrimaryButton onClick={onExport} disabled={exporting}>
          <Download className="h-4 w-4" />
          {exporting ? 'Exporting…' : 'Export'}
        </PrimaryButton>
      </div>
    </div>
  );
}


function OnboardingModal({ onClose }: { onClose: () => void }) {
  const steps: Array<{ n: string; title: string; body: string }> = [
    { n: '1', title: 'Import', body: 'Drag video, audio, or images anywhere into the window (or click Import). Click a clip in the bin to add it to the timeline.' },
    { n: '2', title: 'Edit', body: 'Drag clips to move them, pull the edges to trim, S splits at the playhead, Shift+Del ripple-deletes, Ctrl+wheel zooms the timeline.' },
    { n: '3', title: 'Style', body: 'Select a clip and use the inspector: effects, color LUTs, masks, blend modes, speed curves — and the ◇ diamonds keyframe almost anything.' },
    { n: '4', title: 'AI tools', body: 'Captions transcribes speech on your device (nothing uploaded) with word-by-word karaoke styling. Auto edit finds the dead air, previews the cuts on the timeline, and removes them in one undoable step.' },
    { n: '5', title: 'Export', body: 'Export streams straight to disk as MP4 or WebM, hardware-accelerated when your GPU supports it. No watermark, ever.' },
  ];
  const keys: Array<[string, string]> = [
    ['Space', 'Play / pause'],
    ['S', 'Split at playhead'],
    ['T', 'Add text'],
    ['Del / Shift+Del', 'Delete / ripple delete'],
    [`${MOD_KEY}+C / X / V`, 'Copy / cut / paste clips'],
    [`${MOD_KEY}+Z / ${MOD_KEY}+Shift+Z`, 'Undo / redo'],
    ['← / →', 'Step one frame'],
    [`${MOD_KEY}+S / ${MOD_KEY}+O`, 'Save / open project'],
  ];
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="max-h-[90%] w-[560px] overflow-auto rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Clapperboard className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Welcome to Krypt Editor</div>
            <div className="text-xs text-krypt-muted">Free, offline, no watermarks. Here's the 60-second tour.</div>
          </div>
        </div>

        <div className="space-y-2.5">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-krypt-purple/20 font-mono text-xs font-bold text-krypt-purple">{s.n}</div>
              <div>
                <div className="text-xs font-bold text-white">{s.title}</div>
                <div className="text-xs leading-relaxed text-krypt-muted">{s.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          {keys.map(([k, d]) => (
            <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-mono text-white/90">{k}</span>
              <span className="text-right text-krypt-muted">{d}</span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            onClick={() => void window.krypt.app.openExternal(TUTORIAL_URL)}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/90 transition hover:bg-white/10"
          >
            <Youtube className="h-4 w-4 text-rose-400" /> Watch the video tutorial
          </button>
          <div className="ml-auto">
            <PrimaryButton onClick={onClose}>Start editing</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CaptionModal({ status, ratio, onCancel }: { status: string; ratio: number; onCancel: () => void }) {
  const determinate = ratio > 0 && ratio < 1;
  const downloading = determinate && /model/i.test(status);
  const pct = Math.round(ratio * 100);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[360px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Captions className="h-5 w-5 text-krypt-purple" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">Auto-captions</div>
            <div className="truncate text-xs text-krypt-muted">{downloading ? 'Downloading model…' : status}</div>
          </div>
          {determinate && <div className="ml-auto font-mono text-sm text-white">{pct}%</div>}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          {determinate ? (
            <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${pct}%` }} />
          ) : (
            <div className="h-full w-full animate-pulse bg-krypt-gradient" />
          )}
        </div>
        <p className="mt-3 text-[11px] text-krypt-muted/70">
          Transcribing runs on your CPU across several cores, usually a fraction of the clip's length. The model downloads once, then is cached.
        </p>
        <div className="mt-4 flex justify-end">
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
        </div>
      </div>
    </div>
  );
}

function ToolButton({
  title,
  onClick,
  disabled,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cls(
        'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-white/90 transition disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'border-krypt-purple/50 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/5 hover:bg-white/10',
      )}
    >
      {children}
    </button>
  );
}

function ResizeHandle({ vertical }: { vertical?: boolean }) {
  return (
    <PanelResizeHandle
      className={cls(
        'group flex items-center justify-center transition',
        vertical ? 'w-2' : 'h-2',
      )}
    >
      <div className={cls('rounded-full bg-white/10 transition group-hover:bg-krypt-purple/60 group-data-[resize-handle-state=drag]:bg-krypt-purple', vertical ? 'h-10 w-1' : 'h-1 w-10')} />
    </PanelResizeHandle>
  );
}

function LibraryPanel({ onImport }: { onImport: () => void }) {
  const count = useMediaStore((s) => s.media.length);
  const [tab, setTab] = useState<'media' | 'shapes' | 'stickers' | 'effects' | 'transitions'>('media');
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-krypt-panel/60 shadow-krypt-card">
      <div className="flex border-b border-white/10">
        {(['media', 'shapes', 'stickers', 'effects', 'transitions'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            title={t}
            className={cls(
              'relative flex-1 truncate px-1 py-2.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition',
              tab === t ? 'border-b-2 border-krypt-purple text-white' : 'border-b-2 border-transparent text-krypt-muted hover:text-white/80',
            )}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === 'media' ? (
        <>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] text-krypt-muted">Media · {count}</span>
            <button onClick={onImport} className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/90 transition hover:bg-white/10">
              <FolderOpen className="h-3 w-3" />
              Import
            </button>
          </div>
          <MediaBin />
        </>
      ) : tab === 'shapes' ? (
        <ShapesLibrary />
      ) : tab === 'stickers' ? (
        <StickersLibrary />
      ) : (
        <EffectsLibrary kind={tab} />
      )}
    </div>
  );
}

function InspectorPanel() {
  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-white/10 bg-krypt-panel/60 shadow-krypt-card">
      <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.14em] text-krypt-muted">
        Inspector
      </div>
      <Inspector />
    </div>
  );
}

function EmptyEditor({
  onImport,
  onNew,
  onOpen,
  recents,
  onOpenRecent,
}: {
  onImport: () => void;
  onNew: () => void;
  onOpen: () => void;
  recents: string[];
  onOpenRecent: (p: string) => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20">
      <div className="flex max-w-md flex-col items-center px-6 py-16 text-center animate-fade-in">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-krypt-panel/80 shadow-krypt-card">
          <Clapperboard className="h-8 w-8 text-krypt-purple" />
        </div>
        <h2 className="text-xl font-bold text-white">Start a new project</h2>
        <p className="mt-2 text-sm leading-relaxed text-krypt-muted">
          Krypt Editor is a free, open-source CapCut alternative. Pick a template, import your media, or open an
          existing project — then cut, caption, and export.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <PrimaryButton onClick={onNew}>
            <FilePlus className="h-4 w-4" />
            New from template
          </PrimaryButton>
          <GhostButton onClick={onImport}>
            <FolderOpen className="h-4 w-4" />
            Import media
          </GhostButton>
          <GhostButton onClick={onOpen}>
            <FolderInput className="h-4 w-4" />
            Open project
          </GhostButton>
        </div>
        {recents.length > 0 && (
          <div className="mt-6 w-full max-w-xs text-left">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-krypt-muted">Recent</div>
            <div className="space-y-1">
              {recents.slice(0, 5).map((p) => (
                <button
                  key={p}
                  onClick={() => onOpenRecent(p)}
                  title={p}
                  className="block w-full truncate rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-left text-xs text-white/85 transition hover:border-krypt-purple/40 hover:bg-krypt-purple/10"
                >
                  {nameFromPath(p)}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-krypt-muted/70">…or drop files anywhere on this panel</p>
      </div>
    </div>
  );
}

function TemplatePicker({ onPick, onClose }: { onPick: (t: Template) => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[520px] max-w-[92%] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-1 text-sm font-bold text-white">New project</div>
        <div className="mb-4 text-xs text-krypt-muted">Pick a starting template. This replaces the current session.</div>
        <div className="grid grid-cols-3 gap-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onPick(t)}
              className="group flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-3 transition hover:border-krypt-purple/50 hover:bg-krypt-purple/10"
            >
              <div className="flex h-16 w-full items-center justify-center">
                <div
                  className="rounded border border-white/20 bg-black/60 shadow-inner"
                  style={t.ratio >= 1 ? { width: 56, height: 56 / t.ratio } : { height: 56, width: 56 * t.ratio }}
                />
              </div>
              <div className="text-xs font-semibold text-white">{t.label}</div>
              <div className="text-[10px] text-krypt-muted">{t.hint}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 flex justify-end">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
        </div>
      </div>
    </div>
  );
}

function MediaBin() {
  const toast = useToast();
  const media = useMediaStore((s) => s.media);
  const removeMedia = useMediaStore((s) => s.remove);
  const addToTimeline = useTimelineStore((s) => s.addMedia);
  const removeByMedia = useTimelineStore((s) => s.removeByMedia);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-1.5 overflow-auto p-2">
        {media.map((m) => (
          <BinItem
            key={m.id}
            file={m}
            onAdd={() => addToTimeline(m).catch((e: Error) => toast.error(e.message))}
            onRemove={() => {
              removeByMedia(m.id);
              removeMedia(m.id);
            }}
          />
        ))}
        <p className="px-2 pt-1 text-center text-[11px] text-krypt-muted/70">Click a clip to add it to the timeline</p>
      </div>
    </div>
  );
}

const KIND_ICON: Record<MediaKind, typeof Film> = {
  video: Film,
  audio: Music,
  image: ImageIcon,
};

function BinItem({ file, onAdd, onRemove }: { file: MediaFile; onAdd: () => void; onRemove: () => void }) {
  const Icon = KIND_ICON[file.kind];
  return (
    <div
      onClick={onAdd}
      title="Add to timeline"
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 transition hover:border-white/10 hover:bg-white/5"
    >
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black/40">
        {file.kind === 'image' ? (
          <img src={file.mediaUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon className="h-5 w-5 text-krypt-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-white" title={file.name}>
          {file.name}
        </div>
        <div className="text-xs text-krypt-muted">
          {file.kind} · {fmtBytes(file.sizeBytes)}
        </div>
      </div>
      <div className="flex items-center opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <button
          title="Add to timeline"
          onClick={onAdd}
          className="rounded-lg border border-white/10 bg-white/5 p-1.5 text-krypt-muted transition hover:bg-white/10 hover:text-white"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          title="Remove from bin"
          onClick={onRemove}
          className="ml-1 rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-200 transition hover:bg-rose-500/20"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

const LOUDNESS_KEY = 'krypt.export.loudness';
function savedLoudness(): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(LOUDNESS_KEY) ?? 'null');
    return LOUDNESS_TARGETS.some((l) => l.value === v) ? (v as number | null) : null;
  } catch {
    return null;
  }
}

function ExportSettingsModal({ onCancel, onExport }: { onCancel: () => void; onExport: (s: ExportSettings) => void }) {
  const canvas = useTimelineStore((s) => s.canvas);
  const [settings, setSettings] = useState<ExportSettings>(() => ({ ...DEFAULT_EXPORT_SETTINGS, height: Math.min(1080, canvas.height), loudness: savedLoudness() }));
  const set = (patch: Partial<ExportSettings>): void => {
    if ('loudness' in patch) {
      try {
        localStorage.setItem(LOUDNESS_KEY, JSON.stringify(patch.loudness ?? null));
      } catch {
      }
    }
    setSettings((s) => ({ ...s, ...patch }));
  };
  const aspect = canvas.width / canvas.height;
  const w = Math.round((settings.height * aspect) / 2) * 2;

  const HEIGHTS = [480, 720, 1080, 1440, 2160];
  const FORMATS: Array<{ v: ExportSettings['format']; label: string; sub: string }> = [
    { v: 'mp4', label: 'MP4', sub: 'H.264 · most compatible' },
    { v: 'webm', label: 'WebM', sub: 'VP9 · smaller' },
  ];
  const QUALITIES: Array<ExportSettings['quality']> = ['low', 'medium', 'high'];

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div>
      <div className="mb-1 text-xs text-krypt-muted">{label}</div>
      {children}
    </div>
  );

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[400px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Download className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Export settings</div>
            <div className="text-xs text-krypt-muted">{w}×{settings.height} · {settings.fps} fps · {settings.format.toUpperCase()}</div>
          </div>
        </div>

        <div className="space-y-3">
          <Row label="Format">
            <div className="flex gap-2">
              {FORMATS.map((f) => (
                <button
                  key={f.v}
                  onClick={() => set({ format: f.v })}
                  className={cls('flex-1 rounded-lg border px-3 py-2 text-left transition', settings.format === f.v ? 'border-krypt-purple/50 bg-krypt-purple/15' : 'border-white/10 bg-white/5 hover:bg-white/10')}
                >
                  <div className="text-xs font-semibold text-white">{f.label}</div>
                  <div className="text-[10px] text-krypt-muted">{f.sub}</div>
                </button>
              ))}
            </div>
          </Row>

          <Row label="Resolution">
            <div className="flex flex-wrap gap-1.5">
              {HEIGHTS.map((h) => (
                <button
                  key={h}
                  onClick={() => set({ height: h })}
                  className={cls('rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition', settings.height === h ? 'border-krypt-purple/50 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/5 text-krypt-muted hover:text-white')}
                >
                  {h}p
                </button>
              ))}
            </div>
          </Row>

          <Row label="Frame rate">
            <div className="flex gap-1.5">
              {[24, 30, 60].map((f) => (
                <button
                  key={f}
                  onClick={() => set({ fps: f })}
                  className={cls('flex-1 rounded-lg border py-1.5 text-xs font-semibold transition', settings.fps === f ? 'border-krypt-purple/50 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/5 text-krypt-muted hover:text-white')}
                >
                  {f}
                </button>
              ))}
            </div>
          </Row>

          <Row label="Quality">
            <div className="flex gap-1.5">
              {QUALITIES.map((q) => (
                <button
                  key={q}
                  onClick={() => set({ quality: q })}
                  className={cls('flex-1 rounded-lg border py-1.5 text-xs font-semibold capitalize transition', settings.quality === q ? 'border-krypt-purple/50 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/5 text-krypt-muted hover:text-white')}
                >
                  {q}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Loudness">
            <div className="grid grid-cols-4 gap-1.5">
              {LOUDNESS_TARGETS.map((l) => (
                <button
                  key={l.label}
                  title={l.hint}
                  onClick={() => set({ loudness: l.value })}
                  className={cls('rounded-lg border py-1.5 text-xs font-semibold transition', settings.loudness === l.value ? 'border-krypt-purple/50 bg-krypt-purple/20 text-white' : 'border-white/10 bg-white/5 text-krypt-muted hover:text-white')}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-krypt-muted">
              {settings.loudness == null
                ? 'Leaves the mix as it is.'
                : `${LOUDNESS_TARGETS.find((l) => l.value === settings.loudness)?.hint}: evens out the volume to what they expect, with peaks held under −1 dB.`}
            </p>
          </Row>
          {settings.height >= 2160 && <p className="text-[11px] text-amber-300/80">4K renders frame-by-frame on the CPU/GPU and can be slow.</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <GhostButton onClick={onCancel}>Cancel</GhostButton>
          <PrimaryButton onClick={() => onExport(settings)}>
            <Download className="h-4 w-4" />
            Export
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function ExportModal({ state, onCancel }: { state: ExportProgress; onCancel: () => void }) {
  const pct = Math.round(state.ratio * 100);
  const label =
    state.phase === 'audio' ? 'Mixing audio…' : state.phase === 'video' ? 'Rendering video…' : 'Finalizing…';
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center rounded-2xl bg-krypt-void/85 backdrop-blur-sm animate-fade-in">
      <div className="w-[360px] rounded-2xl border border-white/10 bg-krypt-panel/95 p-6 shadow-krypt-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-krypt-purple/15">
            <Download className="h-5 w-5 text-krypt-purple" />
          </div>
          <div>
            <div className="text-sm font-bold text-white">Exporting</div>
            <div className="text-xs text-krypt-muted">{label}</div>
          </div>
          <div className="ml-auto font-mono text-sm text-white">{pct}%</div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full bg-krypt-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-4 flex justify-end">
          <GhostButton onClick={onCancel} destructive>
            <X className="h-4 w-4" />
            Cancel
          </GhostButton>
        </div>
      </div>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-2xl border-2 border-dashed border-krypt-purple/70 bg-krypt-void/80 backdrop-blur-sm animate-fade-in">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-krypt-purple/50 bg-krypt-purple/15 shadow-krypt-glow">
          <Upload className="h-8 w-8 text-krypt-purple" />
        </div>
        <div className="text-lg font-bold text-white">Drop to import</div>
        <div className="text-sm text-krypt-muted">Video, audio, and images</div>
      </div>
    </div>
  );
}
