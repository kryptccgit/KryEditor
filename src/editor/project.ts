import type { MediaFile } from '@shared/types';
import { IS_MAC } from '../utils/format';
import { lutFromBase64, lutToBase64 } from './lut';
import { useLutStore } from './lutStore';
import { useMediaStore } from './mediaStore';
import { useTimelineStore, type Background, type Canvas, type Clip, type Track } from './timelineStore';

export const PROJECT_SCHEMA = 1;

export interface ProjectFile {
  schemaVersion: number;
  canvas: Canvas;
  background?: Background;
  fps?: number;
  tracks: Track[];
  clips: Clip[];
  media: MediaFile[];
  luts?: Array<{ id: string; name: string; size: number; data: string }>;
}

export function serializeProject(): string {
  const ts = useTimelineStore.getState();
  const ms = useMediaStore.getState();
  const doc: ProjectFile = {
    schemaVersion: PROJECT_SCHEMA,
    canvas: ts.canvas,
    background: ts.background,
    fps: ts.fps,
    tracks: ts.tracks,
    clips: ts.clips,
    media: ms.media,
    luts: useLutStore.getState().luts.map((l) => ({ id: l.id, name: l.name, size: l.size, data: lutToBase64(l.table) })),
  };
  return JSON.stringify(doc);
}

export interface ApplyProjectResult {
  ok: boolean;
  error?: string;
  missing: string[];
}

const CLIP_TYPES = new Set(['media', 'text', 'shape', 'draw']);
const TRACK_KINDS = new Set(['video', 'audio', 'text']);

function validClip(c: unknown): c is Clip {
  const x = c as Clip;
  return (
    !!x &&
    typeof x.id === 'string' &&
    typeof x.trackId === 'string' &&
    CLIP_TYPES.has(x.type) &&
    Number.isFinite(x.start) &&
    Number.isFinite(x.duration) &&
    x.duration > 0
  );
}

function validTrack(t: unknown): t is Track {
  const x = t as Track;
  return !!x && typeof x.id === 'string' && TRACK_KINDS.has(x.kind);
}

export async function applyProject(json: string): Promise<ApplyProjectResult> {
  const fail = (error: string): ApplyProjectResult => ({ ok: false, error, missing: [] });
  let doc: ProjectFile;
  try {
    doc = JSON.parse(json) as ProjectFile;
  } catch {
    return fail('That file is not a valid Krypt project.');
  }
  if (!doc || !Array.isArray(doc.clips) || !Array.isArray(doc.tracks)) {
    return fail('That file is not a valid Krypt project.');
  }
  if (typeof doc.schemaVersion === 'number' && doc.schemaVersion > PROJECT_SCHEMA) {
    return fail('This project was saved by a newer version of Krypt Editor — update the app to open it.');
  }
  if (!doc.clips.every(validClip) || !doc.tracks.every(validTrack)) {
    return fail('This project file is damaged and can’t be opened safely.');
  }

  const restoredMedia = (Array.isArray(doc.media) ? doc.media : []).filter(
    (m): m is MediaFile => !!m && typeof m.filePath === 'string' && typeof m.id === 'string',
  );
  const r = await window.krypt.media.resolvePaths(restoredMedia.map((m) => m.filePath).filter(Boolean));
  const foldPath = (p: string): string => {
    const n = p.normalize('NFC');
    return IS_MAC ? n : n.toLowerCase();
  };
  const found = new Set((r.ok ? r.data ?? [] : []).map((m) => foldPath(m.filePath)));
  const missing = restoredMedia.filter((m) => !found.has(foldPath(m.filePath))).map((m) => m.name);

  useLutStore.getState().replaceAll(
    (Array.isArray(doc.luts) ? doc.luts : [])
      .filter((l) => l && typeof l.id === 'string' && typeof l.data === 'string' && Number.isFinite(l.size))
      .map((l) => {
        try {
          return { id: l.id, name: String(l.name ?? 'LUT'), size: l.size, table: lutFromBase64(l.data) };
        } catch {
          return null;
        }
      })
      .filter((l): l is NonNullable<typeof l> => l !== null && l.table.length === l.size * l.size * l.size * 3),
  );

  useMediaStore.getState().replaceAll(restoredMedia);
  useTimelineStore.getState().loadDoc({
    clips: doc.clips,
    tracks: doc.tracks,
    canvas: doc.canvas ?? { width: 1920, height: 1080 },
    background: doc.background,
    fps: doc.fps,
  });
  return { ok: true, missing };
}

export function hasContent(): boolean {
  return useMediaStore.getState().media.length > 0 || useTimelineStore.getState().clips.length > 0;
}
