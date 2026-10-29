import { FONTS, type Canvas, type Clip, type TextClip, type Track } from './timelineStore';

export interface Template {
  id: string;
  label: string;
  hint: string;
  ratio: number;
  build: () => { canvas: Canvas; tracks: Track[]; clips: Clip[] };
}

let seq = 0;
const uid = (p: string): string => `tpl-${p}-${Date.now().toString(36)}-${++seq}`;

function tracks(): Track[] {
  return [
    { id: uid('tr'), kind: 'text', name: 'T1' },
    { id: uid('tr'), kind: 'video', name: 'V1' },
    { id: uid('tr'), kind: 'audio', name: 'A1' },
  ];
}

function text(trackId: string, over: Partial<TextClip>): TextClip {
  return {
    type: 'text',
    id: uid('t'),
    trackId,
    start: 0,
    duration: 3,
    fadeIn: 0,
    fadeOut: 0,
    text: 'Text',
    fontSize: 80,
    fontFamily: FONTS[0].value,
    color: '#ffffff',
    bold: true,
    italic: false,
    outlineWidth: 6,
    outlineColor: '#000000',
    glow: 0,
    glowColor: '#a855f7',
    bgStyle: 'none',
    bgColor: '#000000',
    bgOpacity: 0.6,
    bgRadius: 10,
    bgPadding: 16,
    align: 'center',
    x: 0.5,
    y: 0.5,
    animIn: 'none',
    animOut: 'none',
    keyframes: [],
    ...over,
  };
}

export const TEMPLATES: Template[] = [
  {
    id: 'blank-16-9',
    label: 'Blank 16:9',
    hint: 'YouTube / landscape',
    ratio: 16 / 9,
    build: () => ({ canvas: { width: 1920, height: 1080 }, tracks: tracks(), clips: [] }),
  },
  {
    id: 'blank-9-16',
    label: 'Blank 9:16',
    hint: 'TikTok / Reels / Shorts',
    ratio: 9 / 16,
    build: () => ({ canvas: { width: 1080, height: 1920 }, tracks: tracks(), clips: [] }),
  },
  {
    id: 'blank-1-1',
    label: 'Blank 1:1',
    hint: 'Square post',
    ratio: 1,
    build: () => ({ canvas: { width: 1080, height: 1080 }, tracks: tracks(), clips: [] }),
  },
  {
    id: 'title-9-16',
    label: 'Title + subtitle',
    hint: '9:16 with a title card',
    ratio: 9 / 16,
    build: () => {
      const t = tracks();
      const textTrack = t[0].id;
      return {
        canvas: { width: 1080, height: 1920 },
        tracks: t,
        clips: [
          text(textTrack, { text: 'Your Title', fontSize: 110, y: 0.4, duration: 4, animIn: 'pop' }),
          text(textTrack, { text: 'subtitle goes here', fontSize: 56, bold: false, y: 0.5, duration: 4, animIn: 'fade' }),
        ],
      };
    },
  },
  {
    id: 'lower-third-16-9',
    label: 'Lower third',
    hint: '16:9 name/title overlay',
    ratio: 16 / 9,
    build: () => {
      const t = tracks();
      const textTrack = t[0].id;
      return {
        canvas: { width: 1920, height: 1080 },
        tracks: t,
        clips: [
          text(textTrack, { text: 'Name', fontSize: 72, align: 'left', x: 0.28, y: 0.8, duration: 5, animIn: 'slide' }),
          text(textTrack, { text: 'Title / role', fontSize: 44, bold: false, align: 'left', x: 0.28, y: 0.87, duration: 5, animIn: 'slide' }),
        ],
      };
    },
  },
];
