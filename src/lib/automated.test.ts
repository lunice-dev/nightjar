import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from '../prefs';
import { findAutomated } from './automated';

const now = Date.UTC(2026, 10, 1, 22, 0, 0);
let n = 0;
const ev = (user: string, kind: ActivityEvent['kind'], at: number, detail = ''): ActivityEvent => ({ id: `e${++n}`, at, user, kind, detail });

/** `count` events one after another, `gap` ms apart, ending a minute before `now`. */
const run = (user: string, kind: ActivityEvent['kind'], count: number, gap: number, detail = (i: number) => `item ${i}`) =>
  Array.from({ length: count }, (_, i) => ev(user, kind, now - 60_000 - (count - i) * gap, detail(i)));

describe('findAutomated', () => {
  it('marks a program that opens folders every 0.4 seconds as sure', () => {
    const r = findAutomated(run('bot', 'folder', 73, 400), now);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ user: 'bot', level: 'sure', kind: 'crawl' });
    expect(r[0].summary).toMatch(/Opened 73 of your folders in \d+ seconds/);
  });

  it('leaves a person who opens a folder every few seconds alone', () => {
    expect(findAutomated(run('human', 'folder', 20, 6000), now)).toEqual([]);
  });

  it('calls a quick burst of folders likely but not sure (a whole discography at once)', () => {
    const r = findAutomated(run('fan', 'folder', 20, 800), now);
    expect(r[0]).toMatchObject({ user: 'fan', level: 'likely', kind: 'crawl' });
  });

  it('does not count one album asked for file by file', () => {
    const files = run('friend', 'requested', 25, 200, (i) => `Asked for Some Album › ${i}.flac`);
    expect(findAutomated(files, now)).toEqual([]);
  });

  it('marks someone who asks for dozens of different albums in a few minutes', () => {
    const asked = run('leech', 'requested', 90, 3000, (i) => `Asked for Album ${i % 30} › t${i}.flac`);
    const r = findAutomated(asked, now);
    expect(r[0]).toMatchObject({ user: 'leech', kind: 'mass' });
  });

  it('marks very large downloads, and calls a thousand files in half an hour sure', () => {
    const asked = run('hoarder', 'requested', 1100, 1500, (i) => `Asked for Album ${Math.floor(i / 12)} › t${i}.flac`);
    expect(findAutomated(asked, now)[0]).toMatchObject({ user: 'hoarder', level: 'sure', kind: 'mass' });
  });

  it('marks someone who takes 900 files in an hour', () => {
    const got = run('taker', 'uploaded', 900, 3500);
    expect(findAutomated(got, now)[0]).toMatchObject({ user: 'taker', level: 'sure', kind: 'volume' });
  });

  it('ignores anything older than a day and keeps people apart', () => {
    const old = run('old', 'folder', 80, 400).map((e) => ({ ...e, at: e.at - 2 * 86_400_000 }));
    const mixed = [...old, ...run('a', 'folder', 3, 5000), ...run('b', 'folder', 3, 5000)];
    expect(findAutomated(mixed, now)).toEqual([]);
  });
});
