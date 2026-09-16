import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatObserver } from '../src/observer';
import { ChatGptAdapter } from '../src/chatgpt-adapter';
import { DEFAULT_SANITIZE_OPTIONS } from '../src/speech-sanitizer';

/**
 * 実際の chatgpt.com (2026-09-15 時点) を写した最小構造。
 * section[data-turn][data-turn-id] の内側に
 * div[data-message-author-role][data-message-id] > .markdown が入る。
 */
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
      `<section data-turn="user" data-turn-id="tu${this.turn}"
                data-testid="conversation-turn-${this.turn}">
         <div data-message-author-role="user" data-message-id="u${this.turn}">
           <div class="markdown prose">${text}</div>
         </div>
       </section>`,
    );
  }
  addAssistant(id: string): HTMLElement {
    this.turn++;
    this.main.insertAdjacentHTML(
      'beforeend',
      `<section data-turn="assistant" data-turn-id="t-${id}"
                data-testid="conversation-turn-${this.turn}">
         <div data-message-author-role="assistant" data-message-id="${id}">
           <div class="markdown prose"></div>
         </div>
       </section>`,
    );
    return this.main.querySelector(`[data-message-id="${id}"] .markdown`) as HTMLElement;
  }
  /** 画面外へスクロールしたターンが仮想化で中身を落とす挙動 */
  virtualize(id: string): void {
    const msg = this.main.querySelector(`[data-message-id="${id}"]`);
    msg?.remove();
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

/** 起動後に会話がまとめて描画される（リロード直後）状況 */
class FakeChat2 {
  renderExistingAnswer(html: string): void {
    document.getElementById('main')!.insertAdjacentHTML(
      'beforeend',
      `<section data-turn="assistant" data-turn-id="t-existing"
                data-testid="conversation-turn-2">
         <div data-message-author-role="assistant" data-message-id="existing">
           <div class="markdown prose">${html}</div>
         </div>
       </section>`,
    );
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
/** 本文の増加が止まって「生成完了」と判定されるまで進める */
const settle = () => vi.advanceTimersByTime(1500);

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
    settle();

    expect(chunks).toEqual([
      'ジャンクションとは、魔法を能力値に装備する仕組みです。',
      'たとえば力にファイガを装備します。',
    ]);
    observer.stop();
  });

  it('does not read messages that already existed at startup', () => {
    const chat = new FakeChat();
    const content = chat.addAssistant('old');
    content.innerHTML =
      '<p>これは起動前からある古い回答です。読んではいけません。仮想化されていても読んではいけません。</p>';

    const { observer, chunks } = makeObserver();
    observer.start();
    pump();
    settle();
    expect(chunks).toEqual([]);
    observer.stop();
  });

  it('does not read an existing answer that renders after startup (page reload)', () => {
    // リロード直後は main が空で、会話は少し遅れて描画される。
    // これを「新しい回答」と誤認して読み上げてしまうバグの回帰テスト。
    new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();
    pump();

    const chat2 = new FakeChat2();
    chat2.renderExistingAnswer(
      '<p>開いただけの過去の回答です。ページ描画が遅れただけで、新規生成ではありません。</p>',
    );
    pump();
    settle();

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
    settle();

    const all = chunks.join(' ');
    expect(all).not.toContain('const answer');
    expect(all).toContain('ここにコードがあります。');
    expect(all).toContain('これで動作します。');
    observer.stop();
  });

  it('still reads a genuinely new answer that grows from empty', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();
    pump();

    // 生成中フラグは取れないが、質問は送られている = 本物の新規回答
    chat.addUser('新しい質問');
    pump();
    const content = chat.addAssistant('fresh');
    content.innerHTML = '<p>新しい</p>';
    pump();
    content.innerHTML = '<p>新しい回答が少しずつ伸びてきています。これは読むべきです。</p>';
    pump();
    settle();

    expect(chunks.join(' ')).toContain('これは読むべきです。');
    observer.stop();
  });

  it('finishes reading even when the stop button is never detected', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();

    // startGenerating() を呼ばない = 生成中フラグが一切取れないケース
    chat.addUser('質問です');
    pump();
    const content = chat.addAssistant('a3');
    content.innerHTML = '<p>停止ボタンが取れなくても最後まで読み切ります。</p>';
    pump();
    settle();

    expect(chunks.join(' ')).toContain('停止ボタンが取れなくても最後まで読み切ります。');
    observer.stop();
  });

  it('survives virtualization dropping an older turn', () => {
    const chat = new FakeChat();
    const { observer, chunks } = makeObserver();
    observer.start();

    chat.startGenerating();
    const c1 = chat.addAssistant('a1');
    c1.innerHTML = '<p>最初の回答です。ここまでが一つ目です。</p>';
    pump();
    chat.stopGenerating();
    settle();
    const afterFirst = chunks.length;

    // 画面外になった古いターンの中身が DOM から消える
    chat.virtualize('a1');
    pump();
    settle();
    expect(chunks.length).toBe(afterFirst);
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
    settle();
    const afterFirst = chunks.length;

    chat.addUser('二つ目の質問');
    chat.startGenerating();
    const c2 = chat.addAssistant('a2');
    c2.innerHTML = '<p>二つ目の回答です。まったく別の内容です。</p>';
    pump();
    chat.stopGenerating();
    settle();

    const second = chunks.slice(afterFirst).join(' ');
    expect(second).toContain('二つ目の回答です。');
    expect(second).not.toContain('一つ目の回答');
    observer.stop();
  });
});
