<div align="center">

<img src="resources/krypt.png" alt="Krypt Editor" width="108" />

# Krypt Editor

**A free, open-source video editor for your desktop.**

Cut, trim, compose, caption and export on a real multi-track timeline, with on-device AI for auto edits, captions, reframing and voice-over, all in one clean app. No account, no watermark, no cloud.

[![Release](https://github.com/kryptccgit/KryEditor/actions/workflows/release.yml/badge.svg)](https://github.com/kryptccgit/KryEditor/actions/workflows/release.yml)
&nbsp;[![License: MIT](https://img.shields.io/badge/License-MIT-6366F1)](LICENSE)
&nbsp;[![Windows 10 | 11](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D4?logo=windows&logoColor=white)](#download)
&nbsp;[![macOS: Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon%20%C2%B7%20unsigned-6B7280)](#download)
&nbsp;[![Status: beta](https://img.shields.io/badge/status-beta-F59E0B)](#download)
&nbsp;[![Price: free](https://img.shields.io/badge/Price-free-EC4899)](#download)

<a href="../../releases/latest"><img src="https://img.shields.io/badge/Download-Krypt%20Editor-A855F7?style=for-the-badge&logo=github&logoColor=white" alt="Download Krypt Editor" /></a>
&nbsp;<a href="https://discord.gg/muzFKR657F"><img src="https://img.shields.io/badge/Join%20the-Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join the Discord" /></a>
&nbsp;<a href="https://krypt.cc/tools"><img src="https://img.shields.io/badge/More%20free%20tools-krypt.cc%2Ftools-EC4899?style=for-the-badge&logo=googlechrome&logoColor=white" alt="More free tools at krypt.cc/tools" /></a>

</div>

---

Krypt Editor is a no-bloat, CapCut-style editor that runs entirely on your machine. Layer video, audio, titles and shapes on a multi-track timeline, grade with LUTs and GPU effects, and animate anything with keyframes. On-device AI cuts the dead air out of a talking video, lets you edit by deleting words from the transcript, captions it word by word, reframes it to vertical and replaces a voice with a natural-sounding one. You can also hand the whole editor to Claude, Cursor, Codex or any MCP client and edit by asking. Free, no ads, no telemetry. Built on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT).

## What it does

- **Multi-track timeline** — video, audio and overlay tracks with mute / solo / lock / hide; trim, split, ripple delete, close gaps, snapping, marquee select, filmstrip thumbnails and waveforms.
- **Compositing** — real layering with per-clip opacity, 16 blend modes, feathered shape masks, transform handles, crop and rotation.
- **Canvas** — sized from your first clip, or 16:9 / 9:16 / 1:1 / 4:5 presets, over a solid, gradient or blurred-clip background.
- **Effects** — color adjust, `.cube` 3D LUTs graded on the GPU, look filters, real-time glitch / VHS / chromatic aberration / CRT / film grain / pixelate, chroma key and on-device AI background removal.
- **Text & titles** — fonts, outline, glow, background boxes, 11 in/out animations, emoji stickers, vector shapes and freehand drawing.
- **Transitions** — crossfade, dip, slide, push, wipe, zoom and blur: drop one on a seam, with a matching audio crossfade.
- **Keyframes** — animate transform, opacity, volume, speed and overlay position with easing; they survive splits and trims.
- **Speed curves** — Montage, Hero, Bullet and Jump cut presets or your own ramps, pitch-preserved in preview and export, plus freeze frame and reverse.
- **Auto edit** — finds the pauses and cuts them in one undo step across every track, with presets for talking head, voice-over, podcast and gameplay. **Speech (AI)** mode listens with Whisper so game audio and music don't count as talking, and can also drop filler words, cut retakes and caption in the same pass.
- **Edit by transcript** — see what was said beside the video; select words and press Delete to cut them from every track.
- **Auto reframe** — turn landscape into 9:16, 1:1 or 4:5 in one go, with an on-device face detector keeping the speaker in shot.
- **Auto-captions** — on-device Whisper with word-level timing, karaoke highlighting, full styling and SRT/VTT import/export. **Fast** or **Accurate** models, on the GPU when there is one.
- **Audio** — keyframable volume, fades, detach audio, on-device noise reduction, **auto duck** for music under a voice, and loudness-normalized exports at −14 / −16 / −23 LUFS.
- **Text to speech** — 28 natural English voices (Kokoro, the voice engine from Krypt Studio) plus Spanish, French, German, Portuguese and Korean. Type a line and it lands on the timeline.
- **Re-voice** — replace a clip's speech with one of those voices at the same timing, fixing or rewriting any line first.
- **AI agents (MCP)** — connect Claude Code, Claude Desktop, Codex, Cursor, VS Code, Windsurf or Gemini CLI in one click, then edit by asking: *"cut the pauses"*, *"make it vertical and add a title"*, *"export to my Desktop"*. 31 tools reach the whole editor, each change is one undo step, and it all stays local.
- **Export** — MP4 (H.264/AAC), WebM (VP9/Opus) or M4A, hardware-encoded when your GPU supports it and streamed to disk. An untouched recording at its own size is copied losslessly in seconds.
- **Projects** — `.krypt` files with crash-safe saves, autosave with backups, recents and starter templates.

## Local and private

- **No account, no watermark, no telemetry** — nothing about you or your projects is sent anywhere.
- **Everything works offline.** Four optional features download a model the first time you use them, then cache it: auto-captions (Whisper: about 300 MB, or 1–1.6 GB for Accurate), text to speech (Kokoro: about 340 MB; MMS-TTS for other languages), and AI background removal and auto reframe (MediaPipe).
- **AI agents connect over a local pipe** with a per-user token, and there's an off switch and an activity log for everything they do.

## Download

<a href="../../releases/latest"><img src="https://img.shields.io/badge/Download%20for%20Windows-Krypt%20Editor-A855F7?style=for-the-badge&logo=windows&logoColor=white" alt="Download Krypt Editor" /></a>

Grab the latest **`Krypt Editor-Setup-x.y.z-x64.exe`** (or `-arm64.exe`) from the [**Releases**](../../releases) page and run it (Windows 10/11). Releases also carry an **unsigned macOS build for Apple Silicon** (dmg and zip), which gets less testing than the Windows one.

> Builds aren't code-signed yet, so the first launch may show a SmartScreen prompt — click **More info → Run anyway**. The full source is right here if you'd rather build it yourself.

### Opening it on macOS

The mac build is not notarized (Apple charges $99/yr for the certificate that would make this unnecessary), so the first launch needs one manual approval:

1. Open the `.dmg` and drag **Krypt Editor** to Applications.
2. Launch it once. macOS refuses — pick **Done**.
3. **System Settings → Privacy & Security**, scroll to Security: *"Krypt Editor was blocked"* → **Open Anyway**, then confirm.

## Build from source

```bash
git clone https://github.com/kryptccgit/KryEditor.git
cd KryEditor
npm install
npm run dev        # Vite + Electron with HMR
npm run typecheck  # tsc for renderer + main
npm test           # pure-logic unit tests
npm run dist       # build the installer for your OS into /release
```

Requires [Node.js](https://nodejs.org) 20+. Built with Electron, React, TypeScript, Vite, Tailwind and Zustand. Every push to `main` builds the Windows and macOS installers and attaches them to a GitHub Release.

## Links

- **Website** — [krypt.cc/tools/editor](https://krypt.cc/tools/editor) · more free tools at [krypt.cc/tools](https://krypt.cc/tools)
- **Support and community** — [Discord](https://discord.gg/muzFKR657F)
- **Credits** — bundled libraries and AI models are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)

## License

Released under the [MIT License](LICENSE) — free to use, fork and share. Please don't rebrand and resell it. Based on [OpenCut](https://github.com/OpenCut-app/OpenCut) (MIT). Provided **as-is, with no warranty**.

<div align="center"><sub>Built by the Krypt team · <a href="https://krypt.cc/tools/editor">krypt.cc/tools/editor</a></sub></div>
