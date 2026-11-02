/** Splits text into at most `maxLines` lines that fit `maxWidth`, ending the last one with "…" if the text is longer. */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (measure(next) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      line = words.slice(i).join(' ');
      break;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  const last = lines.length - 1;
  if (last >= 0) {
    let s = lines[last];
    if (measure(s) > maxWidth) {
      while (s.length > 1 && measure(`${s}…`) > maxWidth) s = s.slice(0, -1);
      lines[last] = `${s.trimEnd()}…`;
    }
  }
  return lines;
}

const W = 1080;
const H = 1920;

/** A box blur over RGBA pixels, `passes` times each way; three passes come out close to a gaussian. Edges repeat. */
export function boxBlur(data: Uint8ClampedArray, w: number, h: number, radius: number, passes: number) {
  const tmp = new Uint8ClampedArray(data.length);
  const span = radius * 2 + 1;
  const run = (src: Uint8ClampedArray, dst: Uint8ClampedArray, len: number, count: number, stride: number, lineStride: number) => {
    for (let line = 0; line < count; line++) {
      const base = line * lineStride;
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let i = -radius; i <= radius; i++) sum += src[base + Math.min(len - 1, Math.max(0, i)) * stride + c];
        for (let i = 0; i < len; i++) {
          dst[base + i * stride + c] = sum / span;
          sum += src[base + Math.min(len - 1, i + radius + 1) * stride + c] - src[base + Math.max(0, i - radius) * stride + c];
        }
      }
    }
  };
  for (let p = 0; p < passes; p++) {
    run(data, tmp, w, h, 4, w * 4);
    run(tmp, data, h, w, w * 4, 4);
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

/** Draws `img` filling `w`×`h` at (x, y), cropped to fit like object-fit: cover. */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export interface CardInfo {
  art: string;
  /** The cover's colour, for the backdrop when the picture can't be used. */
  tint: string | null;
  title: string;
  artist: string | null;
}

async function draw(info: CardInfo, useImage: boolean): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = useImage && info.art ? await loadImage(info.art) : null;

  // The backdrop: a small copy of the cover, blurred by hand (canvas blur filters aren't on every browser), then enlarged in
  // steps so no blocks show.
  ctx.fillStyle = info.tint ?? '#22273a';
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const small = document.createElement('canvas');
    small.width = 108;
    small.height = 192;
    const s = small.getContext('2d')!;
    s.imageSmoothingQuality = 'high';
    cover(s, img, 0, 0, 108, 192);
    const px = s.getImageData(0, 0, 108, 192);
    boxBlur(px.data, 108, 192, 7, 3);
    s.putImageData(px, 0, 0);
    let from: HTMLCanvasElement = small;
    for (const [w, h] of [[270, 480], [540, 960], [W, H]] as const) {
      const step = w === W ? canvas : document.createElement('canvas');
      step.width = w;
      step.height = h;
      const c = step.getContext('2d')!;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(from, 0, 0, w, h);
      from = step;
    }
  }
  const veil = ctx.createLinearGradient(0, 0, 0, H);
  veil.addColorStop(0, 'rgb(0 0 0 / 0.18)');
  veil.addColorStop(0.5, 'rgb(0 0 0 / 0.08)');
  veil.addColorStop(1, 'rgb(0 0 0 / 0.5)');
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, W, H);

  const font = (weight: number, px: number) => `${weight} ${px}px "Instrument Sans Variable", system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgb(255 255 255 / 0.7)';
  ctx.font = font(600, 34);
  ctx.fillText('NOW PLAYING', 140, 470);

  // The cover, with a soft shadow.
  const size = 800, cx = 140, cy = 520;
  ctx.save();
  ctx.shadowColor = 'rgb(0 0 0 / 0.45)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, cx, cy, size, size, 40);
  ctx.fillStyle = info.tint ?? '#22273a';
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, cx, cy, size, size, 40);
  ctx.clip();
  if (img) cover(ctx, img, cx, cy, size, size);
  ctx.restore();

  // The title and the artist.
  ctx.fillStyle = '#fff';
  ctx.font = font(700, 68);
  const title = wrapLines((s) => ctx.measureText(s).width, info.title, size, 2);
  let y = cy + size + 110;
  for (const l of title) {
    ctx.fillText(l, cx, y);
    y += 80;
  }
  ctx.fillStyle = 'rgb(255 255 255 / 0.78)';
  ctx.font = font(500, 46);
  const artist = wrapLines((s) => ctx.measureText(s).width, info.artist ?? 'Unknown artist', size, 1);
  ctx.fillText(artist[0] ?? '', cx, y + 8);

  // The mark at the bottom.
  ctx.fillStyle = 'rgb(255 255 255 / 0.6)';
  ctx.font = font(600, 30);
  const mark = 'N I G H T J A R';
  ctx.fillText(mark, (W - ctx.measureText(mark).width) / 2, H - 120);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

/** The picture to post as a story: 1080×1920, the cover over its own blurred self. If the cover can't be read, the backdrop is its colour. */
export async function makeStoryCard(info: CardInfo): Promise<Blob> {
  try {
    return await draw(info, true);
  } catch {
    return draw(info, false); // a cover from another website taints the canvas: draw without it
  }
}

/** Hands the card to the system share sheet (Instagram, Messages, …), or saves it where sharing files isn't available. */
export async function shareStoryCard(info: CardInfo): Promise<'shared' | 'saved' | 'cancelled'> {
  const blob = await makeStoryCard(info);
  const file = new File([blob], 'nightjar-now-playing.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}
