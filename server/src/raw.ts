import fs from 'node:fs/promises';
import exifr from 'exifr';

const RAF_MAGIC = 'FUJIFILMCCD-RAW';
// The RAF header stores the embedded JPEG's location at fixed offsets.
const RAF_JPEG_OFFSET_AT = 84;
const RAF_JPEG_LENGTH_AT = 88;
const RAF_HEADER_BYTES = 92;

/**
 * Extracts the full-size JPEG embedded in a Fuji RAF file.
 *
 * Preferred over actually decoding the RAF (libraw/dcraw): the embedded JPEG is
 * already rendered with the camera's film simulation, so it is both instant and
 * looks exactly like the straight-out-of-camera result.
 */
export async function extractRafJpeg(filePath: string): Promise<Buffer | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(RAF_HEADER_BYTES);
    const { bytesRead } = await fh.read(header, 0, RAF_HEADER_BYTES, 0);
    if (bytesRead < RAF_HEADER_BYTES) return null;
    if (header.subarray(0, RAF_MAGIC.length).toString('ascii') !== RAF_MAGIC) return null;

    const offset = header.readUInt32BE(RAF_JPEG_OFFSET_AT);
    const length = header.readUInt32BE(RAF_JPEG_LENGTH_AT);
    if (!offset || !length) return null;

    const stat = await fh.stat();
    if (offset + length > stat.size) return null;

    const jpeg = Buffer.alloc(length);
    await fh.read(jpeg, 0, length, offset);

    // Verify the SOI marker so a corrupt offset table cannot yield garbage.
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
    return jpeg;
  } catch {
    return null;
  } finally {
    await fh.close();
  }
}

/**
 * For non-RAF RAW formats, falls back to the largest preview stored in EXIF.
 * There is no full RAW decode — if nothing is found the file has no preview.
 */
export async function extractGenericPreview(filePath: string): Promise<Buffer | null> {
  try {
    const buf = await exifr.thumbnail(filePath);
    if (!buf) return null;
    return Buffer.from(buf);
  } catch {
    return null;
  }
}

/** Displayable JPEG bytes for any RAW file. */
export async function rawToJpeg(filePath: string, ext: string): Promise<Buffer | null> {
  if (ext === '.raf') {
    const jpeg = await extractRafJpeg(filePath);
    if (jpeg) return jpeg;
  }
  return extractGenericPreview(filePath);
}
