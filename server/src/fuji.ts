/**
 * Minimal Fujifilm MakerNote reader — film simulation only.
 *
 * exifr hands back the MakerNote as a raw buffer without decoding Fuji's tables.
 * Since the film simulation is the single most meaningful piece of metadata for a
 * Fuji shooter, it is worth the small parser.
 *
 * Layout: "FUJIFILM" (8 bytes) + IFD offset (uint32 LE) + a standard TIFF IFD.
 * All offsets are relative to the start of the MakerNote and always little-endian.
 */

const MAGIC = 'FUJIFILM';
const TAG_FILM_MODE = 0x1401;

// exiftool's Fuji FilmMode table.
const FILM_MODES = new Map<number, string>([
  [0x000, 'Provia / Standard'],
  [0x100, 'Studio Portrait'],
  [0x110, 'Studio Portrait Enhanced Saturation'],
  [0x120, 'Astia / Soft'],
  [0x130, 'Studio Portrait Increased Sharpness'],
  [0x200, 'Velvia / Vivid'],
  [0x300, 'Studio Portrait Ex'],
  [0x400, 'Velvia'],
  [0x500, 'Pro Neg. Std'],
  [0x501, 'Pro Neg. Hi'],
  [0x600, 'Classic Chrome'],
  [0x700, 'Eterna'],
  [0x800, 'Classic Negative'],
  [0x900, 'Bleach Bypass'],
  [0xa00, 'Nostalgic Neg'],
  [0xb00, 'Reala ACE'],
]);

export function parseFujiFilmSimulation(makerNote: Uint8Array | Buffer | undefined): string | null {
  if (!makerNote || makerNote.length < 12) return null;
  const buf = Buffer.isBuffer(makerNote) ? makerNote : Buffer.from(makerNote);
  if (buf.subarray(0, MAGIC.length).toString('ascii') !== MAGIC) return null;

  try {
    const ifdOffset = buf.readUInt32LE(8);
    if (ifdOffset + 2 > buf.length) return null;

    const count = buf.readUInt16LE(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      if (entry + 12 > buf.length) break;
      if (buf.readUInt16LE(entry) !== TAG_FILM_MODE) continue;

      // FilmMode is a single SHORT, so the value is inlined in the entry.
      const value = buf.readUInt16LE(entry + 8);
      return FILM_MODES.get(value) ?? `Unknown (0x${value.toString(16)})`;
    }
  } catch {
    return null;
  }
  return null;
}
