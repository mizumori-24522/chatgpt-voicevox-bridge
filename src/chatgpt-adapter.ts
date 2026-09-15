import { log, warn } from './logger';

/**
 * ChatGPT Web の DOM 依存を全てこのモジュールへ隔離する。
 * UI 変更時はここだけを直せばよい。
 *
 * 生成CSSクラス名には依存せず、data-* / role / aria を優先する。
 */

export type AssistantMessage = {
  id: string;
  element: HTMLElement;
  content: Element;
};

const ASSISTANT_SEL = '[data-message-author-role="assistant"]';
const USER_SEL = '[data-message-author-role="user"]';
const CONTENT_SELECTORS = ['.markdown', '[class*="markdown"]', '.prose', '[class*="prose"]'];

export class ChatGptAdapter {
  /** 監視対象のルート。会話領域が見つかればそれ、無ければ body。 */
  getObserverRoot(): HTMLElement {
    const main = document.querySelector('main');
    return (main as HTMLElement | null) ?? document.body;
  }

  getLatestAssistantMessage(): AssistantMessage | null {
    const nodes = document.querySelectorAll<HTMLElement>(ASSISTANT_SEL);
    if (nodes.length === 0) return null;
    const el = nodes[nodes.length - 1];
    const id = this.messageId(el, nodes.length - 1);
    const content = this.findContentRoot(el);
    return { id, element: el, content };
  }

  getLatestUserMessageId(): string | null {
    const nodes = document.querySelectorAll<HTMLElement>(USER_SEL);
    if (nodes.length === 0) return null;
    return this.messageId(nodes[nodes.length - 1], nodes.length - 1);
  }

  /**
   * メッセージ ID。ChatGPT 側の data-message-id が最優先。
   * 取れない場合は会話ID + 出現順で代用する。
   */
  private messageId(el: HTMLElement, index: number): string {
    const attr = el.getAttribute('data-message-id');
    if (attr) return attr;
    const turn = el.closest('[data-testid^="conversation-turn-"]');
    const testid = turn?.getAttribute('data-testid');
    if (testid) return `${this.conversationKey()}:${testid}`;
    return `${this.conversationKey()}:idx-${index}`;
  }

  private conversationKey(): string {
    return location.pathname;
  }

  /** 本文（markdown レンダリング結果）のルート要素。見つからなければメッセージ要素自身。 */
  private findContentRoot(el: HTMLElement): Element {
    for (const sel of CONTENT_SELECTORS) {
      const hit = el.querySelector(sel);
      if (hit) return hit;
    }
    return el;
  }

  /** 生成中かどうか。停止ボタンの存在を第一根拠にする。 */
  isGenerating(): boolean {
    if (document.querySelector('button[data-testid="stop-button"]')) return true;
    if (document.querySelector('[data-testid="stop-button"]')) return true;
    if (document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]')) return true;
    if (document.querySelector('.result-streaming, [class*="result-streaming"]')) return true;
    return false;
  }

  /** 入力欄。Enter 送信検出に使う。 */
  getComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ??
      document.querySelector<HTMLElement>('form [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('form textarea')
    );
  }

  /** ページが ChatGPT の会話画面として認識できるか */
  probe(): { ok: boolean; detail: string } {
    const assistants = document.querySelectorAll(ASSISTANT_SEL).length;
    const composer = this.getComposer() !== null;
    const ok = composer || assistants > 0;
    const detail = `assistant=${assistants} composer=${composer}`;
    if (ok) log('ChatGPT', 'probe ok', detail);
    else warn('ChatGPT', 'DOM を認識できません', detail);
    return { ok, detail };
  }
}
