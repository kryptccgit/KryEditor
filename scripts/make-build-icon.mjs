import { Jimp } from 'jimp';
import fs from 'node:fs';

const ROOT = 'C:/Users/Krypt/Desktop/kryptware/KryptEditor';
const src = await Jimp.read(`${ROOT}/resources/krypt.png`);
const size = 1024;
const scale = (size * 0.94) / Math.max(src.width, src.height);
src.scale(scale);
const canvas = new Jimp({ width: size, height: size, color: 0x00000000 });
canvas.composite(src, Math.round((size - src.width) / 2), Math.round((size - src.height) / 2));
fs.mkdirSync(`${ROOT}/build`, { recursive: true });
await canvas.write(`${ROOT}/build/icon.png`);
console.log('wrote build/icon.png 1024x1024');
