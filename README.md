# Krypt Editor

A free, no-bloat **CapCut-style video editor** for Windows. Cut, trim, compose,
caption, and export — all on your machine, no accounts, no watermarks, no cloud.
Part of the [Krypt](https://krypt.cc) free tools suite.

> Free. No ads. No telemetry. No bullshit. Built on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT).

Electron + React + TypeScript + Vite + Tailwind + Zustand.

## Features

- **Multi-track timeline** — video / audio / text+overlay tracks with per-track
  **mute / solo / lock / hide**; trim, split, duplicate, copy/paste,
  **ripple delete** and close-gap, marquee-select, snapping, Ctrl+wheel zoom,
  drag clips between tracks; filmstrip thumbnails on video and waveforms on
  audio.
- **Compositing** — real multi-track layering with per-clip opacity,
  **16 blend modes**, **shape masks** (linear / rect / ellipse with feather and
  invert), CapCut-style transform handles, crop, and rotation.
- **Canvas** — auto-resolution from your first clip plus 16:9 / 9:16 / 1:1 / 4:5
  presets; background fill (solid color, gradient, or a blurred copy of the clip).
- **Effects** — color adjust (brightness / contrast / saturation / hue /
  vignette), **3D color LUTs** (import any `.cube`, GPU-graded with a strength
  slider, embedded in the project file), look filters, and real-time GPU
  effects (glitch, VHS, chromatic aberration, CRT, film grain, pixelate);
  **chroma key** (green screen) and **on-device AI background removal**.
- **Text & titles** — fonts, outline, glow, background box / per-line highlight,
  and 11 in/out animations (incl. typewriter, bounce, spin); emoji stickers,
  vector shapes, and a freehand drawing tool.
- **Transitions** — crossfade, dip, slide, push, wipe, zoom, blur — drag onto the
  seam between two clips (or pick in the inspector), with adjustable duration
  and audio crossfade.
- **Keyframes** — animate transform, opacity, **volume**, **speed**, and
  overlay position with easing curves; keyframes show as draggable diamonds on
  selected timeline clips (Alt+click deletes, click jumps the playhead); type
  exact values into any slider. Keyframes survive splits and trims.
- **Speed curves** — CapCut-style velocity presets (Montage, Hero, Bullet,
  Jump cut) or hand-keyed speed ramps, pitch-preserved in preview *and*
  export; plus one-click **freeze frame** and **reverse clip**.
- **Auto edit** — finds the dead air and cuts it: an on-device loudness
  envelope with an adaptive noise floor, previewed as red bands on the timeline
  while you tune sensitivity / minimum pause / padding, then applied as one
  undo step that ripples every track. Presets for talking head, voice-over,
  podcast, gameplay, and zooms-only, plus an optional alternating punch-in zoom
  on each cut to hide the jumps. A **Speech (AI)** mode listens with Whisper as well as loudness
  (a transcript gap only counts where the sound is also quieter than your voice), so game audio and music no longer count as talking, and
  can also remove filler words ("um", "uh"), cut retakes (a phrase said again
  within 15 s keeps only the last take), and add captions in the same pass.
- **Edit by transcript** — the **Transcript** button shows what was said as
  text beside the video: click a word to jump there, drag over words (or find
  a phrase and select every match) and press Delete, and that part is cut from
  every track, gaps closed, one undo step. Uses the same on-device Whisper
  transcript as auto edit and captions, so it's instant once one exists.
- **Auto reframe** — turn a landscape video into 9:16 (or 1:1, 4:5) in one go:
  every clip is scaled to fill the new shape and an on-device face detector
  keeps the speaker in shot, with calm eased pans only when they actually
  move. Footage without a clear face (gameplay with a small facecam) stays
  centred.
