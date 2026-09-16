import { log, warn } from './logger';

/**
 * ChatGPT Web の DOM 依存を全てこのモジュールへ隔離する。
 * UI 変更時はここだけを直せばよい。
 *
 * 2026-09-15 に実際の chatgpt.com (GPT-6 世代 UI) で確認した構造:
 *
 *   <section data-turn="assistant" data-turn-id="<uuid>"
 *            data-testid="conversation-turn-10">
 *     <div data-message-author-role="assistant" data-message-id="<uuid>"
 *          data-message-model-slug="...">
 *       <div class="... markdown prose ...">  ← 本文
 *
 * 重要: 会話は仮想化されており、画面外のターンでは内側の
 * [data-message-author-role] が DOM から消える。外側の
 * section[data-turn] は残るので、そちらを一次の拠り所にする。
 * 生成CSSクラス名には依存しない。
 */

export type AssistantMessage = {
  id: string;
  element: HTMLElement;
  content: Element;
};

const TURN_SEL = '[data-turn]';
const TURN_FALLBACK_SEL = '[data-testid^="conversation-turn-"]';
const ASSISTANT_SEL = '[data-message-author-role="assistant"]';
const USER_SEL = '[data-message-author-role="user"]';
const CONTENT_SELECTORS = ['.markdown', '[class*="markdown"]', '.prose', '[class*="prose"]'];

export class ChatGptAdapter {
  getObserverRoot(): HTMLElement {
    const main = document.querySelector('main');
    return (main as HTMLElement | null) ?? document.body;
  }

  /** assistant ターンを出現順に全部返す（任意の回答を指定して読ませる用） */
  assistantTurns(): HTMLElement[] {
    return this.turns().filter(
      (t) =>
        t.getAttribute('data-turn') === 'assistant' ||
        (t.getAttribute('data-turn') === null && t.querySelector(ASSISTANT_SEL) !== null),
    );
  }

  /** ターンから本文要素を取り出す */
  contentOfTurn(turn: HTMLElement): Element {
    const message = turn.matches(ASSISTANT_SEL)
      ? turn
      : (turn.querySelector<HTMLElement>(ASSISTANT_SEL) ?? turn);
    return this.findContentRoot(message);
  }

  private turns(): HTMLElement[] {
    const byTurn = document.querySelectorAll<HTMLElement>(TURN_SEL);
    if (byTurn.length > 0) return Array.from(byTurn);
    return Array.from(document.querySelectorAll<HTMLElement>(TURN_FALLBACK_SEL));
  }

  private lastTurnOfRole(role: 'assistant' | 'user'): HTMLElement | null {
    const turns = this.turns();
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const attr = t.getAttribute('data-turn');
      if (attr === role) return t;
      // data-turn が無い UI 世代では内側の author-role で判定する
      if (attr === null && t.querySelector(`[data-message-author-role="${role}"]`)) return t;
    }
    // ターン構造そのものが取れない場合の最終手段
    const sel = role === 'assistant' ? ASSISTANT_SEL : USER_SEL;
    const nodes = document.querySelectorAll<HTMLElement>(sel);
    return nodes.length > 0 ? nodes[nodes.length - 1] : null;
  }

  getLatestAssistantMessage(): AssistantMessage | null {
    const turn = this.lastTurnOfRole('assistant');
    if (!turn) return null;
    const message = turn.matches(ASSISTANT_SEL)
      ? turn
      : (turn.querySelector<HTMLElement>(ASSISTANT_SEL) ?? turn);
    return { id: this.turnId(turn, message), element: message, content: this.findContentRoot(message) };
  }

  getLatestUserMessageId(): string | null {
    const turn = this.lastTurnOfRole('user');
    if (!turn) return null;
    const message = turn.matches(USER_SEL) ? turn : (turn.querySelector<HTMLElement>(USER_SEL) ?? turn);
    return this.turnId(turn, message);
  }

  /**
   * メッセージ ID。data-turn-id / data-message-id を優先し、
   * 取れない場合のみ会話パス + 出現順で代用する。
   */
  private turnId(turn: HTMLElement, message: HTMLElement): string {
    const turnId = turn.getAttribute('data-turn-id');
    if (turnId) return `turn:${turnId}`;
    const msgId = message.getAttribute('data-message-id');
    if (msgId) return `msg:${msgId}`;
    const testid = turn.getAttribute('data-testid');
    if (testid) return `${location.pathname}:${testid}`;
    const siblings = this.turns();
    return `${location.pathname}:idx-${siblings.indexOf(turn)}`;
  }

  /** 本文（markdown レンダリング結果）のルート。無ければメッセージ要素自身。 */
  private findContentRoot(el: HTMLElement): Element {
    for (const sel of CONTENT_SELECTORS) {
      const hit = el.querySelector(sel);
      if (hit) return hit;
    }
    return el;
  }

  /**
   * 生成中かどうか。停止ボタン等が取れればそれを使うが、
   * ChatGPT の UI 変更で取れなくなる可能性が高いので、
   * observer 側の「本文が増え続けているか」判定と併用する前提。
   */
  isGenerating(): boolean {
    if (document.querySelector('[data-testid="stop-button"]')) return true;
    if (document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]')) return true;
    if (document.querySelector('[class*="result-streaming"]')) return true;
    return false;
  }

  getComposer(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('#prompt-textarea') ??
      document.querySelector<HTMLElement>('[data-composer-body] [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('form [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('form textarea')
    );
  }

  probe(): { ok: boolean; detail: string } {
    const turns = this.turns().length;
    const composer = this.getComposer() !== null;
    const ok = composer || turns > 0;
    const detail = `turns=${turns} composer=${composer}`;
    if (ok) log('ChatGPT', 'probe ok', detail);
    else warn('ChatGPT', 'DOM を認識できません', detail);
    return { ok, detail };
  }
}
