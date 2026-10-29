import { create } from 'zustand';
import type { LutDef } from './lut';

interface LutState {
  luts: LutDef[];
  add: (lut: LutDef) => void;
  remove: (id: string) => void;
  replaceAll: (luts: LutDef[]) => void;
}

export const useLutStore = create<LutState>((set) => ({
  luts: [],
  add: (lut) => set((s) => ({ luts: [...s.luts.filter((l) => l.id !== lut.id), lut] })),
  remove: (id) => set((s) => ({ luts: s.luts.filter((l) => l.id !== id) })),
  replaceAll: (luts) => set({ luts }),
}));

export function lutById(id: string | undefined): LutDef | undefined {
  return id ? useLutStore.getState().luts.find((l) => l.id === id) : undefined;
}
