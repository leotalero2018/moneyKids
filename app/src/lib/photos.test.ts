import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage, MAX_EDGE, MAX_UPLOAD_BYTES } from './photos.js';

/**
 * jsdom implements neither image decoding nor canvas encoding, so the test
 * injects both seams. What is being tested is our arithmetic and our limits,
 * which is exactly where a 100x-sized upload or a squashed photo would come
 * from — not the browser's codec.
 */
function stubImage(width: number, height: number) {
  class FakeImage {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) { setTimeout(() => this.onload?.(), 0); }
  }
  vi.stubGlobal('Image', FakeImage);
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: () => undefined,
  });
}

let drawn: { w: number; h: number } | null = null;

beforeEach(() => {
  drawn = null;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
      drawn = { w, h };
    },
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
    function (this: HTMLCanvasElement, cb: BlobCallback) {
      cb(new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }));
    },
  );
});

describe('compressImage', () => {
  it('scales the long edge down to the cap and keeps the aspect ratio', async () => {
    stubImage(4000, 3000);
    const out = await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(out.type).toBe('image/jpeg');
    expect(drawn).toEqual({ w: MAX_EDGE, h: Math.round(MAX_EDGE * 3000 / 4000) });
  });

  it('scales the other axis when the photo is portrait', async () => {
    stubImage(1500, 3000);
    await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(drawn).toEqual({ w: Math.round(MAX_EDGE * 1500 / 3000), h: MAX_EDGE });
  });

  it('never upscales a small photo', async () => {
    stubImage(400, 300);
    await compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' }));
    expect(drawn).toEqual({ w: 400, h: 300 });
  });

  it('rejects a non-image file before touching a canvas', async () => {
    stubImage(100, 100);
    await expect(
      compressImage(new File([new Uint8Array(10)], 'doc.pdf', { type: 'application/pdf' })),
    ).rejects.toThrow(/image/i);
  });

  it('rejects a result over the storage limit rather than uploading a doomed blob', async () => {
    stubImage(1000, 1000);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      function (this: HTMLCanvasElement, cb: BlobCallback) {
        cb(new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: 'image/jpeg' }));
      },
    );
    await expect(
      compressImage(new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow(/too large/i);
  });
});
