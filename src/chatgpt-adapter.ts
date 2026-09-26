import { log, warn } from './logger';

/**
 * ChatGPT Web の DOM 依存を全てこのモジュールへ隔離する。
 * UI 変更時はここだけを直せばよい。生成CSSクラス名には依存しない。
 *
 * 2 世代の構造に対応している。新しいほうを優先して探す。
 *
 * ■ 2026-09-26 に実機で確認した構造（新）
 *   <div data-content-search-turn-key="<ターン>">        ← 最初は fallback-turn-N、後で UUID に差し替わる
 *     <div data-content-search-unit-key="<ターン>:0:user">
 *     <div data-content-search-unit-key="<ターン>:2:assistant"
 *          data-chatgpt-search-message-ids="<回答ID> ...">
 *       <div data-chatgpt-selection-message-id="<回答ID>">
 *         <div data-markdown-text-style="assistant-message">  ← 本文
 *   旧来の data-turn / data-message-author-role は一切無い。
 *   質問側にはメッセージ ID が付いていない。
 *
 * ■ 2026-09-15 に確認した構造（旧）
 *   <section data-turn="assistant" data-turn-id="<uuid>">
 *     <div data-message-author-role="assistant" data-message-id="<uuid>">
 *       <div class="... markdown prose ...">
 */

export type AssistantMessage = {
  id: string;
  element: HTMLElement;
  content: Element;
};

type Role = 'assistant' | 'user';

const UNIT_SEL = '[data-content-search-unit-key]';
const TURN_SEL = '[data-turn]';
const TURN_FALLBACK_SEL = '[data-testid^="conversation-turn-"]';
const ASSISTANT_SEL = '[data-message-author-role="assistant"]';
const USER_SEL = '[data-message-author-role="user"]';
const CONTENT_SELECTORS = [
  '[data-markdown-text-style="assistant-message"]',
  '.markdown',
  '[class*="markdown"]',
  '.prose',
  '[class*="prose"]',
];

/** 新構造の発言単位の役割。unit-key の末尾（…:assistant / …:user）で判定する */
function unitRole(el: Element): Role | null {
  const key = el.getAttribute('data-content-search-unit-key') ?? '';
  if (key.endsWith(':assistant')) return 'assistant';
  if (key.endsWith(':user')) return 'user';
  return null;
}

