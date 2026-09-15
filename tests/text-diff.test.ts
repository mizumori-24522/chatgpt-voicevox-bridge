import { describe, it, expect } from 'vitest';
import { StreamTracker, commonPrefixLength } from '../src/text-diff';

describe('commonPrefixLength', () => {
  it('counts shared leading characters', () => {
    expect(commonPrefixLength('今日は', '今日は晴れです。')).toBe(3);
    expect(commonPrefixLength('abc', 'xyz')).toBe(0);
  });
});

describe('StreamTracker', () => {
  it('returns only newly appended text', () => {
    const t = new StreamTracker();
    expect(t.push('今日は')).toBe('今日は');
    expect(t.push('今日は晴れです。')).toBe('晴れです。');
  });

  it('never re-emits the same text on repeated observation', () => {
    const t = new StreamTracker();
    t.push('あいうえお');
    expect(t.push('あいうえお')).toBe('');
    expect(t.push('あいうえお')).toBe('');
  });

  it('emits the tail when text after the consumed point is rewritten', () => {
    const t = new StreamTracker();
    expect(t.push('前半です。')).toBe('前半です。');
    expect(t.push('前半です。後半です。')).toBe('後半です。');
  });

  it('does not re-read when already-consumed text is replaced', () => {
    const t = new StreamTracker();
    t.push('最初の文章です。');
    expect(t.push('まったく違う文章です。')).toBe('');
  });

  it('resets cleanly for a new message', () => {
    const t = new StreamTracker();
    t.push('古い回答');
    t.reset();
    expect(t.push('新しい回答')).toBe('新しい回答');
  });
});
