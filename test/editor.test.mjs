import assert from 'node:assert';
import {
  activeAudioClips,
  activeWordAt,
  audibleTrackIds,
  denoiseChannel,
  encodeWavPcm16,
  lutAtlasPixels,
  lutFromBase64,
  lutToBase64,
  parseCube,
  maxClipDuration,
  parseSubtitles,
  planSlices,
  poolSize,
  resolvedValue,
  retimeKeyframesForHeadTrim,
  sourceTimeAt,
  speedAt,
  splitKeyframes,
  timeStretch,
  timelineDuration,
  toSRT,
  useTimelineStore,
} from './.editor.mjs';
import { captionClipsFor, clipSpeechCuts, combineSilences, detectSilences, envelopeDb, fillerRanges, intersectRanges, planCuts, remapSegments, retakeRanges, silencesFromWords, sliceClip, timelineTimeAtSource, upcomingVideoClips, voiceLevelDb } from './.editor.mjs';
import { AGENT_TOOL_NAMES, TOOLS, markSessionReady, runAgentTool, useLutStore, useMediaStore, useProjectStore } from './.editor.mjs';
import { AnalysisAccumulator, Resampler, compactRanges, passthroughClip, resample, restoreTimes, sourceTime, speechRanges, tokenTimestamps } from './.editor.mjs';
import { layoutLines, linesFromTranscript, revoicePieces, speakable } from './.editor.mjs';
import { cutRangesForWords, findPhrase, transcriptWordsFrom, wordIndexAt, cameraPath, fillFactor, pathAt, posXFor, reframeClip, sampleTimes, duckKeys, duckSpans, joinClose, voicedFromWords, integratedLoudness, normalizeLoudness, peakDb } from './.editor.mjs';
import { TTS_VOICES, g2pWord, kokoroEncode, loadDict, phonemize, sentences, spellToken, splitLong, textChunks, wordToArpabet } from './.editor.mjs';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b}`);

const mediaClip = (over = {}) => ({
  type: 'media',
  id: 'c1',
  mediaId: 'm1',
  trackId: 'v1',
  start: 0,
  duration: 10,
  inPoint: 0,
  sourceDuration: 10,
  sourceWidth: 1920,
  sourceHeight: 1080,
  speed: 1,
  volume: 1,
  muted: false,
  brightness: 100,
  contrast: 100,
  saturation: 100,
  effect: 'none',
  scaleX: 1,
  scaleY: 1,
  posX: 0,
  posY: 0,
  rotation: 0,
  opacity: 1,
  cropTop: 0,
  cropRight: 0,
  cropBottom: 0,
  cropLeft: 0,
  keyframes: [],
  transition: 'none',
  transitionDur: 0.5,
  chromaKey: false,
  chromaColor: '#00d800',
  chromaSimilarity: 0.4,
  chromaSmoothness: 0.1,
  bgRemove: false,
  fadeIn: 0,
  fadeOut: 0,
  ...over,
});
const kf = (prop, time, value, id = `k${Math.floor(time * 1000)}`) => ({ id, prop, t: time, value });

t('head trim shifts keyframes with the content', () => {
  const clip = mediaClip({ keyframes: [kf('posX', 2, 0.5), kf('posX', 8, -0.5)] });
  const out = retimeKeyframesForHeadTrim(clip, 1);
  const ts = out.filter((k) => k.prop === 'posX').map((k) => k.t).sort((a, b) => a - b);
  assert.deepStrictEqual(ts, [1, 7]);
});

t('head trim past a key samples a boundary key at 0', () => {
  const clip = mediaClip({ keyframes: [kf('posX', 2, 0), kf('posX', 6, 1)] });
  const out = retimeKeyframesForHeadTrim(clip, 4);
  const first = out.filter((k) => k.prop === 'posX').sort((a, b) => a.t - b.t)[0];
  approx(first.t, 0);
  approx(first.value, 0.5);
});

t('split preserves the motion on both halves', () => {
  const clip = mediaClip({ keyframes: [kf('posX', 2, 0), kf('posX', 8, 1)] });
  const { left, right } = splitKeyframes(clip, 5);
  const leftClip = mediaClip({ duration: 5, keyframes: left });
  const rightClip = mediaClip({ start: 5, duration: 5, keyframes: right });
  approx(resolvedValue(leftClip, 'posX', 4.999, 0), (4.999 - 2) / 6, 1e-3);
  approx(resolvedValue(rightClip, 'posX', 5.0, 0), 0.5, 1e-3);
  approx(resolvedValue(rightClip, 'posX', 8, 0), 1, 1e-3);
});

t('mute silences a track; solo overrides everything', () => {
  const tracks = [
    { id: 'a', kind: 'audio', name: 'A1' },
    { id: 'b', kind: 'audio', name: 'A2', muted: true },
  ];
  assert.deepStrictEqual([...audibleTrackIds(tracks)].sort(), ['a']);
  const soloed = [...tracks, { id: 'c', kind: 'audio', name: 'A3', solo: true }];
  assert.deepStrictEqual([...audibleTrackIds(soloed)], ['c']);
});

t('overlapping clips on separate audio tracks both play', () => {
  const tracks = [
    { id: 'a', kind: 'audio', name: 'A1' },
    { id: 'b', kind: 'audio', name: 'A2' },
    { id: 'm', kind: 'audio', name: 'A3', muted: true },
  ];
  const clips = [
    mediaClip({ id: 'voice', trackId: 'a', start: 0, duration: 10 }),
    mediaClip({ id: 'music', trackId: 'b', start: 2, duration: 10 }),
    mediaClip({ id: 'muted', trackId: 'm', start: 0, duration: 10 }),
  ];
  assert.deepStrictEqual(activeAudioClips(clips, tracks, 5).map((c) => c.id).sort(), ['music', 'voice']);
  assert.deepStrictEqual(activeAudioClips(clips, tracks, 1).map((c) => c.id), ['voice']);
});

t('ripple delete closes the gap on the same track', () => {
  useTimelineStore.setState({
    tracks: [{ id: 'v1', kind: 'video', name: 'V1' }],
    clips: [mediaClip({ id: 'x', start: 0, duration: 4 }), mediaClip({ id: 'y', start: 4, duration: 2 }), mediaClip({ id: 'z', start: 6, duration: 3 })],
    selectedIds: ['y'],
    past: [],
    future: [],
  });
  useTimelineStore.getState().rippleDeleteSelected();
  const s = useTimelineStore.getState();
  const z = s.clips.find((c) => c.id === 'z');
  approx(z.start, 4);
  assert.strictEqual(s.clips.length, 2);
});

t('paste lands at the playhead preserving relative timing', () => {
  useTimelineStore.setState({
    tracks: [{ id: 'v1', kind: 'video', name: 'V1' }],
    clips: [mediaClip({ id: 'x', start: 2, duration: 3 }), mediaClip({ id: 'y', start: 6, duration: 2 })],
    selectedIds: ['x', 'y'],
    playhead: 10,
    past: [],
    future: [],
  });
  const st = useTimelineStore.getState();
  assert.strictEqual(st.copySelected(), 2);
  assert.strictEqual(st.paste(), 2);
  const s = useTimelineStore.getState();
  assert.strictEqual(s.clips.length, 4);
  const pasted = s.clips.filter((c) => s.selectedIds.includes(c.id)).sort((a, b) => a.start - b.start);
  approx(pasted[0].start, 10);
  approx(pasted[1].start, 14);
});

t('close gap slides a clip (and later clips) to the previous clip end', () => {
  useTimelineStore.setState({
    tracks: [{ id: 'v1', kind: 'video', name: 'V1' }],
    clips: [mediaClip({ id: 'x', start: 0, duration: 3 }), mediaClip({ id: 'y', start: 5, duration: 2 }), mediaClip({ id: 'z', start: 8, duration: 1 })],
    selectedIds: [],
    past: [],
    future: [],
  });
  useTimelineStore.getState().closeGapBefore('y');
  const s = useTimelineStore.getState();
  approx(s.clips.find((c) => c.id === 'y').start, 3);
  approx(s.clips.find((c) => c.id === 'z').start, 6);
});

t('timelineDuration is the max clip end', () => {
  approx(timelineDuration([mediaClip({ start: 1, duration: 2 }), mediaClip({ id: 'b', start: 4, duration: 3.5 })]), 7.5);
});

t('SRT round-trips through parse and serialize', () => {
  const segs = [
    { start: 0.5, end: 2.25, text: 'Hello there' },
    { start: 3, end: 5.1, text: 'Two\nlines' },
  ];
  const parsed = parseSubtitles(toSRT(segs));
  assert.strictEqual(parsed.length, 2);
  approx(parsed[0].start, 0.5, 1e-3);
  approx(parsed[1].end, 5.1, 1e-3);
  assert.strictEqual(parsed[1].text, 'Two\nlines');
});

t('parses WebVTT with dot timecodes', () => {
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
  const parsed = parseSubtitles(vtt);
  assert.strictEqual(parsed.length, 1);
  approx(parsed[0].start, 1, 1e-3);
});

t('sourceTimeAt matches the closed form for constant speed', () => {
  const clip = mediaClip({ speed: 2, inPoint: 1, start: 3 });
  approx(sourceTimeAt(clip, 7), 1 + 4 * 2);
});

t('sourceTimeAt integrates a speed ramp', () => {
  const clip = mediaClip({ sourceDuration: 30, keyframes: [kf('speed', 0, 1), kf('speed', 10, 3)] });
  approx(speedAt(clip, 0), 1, 1e-3);
  approx(speedAt(clip, 10), 3, 1e-3);
  approx(sourceTimeAt(clip, 10), 20, 0.05);
  approx(sourceTimeAt(clip, 5), 7.5, 0.05);
});

t('maxClipDuration stops where the curve exhausts the source', () => {
  const clip = mediaClip({ sourceDuration: 10, duration: 8, keyframes: [kf('speed', 0, 2), kf('speed', 8, 2)] });
  approx(maxClipDuration(clip), 5, 0.05);
});

t('split with a speed curve keeps source time continuous', () => {
  useTimelineStore.setState({
    tracks: [{ id: 'v1', kind: 'video', name: 'V1' }],
    clips: [mediaClip({ id: 'x', duration: 10, sourceDuration: 30, keyframes: [kf('speed', 0, 1), kf('speed', 10, 3)] })],
    selectedIds: ['x'],
    playhead: 4,
    past: [],
    future: [],
  });
  const before = useTimelineStore.getState().clips[0];
  const srcAtCut = sourceTimeAt(before, 4);
  useTimelineStore.getState().splitSelectedAtPlayhead();
  const s = useTimelineStore.getState();
  const right = s.clips.find((c) => c.start === 4);
  approx(right.inPoint, srcAtCut, 1e-6);
  approx(sourceTimeAt(right, 4), srcAtCut, 0.05);
});

t('moveKeyframes retimes a cluster; deleteKeyframes removes it', () => {
  useTimelineStore.setState({
    tracks: [{ id: 'v1', kind: 'video', name: 'V1' }],
    clips: [mediaClip({ id: 'x', keyframes: [kf('posX', 2, 0.5), kf('opacity', 2.01, 0.8), kf('posX', 6, 1)] })],
    selectedIds: [],
    past: [],
    future: [],
  });
  useTimelineStore.getState().moveKeyframes('x', 2, 3);
  let ks = useTimelineStore.getState().clips[0].keyframes;
  assert.deepStrictEqual(ks.map((k) => k.t).sort((a, b) => a - b), [3, 3, 6]);
  useTimelineStore.getState().deleteKeyframes('x', 3);
  ks = useTimelineStore.getState().clips[0].keyframes;
  assert.deepStrictEqual(ks.map((k) => k.t), [6]);
});

t('activeWordAt holds the last started word until the next begins', () => {
  const clip = {
    type: 'text',
    id: 't1',
    start: 10,
    duration: 3,
    words: [
      { start: 0, end: 0.4, text: 'Hello' },
      { start: 0.6, end: 1.0, text: ' there' },
      { start: 1.4, end: 2.0, text: ' friend' },
    ],
  };
  assert.strictEqual(activeWordAt(clip, 9.9), -1);
  assert.strictEqual(activeWordAt(clip, 10.2), 0);
  assert.strictEqual(activeWordAt(clip, 10.5), 0);
  assert.strictEqual(activeWordAt(clip, 10.7), 1);
  assert.strictEqual(activeWordAt(clip, 12.5), 2);
});

t('addCaptions stores word timings relative to the clip start', () => {
  useTimelineStore.setState({ tracks: [{ id: 'tx', kind: 'text', name: 'T1' }], clips: [], selectedIds: [], past: [], future: [] });
  useTimelineStore.getState().addCaptions([
    { start: 5, end: 7, text: 'Hi there', words: [{ start: 5, end: 5.5, text: 'Hi' }, { start: 5.5, end: 6, text: ' there' }] },
  ]);
  const cap = useTimelineStore.getState().clips[0];
  approx(cap.start, 5);
  approx(cap.words[0].start, 0);
  approx(cap.words[1].start, 0.5);
  assert.strictEqual(cap.karaoke, 'color');
});

t('parses a .cube and lays out the atlas correctly', () => {
  const cube = ['TITLE "Test"', 'LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n');
  const lut = parseCube('test.cube', cube);
  assert.strictEqual(lut.name, 'Test');
  assert.strictEqual(lut.size, 2);
  assert.strictEqual(lut.table.length, 24);
  approx(lut.table[5 * 3], 1);
  approx(lut.table[5 * 3 + 2], 1);
  const px = lutAtlasPixels(lut);
  assert.strictEqual(px[3 * 4], 255);
  assert.strictEqual(px[3 * 4 + 1], 0);
  assert.strictEqual(px[3 * 4 + 2], 255);
});

t('rejects malformed .cube files with a readable message', () => {
  assert.throws(() => parseCube('bad.cube', 'LUT_3D_SIZE 2\n0 0 0'), /expected 8 entries/);
  assert.throws(() => parseCube('bad.cube', '0 0 0\n1 1 1'), /LUT_3D_SIZE/);
});

t('LUT tables round-trip through base64 (project files)', () => {
  const table = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.123456]);
  const back = lutFromBase64(lutToBase64(table));
  assert.strictEqual(back.length, table.length);
  for (let i = 0; i < table.length; i++) approx(back[i], table[i]);
});

t('spectral gate cuts noise-only regions harder than the tone', () => {
  const sr = 48000;
  const n = sr * 2;
  const input = new Float32Array(n);
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < n; i++) {
    input[i] = 0.02 * rand();
    if (i > n * 0.25 && i < n * 0.75) input[i] += 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  }
  const out = denoiseChannel(input);
  const rms = (arr, a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / (b - a));
  };
  const noiseBefore = rms(input, 0, Math.floor(n * 0.2));
  const noiseAfter = rms(out, 0, Math.floor(n * 0.2));
  const toneBefore = rms(input, Math.floor(n * 0.4), Math.floor(n * 0.6));
  const toneAfter = rms(out, Math.floor(n * 0.4), Math.floor(n * 0.6));
  assert.ok(noiseAfter < noiseBefore * 0.5, `noise floor should drop by >6dB (${noiseBefore} → ${noiseAfter})`);
  assert.ok(toneAfter > toneBefore * 0.8, `the tone should survive (${toneBefore} → ${toneAfter})`);
});

t('WAV encoder writes a valid PCM16 header', () => {
  const wav = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 1]), 16000);
  const dv = new DataView(wav.buffer);
  assert.strictEqual(String.fromCharCode(wav[0], wav[1], wav[2], wav[3]), 'RIFF');
  assert.strictEqual(String.fromCharCode(wav[8], wav[9], wav[10], wav[11]), 'WAVE');
  assert.strictEqual(dv.getUint32(24, true), 16000);
  assert.strictEqual(dv.getUint32(40, true), 8);
  assert.strictEqual(dv.getInt16(44 + 6, true), 0x7fff);
});

t('timeStretch changes duration, keeps the signal alive', () => {
  const sr = 48000;
  const input = new Float32Array(sr);
  for (let i = 0; i < sr; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  const out = timeStretch([input], 2)[0];
  approx(out.length, sr / 2, 2);
  let energy = 0;
  for (let i = 0; i < out.length; i++) energy += out[i] * out[i];
  assert.ok(energy / out.length > 0.1, `stretched signal lost energy (${energy / out.length})`);
});

const textClip = (over = {}) => ({
  type: 'text',
  id: 'cap',
  trackId: 't1',
  start: 5,
  duration: 2,
  fadeIn: 0,
  fadeOut: 0,
  text: 'hi',
  fontSize: 48,
  fontFamily: 'Inter',
  color: '#fff',
  bold: false,
  italic: false,
  outlineWidth: 0,
  outlineColor: '#000',
  glow: 0,
  glowColor: '#000',
  bgStyle: 'none',
  bgColor: '#000',
  bgOpacity: 0.6,
  bgRadius: 10,
  bgPadding: 16,
  align: 'center',
  x: 0.5,
  y: 0.8,
  animIn: 'none',
  animOut: 'none',
  keyframes: [],
  ...over,
});
const envFrom = (segments, hz = 100) => {
  const env = new Float32Array(segments.reduce((s, [d]) => s + Math.round(d * hz), 0));
  let i = 0;
  for (const [d, db] of segments) for (let k = 0; k < Math.round(d * hz); k++) env[i++] = db;
  return env;
};
const SIL = { sensitivityDb: 12, minPause: 0.5, padBefore: 0.1, padAfter: 0.2, minKeep: 0.25 };
const V1 = { id: 'v1', kind: 'video', name: 'V1' };
const T1 = { id: 't1', kind: 'text', name: 'T1' };
const A1 = { id: 'a1', kind: 'audio', name: 'A1' };
const MEDIA = [
  { id: 'm1', kind: 'video' },
  { id: 'm2', kind: 'video' },
  { id: 'm3', kind: 'audio' },
];
const byStart = (a, b) => a.start - b.start;

t('envelopeDb: silence sits at the floor, a tone reads as its RMS', () => {
  const sr = 8000;
  const pcm = new Float32Array(sr * 2);
  for (let i = sr; i < 2 * sr; i++) pcm[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sr);
  const env = envelopeDb([pcm], sr);
  approx(env.length, 200, 1);
  assert.ok(env[50] < -90, `silence should sit at the floor (${env[50]})`);
  approx(env[150], 20 * Math.log10(0.5 / Math.SQRT2), 0.5);
});

t('detectSilences: long pauses go, short ones stay, speech keeps its handles', () => {
  const env = envFrom([[1, -60], [2, -20], [0.3, -60], [1.7, -20], [2, -60]]);
  const cuts = detectSilences(env, 100, 0, 7, SIL);
  assert.strictEqual(cuts.length, 2, JSON.stringify(cuts));
  approx(cuts[0][0], 0, 0.011);
  approx(cuts[0][1], 0.9, 0.011);
  approx(cuts[1][0], 5.2, 0.011);
  approx(cuts[1][1], 7, 0.011);
});

t('detectSilences: flat audio has nothing to cut', () => {
  assert.deepStrictEqual(detectSilences(envFrom([[5, -50]]), 100, 0, 5, SIL), []);
});

t('detectSilences: a blip between two pauses is absorbed', () => {
  const env = envFrom([[1, -20], [1, -60], [0.1, -20], [1, -60], [1, -20]]);
  const cuts = detectSilences(env, 100, 0, 4.1, SIL);
  assert.strictEqual(cuts.length, 1, JSON.stringify(cuts));
  approx(cuts[0][0], 1.2, 0.011);
  approx(cuts[0][1], 3.0, 0.011);
});

t('detectSilences: only looks inside the source window', () => {
  const env = envFrom([[2, -60], [2, -20], [2, -60]]);
  const cuts = detectSilences(env, 100, 1, 5, SIL);
  assert.strictEqual(cuts.length, 2, JSON.stringify(cuts));
  approx(cuts[0][0], 1, 0.011);
  approx(cuts[0][1], 1.9, 0.011);
  approx(cuts[1][0], 4.2, 0.011);
  approx(cuts[1][1], 5, 0.011);
});

t('timelineTimeAtSource inverts sourceTimeAt for flat and curved speed', () => {
  const flat = mediaClip({ start: 4, inPoint: 2, speed: 2, duration: 3 });
  approx(timelineTimeAtSource(flat, 2), 4);
  approx(timelineTimeAtSource(flat, 6), 6);
  const ramp = mediaClip({ start: 0, duration: 10, sourceDuration: 30, keyframes: [kf('speed', 0, 1), kf('speed', 10, 3)] });
  for (const tt of [1, 3.3, 7.5]) approx(timelineTimeAtSource(ramp, sourceTimeAt(ramp, tt)), tt, 1e-3);
});

t("combineSilences: one clip's silence never deletes another's speech", () => {
  const voice = { cover: [0, 10], silences: [[2, 4], [8, 10]] };
  const music = { cover: [0, 10], silences: [[0, 3], [9, 10]] };
  assert.deepStrictEqual(combineSilences([voice, music]), [[2, 3], [9, 10]]);
  const late = { cover: [5, 10], silences: [] };
  assert.deepStrictEqual(combineSilences([voice, late]), [[2, 4]]);
});

t('planCuts: removes the range, ripples every track, slices spanning clips, skips locked', () => {
  const tracks = [V1, T1, { ...A1, locked: true }];
  const video = mediaClip({ id: 'v', trackId: 'v1', start: 0, duration: 10 });
  const later = mediaClip({ id: 'w', trackId: 'v1', start: 10, duration: 5, mediaId: 'm2' });
  const cap = textClip({ id: 'cap', start: 5, duration: 2 });
  const music = mediaClip({ id: 'music', trackId: 'a1', mediaId: 'm3', start: 0, duration: 15 });
  const out = planCuts([video, later, cap, music], tracks, MEDIA, [[3, 4]], { remove: true, zoom: null, seamFade: 0.015 });
  const v = out.filter((c) => c.trackId === 'v1').sort(byStart);
  assert.strictEqual(v.length, 3);
  assert.strictEqual(v[0].id, 'v');
  approx(v[0].duration, 3);
  approx(v[1].start, 3);
  approx(v[1].duration, 6);
  approx(v[1].inPoint, 4);
  assert.strictEqual(v[1].transition, 'none');
  approx(v[2].start, 9);
  assert.strictEqual(v[2].id, 'w');
  const c = out.find((x) => x.id === 'cap');
  approx(c.start, 4);
  approx(c.duration, 2);
  const m = out.find((x) => x.id === 'music');
  approx(m.start, 0);
  approx(m.duration, 15);
});

t('planCuts: a clip inside the dead air disappears; motion across the seam is continuous', () => {
  const clip = mediaClip({ id: 'k', duration: 10, keyframes: [kf('posX', 0, 0), kf('posX', 10, 1)] });
  const sticker = textClip({ id: 'gone', start: 3.2, duration: 0.5 });
  const out = planCuts([clip, sticker], [V1, T1], MEDIA, [[3, 4]], { remove: true, zoom: null, seamFade: 0 });
  assert.ok(!out.some((x) => x.id === 'gone'));
  const [left, right] = out.filter((x) => x.trackId === 'v1').sort(byStart);
  approx(resolvedValue(left, 'posX', left.start + left.duration, 0), 0.3, 1e-3);
  approx(resolvedValue(right, 'posX', right.start, 0), 0.4, 1e-3);
  approx(resolvedValue(right, 'posX', right.start + right.duration, 0), 1, 1e-3);
});

t('planCuts: alternating punch-in on video pieces, micro-fades on audio seams', () => {
  const video = mediaClip({ id: 'z', duration: 10 });
  const audio = mediaClip({ id: 'au', trackId: 'a1', mediaId: 'm3', duration: 10 });
  const out = planCuts([video, audio], [V1, A1], MEDIA, [[2, 3], [5, 6]], { remove: true, zoom: 1.12, seamFade: 0.015 });
  const v = out.filter((c) => c.trackId === 'v1').sort(byStart);
  assert.deepStrictEqual(v.map((c) => +c.scaleX.toFixed(2)), [1, 1.12, 1]);
  assert.ok(v[1].posY > 0, 'zoomed piece nudges down to keep a face in frame');
  const a = out.filter((c) => c.trackId === 'a1').sort(byStart);
  assert.ok(a.every((c) => c.scaleX === 1));
  approx(a[0].fadeIn, 0);
  approx(a[0].fadeOut, 0.015);
  approx(a[1].fadeIn, 0.015);
  approx(a[1].fadeOut, 0.015);
  approx(a[2].fadeOut, 0);
  approx(timelineDuration(out), 8);
});

t('planCuts: zoom-only mode keeps every frame', () => {
  const clip = mediaClip({ id: 'z', duration: 10 });
  const out = planCuts([clip], [V1], MEDIA, [[2, 3], [5, 6]], { remove: false, zoom: 1.12, seamFade: 0 }).sort(byStart);
  assert.strictEqual(out.length, 3);
  approx(timelineDuration(out), 10);
  approx(out[1].start, 2.5);
  approx(out[1].inPoint, 2.5);
  approx(out[2].start, 5.5);
  assert.deepStrictEqual(out.map((c) => +c.scaleX.toFixed(2)), [1, 1.12, 1]);
});

t('sliceClip rebases caption word timings', () => {
  const cap = textClip({ start: 10, duration: 4, words: [{ start: 0, end: 1, text: 'a' }, { start: 2, end: 3, text: 'b' }] });
  const right = sliceClip(cap, 12, 14);
  approx(right.start, 12);
  approx(right.duration, 2);
  approx(right.words[1].start, 0);
  assert.strictEqual(activeWordAt(right, 12.5), 1);
  assert.notStrictEqual(right.id, cap.id);
});

t('split rebases caption words on the right half', () => {
  useTimelineStore.setState({
    tracks: [T1],
    clips: [textClip({ id: 'cap', start: 10, duration: 4, words: [{ start: 0, end: 1, text: 'a' }, { start: 2, end: 3, text: 'b' }] })],
    selectedIds: ['cap'],
    playhead: 12,
    past: [],
    future: [],
  });
  useTimelineStore.getState().splitSelectedAtPlayhead();
  const right = useTimelineStore.getState().clips.find((c) => c.start === 12);
  approx(right.words[1].start, 0);
  assert.strictEqual(activeWordAt(right, 12.5), 1);
});

t('commitClips is a single undo step and clamps the playhead', () => {
  useTimelineStore.setState({ tracks: [V1], clips: [mediaClip({ id: 'x', duration: 10 })], selectedIds: ['x'], playhead: 8, past: [], future: [] });
  const st = useTimelineStore.getState();
  st.commitClips(planCuts(st.clips, st.tracks, MEDIA, [[2, 4], [6, 7]], { remove: true, zoom: 1.12, seamFade: 0.015 }));
  let s = useTimelineStore.getState();
  assert.strictEqual(s.clips.length, 3);
  approx(timelineDuration(s.clips), 7);
  approx(s.playhead, 7);
  assert.deepStrictEqual(s.selectedIds, ['x']);
  s.undo();
  s = useTimelineStore.getState();
  assert.strictEqual(s.clips.length, 1);
  approx(s.clips[0].duration, 10);
});

t('silencesFromWords: gaps between words become cuts; no words means nothing to cut', () => {
  const words = [
    { start: 1, end: 2, text: ' a' },
    { start: 2.2, end: 3, text: ' b' },
    { start: 5, end: 6, text: ' c' },
  ];
  const cuts = silencesFromWords(words, 0, 8, SIL);
  assert.deepStrictEqual(cuts.map((r) => r.map((v) => +v.toFixed(3))), [[0, 0.9], [3.2, 4.9], [6.2, 8]]);
  assert.deepStrictEqual(silencesFromWords([], 0, 8, SIL), []);
});

t('fillerRanges: ums go, widened into the gap, neighbours merge, "umbrella" survives', () => {
  const words = [
    { start: 0, end: 0.5, text: ' So' },
    { start: 0.9, end: 1.1, text: ' um,' },
    { start: 1.2, end: 1.4, text: ' uh' },
    { start: 2.0, end: 2.5, text: ' yeah' },
    { start: 3, end: 3.2, text: ' Umbrella' },
  ];
  const cuts = fillerRanges(words);
  assert.strictEqual(cuts.length, 1, JSON.stringify(cuts));
  approx(cuts[0][0], 0.75);
  approx(cuts[0][1], 1.55);
});

t('retakeRanges: a repeated phrase drops the earlier attempts and keeps the last', () => {
  const say = (text, t0) => text.split(' ').map((w, i) => ({ start: t0 + i * 0.3, end: t0 + i * 0.3 + 0.25, text: ` ${w}` }));
  const words = [
    ...say('welcome back to the channel today we', 0),
    ...say('welcome back to the channel today we look at', 4),
    ...say('welcome back to the channel today we look at auto edit', 8),
  ];
  assert.deepStrictEqual(retakeRanges(words).map((r) => r.map((v) => +v.toFixed(2))), [[0, 8]]);
  assert.deepStrictEqual(retakeRanges([...say('and then I was', 0), ...say('and then I was', 5)]), []);
  assert.deepStrictEqual(retakeRanges([...say('welcome back to the channel', 0), ...say('welcome back to the channel', 30)]), []);
});

t('clipSpeechCuts scales timeline settings into source time and pads for Whisper slop', () => {
  const clip = mediaClip({ start: 0, duration: 5, inPoint: 0, speed: 2, sourceDuration: 10 });
  const words = [
    { start: 0, end: 4, text: ' a' },
    { start: 6, end: 10, text: ' b' },
  ];
  const r = clipSpeechCuts(clip, words, SIL, { fillers: false, retakes: false });
  assert.strictEqual(r.pauses.length, 1, JSON.stringify(r));
  approx(r.pauses[0][0], 2.4);
  approx(r.pauses[0][1], 2.7);
  assert.deepStrictEqual(r.fillers, []);
});

t('remapSegments: captions follow the surviving pieces and lose the cut words', () => {
  const clip = mediaClip({ id: 'v', duration: 10 });
  const pieces = planCuts([clip], [V1], MEDIA, [[3, 5]], { remove: true, zoom: null, seamFade: 0 });
  const segs = [
    {
      start: 1,
      end: 7,
      text: 'one two three four',
      words: [
        { start: 1, end: 1.5, text: ' one' },
        { start: 2, end: 2.5, text: ' two' },
        { start: 3.5, end: 4, text: ' three' },
        { start: 6, end: 6.5, text: ' four' },
      ],
    },
    { start: 8, end: 9, text: 'chunk only' },
  ];
  const out = remapSegments(segs, pieces);
  assert.strictEqual(out.length, 3, JSON.stringify(out));
  assert.strictEqual(out[0].text, 'one two');
  approx(out[0].start, 1);
  assert.strictEqual(out[1].text, 'four');
  approx(out[1].start, 4);
  approx(out[2].start, 6);
});

t('commitClips can add a track in the same undo step; captionClipsFor rebases words', () => {
  useTimelineStore.setState({ tracks: [V1], clips: [mediaClip({ id: 'x', duration: 10 })], selectedIds: [], playhead: 0, past: [], future: [] });
  const st = useTimelineStore.getState();
  const caps = captionClipsFor([{ start: 1, end: 2, text: 'hi', words: [{ start: 1, end: 1.5, text: 'hi' }] }], undefined, 't9');
  st.commitClips([...st.clips, ...caps], [...st.tracks, { id: 't9', kind: 'text', name: 'T1' }]);
  let s = useTimelineStore.getState();
  assert.strictEqual(s.tracks.length, 2);
  assert.strictEqual(s.clips.length, 2);
  assert.strictEqual(s.clips[1].role, 'caption');
  approx(s.clips[1].words[0].start, 0);
  s.undo();
  s = useTimelineStore.getState();
  assert.strictEqual(s.tracks.length, 1);
  assert.strictEqual(s.clips.length, 1);
});

t('intersectRanges keeps only the overlap', () => {
  assert.deepStrictEqual(intersectRanges([[0, 5], [8, 10]], [[3, 9]]), [[3, 5], [8, 9]]);
  assert.deepStrictEqual(intersectRanges([[0, 1]], [[1, 2]]), []);
});

t('voiceLevelDb is the median loudness inside the words', () => {
  const env = envFrom([[2, -20], [2, -60], [2, -14]]);
  const words = [
    { start: 0, end: 2, text: ' a' },
    { start: 4, end: 6, text: ' b' },
  ];
  const v = voiceLevelDb(env, 100, words, 0, 6);
  assert.ok(v === -20 || v === -14, `median of the two speech levels (${v})`);
  assert.strictEqual(voiceLevelDb(env, 100, [], 0, 6), null);
});

t('speech mode: a gap Whisper missed stays in when the sound is still at voice level', () => {
  const env = envFrom([[6, -20], [3, -60], [1, -20]]);
  const words = [
    { start: 0, end: 3, text: ' one' },
    { start: 5, end: 6, text: ' two' },
    { start: 9, end: 10, text: ' three' },
  ];
  const clip = mediaClip({ start: 0, duration: 10, inPoint: 0, sourceDuration: 10 });
  const voice = { env, hz: 100, voiceDb: voiceLevelDb(env, 100, words, 0, 10) };
  const guarded = clipSpeechCuts(clip, words, SIL, { fillers: false, retakes: false }, voice).pauses;
  assert.strictEqual(guarded.length, 1, JSON.stringify(guarded));
  approx(guarded[0][0], 6.4, 0.011);
  approx(guarded[0][1], 8.7, 0.011);
  const naive = clipSpeechCuts(clip, words, SIL, { fillers: false, retakes: false }).pauses;
  assert.strictEqual(naive.length, 2, JSON.stringify(naive));
  approx(naive[0][0], 3.4, 0.011);
});

t('speech mode: a loud spike inside a quiet gap is absorbed, a word between gaps is not', () => {
  const env = envFrom([[2, -20], [2, -60], [0.1, -20], [1.9, -60], [1, -20], [1, -60], [0.2, -20], [1.8, -60], [1, -20]]);
  const words = [
    { start: 0, end: 2, text: ' a' },
    { start: 6, end: 7, text: ' b' },
    { start: 8, end: 8.2, text: ' yes' },
    { start: 10, end: 11, text: ' c' },
  ];
  const clip = mediaClip({ start: 0, duration: 11, inPoint: 0, sourceDuration: 11 });
  const voice = { env, hz: 100, voiceDb: -20 };
  const cuts = clipSpeechCuts(clip, words, SIL, { fillers: false, retakes: false }, voice).pauses;
  assert.strictEqual(cuts.length, 3, JSON.stringify(cuts));
  approx(cuts[0][0], 2.4, 0.011);
  approx(cuts[0][1], 5.7, 0.011);
  approx(cuts[1][1], 7.7, 0.011);
  approx(cuts[2][0], 8.6, 0.011);
});

t('upcomingVideoClips lists what starts soon on visible video tracks, nearest first', () => {
  const tracks = [V1, { id: 'v2', kind: 'video', name: 'V2', hidden: true }, A1];
  const clips = [
    mediaClip({ id: 'now', start: 0, duration: 5 }),
    mediaClip({ id: 'soon', start: 6, duration: 2 }),
    mediaClip({ id: 'sooner', start: 5, duration: 1 }),
    mediaClip({ id: 'hidden', start: 5.5, duration: 1, trackId: 'v2' }),
    mediaClip({ id: 'audio', start: 5.2, duration: 1, trackId: 'a1', mediaId: 'm3' }),
    mediaClip({ id: 'later', start: 20, duration: 1 }),
  ];
  assert.deepStrictEqual(upcomingVideoClips(clips, tracks, 4.5, 2.5).map((c) => c.id), ['sooner', 'soon']);
  assert.deepStrictEqual(upcomingVideoClips(clips, tracks, 4.5, 2.5, 1).map((c) => c.id), ['sooner']);
});

t('planSlices cuts long audio at the quietest point near each even split', () => {
  const sr = 1000;
  const a = new Float32Array(300 * sr).fill(0.5);
  for (let i = 95 * sr; i < 95.3 * sr; i++) a[i] = 0;
  for (let i = 212 * sr; i < 212.3 * sr; i++) a[i] = 0;
  const pts = planSlices(a, 100, 15, sr);
  assert.strictEqual(pts.length, 4, JSON.stringify(pts));
  assert.strictEqual(pts[0], 0);
  assert.strictEqual(pts[3], a.length);
  approx(pts[1] / sr, 95.1, 0.2);
  approx(pts[2] / sr, 212.1, 0.2);
  assert.deepStrictEqual(planSlices(new Float32Array(40 * sr), 100, 5, sr), [0, 40 * sr]);
});

t('poolSize: half the cores, capped at 8, fewer on low memory', () => {
  assert.strictEqual(poolSize(16, 8), 8);
  assert.strictEqual(poolSize(32, 8), 8);
  assert.strictEqual(poolSize(8, 8), 4);
  assert.strictEqual(poolSize(16, 4), 4);
  assert.strictEqual(poolSize(16, 2), 2);
  assert.strictEqual(poolSize(1, 8), 1);
});

{
  markSessionReady();
  const sig = new AbortController().signal;
  const run = (tool, args = {}) => runAgentTool({ rid: 1, tool, args, client: 'test' }, () => {}, sig);
  const reset = () => {
    useMediaStore.setState({ media: [{ id: 'm1', name: 'talk.mp4', kind: 'video', filePath: 'C:/v/talk.mp4', sizeBytes: 1, mediaUrl: 'x' }] });
    useTimelineStore.setState({
      tracks: [V1, T1],
      clips: [mediaClip({ id: 'a', duration: 10, mediaId: 'm1', sourceDuration: 10 }), mediaClip({ id: 'b', start: 10, duration: 5, mediaId: 'm1', inPoint: 2, sourceDuration: 10 })],
      selectedIds: [],
      playhead: 0,
      past: [],
      future: [],
    });
  };

  await ta('agent get_project lists tracks, clips and media in timeline seconds', async () => {
    reset();
    const r = await run('get_project');
    assert.ok(r.ok, r.text);
    const p = JSON.parse(r.text);
    assert.strictEqual(p.duration, 15);
    assert.deepStrictEqual(p.clips.map((c) => c.id), ['a', 'b']);
    assert.strictEqual(p.clips[1].in, 2);
    assert.strictEqual(p.media[0].name, 'talk.mp4');
  });

  await ta('agent cut_ranges ripples, is one undo step, and rejects nonsense', async () => {
    reset();
    const r = await run('cut_ranges', { ranges: [[2, 4], [12, 13]] });
    assert.ok(r.ok, r.text);
    const s = useTimelineStore.getState();
    approx(timelineDuration(s.clips), 12);
    assert.strictEqual(s.past.length, 1);
    s.undo();
    approx(timelineDuration(useTimelineStore.getState().clips), 15);
    const bad = await run('cut_ranges', { ranges: [[5, 3]] });
    assert.ok(!bad.ok && /valid/.test(bad.text), bad.text);
  });

  await ta('agent cut_ranges with ripple=false leaves the gap', async () => {
    reset();
    await run('cut_ranges', { ranges: [[2, 4]], ripple: false });
    const s = useTimelineStore.getState();
    approx(timelineDuration(s.clips), 15);
    assert.ok(!s.clips.some((c) => c.start < 4 - 1e-6 && c.start + c.duration > 2 + 1e-6));
  });

  await ta('agent split_clips and delete_clips (ripple on the clip\'s own track only)', async () => {
    reset();
    useTimelineStore.setState({ clips: [...useTimelineStore.getState().clips, textClip({ id: 'txt', start: 12, duration: 2 })] });
    const sp = await run('split_clips', { time: 5, clip_ids: ['a'] });
    assert.ok(sp.ok, sp.text);
    assert.strictEqual(useTimelineStore.getState().clips.filter((c) => c.trackId === 'v1').length, 3);
    const del = await run('delete_clips', { clip_ids: ['a'], ripple: true });
    assert.ok(del.ok, del.text);
    const s = useTimelineStore.getState();
    const b = s.clips.find((c) => c.id === 'b');
    approx(b.start, 5);
    approx(s.clips.find((c) => c.id === 'txt').start, 12);
  });

  await ta('agent update_clip caps duration at the end of the source and maps snake_case', async () => {
    reset();
    const r = await run('update_clip', { clip_id: 'b', duration: 30, volume: 0.5, scale: 1.2 });
    assert.ok(r.ok, r.text);
    assert.match(r.text, /capped/);
    const b = useTimelineStore.getState().clips.find((c) => c.id === 'b');
    approx(b.duration, 8);
    assert.strictEqual(b.volume, 0.5);
    assert.strictEqual(b.scaleX, 1.2);
    const none = await run('update_clip', { clip_id: 'b' });
    assert.ok(!none.ok);
  });

  await ta('agent add_text creates a text track if needed, all in one undo step', async () => {
    reset();
    useTimelineStore.setState({ tracks: [V1] });
    const r = await run('add_text', { text: 'Day 1', start: 0, duration: 3, style: { font_size: 120, anim_in: 'pop' } });
    assert.ok(r.ok, r.text);
    const s = useTimelineStore.getState();
    const txt = s.clips.find((c) => c.type === 'text');
    assert.strictEqual(txt.text, 'Day 1');
    assert.strictEqual(txt.fontSize, 120);
    assert.strictEqual(txt.animIn, 'pop');
    assert.strictEqual(s.tracks.find((tr) => tr.id === txt.trackId).kind, 'text');
    assert.strictEqual(s.past.length, 1, 'one undo step');
    s.undo();
    assert.strictEqual(useTimelineStore.getState().tracks.length, 1);
    const bad = await run('add_text', { text: 'x', start: 0, duration: 1, style: { anim_in: 'explode' } });
    assert.ok(!bad.ok && /Unknown animation/.test(bad.text));
  });

  await ta('agent undo/redo, set_canvas and unknown tools', async () => {
    reset();
    await run('set_canvas', { aspect: '9:16' });
    assert.deepStrictEqual(useTimelineStore.getState().canvas, { width: 1080, height: 1920 });
    assert.match((await run('undo', { steps: 5 })).text, /Undid 1 step/);
    assert.match((await run('redo')).text, /Redid 1 step/);
    const u = await run('nope');
    assert.ok(!u.ok);
  });
}

{
  const sig = new AbortController().signal;
  const run = (tool, args = {}) => runAgentTool({ rid: 1, tool, args, client: 'test' }, () => {}, sig);
  const reset = () => {
    useMediaStore.setState({ media: [{ id: 'm1', name: 'talk.mp4', kind: 'video', filePath: 'C:/v/talk.mp4', sizeBytes: 1, mediaUrl: 'x' }] });
    useLutStore.setState({ luts: [{ id: 'lut-a', name: 'Teal.cube', size: 2, table: new Float32Array(24) }] });
    useTimelineStore.setState({
      tracks: [V1, T1],
      clips: [
        mediaClip({ id: 'a', duration: 10, mediaId: 'm1', sourceDuration: 20 }),
        mediaClip({ id: 'b', start: 10, duration: 5, mediaId: 'm1', inPoint: 10, sourceDuration: 20 }),
        textClip({ id: 'txt', start: 1, duration: 2 }),
      ],
      selectedIds: [],
      playhead: 0,
      past: [],
      future: [],
    });
  };
  const clip = (id) => useTimelineStore.getState().clips.find((c) => c.id === id);

  await ta('agent tool list matches the executor (no tool without a handler, no handler without a schema)', async () => {
    assert.deepStrictEqual([...AGENT_TOOL_NAMES].sort(), TOOLS.map((x) => x.name).sort());
  });

  await ta('agent list_options names everything the other tools accept', async () => {
    reset();
    const o = JSON.parse((await run('list_options')).text);
    assert.ok(o.effects.gpu_effects.includes('vhs') && o.effects.filters.includes('bw'));
    assert.ok(o.transitions.includes('fade') && o.blend_modes.includes('screen') && o.fonts.includes('Impact'));
    assert.deepStrictEqual(o.luts, [{ id: 'lut-a', name: 'Teal.cube' }]);
    assert.ok(o.keyframable.media.includes('scale'));
  });

  await ta('agent update_clip on a whole track: effect + transition on every media clip, text skipped, one undo step', async () => {
    reset();
    const r = await run('update_clip', { track_id: 'v1', effect: 'VHS', transition: 'fade', transition_duration: 0.4, blend: 'Screen', crop_top: 0.1 });
    assert.ok(r.ok, r.text);
    for (const id of ['a', 'b']) {
      assert.strictEqual(clip(id).effect, 'vhs');
      assert.strictEqual(clip(id).transition, 'fade');
      assert.strictEqual(clip(id).blend, 'screen');
      approx(clip(id).cropTop, 0.1);
    }
    assert.strictEqual(useTimelineStore.getState().past.length, 1);
    const bad = await run('update_clip', { clip_id: 'a', effect: 'sparkles' });
    assert.ok(!bad.ok && /Unknown effect/.test(bad.text), bad.text);
    const textOnly = await run('update_clip', { clip_id: 'txt', effect: 'vhs' });
    assert.ok(!textOnly.ok && /don't apply/.test(textOnly.text), textOnly.text);
  });

  await ta('agent update_clip: a GPU effect and a LUT replace each other; chroma key and bg removal too', async () => {
    reset();
    await run('update_clip', { clip_id: 'a', lut: 'teal', lut_amount: 0.5 });
    assert.strictEqual(clip('a').lut, 'lut-a');
    const r = await run('update_clip', { clip_id: 'a', effect: 'glitch' });
    assert.match(r.text, /LUT was cleared/);
    assert.strictEqual(clip('a').lut, undefined);
    await run('update_clip', { clip_id: 'a', lut: 'lut-a' });
    assert.strictEqual(clip('a').effect, 'none');
    const both = await run('update_clip', { clip_id: 'a', lut: 'lut-a', effect: 'vhs' });
    assert.ok(!both.ok);
    await run('update_clip', { clip_id: 'a', chroma_key: { enabled: true, color: '#0000ff' } });
    await run('update_clip', { clip_id: 'a', bg_remove: true });
    assert.ok(clip('a').bgRemove && !clip('a').chromaKey);
    const noLut = await run('update_clip', { clip_id: 'a', lut: 'nope' });
    assert.ok(!noLut.ok && /Teal\.cube/.test(noLut.text));
  });

  await ta('agent update_clip: masks merge over the default and null removes them; text style by font name', async () => {
    reset();
    await run('update_clip', { clip_id: 'a', mask: { type: 'rect', feather: 0.2 } });
    assert.strictEqual(clip('a').mask.type, 'rect');
    approx(clip('a').mask.feather, 0.2);
    approx(clip('a').mask.w, 0.6);
    await run('update_clip', { clip_id: 'a', mask: null });
    assert.strictEqual(clip('a').mask, undefined);
    const t = await run('update_clip', { clip_id: 'txt', style: { font: 'impact', glow: 12, bg_style: 'box', bg_opacity: 0.4 } });
    assert.ok(t.ok, t.text);
    assert.match(clip('txt').fontFamily, /Impact/);
    assert.strictEqual(clip('txt').glow, 12);
  });

  await ta('agent set_keyframes: timeline times become clip-local, scale keys both axes, outside times are refused', async () => {
    reset();
    const r = await run('set_keyframes', { clip_id: 'b', property: 'scale', keyframes: [{ time: 10, value: 1 }, { time: 15, value: 1.3, ease: 'inout' }] });
    assert.ok(r.ok, r.text);
    const ks = clip('b').keyframes;
    assert.strictEqual(ks.length, 4);
    assert.deepStrictEqual([...new Set(ks.map((k) => k.prop))].sort(), ['scaleX', 'scaleY']);
    approx(Math.max(...ks.map((k) => k.t)), 5);
    const out = await run('set_keyframes', { clip_id: 'b', property: 'opacity', keyframes: [{ time: 2, value: 0 }] });
    assert.ok(!out.ok && /outside/.test(out.text));
    await run('set_keyframes', { clip_id: 'b', property: 'scale', keyframes: [] });
    assert.strictEqual(clip('b').keyframes.length, 0);
    const wrong = await run('set_keyframes', { clip_id: 'txt', property: 'speed', keyframes: [] });
    assert.ok(!wrong.ok);
  });

  await ta('agent set_keyframes on speed shortens a clip that would run out of footage', async () => {
    reset();
    const r = await run('set_keyframes', { clip_id: 'b', property: 'speed', keyframes: [{ time: 10, value: 4 }, { time: 15, value: 4 }] });
    assert.ok(r.ok, r.text);
    assert.ok(clip('b').duration < 5 - 1e-6, `duration ${clip('b').duration}`);
    assert.match(r.text, /shortened/);
  });

  await ta('agent retime_clip: freeze of a chosen length pushes the track right; presets apply', async () => {
    reset();
    const r = await run('retime_clip', { clip_id: 'a', freeze_at: 4, freeze_duration: 2 });
    assert.ok(r.ok, r.text);
    approx(clip('b').start, 12);
    const s = useTimelineStore.getState();
    const frozen = s.clips.find((c) => c.freezeAt != null);
    approx(frozen.duration, 2);
    approx(frozen.start, 4);
    assert.strictEqual(s.past.length, 1);
    assert.strictEqual(clip('txt').start, 1, 'other tracks untouched');
    const p = await run('retime_clip', { clip_id: 'b', speed_preset: 'montage' });
    assert.ok(p.ok, p.text);
    assert.ok(clip('b').keyframes.some((k) => k.prop === 'speed'));
    const two = await run('retime_clip', { clip_id: 'b', speed_preset: 'none', reverse: true });
    assert.ok(!two.ok);
  });

  await ta('agent duplicate_clip, detach_audio, add_shape and edit_track', async () => {
    reset();
    const d = await run('duplicate_clip', { clip_id: 'txt', start: 6 });
    assert.ok(d.ok, d.text);
    assert.strictEqual(useTimelineStore.getState().clips.filter((c) => c.type === 'text').length, 2);
    const det = await run('detach_audio', { clip_id: 'a' });
    assert.ok(det.ok, det.text);
    assert.ok(clip('a').muted);
    assert.ok(useTimelineStore.getState().tracks.some((t) => t.kind === 'audio'));
    const sh = await run('add_shape', { shape: 'arrow', start: 2, duration: 1.5, fill: '#ff0000', x: 0.2 });
    assert.ok(sh.ok, sh.text);
    const shape = useTimelineStore.getState().clips.find((c) => c.type === 'shape');
    assert.strictEqual(shape.fill, '#ff0000');
    approx(shape.x, 0.2);
    approx(shape.start, 2);
    const add = await run('edit_track', { action: 'add', kind: 'video', name: 'B-roll', locked: true });
    assert.ok(add.ok, add.text);
    const tr = useTimelineStore.getState().tracks.at(-1);
    assert.strictEqual(tr.name, 'B-roll');
    assert.ok(tr.locked);
    const before = useTimelineStore.getState().past.length;
    await run('edit_track', { action: 'update', track_id: 'v1', hidden: true });
    assert.ok(useTimelineStore.getState().tracks.find((t) => t.id === 'v1').hidden);
    assert.strictEqual(useTimelineStore.getState().past.length, before + 1);
    await run('edit_track', { action: 'remove', track_id: tr.id });
    assert.ok(!useTimelineStore.getState().tracks.some((t) => t.id === tr.id));
  });

  await ta('agent set_canvas changes size, fps and background in one undo step', async () => {
    reset();
    const r = await run('set_canvas', { aspect: '9:16', fps: 60, background: 'blur' });
    assert.ok(r.ok, r.text);
    const s = useTimelineStore.getState();
    assert.deepStrictEqual(s.canvas, { width: 1080, height: 1920 });
    assert.strictEqual(s.fps, 60);
    assert.strictEqual(s.background.type, 'blur');
    assert.strictEqual(s.past.length, 1);
    s.undo();
    assert.strictEqual(useTimelineStore.getState().background.type, 'black');
  });

  await ta('agent open_project refuses to throw away unsaved changes', async () => {
    reset();
    useProjectStore.setState({ dirty: true });
    const r = await run('open_project', { path: 'C:/x.krypt' });
    assert.ok(!r.ok && /unsaved/.test(r.text), r.text);
    useProjectStore.setState({ dirty: false });
  });
}

{
  loadDict(inflateRawSync(readFileSync(new URL('../src/editor/kokoro/cmudict.txt.deflate', import.meta.url))).toString('utf8'));
  const ph = (w) => g2pWord(w)[0];

  t('kokoro G2P: dictionary words, the US flap, weak function words', () => {
    const cases = { hello: 'həlˈO', world: 'wˈɜɹld', water: 'wˈɔɾəɹ', party: 'pˈɑɹɾi', button: 'bˈʌtən', music: 'mjˈuzɪk', judge: 'ʤˈʌʤ', voice: 'vˈYs', "cat's": 'kˈæts' };
    for (const [w, want] of Object.entries(cases)) assert.deepStrictEqual(g2pWord(w), [want, 'dictionary'], w);
    assert.strictEqual(ph('the'), 'ðə');
    assert.ok(phonemize('the apple').phonemes.startsWith('ði '));
    assert.ok(phonemize('the beat').phonemes.startsWith('ðə '));
  });

  t('kokoro G2P: suffixes, compounds, acronyms and made-up words', () => {
    assert.deepStrictEqual(g2pWord('beatmakers'), ['bˈitmˌAkəɹz', 'derived']);
    assert.strictEqual(ph('vibing'), 'vˈIbɪŋ');
    assert.strictEqual(ph('lovesick'), 'lˈʌvsˌɪk');
    assert.strictEqual(ph("vibin'"), 'vˈIbɪn');
    assert.deepStrictEqual(g2pWord('DJ'), ['dˌiʤˈA', 'spelled']);
    assert.deepStrictEqual(g2pWord('zorblax'), ['zˈɔɹblæks', 'rules']);
    assert.strictEqual(ph('skrrt'), 'skɹt');
    assert.strictEqual(wordToArpabet('station').join(' '), 'S T EY1 SH AH0 N');
  });

  t('kokoro G2P: numbers, money, abbreviations and sentences', () => {
    const p = phonemize('I paid $5.50 for 3 tracks in 1999.');
    assert.strictEqual(p.phonemes, 'I pˈAd fˈIv dˈɑləɹz fˈɪfti sˈɛnts fɔɹ θɹˈi tɹˈæks ɪn nˈIntˈin nˈInti nˈIn.');
    assert.deepStrictEqual(p.words.map((w) => w.text), ['I', 'paid', '$5.50', 'for', '3', 'tracks', 'in', '1999']);
    assert.ok(phonemize('Dr. Dre').phonemes.startsWith('dˈɑktəɹ '));
    assert.deepStrictEqual(['1,000', '90s', '21st', '50%', '007', 'abc'].map(spellToken), ['one thousand', 'nineties', 'twenty first', 'fifty percent', 'zero zero seven', null]);
    assert.deepStrictEqual(sentences('Hello there. Mr. Smith arrived at 3.5 p.m.! Did he?\nNew line'), ['Hello there.', 'Mr. Smith arrived at 3.5 p.m.!', 'Did he?', 'New line']);
  });

  t('kokoro G2P: every output character is a Kokoro token; long text splits under the model limit', () => {
    const p = phonemize('Hello, "big" world (yes)!');
    assert.strictEqual(p.phonemes, 'həlˈO, "bˈɪɡ" wˈɜɹld (jˈɛs)!');
    const all = phonemize('Zany quixotic jukebox vibes, 1,234 ways — whoa… (FYI) "quoted"; colon: done!');
    assert.strictEqual(kokoroEncode(all.phonemes).length, [...all.phonemes].length, all.phonemes);
    const long = phonemize('one two three, four five six. '.repeat(20));
    const pieces = splitLong(long, 60);
    assert.ok(pieces.length > 3 && pieces.every((x) => [...x.phonemes].length <= 60));
    assert.strictEqual(pieces.reduce((n, x) => n + x.words.length, 0), long.words.length);
    assert.ok(textChunks('word '.repeat(300)).every((c) => kokoroEncode(c.phonemes).length <= 400));
  });

  t('voice list: Kokoro English voices first, MMS for the other languages', () => {
    assert.strictEqual(TTS_VOICES[0].value, 'kokoro:af_heart');
    assert.strictEqual(TTS_VOICES.filter((v) => v.value.startsWith('kokoro:')).length, 28);
    assert.ok(TTS_VOICES.some((v) => v.label === 'Spanish'));
  });
}

{
  t('re-voice lines: tags dropped, sentences split by a cut re-joined, finished sentences kept apart', () => {
    const pieces = [mediaClip({ id: 'p1', duration: 10, mediaId: 'm1', sourceDuration: 40 }), mediaClip({ id: 'p2', start: 10, duration: 10, mediaId: 'm1', inPoint: 20, sourceDuration: 40 })];
    const segs = [
      { start: 1, end: 3, text: ' So today we are' },
      { start: 3.1, end: 4, text: ' going to edit. [Music]' },
      { start: 5, end: 6, text: ' [Music]' },
      { start: 21, end: 23, text: ' (laughs) Then we export.' },
      { start: 14, end: 15, text: ' this part was cut' },
    ];
    const lines = linesFromTranscript(segs, pieces);
    assert.deepStrictEqual(lines.map((l) => l.text), ['So today we are going to edit.', 'Then we export.']);
    approx(lines[1].start, 11);
    assert.strictEqual(speakable('  hi *sighs* there '), 'hi there');
  });

  t('re-voice pieces: one track, preferring the one you can hear', () => {
    const kinds = new Map([['m1', 'video']]);
    const clips = [mediaClip({ id: 'v', trackId: 'v1', mediaId: 'm1', muted: true }), mediaClip({ id: 'a', trackId: 'a1', mediaId: 'm1' }), mediaClip({ id: 'other', trackId: 'a1', mediaId: 'm2' })];
    assert.deepStrictEqual(revoicePieces(clips, kinds, 'm1').map((c) => c.id), ['a']);
  });

  t('re-voice layout: lines land at their times; a long line is sped up, then the next one waits', () => {
    const sr = 24000;
    const tone = (sec) => Float32Array.from({ length: Math.round(sec * sr) }, (_, i) => Math.sin(i / 3) * 0.5);
    let r = layoutLines([{ start: 2, audio: tone(1) }, { start: 5, audio: tone(1) }], sr);
    approx(r.offset, 2);
    assert.strictEqual(r.stretched + r.moved, 0);
    approx(r.audio.length / sr, 4, 0.01);
    r = layoutLines([{ start: 0, audio: tone(2.4) }, { start: 2, audio: tone(1) }], sr);
    assert.strictEqual(r.stretched, 1);
    assert.strictEqual(r.moved, 0);
    r = layoutLines([{ start: 0, audio: tone(4) }, { start: 2, audio: tone(1) }], sr);
    assert.strictEqual(r.stretched, 1);
    assert.strictEqual(r.moved, 1);
    approx(r.audio.length / sr, 4 / 1.3 + 0.08 + 1, 0.05);
  });
}

{
  const tone = (f, sr, secs, a = 0.5) => Float32Array.from({ length: Math.round(sr * secs) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));
  const rms = (x, from = 0, to = x.length) => {
    let s = 0;
    for (let i = from; i < to; i++) s += x[i] * x[i];
    return Math.sqrt(s / (to - from));
  };

  t('resampler: 44.1k → 16k keeps a 1 kHz tone, removes a 10 kHz one (no aliasing), exact length', () => {
    const x = tone(1000, 44100, 2);
    const y = resample(x, 44100, 16000);
    assert.strictEqual(y.length, Math.ceil((x.length * 16000) / 44100));
    approx(rms(y, 1000, y.length - 1000), 0.5 / Math.SQRT2, 0.005);
    const ideal = tone(1000, 16000, 2);
    let err = 0;
    for (let i = 1000; i < y.length - 1000; i++) err = Math.max(err, Math.abs(y[i] - ideal[i]));
    assert.ok(err < 0.01, `max error ${err}`);
    const hi = resample(tone(10000, 44100, 2), 44100, 16000);
    assert.ok(rms(hi, 1000, hi.length - 1000) < 0.002, `10 kHz leaked: ${rms(hi, 1000, hi.length - 1000)}`);
  });

  t('resampler: streaming in odd-sized chunks gives the same samples as one block; 44.1k → 48k up-sampling too', () => {
    const x = tone(440, 44100, 1.3, 0.8);
    const whole = resample(x, 44100, 48000);
    const r = new Resampler(44100, 48000);
    const out = [];
    for (let i = 0; i < x.length; i += 997) r.push(x.subarray(i, i + 997), (v) => out.push(v));
    r.flush((v) => out.push(v));
    assert.strictEqual(out.length, whole.length);
    let d = 0;
    for (let i = 0; i < out.length; i++) d = Math.max(d, Math.abs(out[i] - whole[i]));
    assert.ok(d < 1e-6, `chunked differs by ${d}`);
    approx(rms(whole, 2000, whole.length - 2000), 0.8 / Math.SQRT2, 0.005);
    assert.strictEqual(resample(x, 16000, 16000).length, x.length);
  });

  t('streaming analysis matches the whole-buffer envelope and peaks', () => {
    const sr = 48000;
    const l = Float32Array.from({ length: sr * 3 + 123 }, (_, i) => Math.sin(i / 7) * (i < sr ? 0.1 : i < 2 * sr ? 0.6 : 0.001));
    const r = Float32Array.from(l, (v, i) => v * 0.5 + (i % 2 ? 0.01 : -0.01));
    const ref = envelopeDb([l, r], sr);
    const acc = new AnalysisAccumulator(sr, 60);
    for (let i = 0; i < l.length; i += 4801) acc.push([l.subarray(i, i + 4801), r.subarray(i, i + 4801)]);
    const out = acc.finish();
    assert.strictEqual(out.envelope.length, ref.length);
    let d = 0;
    for (let i = 0; i < ref.length; i++) d = Math.max(d, Math.abs(out.envelope[i] - ref[i]));
    assert.ok(d < 1e-3, `envelope differs by ${d} dB`);
    assert.strictEqual(out.peaks.length, Math.floor(l.length / 800));
    approx(Math.max(...out.peaks), 1);
    assert.ok(out.peaks[10] < 0.2 && out.peaks[100] > 0.9);
  });

  t('silence skipping: long quiet stretches leave, word tails stay, times map back exactly', () => {
    const sr = 16000;
    const loud = (secs) => tone(300, sr, secs, 0.3);
    const quiet = (secs) => new Float32Array(Math.round(sr * secs));
    const parts = [loud(2), quiet(6), loud(1), quiet(1), loud(1)];
    const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let w = 0;
    for (const p of parts) (audio.set(p, w), (w += p.length));
    const kept = speechRanges(audio);
    assert.deepStrictEqual(kept.map(([a, b]) => [a / sr, b / sr]), [[0, 2.5], [7.5, 11]]);
    const { audio: c, pieces } = compactRanges(audio, kept);
    assert.strictEqual(c.length, 6 * sr);
    approx(sourceTime(pieces, 1), 1);
    approx(sourceTime(pieces, 3), 8);
    approx(sourceTime(pieces, 2.6), 7.6);
    const segs = restoreTimes([{ start: 1.8, end: 3.2, text: 'a b', words: [{ start: 1.8, end: 2.1, text: ' a' }, { start: 2.9, end: 3.2, text: ' b' }] }], pieces);
    assert.deepStrictEqual(segs.map((s) => [s.text, s.start, Math.round(s.end * 10) / 10]), [['a', 1.8, 2.1], ['b', 7.9, 8.2]]);
    assert.deepStrictEqual(speechRanges(loud(5)), [[0, 5 * sr]]);
    assert.deepStrictEqual(speechRanges(quiet(5)), []);
  });

  t('passthrough: only an untouched, full-length recording at its own size and High quality is copied', () => {
    const media = new Map([['m1', { id: 'm1', kind: 'video' }], ['a1', { id: 'a1', kind: 'audio' }]]);
    const tracks = [{ id: 'v1', kind: 'video' }, { id: 'a1', kind: 'audio' }, { id: 't1', kind: 'text', hidden: true }];
    const hd = { format: 'mp4', quality: 'high', width: 1920, height: 1080 };
    const v = mediaClip();
    const music = mediaClip({ id: 'mus', mediaId: 'a1', trackId: 'a1', sourceWidth: 0, sourceHeight: 0 });
    assert.strictEqual(passthroughClip([v, music], tracks, media, hd, 10)?.id, 'c1');
    const ducked = mediaClip({ keyframes: [{ id: 'k', prop: 'volume', t: 1, value: 0.3 }] });
    assert.ok(passthroughClip([ducked, { type: 'text', id: 'x', trackId: 't1', start: 0, duration: 2 }], tracks, media, hd, 10));
    const no = (clips, out = hd, total = 10) => assert.strictEqual(passthroughClip(clips, tracks, media, out, total), null);
    no([v, { type: 'text', id: 'cap', trackId: 'v1', start: 0, duration: 2 }]);
    no([mediaClip({ inPoint: 2, duration: 8 })]);
    no([mediaClip({ duration: 6 })]);
    no([v], hd, 12);
    no([mediaClip({ brightness: 110 })]);
    no([mediaClip({ scaleX: 3.2, scaleY: 3.2 })]);
    no([mediaClip({ keyframes: [{ id: 'k', prop: 'posX', t: 1, value: 0.1 }] })]);
    no([mediaClip({ fadeOut: 1 })]);
    no([v], { ...hd, quality: 'medium' });
    no([v], { ...hd, format: 'webm' });
    no([v], { ...hd, width: 1280, height: 720 });
  });

  await ta('fast word timings equal transformers.js exactly (same float32 maths, same DTW path)', async () => {
    const { Tensor, WhisperForConditionalGeneration } = await import('@huggingface/transformers');
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const L = 6, H = 8, F = 1500, prompt = 4, steps = 70;
    const att = (s, t0) => {
      const d = new Float32Array(H * s * F);
      for (let h = 0; h < H; h++) for (let r = 0; r < s; r++) {
        const centre = ((t0 + r) / (prompt + steps)) * 1100;
        for (let f = 0; f < F; f++) d[(h * s + r) * F + f] = Math.exp(-(((f - centre) / 40) ** 2)) + 0.05 * rnd();
      }
      return new Tensor('float32', d, [1, H, s, F]);
    };
    const cross = [Array.from({ length: L }, () => att(prompt, 0))];
    for (let k = 0; k < steps; k++) cross.push(Array.from({ length: L }, () => att(1, prompt + k)));
    const out = { cross_attentions: cross, sequences: { dims: [1, prompt + steps + 1] } };
    const heads = [[2, 3], [3, 1], [4, 7], [5, 0]];
    const ref = WhisperForConditionalGeneration.prototype._extract_token_timestamps.call({ config: { decoder_layers: L, median_filter_width: 7 } }, out, heads, 1100, 0.02, prompt);
    const mine = tokenTimestamps(out, heads, L, 7, 1100, 0.02, prompt);
    assert.deepStrictEqual(mine.dims, ref.dims);
    assert.deepStrictEqual(Array.from(mine.data), Array.from(ref.data));
    assert.ok(mine.data[prompt + 10] > 0 && mine.data[prompt + 60] > mine.data[prompt + 10]);
  });
}

{
  const segs = [
    { start: 0, end: 1, text: 'Hello there.', words: [{ start: 0, end: 0.5, text: ' Hello' }, { start: 0.6, end: 1.0, text: ' there.' }] },
    { start: 3, end: 4.5, text: 'Um so anyway', words: [{ start: 3.0, end: 3.4, text: ' Um' }, { start: 3.5, end: 3.9, text: ' so' }, { start: 4.0, end: 4.5, text: ' anyway' }] },
  ];
  const words = transcriptWordsFrom(segs);

  t('transcript words: in order, trimmed, a long pause starts a paragraph', () => {
    assert.deepStrictEqual(words.map((w) => w.text), ['Hello', 'there.', 'Um', 'so', 'anyway']);
    assert.deepStrictEqual(words.map((w) => w.para), [true, false, true, false, false]);
  });

  t('deleting words cuts up to the next kept word, but keeps most of a long pause', () => {
    assert.deepStrictEqual(cutRangesForWords(words, [2]), [[3.0, 3.5]]);
    assert.deepStrictEqual(cutRangesForWords(words, [3, 2]), [[3.0, 4.0]]);
    const tail = cutRangesForWords(words, [1]);
    approx(tail[0][0], 0.6);
    approx(tail[0][1], 1.12);
    const last = cutRangesForWords(words, [4]);
    approx(last[0][1], 4.62);
    assert.strictEqual(cutRangesForWords(words, [0, 4]).length, 2);
  });

  t('transcript: the playing word, and find (case and punctuation ignored)', () => {
    assert.strictEqual(wordIndexAt(words, 0.55), 0);
    assert.strictEqual(wordIndexAt(words, 3.6), 3);
    assert.strictEqual(wordIndexAt(words, 2.0), -1);
    assert.deepStrictEqual(findPhrase(words, 'THERE'), [1]);
    assert.deepStrictEqual(findPhrase(words, 'um so'), [2]);
    assert.deepStrictEqual(findPhrase(words, 'so um'), []);
  });

  t('transcript after deleting a word: the word is gone (its start sat exactly on the new seam)', () => {
    const segs = [{ start: 0, end: 2, text: 'a b c', words: [{ start: 0, end: 0.5, text: ' a' }, { start: 1, end: 1.4, text: ' b' }, { start: 1.5, end: 2, text: ' c' }] }];
    const before = transcriptWordsFrom(segs);
    const cuts = cutRangesForWords(before, [1]);
    assert.deepStrictEqual(cuts, [[1, 1.5]]);
    const pieces = [mediaClip({ id: 'p1', duration: 1, sourceDuration: 10 }), mediaClip({ id: 'p2', start: 1, duration: 8.5, inPoint: 1.5, sourceDuration: 10 })];
    const after = transcriptWordsFrom(remapSegments(segs, pieces));
    assert.deepStrictEqual(after.map((w) => w.text), ['a', 'c']);
    approx(after[1].start, 1);
  });
}

{
  const vertical = { width: 1080, height: 1920 };

  t('camera path: holds through a stray detection and a gap, pans once when the face really moves', () => {
    const samples = [];
    for (let k = 0; k <= 40; k++) {
      const tt = k * 0.25;
      let x = tt < 5 ? 0.3 : 0.6;
      if (Math.abs(tt - 2) < 1e-9) x = 0.9;
      samples.push({ t: tt, x: tt >= 7 && tt <= 7.5 ? null : x });
    }
    const path = cameraPath(samples);
    assert.strictEqual(path.filter((k) => k.ease === 'inout').length, 1);
    approx(pathAt(path, 1), 0.3, 1e-9);
    approx(pathAt(path, 4.5), 0.3, 1e-9);
    approx(pathAt(path, 9.5), 0.6, 0.01);
    assert.deepStrictEqual(cameraPath([{ t: 0, x: null }, { t: 1, x: null }]), []);
    approx(pathAt([], 3), 0.5);
  });

  t('reframe fill: a 16:9 clip covers a 9:16 canvas; posX keeps a face centred without showing an edge', () => {
    const c = mediaClip({ sourceWidth: 1920, sourceHeight: 1080 });
    const f = fillFactor(c, vertical);
    approx(f, 1920 / 607.5, 1e-6);
    approx(posXFor(c, 0.5, vertical, f), 0);
    const dw = 1080 * f;
    approx(posXFor(c, 0, vertical, f), (dw / 1080) * (0.5 - 1080 / (2 * dw)), 1e-9);
    assert.ok(posXFor(c, 0.2, vertical, f) > 0 && posXFor(c, 0.8, vertical, f) < 0);
  });

  t('reframe clip: still camera → no keys; a pan → posX keys at the clip-local times (through speed)', () => {
    const still = reframeClip(mediaClip({ start: 10 }), [{ t: 0, x: 0.5 }], vertical);
    assert.ok(still.scaleX > 3 && still.keyframes.length === 0);
    approx(still.posX, 0);
    const path = [{ t: 0, x: 0.5 }, { t: 4, x: 0.5 }, { t: 4.6, x: 0.7, ease: 'inout' }];
    const moving = reframeClip(mediaClip({ start: 10 }), path, vertical);
    const ks = moving.keyframes.filter((k) => k.prop === 'posX');
    assert.deepStrictEqual(ks.map((k) => Math.round(k.t * 100) / 100), [0, 4, 4.6, 10]);
    assert.strictEqual(ks[2].ease, 'inout');
    approx(ks[3].value, posXFor(mediaClip(), 0.7, vertical, moving.scaleX), 1e-9);
    const fast = reframeClip(mediaClip({ duration: 5, speed: 2 }), path, vertical);
    approx(fast.keyframes.find((k) => k.prop === 'posX' && k.ease === 'inout').t, 2.3, 1e-6);
    const st = sampleTimes([[0, 10]]);
    assert.ok(st[0] === 0 && st.every((x) => x <= 10) && st.length >= 25);
  });
}

{
  const low = Math.pow(10, -12 / 20);

  t('duck spans bridge short pauses; voice from transcript words maps through the clip', () => {
    assert.deepStrictEqual(duckSpans([[6, 7], [1, 2], [2.5, 3]]), [[1, 3], [6, 7]]);
    const v = mediaClip({ inPoint: 10, duration: 5, sourceDuration: 30 });
    const r = voicedFromWords(v, [{ start: 10.2, end: 10.5, text: 'a' }, { start: 10.6, end: 11, text: 'b' }, { start: 13, end: 13.4, text: 'c' }, { start: 20, end: 21, text: 'out' }]);
    assert.deepStrictEqual(r.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]), [[0.2, 1], [3, 3.4]]);
    assert.deepStrictEqual(joinClose([[0, 1], [1.1, 2]], 0.2), [[0, 2]]);
  });

  t('duck keys: eased dip under each span, boundaries sampled, untouched clips left alone', () => {
    const keys = duckKeys(mediaClip({ id: 'music', trackId: 'a1' }), [[1, 3]]);
    assert.deepStrictEqual(keys.map((k) => Math.round(k.t * 100) / 100), [0, 0.8, 1, 3, 3.5, 10]);
    approx(keys[2].value, low, 1e-9);
    approx(keys[4].value, 1);
    assert.strictEqual(keys[2].ease, 'inout');
    assert.strictEqual(duckKeys(mediaClip({ start: 20 }), [[1, 3]]), null);
    const mid = duckKeys(mediaClip({ start: 2, duration: 4 }), [[1, 3]]);
    approx(mid[0].value, low, 1e-9);
    assert.deepStrictEqual(mid.map((k) => Math.round(k.t * 100) / 100), [0, 1, 1.5, 4]);
  });
}

{
  const sr = 48000;
  const sine = (db, secs = 5, f = 997) => {
    const a = Math.pow(10, db / 20);
    return Float32Array.from({ length: secs * sr }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / sr));
  };

  t('loudness: EBU Tech 3341 case 1 (stereo 1 kHz sine at -23 dBFS reads -23.0 LUFS), silence is -inf', () => {
    approx(integratedLoudness([sine(-23), sine(-23)], sr), -23, 0.1);
    approx(integratedLoudness([sine(-33), sine(-33)], sr), -33, 0.1);
    assert.strictEqual(integratedLoudness([new Float32Array(sr * 2)], sr), -Infinity);
  });

  t('loudness normalize: hits the target, and the limiter holds spikes under the ceiling', () => {
    const l = sine(-23);
    const r = sine(-23);
    const res = normalizeLoudness([l, r], sr, -14);
    approx(res.after, -14, 0.15);
    approx(res.limitedDb, 0, 1e-6);
    const x = sine(-20);
    for (let k = sr; k < x.length; k += sr) x[k] = 0.9;
    const y = Float32Array.from(x);
    const res2 = normalizeLoudness([x, y], sr, -14);
    assert.ok(peakDb([x, y]) <= -1 + 0.01, `peak ${peakDb([x, y])}`);
    assert.ok(res2.limitedDb < -5, `limited ${res2.limitedDb}`);
    approx(res2.after, -14, 0.3);
  });
}

console.log(`editor: ${passed} passed`);
