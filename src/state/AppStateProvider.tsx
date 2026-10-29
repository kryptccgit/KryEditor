import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppState } from '@shared/types';

interface Api {
  state: AppState | null;
  update: (patch: Partial<AppState>) => Promise<void>;
}

const Ctx = createContext<Api | null>(null);

export function useApp(): Api {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside <AppStateProvider>');
  return ctx;
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);

  const refreshState = useCallback(async () => {
    try {
      setState(await window.krypt.state.get());
    } catch {
    }
  }, []);

  useEffect(() => {
    void refreshState();
    const offState = window.krypt.app.onStateChanged((s) => setState(s));
    return () => {
      offState();
    };
  }, [refreshState]);

  const update = useCallback(async (patch: Partial<AppState>): Promise<void> => {
    try {
      const next = await window.krypt.state.update(patch);
      setState(next);
    } catch (err) {
      console.error('state update failed:', err);
    }
  }, []);

  const api = useMemo<Api>(() => ({ state, update }), [state, update]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
