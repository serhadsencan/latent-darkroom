/**
 * Generates the logo assets the UI uses from the source banner.
 *
 *   node scripts/make-logo-assets.mjs <source-image> [--cx 0.4904 --cy 0.3763 --r 0.118]
 *
 * The source is the wide banner with the emblem on top and the wordmark below.
 * The emblem is cropped square into `web/public/`. The crop is tunable:
 *   --cx / --cy  emblem centre as a fraction of the image (0-1)
 *   --r          emblem radius as a fraction of the image WIDTH
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'web', 'public');

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
if (!source) {
  console.error('Usage: node scripts/make-logo-assets.mjs <source-image> [--cx .. --cy .. --r ..]');
  process.exit(1);
}

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1 || !args[i + 1]) return fallback;
  const value = Number(args[i + 1]);
  return Number.isFinite(value) ? value : fallback;
}

// Defaults measured against the current banner layout (emblem centred, upper half).
const cx = flag('cx', 0.4904);
const cy = flag('cy', 0.3763);
const r = flag('r', 0.118);

const meta = await sharp(source).metadata();
if (!meta.width || !meta.height) {
  console.error('Could not read the image dimensions.');
  process.exit(1);
}

const half = Math.round(meta.width * r);
const left = Math.round(meta.width * cx) - half;
const top = Math.round(meta.height * cy) - half;
const size = half * 2;

if (left < 0 || top < 0 || left + size > meta.width || top + size > meta.height) {
  console.error(
    `Crop falls outside the image (${left},${top} ${size}×${size} of ${meta.width}×${meta.height}). ` +
      'Adjust --cx / --cy / --r.',
  );
  process.exit(1);
}

await fs.mkdir(publicDir, { recursive: true });

const mark = sharp(source).extract({ left, top, width: size, height: size });

// 256px covers every use including the 180px apple-touch-icon on retina.
// A gradient-heavy emblem bloats as PNG; palette quantisation shrinks it ~10×.
const outputs = [
  { file: 'logo-mark.png', size: 256 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size: px } of outputs) {
  await mark
    .clone()
    .resize(px, px)
    .png({ compressionLevel: 9, palette: true, quality: 90 })
    .toFile(path.join(publicDir, file));
}

console.log(`Source: ${meta.width}×${meta.height}`);
console.log(`Emblem cropped: ${left},${top} ${size}×${size}`);
for (const { file } of outputs) {
  const { size: bytes } = await fs.stat(path.join(publicDir, file));
  console.log(`  web/public/${file.padEnd(16)} ${(bytes / 1024).toFixed(1)} KB`);
}
