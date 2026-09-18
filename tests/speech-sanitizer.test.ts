import { describe, it, expect } from 'vitest';
import {
  sanitizeMarkdown,
  extractSpeechText,
  DEFAULT_SANITIZE_OPTIONS,
} from '../src/speech-sanitizer';

const opts = DEFAULT_SANITIZE_OPTIONS;

describe('sanitizeMarkdown', () => {
  it('strips bold markers', () => {
    expect(sanitizeMarkdown('**重要**', opts)).toBe('重要');
  });

  it('strips headings, quotes and list markers', () => {
    expect(sanitizeMarkdown('# 見出し\n> 引用\n- 項目', opts)).toBe('見出し\n引用\n項目');
  });

  it('announces code blocks instead of reading them', () => {
    const out = sanitizeMarkdown('説明です。\n```ts\nconst a = 1;\n```\n続きです。', opts);
    expect(out).toContain('ここにコードがあります。');
    expect(out).not.toContain('const a = 1');
  });

  it('handles an unclosed code fence mid-stream', () => {
    const out = sanitizeMarkdown('説明です。\n```ts\nconst a = 1;', opts);
    expect(out).not.toContain('const a = 1');
  });

  it('reads short inline code as-is', () => {
    expect(sanitizeMarkdown('`localhost` を使います', opts)).toBe('localhost を使います');
  });

  it('replaces long URLs', () => {
    expect(sanitizeMarkdown('詳細は https://example.com/very/long/url を見て', opts))
      .toContain('リンクがあります。');
  });

  it('can drop URLs entirely', () => {
    const out = sanitizeMarkdown('詳細は https://example.com/x を見て', { ...opts, urlMode: 'skip' });
    expect(out).not.toContain('example.com');
    expect(out).not.toContain('リンクがあります');
  });
});

function dom(html: string): Element {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('stripDecorations', () => {
  it('removes emoji that would make VOICEVOX pause', () => {
    expect(sanitizeMarkdown('根強い人気という印象です 🎭🔮', opts)).toBe('根強い人気という印象です');
  });

  it('keeps ordinary text and numbers intact', () => {
    expect(sanitizeMarkdown('2026年の話です。', opts)).toBe('2026年の話です。');
  });

  it('removes emoji from rendered DOM too', () => {
    const out = extractSpeechText(dom('<p>面白いです 📜✨</p>'), opts);
    expect(out.trim()).toBe('面白いです');
  });
});

describe('extractSpeechText', () => {
  it('reads paragraph text', () => {
    expect(extractSpeechText(dom('<p>こんにちは。</p><p>元気ですか。</p>'), opts))
      .toBe('こんにちは。\n元気ですか。');
  });

  it('announces a code block instead of reading it', () => {
    const out = extractSpeechText(dom('<p>次のコードです。</p><pre><code>rm -rf /</code></pre>'), opts);
    expect(out).toContain('ここにコードがあります。');
    expect(out).not.toContain('rm -rf');
  });

  it('announces tables', () => {
    const out = extractSpeechText(dom('<table><tr><td>A</td></tr></table>'), opts);
    expect(out.trim()).toBe('表があります。');
  });

  it('replaces bare-URL links', () => {
    const out = extractSpeechText(dom('<a href="https://x.test/a">https://x.test/a</a>'), opts);
    expect(out.trim()).toBe('リンクがあります。');
  });

  it('keeps link text when it is not a URL', () => {
    const out = extractSpeechText(dom('<a href="https://x.test/a">公式サイト</a>'), opts);
    expect(out.trim()).toBe('公式サイト');
  });

  it('skips the web-search citation pill used by ChatGPT', () => {
    const out = extractSpeechText(
      dom('<p>本文です。<span data-testid="webpage-citation-pill">example.com</span></p>'),
      opts,
    );
    expect(out.trim()).toBe('本文です。');
  });

  it('skips citation markers and hidden nodes', () => {
    const out = extractSpeechText(
      dom('<p>本文です。<sup>1</sup><span class="sr-only">隠し</span></p>'),
      opts,
    );
    expect(out.trim()).toBe('本文です。');
  });
});
