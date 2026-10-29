import type { ImageSegmenter, MPMask } from '@mediapipe/tasks-vision';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let videoSegmenter: Promise<ImageSegmenter> | null = null;

async function create(runningMode: 'VIDEO' | 'IMAGE'): Promise<ImageSegmenter> {
  const vision = await import('@mediapipe/tasks-vision');
  const { MEDIAPIPE_FILESET } = await import('./mediapipeFileset');
  return vision.ImageSegmenter.createFromOptions(MEDIAPIPE_FILESET, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
}

export function getVideoSegmenter(): Promise<ImageSegmenter> {
  if (!videoSegmenter) {
    videoSegmenter = create('VIDEO').catch((err) => {
      videoSegmenter = null;
      throw err;
    });
  }
  return videoSegmenter;
}

export function createImageSegmenter(): Promise<ImageSegmenter> {
  return create('IMAGE');
}

export function maskToCanvas(mask: MPMask): HTMLCanvasElement {
  const w = mask.width;
  const h = mask.height;
  const data = mask.getAsFloat32Array();
  const cnv = document.createElement('canvas');
  cnv.width = w;
  cnv.height = h;
  const ctx = cnv.getContext('2d');
  if (!ctx) return cnv;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i] < 0 ? 0 : data[i] > 1 ? 1 : data[i];
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(a * 255);
  }
  ctx.putImageData(img, 0, 0);
  return cnv;
}

let exComp: HTMLCanvasElement | null = null;
let exCompCtx: CanvasRenderingContext2D | null = null;
let exMask: HTMLCanvasElement | null = null;
let exMaskCtx: CanvasRenderingContext2D | null = null;
let exMaskImg: ImageData | null = null;

export function applyMask(
  src: CanvasImageSource & { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number },
  mask: MPMask,
): HTMLCanvasElement {
  const w = (src.naturalWidth as number) || (src.width as number) || 1;
  const h = (src.naturalHeight as number) || (src.height as number) || 1;
  if (!exComp) {
    exComp = document.createElement('canvas');
    exCompCtx = exComp.getContext('2d');
  }
  if (exComp.width !== w) exComp.width = w;
  if (exComp.height !== h) exComp.height = h;
  const ctx = exCompCtx;
  if (!ctx) return exComp;

  const mw = mask.width;
  const mh = mask.height;
  if (!exMask) {
    exMask = document.createElement('canvas');
    exMaskCtx = exMask.getContext('2d');
  }
  if (exMask.width !== mw || exMask.height !== mh) {
    exMask.width = mw;
    exMask.height = mh;
    exMaskImg = null;
  }
  if (exMaskCtx) {
    const data = mask.getAsFloat32Array();
    if (!exMaskImg) exMaskImg = exMaskCtx.createImageData(mw, mh);
    const md = exMaskImg.data;
    for (let i = 0; i < mw * mh; i++) {
      const a = data[i] < 0 ? 0 : data[i] > 1 ? 1 : data[i];
      md[i * 4] = 255;
      md[i * 4 + 1] = 255;
      md[i * 4 + 2] = 255;
      md[i * 4 + 3] = Math.round(a * 255);
    }
    exMaskCtx.putImageData(exMaskImg, 0, 0);
  }

  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  if (exMask) ctx.drawImage(exMask, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-over';
  return exComp;
}
