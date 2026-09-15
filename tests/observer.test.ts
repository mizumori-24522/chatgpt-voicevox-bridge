import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatObserver } from '../src/observer';
import { ChatGptAdapter } from '../src/chatgpt-adapter';
import { DEFAULT_SANITIZE_OPTIONS } from '../src/speech-sanitizer';

/** ChatGPT の会話 DOM を模した最小構造 */
class FakeChat {
  private turn = 0;
  constructor() {
    document.body.innerHTML = '<main id="main"></main>';
  }
  private get main() {
    return document.getElementById('main')!;
  }
  addUser(text: string): void {
    this.turn++;
    this.main.insertAdjacentHTML(
      'beforeend',
      `<article data-testid="conversation-turn-${this.turn}">
         <div data-message-author-role="user" data-message-id="u${this.turn}">
           <div class="markdown">${text}</div>
         </div>
       </article>`,
    );
  }
  addAssistant(id: string): HTMLElement {
    this.turn++;
    this.main.insertAdjacentHTML(
      'beforeend',
      `<article data-testid="conversation-turn-${this.turn}">
         <div data-message-author-role="assistant" data-message-id="${id}">
           <div class="markdown"></div>
         </div>
       </article>`,
    );
    return this.main.querySelector(`[data-message-id="${id}"] .markdown`) as HTMLElement;
  }
  startGenerating(): void {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button data-testid="stop-button" id="stopbtn"></button>',
    );
  }
  stopGenerating(): void {
    document.getElementById('stopbtn')?.remove();
  }
}

function makeObserver() {
  const chunks: string[] = [];
  let stops = 0;
  const observer = new ChatObserver({
    adapter: new ChatGptAdapter(),
    getEnabled: () => true,
    getSanitizeOptions: () => DEFAULT_SANITIZE_OPTIONS,
    getChunkerOptions: () => ({
      minimumChunkLength: 10,
      preferredChunkLength: 40,
      maximumChunkLength: 60,
    }),
    onChunk: (t) => chunks.push(t),
    onNewUserMessage: () => stops++,
  });
  return { observer, chunks, getStops: () => stops };
}

/** MutationObserver/rAF を待たず、内部ポーリング相当を直接叩く */
const pump = () => vi.advanceTimersByTime(200);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 0;
  });
});

describe('ChatObserver', () => {
  it('streams chunks once and only once', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();

    chat.addUser('質問です');
    chat.startGenerating();
    const content = chat.addAssistant('a1');

    content.innerHTML = '<p>ジャンクションとは、魔法を能力値に装備する仕組みです。</p>';
    pump();
    // 同じ本文を何度観測しても増えない
    pump();
    pump();
    expect(chunks).toEqual(['ジャンクションとは、魔法を能力値に装備する仕組みです。']);

    content.innerHTML =
      '<p>ジャンクションとは、魔法を能力値に装備する仕組みです。たとえば力にファイガを装備します。</p>';
    pump();
    chat.stopGenerating();
    pump();

    expect(chunks).toEqual([
      'ジャンクションとは、魔法を能力値に装備する仕組みです。',
      'たとえば力にファイガを装備します。',
    ]);
    observer.stop();
  });

  it('does not read messages that already existed at startup', () => {
    const chat = new FakeChat();
    const content = chat.addAssistant('old');
    content.innerHTML = '<p>これは起動前からある古い回答です。読んではいけません。</p>';

    const { observer, chunks } = makeObserver();
    observer.start();
    pump();
    pump();
    expect(chunks).toEqual([]);
    observer.stop();
  });

  it('fires onNewUserMessage when a question is sent', () => {
    const chat = new FakeChat();
    const { observer, getStops } = makeObserver();
    observer.start();
    pump();
    expect(getStops()).toBe(0);

    chat.addUser('新しい質問');
    pump();
    expect(getStops()).toBe(1);
    pump();
    expect(getStops()).toBe(1);
    observer.stop();
  });

  it('skips code blocks but keeps the surrounding prose', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();

    chat.startGenerating();
    const content = chat.addAssistant('a2');
    content.innerHTML =
      '<p>次のように書きます。</p><pre><code>const answer = 42;</code></pre><p>これで動作します。</p>';
    pump();
    chat.stopGenerating();
    pump();

    const all = chunks.join(' ');
    expect(all).not.toContain('const answer');
    expect(all).toContain('ここにコードがあります。');
    expect(all).toContain('これで動作します。');
    observer.stop();
  });

  it('starts a fresh buffer for the next assistant message', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();

    chat.startGenerating();
    const c1 = chat.addAssistant('a1');
    c1.innerHTML = '<p>一つ目の回答です。これで終わりです。</p>';
    pump();
    chat.stopGenerating();
    pump();
    const afterFirst = chunks.length;

    chat.addUser('二つ目の質問');
    chat.startGenerating();
    const c2 = chat.addAssistant('a2');
    c2.innerHTML = '<p>二つ目の回答です。まったく別の内容です。</p>';
    pump();
    chat.stopGenerating();
    pump();

    const second = chunks.slice(afterFirst).join(' ');
    expect(second).toContain('二つ目の回答です。');
    expect(second).not.toContain('一つ目の回答');
    observer.stop();
  });
});
