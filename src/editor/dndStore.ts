import { create } from 'zustand';

export type DragKind = 'effect' | 'transition' | null;

export const DND_EFFECT = 'application/x-krypt-effect';
export const DND_TRANSITION = 'application/x-krypt-transition';

export const useDnd = create<{ kind: DragKind; setKind: (k: DragKind) => void }>((set) => ({
  kind: null,
  setKind: (kind) => set({ kind }),
}));