/** 質問の同一性を本文で表す。新構造では質問に ID が無く、ターンの鍵も途中で差し替わるため */
function textKey(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

export class ChatGptAdapter {
  getObserverRoot(): HTMLElement {
    const main = document.querySelector('main');
    return (main as HTMLElement | null) ?? document.body;
  }

  /** 新構造の発言単位。無ければ空配列 */
  private units(role: Role): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(UNIT_SEL)).filter(
      (u) => unitRole(u) === role,
    );
  }

  /** assistant の発言を出現順に全部返す（任意の回答を指定して読ませる用） */
  assistantTurns(): HTMLElement[] {
    const units = this.units('assistant');
    if (units.length > 0) return units;
    return this.legacyTurns().filter(
      (t) =>
        t.getAttribute('data-turn') === 'assistant' ||
        (t.getAttribute('data-turn') === null && t.querySelector(ASSISTANT_SEL) !== null),
    );
  }

  /** 発言から本文要素を取り出す */
  contentOfTurn(turn: HTMLElement): Element {
    return this.findContentRoot(this.messageOf(turn, 'assistant'));
  }

  getLatestAssistantMessage(): AssistantMessage | null {
    const units = this.units('assistant');
    if (units.length > 0) {
      const unit = units[units.length - 1];
      return {
        id: this.unitMessageId(unit, units.length - 1),
        element: unit,
        content: this.findContentRoot(unit),
      };
    }

    const turn = this.lastLegacyTurn('assistant');
    if (!turn) return null;
    const message = this.messageOf(turn, 'assistant');
    return { id: this.legacyTurnId(turn, message), element: message, content: this.findContentRoot(message) };
  }

  getLatestUserMessageId(): string | null {
    const units = this.units('user');
    if (units.length > 0) {
      const text = textKey(units[units.length - 1]);
      return text ? `user:${text}` : null;
    }

    const turn = this.lastLegacyTurn('user');
    if (!turn) return null;
    return this.legacyTurnId(turn, this.messageOf(turn, 'user'));
  }

  /**
   * 新構造の回答 ID。メッセージ ID を最優先する。
   * ターンの鍵（unit-key）は fallback-turn-N → UUID と途中で変わるので使わない。
   */
  private unitMessageId(unit: HTMLElement, index: number): string {
    const ids = unit.getAttribute('data-chatgpt-search-message-ids')?.trim();
    if (ids) return `msg:${ids.split(/\s+/)[0]}`;
    const sel = unit.querySelector('[data-chatgpt-selection-message-id]');
    const selId = sel?.getAttribute('data-chatgpt-selection-message-id');
    if (selId) return `msg:${selId}`;
    return `${location.pathname}:assistant-${index}`;
  }

  private messageOf(turn: HTMLElement, role: Role): HTMLElement {
    const sel = role === 'assistant' ? ASSISTANT_SEL : USER_SEL;
    return turn.matches(sel) ? turn : (turn.querySelector<HTMLElement>(sel) ?? turn);
  }

  // ---- 旧構造 ----

  private legacyTurns(): HTMLElement[] {
    const byTurn = document.querySelectorAll<HTMLElement>(TURN_SEL);
    if (byTurn.length > 0) return Array.from(byTurn);
    return Array.from(document.querySelectorAll<HTMLElement>(TURN_FALLBACK_SEL));
  }

  private lastLegacyTurn(role: Role): HTMLElement | null {
    const turns = this.legacyTurns();
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const attr = t.getAttribute('data-turn');
      if (attr === role) return t;
      if (attr === null && t.querySelector(`[data-message-author-role="${role}"]`)) return t;
    }
    const sel = role === 'assistant' ? ASSISTANT_SEL : USER_SEL;
    const nodes = document.querySelectorAll<HTMLElement>(sel);
    return nodes.length > 0 ? nodes[nodes.length - 1] : null;
  }

  private legacyTurnId(turn: HTMLElement, message: HTMLElement): string {
    const turnId = turn.getAttribute('data-turn-id');
    if (turnId) return `turn:${turnId}`;
    const msgId = message.getAttribute('data-message-id');
    if (msgId) return `msg:${msgId}`;
    const testid = turn.getAttribute('data-testid');
    if (testid) return `${location.pathname}:${testid}`;
    return `${location.pathname}:idx-${this.legacyTurns().indexOf(turn)}`;
  }

  /** 本文（markdown レンダリング結果）のルート。無ければ要素自身。 */
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
      document.querySelector<HTMLElement>('[data-composer-body] [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('#prompt-textarea') ??
      document.querySelector<HTMLElement>('form [contenteditable="true"]') ??
      document.querySelector<HTMLElement>('form textarea')
    );
  }

  /**
   * 質問の送信操作を検出する。「読み上げを解禁してよい」の一番確かな根拠。
   *
   * ChatGPT 側がイベントを止めても拾えるよう、capture で document に付ける。
   * 日本語入力の変換確定の Enter（isComposing）は送信ではないので除外する。
   */
  onSubmit(cb: () => void): void {
    const inComposer = (t: EventTarget | null): boolean => {
      if (!(t instanceof Element)) return false;
      const composer = this.getComposer();
      return composer !== null && (composer === t || composer.contains(t));
    };
    const hasText = (): boolean => (this.getComposer()?.textContent ?? '').trim().length > 0;

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
        if (!inComposer(e.target) || !hasText()) return;
        cb();
      },
      true,
    );
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.closest('[data-testid="send-button"], button[aria-label*="送信"], button[aria-label*="Send"]')) {
          cb();
        }
      },
      true,
    );
  }

  probe(): { ok: boolean; detail: string } {
    const turns = document.querySelectorAll(UNIT_SEL).length + this.legacyTurns().length;
    const composer = this.getComposer() !== null;
    const ok = composer || turns > 0;
    const detail = `turns=${turns} composer=${composer}`;
    if (ok) log('ChatGPT', 'probe ok', detail);
    else warn('ChatGPT', 'DOM を認識できません', detail);
    return { ok, detail };
  }
}
