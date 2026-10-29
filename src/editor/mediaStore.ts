import { create } from 'zustand';
import type { MediaFile } from '@shared/types';

interface MediaState {
  media: MediaFile[];
  selectedId: string | null;

  add: (files: MediaFile[]) => MediaFile[];
  remove: (id: string) => void;
  select: (id: string | null) => void;
  replaceAll: (files: MediaFile[]) => void;
  clear: () => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  media: [],
  selectedId: null,

  add: (files) => {
    const existing = get().media;
    const seen = new Set(existing.map((m) => m.filePath));
    const fresh = files.filter((m) => !seen.has(m.filePath));
    if (fresh.length === 0) return [];
    set({
      media: [...existing, ...fresh],
      selectedId: get().selectedId ?? fresh[0].id,
    });
    return fresh;
  },

  remove: (id) =>
    set((s) => {
      const media = s.media.filter((m) => m.id !== id);
      const selectedId = s.selectedId === id ? (media[0]?.id ?? null) : s.selectedId;
      return { media, selectedId };
    }),

  select: (id) => set({ selectedId: id }),

  replaceAll: (files) => set({ media: files, selectedId: files[0]?.id ?? null }),

  clear: () => set({ media: [], selectedId: null }),
}));
