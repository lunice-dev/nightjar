/** The colour an album's cover is mostly made of, for the glow behind the home page. */
const found = new Map<string, Promise<[number, number, number] | null>>();

const SIZE = 24;

/**
 * The cover's main colour: the average of its pixels, counting the colourful ones more so a grey border or
 * a black background doesn't win. Null when the picture can't be read (a site that doesn't allow it).
 */
export function coverColour(src: string): Promise<[number, number, number] | null> {
  const known = found.get(src);
  if (known) return known;
  const p = new Promise<[number, number, number] | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = SIZE;
        const g = c.getContext('2d', { willReadFrequently: true })!;
        g.drawImage(img, 0, 0, SIZE, SIZE);
        const d = g.getImageData(0, 0, SIZE, SIZE).data;
        let r = 0, gr = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const hi = Math.max(d[i], d[i + 1], d[i + 2]);
          const lo = Math.min(d[i], d[i + 1], d[i + 2]);
          if (hi < 28) continue; // near black
          const weight = 6 + (hi - lo);
          r += d[i] * weight;
          gr += d[i + 1] * weight;
          b += d[i + 2] * weight;
          w += weight;
        }
        resolve(w ? [Math.round(r / w), Math.round(gr / w), Math.round(b / w)] : null);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
  found.set(src, p);
  return p;
}
