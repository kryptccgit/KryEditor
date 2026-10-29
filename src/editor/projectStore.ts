import { create } from 'zustand';

export function nameFromPath(p: string): string {
  const base = p.replace(/\\/g, '/').split('/').pop() ?? p;
  return base.replace(/\.krypt$/i, '');
}

interface ProjectState {
  path: string | null;
  name: string;
  dirty: boolean;
  setSaved: (path: string) => void;
  setOpened: (path: string) => void;
  setNew: (name?: string) => void;
  markDirty: () => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  path: null,
  name: 'Untitled',
  dirty: false,
  setSaved: (p) => set({ path: p, name: nameFromPath(p), dirty: false }),
  setOpened: (p) => set({ path: p, name: nameFromPath(p), dirty: false }),
  setNew: (name = 'Untitled') => set({ path: null, name, dirty: false }),
  markDirty: () => set((s) => (s.dirty ? {} : { dirty: true })),
}));
