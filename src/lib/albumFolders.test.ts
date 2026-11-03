import { describe, expect, it } from 'vitest';
import { albumFolders } from './albumFolders';

const DL = 'C:\\Music\\UNSORTED';
const at = (dir: string, n: number, from = 1) => Array.from({ length: n }, (_, i) => `${DL}\\${dir}\\${String(i + from).padStart(2, '0')}.flac`);

describe('where an album’s files are', () => {
  it('counts a two-disc album in one place as one folder', () => {
    const f = albumFolders([...at('Gish (1991)\\CD 01', 10), ...at('Gish (1991)\\CD 02', 18)], DL);
    expect(f.all).toBe(1);
    expect(f.target).toBe(`${DL}\\Gish (1991)`);
    expect(f.others).toEqual([]);
  });

  it('finds the album folder a retry went to, and its discs', () => {
    const f = albumFolders([...at('Gish (1991)\\CD 01', 10), ...at('Gish (1991)\\CD 02', 15), ...at('Gish\\CD 02', 3, 16)], DL);
    expect(f.all).toBe(2);
    expect(f.target).toBe(`${DL}\\Gish (1991)`);
    expect(f.others).toEqual([`${DL}\\Gish`]);
    expect(f.discs.sort()).toEqual(['CD 01', 'CD 02']);
  });

  it('keeps albums without disc folders as they were', () => {
    const f = albumFolders([...at('Adore (1998)', 14), ...at('Adore', 2, 15)], DL);
    expect(f.target).toBe(`${DL}\\Adore (1998)`);
    expect(f.others).toEqual([`${DL}\\Adore`]);
    expect(f.discs).toEqual(['']);
  });

  it('treats a disc folder right inside the download folder as an album', () => {
    expect(albumFolders(at('CD 1', 4), DL).target).toBe(`${DL}\\CD 1`);
  });

  it('ignores files outside the download folder', () => {
    expect(albumFolders(['D:\\Elsewhere\\x\\01.flac'], DL).all).toBe(0);
  });
});
