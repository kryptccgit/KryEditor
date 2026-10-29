import { Component, useEffect, useState, type ReactNode } from 'react';
import type { MediaFile } from '@shared/types';
import { TopNav, type RouteId } from './components/TopNav';
import { ToastProvider, useToast } from './state/ToastProvider';
import { ModalProvider } from './state/ModalProvider';
import { AppStateProvider } from './state/AppStateProvider';
import { useMediaStore } from './editor/mediaStore';
import { useTimelineStore } from './editor/timelineStore';
import { applyProject, hasContent, serializeProject } from './editor/project';
import { useProjectStore } from './editor/projectStore';
import { EditorPage } from './pages/Editor';
import { SHOW_GUIDE_EVENT } from './utils/guide';
import { markSessionReady, serveAgentTools } from './editor/agentTools';
import { SettingsPage } from './pages/Settings';
import { AboutPage } from './pages/About';

export function App() {
  return (
    <ToastProvider>
      <ModalProvider>
        <AppStateProvider>
          <Shell />
        </AppStateProvider>
      </ModalProvider>
    </ToastProvider>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error('[render error]', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="h-full overflow-auto p-6 text-rose-200">
          <div className="mb-2 text-base font-bold text-rose-300">Something crashed while rendering.</div>
          <div className="mb-3 text-sm">{this.state.error.message}</div>
          <pre className="whitespace-pre-wrap rounded-lg border border-white/10 bg-black/40 p-3 text-[11px] text-krypt-muted">{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function Shell() {
  const toast = useToast();
  const addMedia = useMediaStore((s) => s.add);
  const addToTimeline = useTimelineStore((s) => s.addMedia);
  const [route, setRoute] = useState<RouteId>('editor');

  useEffect(() => {
    const onShowGuide = (): void => setRoute('editor');
    window.addEventListener(SHOW_GUIDE_EVENT, onShowGuide);
    return () => window.removeEventListener(SHOW_GUIDE_EVENT, onShowGuide);
  }, []);

  useEffect(() => serveAgentTools(), []);

  useEffect(() => {
    const off = window.krypt.log.onAppend((entry) => {
      if (entry.level === 'error') toast.error(entry.message);
      else if (entry.level === 'warn') console.warn(`[backend] ${entry.message}`);
    });
    return off;
  }, [toast]);

  useEffect(() => {
    const intake = (incoming: MediaFile[]): void => {
      if (incoming.length === 0) return;
      const added = addMedia(incoming);
      setRoute('editor');
      if (added.length > 0) {
        added.forEach((m) =>
          addToTimeline(m).catch((e: Error) => {
            useMediaStore.getState().remove(m.id);
            toast.error(e.message);
          }),
        );
        toast.success(`Imported ${added.length} file${added.length === 1 ? '' : 's'}`);
      } else {
        toast.info('Those files are already in your media bin.');
      }
    };
    let cancelled = false;
    void (async () => {
      const launch = await window.krypt.media.takeLaunchFiles();
      if (cancelled) return;
      if (launch.length > 0) {
        intake(launch);
        return;
      }
      const json = await window.krypt.project.autosaveRead();
      if (cancelled || !json || hasContent()) return;
      const res = await applyProject(json);
      if (res.ok) {
        useProjectStore.getState().setNew();
        setRoute('editor');
        toast.info('Restored your last session.');
        if (res.missing.length > 0) toast.warn(`Missing media: ${res.missing.join(', ')} — clips using ${res.missing.length === 1 ? 'it' : 'them'} will be empty.`);
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (!cancelled) markSessionReady();
      });
    const off = window.krypt.media.onOpened(intake);
    return () => {
      cancelled = true;
      off();
    };
  }, [addMedia, addToTimeline, toast]);

  useEffect(() => {
    const mark = useProjectStore.getState().markDirty;
    const u1 = useTimelineStore.subscribe((s, prev) => {
      if (s.clips !== prev.clips || s.tracks !== prev.tracks || s.canvas !== prev.canvas) mark();
    });
    const u2 = useMediaStore.subscribe((s, prev) => {
      if (s.media !== prev.media) mark();
    });
    return () => {
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    let timer: number | undefined;
    const schedule = (): void => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (hasContent()) void window.krypt.project.autosaveWrite(serializeProject());
      }, 2500);
    };
    const u1 = useTimelineStore.subscribe((s, prev) => {
      if (s.clips !== prev.clips || s.tracks !== prev.tracks || s.canvas !== prev.canvas) schedule();
    });
    const u2 = useMediaStore.subscribe((s, prev) => {
      if (s.media !== prev.media) schedule();
    });
    return () => {
      if (timer) window.clearTimeout(timer);
      u1();
      u2();
    };
  }, []);

  useEffect(() => {
    const guard = (e: DragEvent): void => {
      if (Array.from(e.dataTransfer?.types ?? []).includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', guard);
    window.addEventListener('drop', guard);
    return () => {
      window.removeEventListener('dragover', guard);
      window.removeEventListener('drop', guard);
    };
  }, []);

  return (
    <div className="flex h-full flex-col bg-krypt-void">
      <div className="pointer-events-none fixed inset-0 bg-krypt-radial" />
      <TopNav current={route} onNavigate={setRoute} />
      <main className="relative min-h-0 flex-1">
        <ErrorBoundary>
          {route === 'editor' && <EditorPage />}
          {route === 'settings' && <SettingsPage />}
          {route === 'about' && <AboutPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
