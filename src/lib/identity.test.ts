import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FolderResult, Release } from './quality';

// MusicBrainz, as each test wants it: which album it finds (none by default) and that album's track names.
const mb = vi.hoisted(() => ({ group: null as string | null, tracks: [] as string[], asked: 0 }));
vi.mock('./covers', () => ({ releaseGroupId: async () => mb.group }));
vi.mock('./musicbrainz', () => ({
  mbFetch: async () => {
    mb.asked++;
    return { releases: [{ media: [{ tracks: mb.tracks.map((title) => ({ title })) }] }] };
  },
}));

const { checkRelease, identityOf, mismatchText, plainName, tagsSayOtherAlbum, titleOf, unidentifiedFolder } = await import('./identity');

// The real case from 25 Oct: a folder named after Mick Jenkins' album, full of Foo Fighters.
const PATIENCE = ['Smoking Song', 'Same Ol', 'Michelin Star', 'Pull Up', 'Show Me', 'Rooftop', 'Different Stories'];
const FOO = ['Doll', 'Monkey Wrench', 'Hey Johnny Park', 'My Poor Brain', 'Wind Up', 'Everlong', 'My Hero'];

let n = 0;
function copy(user: string, folder: string, titles: string[]): FolderResult {
  const parts = folder.split('\\');
  return {
    key: `${user}|${folder}|${n++}`,
    username: user,
    folder,
    title: parts[parts.length - 1],
    parent: parts[parts.length - 2] ?? '',
    audio: titles.map((t, i) => ({ filename: `${folder}\\${String(i + 1).padStart(2, '0')} - ${t}.flac` })),
  } as unknown as FolderResult;
}
const release = (...sources: FolderResult[]): Release => ({ key: `release-${n++}`, best: sources[0], sources, score: 0 });
const real = (user: string, titles = PATIENCE) => copy(user, 'Music\\Mick Jenkins\\The Patience', titles);
const bait = (user = 'flux_7714') => copy(user, '@@share\\audio\\slskd\\failed_imports\\Mick Jenkins - The Patience (2023)', FOO);

beforeEach(() => {
  mb.group = null;
  mb.tracks = [];
});

describe('names', () => {
  it('takes the song title out of a file name', () => {
    expect(titleOf('Music\\Foo Fighters\\Album\\06 - Everlong.flac')).toBe('everlong');
    expect(titleOf('01. Monkey Wrench.mp3')).toBe('monkey wrench');
    expect(titleOf('CD1 03 - My Hero.flac')).toBe('my hero');
    expect(titleOf('A1. Doll.flac')).toBe('doll');
    expect(titleOf('1-07 Wind Up.flac')).toBe('wind up');
  });

  it('drops the artist and album when the file name repeats them', () => {
    expect(titleOf('Foo Fighters - The Colour and the Shape - 11 - Everlong.flac', 'Foo Fighters', 'The Colour and the Shape')).toBe('everlong');
  });

  it('ignores what people add in brackets, accents, capitals and "The"', () => {
    expect(titleOf('05 - Michelin Star (feat. Somebody).flac')).toBe('michelin star');
    expect(titleOf('02 - Same Ol [Remastered 2024].flac')).toBe('same ol');
    expect(plainName('Björk')).toBe('bjork');
    expect(plainName('The Beatles')).toBe(plainName('beatles'));
    expect(plainName('Simon & Garfunkel')).toBe('simon and garfunkel');
  });

  it('knows the folders auto-taggers leave unidentified albums in', () => {
    expect(unidentifiedFolder('@@share\\audio\\slskd\\failed_imports\\Mick Jenkins - The Patience')).toBe(true);
    expect(unidentifiedFolder('Music\\Unknown Album')).toBe(true);
    expect(unidentifiedFolder('Music\\untagged\\x')).toBe(true);
    expect(unidentifiedFolder('Music\\Mick Jenkins\\The Patience')).toBe(false);
    expect(unidentifiedFolder('Music\\Failed Imports of the Heart')).toBe(false);
  });
});

