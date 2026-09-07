/**
 * Generates the PWA icons with no image dependency.
 *
 * ImageMagick is not installed here and sips cannot rasterize SVG, so this
 * writes PNGs directly: raw RGBA rows, one zlib stream, three chunks. A coin
 * on the accent colour is enough for v1, and an install prompt is refused
 * outright if the 192 and 512 icons are missing.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../app/public');

const BG = [11, 114, 133];      // --c-accent
const COIN = [253, 251, 247];   // --c-bg
const RING = [11, 114, 133];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function iconPixels(size) {
  const rows = [];
  const c = (size - 1) / 2;
  const outer = size * 0.36;
  const inner = size * 0.27;
  for (let y = 0; y < size; y += 1) {
    // each row is prefixed with filter byte 0 (None)
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - c, y - c);
      const rgb = d > outer ? BG : d > inner ? RING : COIN;
      const at = 1 + x * 4;
      row[at] = rgb[0];
      row[at + 1] = rgb[1];
      row[at + 2] = rgb[2];
      row[at + 3] = 255;
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}

function png(size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(iconPixels(size), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180],
]) {
  writeFileSync(resolve(OUT, name), png(size));
  console.log(`wrote ${name} (${size}x${size})`);
}
