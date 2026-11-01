import { boxBlur } from './storyCard';

const SIZE = 96;
const soft = new Map<string, string | null>();
const running = new Map<string, Promise<string | null>>();

/** The picture already blurred and saturated (as a small JPEG), so the player draws a plain image instead of a huge live blur filter. */
export const softBackdropNow = (src: string) => soft.get(src) ?? null;

/**
 * Makes the blurred background for a cover: shrunk, saturated, box-blurred, and enlarged in steps so no blocks show. Null when the picture
 * can't be read (from a site that doesn't allow it), in which case the caller falls back to blurring it with CSS.
 */
export function softBackdrop(src: string): Promise<string | null> {
  if (soft.has(src)) return Promise.resolve(soft.get(src) ?? null);
  const job = running.get(src);
  if (job) return job;
  const p = new Promise<string | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      try {
        await img.decode?.();
      } catch {
        /* drawing it still works */
      }
      if (!img.naturalWidth || !img.naturalHeight) return resolve(null); // a picture with no size of its own (some SVGs): blur it with CSS
      try {
        const small = document.createElement('canvas');
        small.width = small.height = SIZE;
        const s = small.getContext('2d', { willReadFrequently: true })!;
        s.imageSmoothingQuality = 'high';
        // Fill the square the way the page shows it (cropped to cover).
        const k = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
        const sw = SIZE / k, sh = SIZE / k;
        s.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, SIZE, SIZE);
        const px = s.getImageData(0, 0, SIZE, SIZE);
        const d = px.data;
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          d[i] = g + (d[i] - g) * 1.5;
          d[i + 1] = g + (d[i + 1] - g) * 1.5;
          d[i + 2] = g + (d[i + 2] - g) * 1.5;
        }
        boxBlur(d, SIZE, SIZE, 3, 3);
        s.putImageData(px, 0, 0);
        let from = small;
        for (const n of [192, 384]) {
          const step = document.createElement('canvas');
          step.width = step.height = n;
          const c = step.getContext('2d')!;
          c.imageSmoothingQuality = 'high';
          c.drawImage(from, 0, 0, n, n);
          from = step;
        }
        resolve(from.toDataURL('image/jpeg', 0.86));
      } catch {
        resolve(null); // the picture is from a server that doesn't allow reading it
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  }).then((url) => {
    soft.set(src, url);
    running.delete(src);
    return url;
  });
  running.set(src, p);
  return p;
}
