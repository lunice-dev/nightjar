import { describe, expect, it } from 'vitest';
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
