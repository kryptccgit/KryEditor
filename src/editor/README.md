# src/editor

The editor core (originally seeded from OpenCut, MIT — now substantially its
own code). The shell mounts it from `src/pages/Editor.tsx`.

Map:

- `timelineStore.ts` — the document: tracks, clips (media/text/shape/draw),
  keyframes, transitions, undo history, and the pure evaluation helpers
  (`clipLayout`, `activeVisualLayers`, `transitionPart`, `textAnim`, …) shared
  by preview and export.
- `mediaStore.ts` — the session media bin; timeline clips reference bin
  entries by media id.
- `Preview.tsx` — live DOM/CSS compositor (one layer per visible clip; WebGL
  passes for chroma key / shader effects / background removal).
- `Timeline.tsx` — tracks, clip blocks, filmstrips/waveforms, snapping,
  marquee select, transition seams.
- `Inspector.tsx` — the properties panel, including keyframe sliders.
- `export.ts` — renders the timeline frame-by-frame onto a canvas and encodes
  via mediabunny/WebCodecs (decoded VideoFrames are drawn directly; a scratch
  canvas only when an effect needs pixels); audio is mixed in an
  OfflineAudioContext (speed-changed clips are pitch-preserved via
  `stretch.ts`), decoding only the span each file is used for.
- `passthrough.ts` — the export shortcut: one untouched H.264 clip covering
  the whole timeline at the source's size and frame rate has its packets
  copied into the MP4 instead of being decoded and re-encoded.
- `audioDecode.ts` — streaming audio decode (mediabunny) with a polyphase
  windowed-sinc resampler: mono 16 kHz for Whisper, 48 kHz AudioBuffers for
  the export mix, and single-pass waveform peaks + loudness envelope. Holds
  only the output, never the whole file decoded (`decodeAudioData` couldn't
  open multi-GB recordings); falls back to it for formats mediabunny can't read.
- `probe.ts` / `thumbs.ts` / `peaks.ts` — media metadata, filmstrip frames,
  audio waveforms.
- `autoEdit.ts` / `AutoEditDialog.tsx` — auto edit: loudness envelope, the
  adaptive silence detector, the pure cut planner (ripple across tracks,
  alternating punch-in zoom), presets, and the floating dialog that paints the
  pending cuts on the timeline; `speechAnalysis.ts` caches per-file Whisper
  transcripts for its speech mode (filler words, retakes, captions).
- `agentTools.ts` / `AiPanel.tsx` — the AI agents (MCP) dropdown in the top bar and the renderer side
  of the agent tools: each call from `electron/mcp` (server, client installers,
  stdio bridge in `resources/mcp`) runs here against the stores, serialized,
  one undo step per edit. Schemas live in `electron/mcp/tools.ts`.
- `captions.ts` / `captionWorker.ts` — on-device Whisper transcription +
  SRT/VTT parse/serialize. Long silences are cut out before Whisper and the
  times mapped back; the rest is sliced at quiet points over a worker pool —
  two WebGPU workers (for Whisper base, encoder on the GPU and decoder on the
  CPU) or one per core budget on the CPU. The ONNX runtime is the JSEP build (alias in
  `vite.config.ts`), measured faster here than ORT's native WebGPU build. `whisperTimestamps.ts` replaces transformers.js's word
  alignment with an identical typed-array version (it was ~half the time).
  `SpeechModelCard.tsx` is the Fast/Accurate choice in Settings.
- `tts.ts` / `kokoro/` — text to speech. English is Kokoro-82M, ported from
  Krypt Studio's analyzer: `g2p.ts` (text → phonemes with the bundled CMU
  dictionary, no eSpeak), `kokoroWorker.ts` (ONNX Runtime, WebGPU else WASM);
  main installs the model (`electron/system/kokoro.ts`, copied from Studio
  when it has it). Other languages use MMS-TTS (`ttsWorker.ts`).
- `modelCache.ts` — where both workers keep downloaded Hugging Face models:
  files in userData/models/speech through `krypteditor://models/`. Chromium
  rejects Cache API writes from a file:// page, so the browser cache would
  download them again on every launch.
- `transcriptEdit.ts` / `TranscriptPanel.tsx` — edit by transcript: timeline
  words from the cached Whisper transcript (re-mapped through the clips on
  every edit), the cuts that delete a selection, find, the playing word.
- `reframe.ts` / `ReframeDialog.tsx` — auto reframe: face samples (MediaPipe
  face detector on frames from mediabunny) → a held/panned camera path →
  fill scale + posX keyframes per clip; sets the canvas in the same undo step.
- `ducking.ts` / `DuckDialog.tsx` — auto duck: voice ranges (transcript words
  or loudness) → bridged spans → eased volume keyframes on the other tracks.
- `loudness.ts` — BS.1770 integrated loudness, look-ahead limiter, and the
  export's normalize-to-target pass.
- `revoice.ts` / `RevoiceDialog.tsx` — re-voice: transcript lines mapped onto
  the timeline, spoken with Kokoro, laid out at the original times (sped up to
  fit, else pushed later), one WAV on a new track, original muted/lowered.
- `chroma.ts` / `fx.ts` / `segmenter.ts` — the GPU/ML per-clip passes.
- `project.ts` — `.krypt` (de)serialization and validation.

Preview and export share the pure math from `timelineStore.ts`; anything that
affects rendering must go through those helpers so the two stay in sync.
