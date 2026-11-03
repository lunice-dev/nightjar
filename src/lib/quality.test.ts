import { describe, expect, it } from 'vitest';
import { isFormatFolder, speed, splitFolder } from './quality';

describe('an album kept in a folder named after its format', () => {
  it('takes its name from the folder above, and keeps its files where they are', () => {
    const s = splitFolder('Music\\(HQ) Bon Iver - For Emma, Forever Ago\\24bit\\01 - Flume.flac');
    expect(s.title).toBe('(HQ) Bon Iver - For Emma, Forever Ago');
    expect(s.parent).toBe('Music');
    expect(s.root).toBe('Music\\(HQ) Bon Iver - For Emma, Forever Ago\\24bit');
  });
  it('knows the usual format names, and not album names', () => {
    for (const f of ['24bit', '24 bit', '16-bit', 'FLAC', 'flac 24', 'FLAC 24-96', '[Hi-Res]', 'MP3 320', '320 kbps', '96kHz', 'V0']) expect(isFormatFolder(f)).toBe(true);
    for (const f of ['1999', 'Gold', 'For Emma, Forever Ago', 'Discovery', 'MINT JAMS']) expect(isFormatFolder(f)).toBe(false);
  });
  it('still steps over a disc folder first', () => {
    expect(splitFolder('Music\\Gish (1991)\\CD 01\\01.flac').title).toBe('Gish (1991)');
  });
});

describe('speeds', () => {
  it('never prints a fraction of a byte', () => {
    expect(speed(0.123456789)).toBe('under 1 KB/s');
    expect(speed(512.333)).toBe('under 1 KB/s');
    expect(speed(2048)).toBe('2.0 KB/s');
    expect(speed(0)).toBe('—');
  });
});
