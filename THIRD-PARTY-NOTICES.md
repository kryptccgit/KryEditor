# Third-Party Notices

Krypt Editor is free and open source (MIT) and is based on **OpenCut** (MIT).
It bundles and/or downloads the following third-party software and models. Each
is the property of its respective owner and is used under the license shown.

> This list covers the primary runtime dependencies. Run a full license audit
> (e.g. `npx license-checker --production --summary`) before each release to
> regenerate a complete manifest.

## Bundled libraries

| Component | License |
| --- | --- |
| React, React-DOM | MIT |
| Zustand | MIT |
| lucide-react | ISC |
| react-resizable-panels | MIT |
| @hello-pangea/dnd | Apache-2.0 |
| mediabunny (encode/decode/mux) | MPL-2.0 |
| onnxruntime-web | MIT |
| @huggingface/transformers (transformers.js) | Apache-2.0 |
| @mediapipe/tasks-vision | Apache-2.0 |
| discord-rpc | MIT |
| CMU Pronouncing Dictionary (English pronunciations for text to speech; `src/editor/kokoro/cmudict.txt.deflate`) | BSD-style (Carnegie Mellon University; see `src/editor/kokoro/CMUDICT-LICENSE.txt`) |

The MPL-2.0 source for mediabunny is available from its project repository; per
MPL-2.0 the modified files (if any) and the license text accompany this build.

## AI models (downloaded on first use, then cached)

| Model | Source | License |
| --- | --- | --- |
| Whisper `whisper-base` / `whisper-base.en` (auto-captions) | Hugging Face (`Xenova/whisper-base*`) | MIT (OpenAI Whisper) |
| Kokoro-82M v1.0 and its 28 English voices (English text to speech) | Hugging Face (`onnx-community/Kokoro-82M-v1.0-ONNX`, pinned revision; SHA-256 checked) | Apache-2.0 (hexgrad) |
| MMS-TTS per-language voices (Spanish, French, German, Portuguese and Korean text to speech) | Hugging Face (`Xenova/mms-tts-*`) | CC-BY-NC-4.0 (Meta MMS) |
| MediaPipe Selfie Segmenter (AI background removal) | Google MediaPipe models | Apache-2.0 |
| MediaPipe Face Detector, BlazeFace short-range (auto reframe) | Google MediaPipe models | Apache-2.0 |

These models are fetched from the Hugging Face and Google CDNs only when you
invoke the corresponding feature, and are cached locally afterward. No analytics
or telemetry is collected by Krypt Editor itself.

## Fonts

Chakra Petch, JetBrains Mono, and Press Start 2P (SIL Open Font License) are
bundled in `public/fonts` so the app renders identically offline.
