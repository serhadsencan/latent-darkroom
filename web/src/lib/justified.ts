import type { Photo } from '../api.ts';

export type Box = { photo: Photo; x: number; width: number; height: number };
export type Row = { top: number; height: number; boxes: Box[] };
export type Layout = { rows: Row[]; totalHeight: number };

const DEFAULT_ASPECT = 3 / 2;

function aspectOf(photo: Photo): number {
  if (!photo.width || !photo.height) return DEFAULT_ASPECT;
  const ratio = photo.width / photo.height;
  // Clamp panoramas, otherwise one frame swallows an entire row.
  return Math.min(Math.max(ratio, 0.4), 4);
}

/**
 * Flickr/Lightroom-style justified grid: photos keep their aspect ratio and the
 * row height is scaled so the row fills the container exactly.
 */
export function layoutJustified(
  photos: Photo[],
  containerWidth: number,
  targetHeight: number,
  gap: number,
): Layout {
  const rows: Row[] = [];
  if (containerWidth <= 0 || photos.length === 0) return { rows, totalHeight: 0 };

  let current: Photo[] = [];
  let aspectSum = 0;
  let top = 0;

  const flush = (justify: boolean) => {
    if (current.length === 0) return;
    const totalGap = gap * (current.length - 1);
    const available = containerWidth - totalGap;
    // The last row is not stretched — a half-full row would look oddly large.
    const height = justify ? available / aspectSum : targetHeight;

    let x = 0;
    const boxes: Box[] = current.map((photo) => {
      const width = height * aspectOf(photo);
      const box: Box = { photo, x, width, height };
      x += width + gap;
      return box;
    });

    rows.push({ top, height, boxes });
    top += height + gap;
    current = [];
    aspectSum = 0;
  };

  for (const photo of photos) {
    current.push(photo);
    aspectSum += aspectOf(photo);
    const projectedWidth = aspectSum * targetHeight + gap * (current.length - 1);
    if (projectedWidth >= containerWidth) flush(true);
  }
  flush(false);

  return { rows, totalHeight: Math.max(0, top - gap) };
}