describe('before downloading, against other people’s copies', () => {
  it('catches the bait copy when several people agree on the real one', async () => {
    const fake = bait();
    const r = release(real('anna'), real('bert'), real('carl'), fake);
    await checkRelease(r);
    expect(identityOf(fake.key)).toMatchObject({ kind: 'mismatch', matched: 0, of: 7, against: 'others', unidentified: true });
    for (const s of r.sources.slice(0, 3)) expect(identityOf(s.key)?.kind).toBe('ok');
  });

  it('accuses nobody on the word of a single other person', async () => {
    const fake = bait();
    await checkRelease(release(real('anna'), fake));
    expect(identityOf(fake.key)?.kind).toBe('unknown');
  });

  it('judges nothing by names like "Track 01"', async () => {
    const tracks = copy('dora', 'Music\\Mick Jenkins\\The Patience', ['Track 01', 'Track 02', 'Track 03', 'Track 04']);
    await checkRelease(release(real('anna'), real('bert'), real('carl'), tracks));
    expect(identityOf(tracks.key)?.kind).toBe('unknown');
  });

  it('accepts a copy whose names differ only in decoration', async () => {
    const odd = copy('dora', 'Music\\Mick Jenkins\\The Patience', PATIENCE.map((t, i) => (i % 2 ? `${t} (feat. Someone)` : `${t} [Remastered]`)));
    await checkRelease(release(real('anna'), real('bert'), odd));
    expect(identityOf(odd.key)?.kind).toBe('ok');
  });

  it('accepts a copy with only part of the album', async () => {
    const part = real('dora', PATIENCE.slice(0, 3));
    await checkRelease(release(real('anna'), real('bert'), real('carl'), part));
    expect(identityOf(part.key)?.kind).toBe('ok');
  });

  it('explains the warning in words', async () => {
    const fake = bait();
    await checkRelease(release(real('anna'), real('bert'), fake));
    const text = mismatchText(identityOf(fake.key)!, 'Mick Jenkins', 'The Patience');
    expect(text).toMatch(/^None of its 7 track names are in other people’s copies of Mick Jenkins – The Patience\./);
  });
});

describe('before downloading, against MusicBrainz', () => {
  it('passes a copy whose names are on the album', async () => {
    mb.group = 'rg-patience-1';
    mb.tracks = PATIENCE;
    const one = real('anna');
    await checkRelease(release(one));
    expect(identityOf(one.key)).toMatchObject({ kind: 'ok', matched: 7, of: 7, against: 'musicbrainz' });
  });

  it('flags a copy whose names aren’t, even when nobody else has the album', async () => {
    mb.group = 'rg-patience-2';
    mb.tracks = PATIENCE;
    const fake = bait();
    await checkRelease(release(fake));
    expect(identityOf(fake.key)).toMatchObject({ kind: 'mismatch', matched: 0, of: 7, against: 'musicbrainz' });
  });

  it('doesn’t flag a copy two other people back up (MusicBrainz may have found another album of that name)', async () => {
    mb.group = 'rg-patience-3';
    mb.tracks = PATIENCE;
    const fake = bait('erin');
    await checkRelease(release(fake, bait('fred'), bait('gina')));
    expect(identityOf(fake.key)?.kind).toBe('unknown');
  });
});

describe('a big search', () => {
  it('judges hundreds of copies in a moment (it used to freeze slower phones)', async () => {
    const word = (i: number) => ['alpha', 'bravo', 'delta', 'echo', 'golf', 'hotel', 'india', 'kilo', 'lima', 'mike'][i % 10] + i;
    const sources: FolderResult[] = [];
    for (let i = 0; i < 400; i++) {
      const g = i % 60; // 60 different rips, many people each
      sources.push(copy(`user${i}`, `Music\\Artist\\Album ${g}`, Array.from({ length: 15 }, (_, k) => `${word(g * 15 + k)} ${word(k)} song`)));
    }
    const started = performance.now();
    await checkRelease(release(...sources));
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe('while downloading: the first track’s tags', () => {
  const wanted = { artist: 'Mick Jenkins', album: 'The Patience' };

  it('says another album when both the artist and the album are someone else’s', () => {
    expect(tagsSayOtherAlbum(wanted, { artist: 'Foo Fighters', album: 'The Colour and the Shape' })).toBe(true);
  });

  it('doesn’t count a word in common as the same album', () => {
    expect(tagsSayOtherAlbum(wanted, { artist: 'Foo Fighters', album: 'Echoes, Silence, Patience & Grace' })).toBe(true);
  });

  it('accepts editions, guests, compilations and spelling', () => {
    expect(tagsSayOtherAlbum(wanted, { artist: 'Mick Jenkins', album: 'The Patience (Deluxe Edition)' })).toBe(false);
    expect(tagsSayOtherAlbum(wanted, { artist: 'Mick Jenkins feat. Benny the Butcher', album: 'The Patience' })).toBe(false);
    expect(tagsSayOtherAlbum(wanted, { artist: 'Someone Else', albumArtist: 'Various Artists', album: 'Best of 2023' })).toBe(false);
    expect(tagsSayOtherAlbum({ artist: 'Björk', album: 'Homogenic' }, { artist: 'Bjork', album: 'HOMOGENIC' })).toBe(false);
  });

  it('never accuses on missing tags', () => {
    expect(tagsSayOtherAlbum(wanted, {})).toBe(false);
    expect(tagsSayOtherAlbum(wanted, { artist: 'Foo Fighters' })).toBe(false);
    expect(tagsSayOtherAlbum({ album: 'The Patience' }, { artist: 'Foo Fighters', album: 'Wasting Light' })).toBe(false);
  });

  it('one difference alone isn’t enough', () => {
    expect(tagsSayOtherAlbum(wanted, { artist: 'Foo Fighters', album: 'The Patience' })).toBe(false);
    expect(tagsSayOtherAlbum(wanted, { artist: 'Mick Jenkins', album: 'Pieces of a Man' })).toBe(false);
  });
});
