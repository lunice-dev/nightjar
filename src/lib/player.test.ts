import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayer, type QueueItem } from './player';

const item = (id: string) => ({ qid: id, title: id, path: id, dir: 'd', seconds: 30 }) as unknown as QueueItem;
const order = () => usePlayer.getState().queue.map((q) => q.qid);

describe('moving a track in the queue', () => {
  const start = () => usePlayer.setState({ queue: ['a', 'b', 'c', 'd', 'e'].map(item), index: 1 });

  it('moves a track that is still to come', () => {
    start();
    usePlayer.getState().move('e', 2);
    expect(order()).toEqual(['a', 'b', 'e', 'c', 'd']);
  });

  it('keeps it among the tracks still to come', () => {
    start();
    usePlayer.getState().move('d', 0);
    expect(order()).toEqual(['a', 'b', 'd', 'c', 'e']);
    usePlayer.getState().move('c', 99);
    expect(order()).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('leaves what has played and what is playing where they are', () => {
    start();
    usePlayer.getState().move('a', 3);
    usePlayer.getState().move('b', 3);
    expect(order()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(usePlayer.getState().index).toBe(1);
  });
});

describe('the sleep timer', () => {
  afterEach(() => {
    usePlayer.getState().setSleep(null);
    vi.useRealTimers();
  });

  it('stops the music when the time is up', () => {
    vi.useFakeTimers();
    usePlayer.getState().setSleep(15);
    expect(usePlayer.getState().sleep).toEqual({ at: Date.now() + 15 * 60000 });
    vi.advanceTimersByTime(14 * 60000);
    usePlayer.getState().checkSleep();
    expect(usePlayer.getState().sleep).not.toBeNull();
    vi.advanceTimersByTime(60000 + 100);
    expect(usePlayer.getState().sleep).toBeNull();
  });

  it('can be cancelled', () => {
    vi.useFakeTimers();
    usePlayer.getState().setSleep(30);
    usePlayer.getState().setSleep(null);
    expect(usePlayer.getState().sleep).toBeNull();
  });

  it('end of track stops on the track that was playing, without going on to the next', () => {
    usePlayer.setState({ queue: ['a', 'b'].map(item), index: 0, repeat: 'off' });
    usePlayer.getState().setSleep('track');
    usePlayer.getState().ended();
    expect(usePlayer.getState().index).toBe(0);
    expect(usePlayer.getState().sleep).toBeNull();
  });
});

describe('the volume', () => {
  it('stays between 0 and 1', () => {
    usePlayer.getState().setVolume(1.7);
    expect(usePlayer.getState().volume).toBe(1);
    usePlayer.getState().setVolume(-3);
    expect(usePlayer.getState().volume).toBe(0);
    usePlayer.getState().setVolume(1);
  });
});
