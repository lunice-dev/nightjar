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

  // The backdrop: the cover shrunk to a few pixels and stretched back is a soft blur on every browser (canvas blur filters aren't everywhere).
  ctx.fillStyle = info.tint ?? '#2a2724';
  ctx.fillRect(0, 0, W, H);
  if (img) {
    const tiny = document.createElement('canvas');
    tiny.width = 27;
    tiny.height = 48;
    const t = tiny.getContext('2d')!;
    t.imageSmoothingQuality = 'high';
    cover(t, img, 0, 0, 27, 48);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(tiny, 0, 0, W, H);
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
  ctx.fillStyle = info.tint ?? '#2a2724';
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