- **AI agents (MCP)** — the **AI agents** button (top right) connects Claude Code, Codex,
  Cursor, Claude Desktop, VS Code, Windsurf, Gemini CLI, or any other MCP
  client in one click, then lets you edit by asking: "cut the pauses", "remove
  the part about sponsors", "make it vertical and add a title", "export to my
  Desktop", "VHS look and a crossfade on every cut". 31 tools reach the
  whole editor — auto edit and transcript cuts, clips, titles, shapes,
  stickers, every effect / LUT / blend / mask / chroma key / background
  removal, transitions, keyframes, speed curves, freeze and reverse, tracks,
  captions, voice-over and re-voice, auto reframe, ducking, canvas and background, frame previews, undo/redo,
  save/open, export — run live in the editor, each as one undo step, with an activity log and an off
  switch. Local only: a per-user named pipe with a token; clients start a
  small stdio bridge that ships inside the app (no Node install needed).
- **Auto-captions** — on-device speech-to-text (Whisper) in background
  workers with word-level timing, English or multilingual models, full styling,
  **karaoke word-by-word highlighting** (color / pop / box), and SRT/VTT
  import/export. Runs on the graphics card when there is one (WebGPU), skips
  long silences, and reuses a transcript you already have (Transcript, auto
  edit) instead of listening again. **Fast** (Whisper base) or **Accurate**
  (Whisper large-v3-turbo, or Whisper small on GPUs without fp16) in Settings.
- **Audio** — per-clip volume (keyframable) / mute / fades, detach audio,
  **on-device noise reduction** (spectral gate for hiss/hum/fans), full mix on
  export. **Auto duck** lowers music and game audio whenever someone talks
  (found from the transcript when there is one, else loudness) and brings it
  back in the pauses, as editable volume keyframes. Exports can be
  **loudness-normalized** to −14 LUFS (YouTube / Spotify / TikTok), −16
  (podcasts) or −23 (broadcast), measured per ITU-R BS.1770 with a look-ahead
  limiter keeping peaks under −1 dB.
- **Text to speech** — on-device voice-over: 28 natural English voices (US and UK)
  with Kokoro, the voice engine from Krypt Studio (reused from Studio when it is
  installed there), plus Spanish, French, German, Portuguese and Korean (MMS-TTS).
  Type a line, it lands on an audio track at the playhead. Runs on the GPU when it
  can. No cloud, no credits.
- **Re-voice** — replace the speech in a clip with one of those voices at the
  same timing: it transcribes the clip, you fix or rewrite any line, and the new
  voice lands on its own track (lines that run long are sped up slightly to
  fit) while the original is muted or lowered under it. One undo step.
- **Export** — MP4 (H.264/AAC), WebM (VP9/Opus), or audio-only M4A, with chosen
  resolution, frame rate, and quality; **hardware encoding** when the GPU
  supports it, streamed straight to disk (no RAM blow-up on long projects).
  An untouched recording exported at its own size and frame rate is copied
  **losslessly** (no re-encode, seconds instead of minutes).
- **Projects** — save/open `.krypt` files (validated, crash-safe atomic
  writes), autosave with backup generation, recents, and starter templates.
  Opens media via file association and "Open with".

## Install

Download the latest **`Krypt Editor-Setup-x.y.z.exe`** from the Releases page and
run it (Windows 10/11, 64-bit). The installer is unsigned, so Windows SmartScreen
may show a warning on first run — click **More info → Run anyway**.

Everything works **offline**. Four optional features download a small model
from the internet the first time you use them, then cache it: **auto-captions**
(Whisper: about 300 MB, or 1–1.6 GB for Accurate), **text to speech** (Kokoro for English, about 340 MB; MMS-TTS for other languages), and **AI background removal** and **auto reframe**
(MediaPipe).

## Build from source

```bash
npm install
npm run dev        # Vite + Electron with HMR
npm run typecheck  # tsc for renderer + main
npm test           # pure-logic unit tests
npm run build      # production renderer + main bundles
npm run dist       # build + electron-builder NSIS installer (release/)
npm run make-ico   # rebuild resources/krypt.ico from krypt.png
```

## License

MIT — see [LICENSE](LICENSE). Based on [OpenCut](https://github.com/OpenCut-app/OpenCut)
(MIT). Bundled libraries and downloaded AI models are credited in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
