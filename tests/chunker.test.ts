import { describe, it, expect } from 'vitest';
import { SpeechChunker, hasSpeakableContent } from '../src/chunker';

const opts = { minimumChunkLength: 10, preferredChunkLength: 40, maximumChunkLength: 60 };

describe('SpeechChunker', () => {
  it('holds text shorter than the minimum', () => {
    const c = new SpeechChunker(opts);
    c.append('短い。');
    expect(c.take(false)).toEqual([]);
  });

  it('splits at sentence boundaries', () => {
    const c = new SpeechChunker(opts);
    c.append('これは一文目でとても長いです。これは二文目でとても長いです。つづき');
    expect(c.take(false)).toEqual([
      'これは一文目でとても長いです。',
      'これは二文目でとても長いです。',
    ]);
  });

  it('flushes the remainder when final', () => {
    const c = new SpeechChunker(opts);
    c.append('まだ途中の文');
    expect(c.take(true)).toEqual(['まだ途中の文']);
    expect(c.pending).toBe('');
  });

  it('keeps trailing closing punctuation with its sentence', () => {
    const c = new SpeechChunker(opts);
    c.append('本当にそうなのでしょうか！？そのとおりです。');
    expect(c.take(false)[0]).toBe('本当にそうなのでしょうか！？');
  });

  it('force-cuts text with no boundary at all', () => {
    const c = new SpeechChunker(opts);
    c.append('あ'.repeat(200));
    const chunks = c.take(false);
    expect(chunks.length).toBeGreaterThan(0);
    for (const ch of chunks) expect(ch.length).toBeLessThanOrEqual(opts.maximumChunkLength);
  });

  it('drops chunks with nothing speakable', () => {
    const c = new SpeechChunker(opts);
    c.append('--------------------\n');
    expect(c.take(true)).toEqual([]);
  });

  it('never loses or duplicates characters', () => {
    const c = new SpeechChunker(opts);
    const src = 'あいうえおかきくけこ。さしすせそたちつてと。なにぬねのはひふへほ';
    c.append(src);
    const joined = c.take(true).join('');
    expect(joined).toBe(src.replace(/。/g, '。').split('').join(''));
  });
});

describe('hasSpeakableContent', () => {
  it('rejects symbol-only text', () => {
    expect(hasSpeakableContent('---')).toBe(false);
    expect(hasSpeakableContent('あ')).toBe(true);
    expect(hasSpeakableContent('123')).toBe(true);
  });
});
