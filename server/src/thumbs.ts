import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { rawExts, thumbDir, thumbSizes } from './config.ts';
import { rawToJpeg } from './raw.ts';

sharp.cache({ files: 0, memory: 128 });
sharp.concurrency(Math.max(2, Math.floor(os.availableParallelism() / 2)));

export function nearestSize(requested: number): number {
  return thumbSizes.find((s) => s >= requested) ?? thumbSizes[thumbSizes.length - 1];
}

export function thumbPath(id: string, size: number): string {
  // Shard by the id's first two characters so no directory holds 100k files.
  return path.join(thumbDir, String(size), id.slice(0, 2), `${id}.jpg`);
}

/** Bytes sharp can decode. For RAW files this is the embedded preview. */
export async function readDecodable(filePath: string, ext: string): Promise<Buffer | null> {
  if (rawExts.has(ext)) return rawToJpeg(filePath, ext);
  return fs.readFile(filePath);
}

export type Dimensions = { width: number; height: number; orientation: number };

/** Visual dimensions after EXIF orientation has been applied. */
export async function readDimensions(input: Buffer): Promise<Dimensions | null> {
  try {
    const meta = await sharp(input).metadata();
    if (!meta.width || !meta.height) return null;
    const orientation = meta.orientation ?? 1;
    const rotated = orientation >= 5 && orientation <= 8;
    return {
      width: rotated ? meta.height : meta.width,
      height: rotated ? meta.width : meta.height,
      orientation,
    };
  } catch {
    return null;
  }
}

export async function writeThumb(input: Buffer, id: string, size: number): Promise<string> {
  const out = thumbPath(id, size);
  await fs.mkdir(path.dirname(out), { recursive: true });
  const tmp = `${out}.${process.pid}.tmp`;
  await sharp(input)
    .rotate() // bake EXIF orientation into the pixels
    .resize(size, size, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: size <= 640 ? 78 : 86, mozjpeg: true, progressive: true })
    .toFile(tmp);
  // Atomic swap so a half-written thumbnail never lands in the cache.
  await fs.rename(tmp, out);
  return out;
}

/** Returns the cached path, generating the thumbnail first if needed. */
export async function ensureThumb(filePath: string, ext: string, id: string, size: number): Promise<string | null> {
  const out = thumbPath(id, size);
  try {
    await fs.access(out);
    return out;
  } catch {
    // missing — generate it
  }
  const input = await readDecodable(filePath, ext);
  if (!input) return null;
  return writeThumb(input, id, size);
}
