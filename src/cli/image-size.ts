/**
 * Intrinsic pixel dimensions of an image file, read from its header.
 *
 * Needed so a cropped image panel can honour `fit: contain` without
 * distorting: the crop window's aspect ratio depends on the source's, and a
 * stretched gel photograph in a published figure is a data-integrity problem,
 * not a cosmetic one.
 *
 * Covers the formats a figure panel realistically carries. An unrecognised
 * file returns null and the panel falls back to filling its box.
 */
import { open } from 'node:fs/promises';

export interface ImageSize {
  width: number;
  height: number;
}

async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

function pngSize(buf: Buffer): ImageSize | null {
  // \x89PNG\r\n\x1a\n then an IHDR chunk whose first two fields are the dims.
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function gifSize(buf: Buffer): ImageSize | null {
  if (buf.length < 10) return null;
  if (buf.toString('ascii', 0, 3) !== 'GIF') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

function jpegSize(buf: Buffer): ImageSize | null {
  if (buf.length < 4 || buf.readUInt16BE(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) { offset++; continue; }
    const marker = buf[offset + 1];
    // SOF0-SOF15 carry the frame dimensions; SOF4/SOF8/SOF12 are not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    const segmentLength = buf.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

export async function readImageSize(filePath: string): Promise<ImageSize | null> {
  try {
    // 64 KB covers a JPEG's headers before the first scan in practice.
    const head = await readHead(filePath, 64 * 1024);
    return pngSize(head) ?? jpegSize(head) ?? gifSize(head);
  } catch {
    return null;
  }
}
