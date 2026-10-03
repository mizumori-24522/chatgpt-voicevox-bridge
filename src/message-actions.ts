/**
 * 過去の発言を「これを読んで」と指定するための小さなボタンを、
 * 各回答と各質問へ差し込む。
 *
 * ChatGPT 側の DOM はできるだけ触らない。
 * - 追加するのは自前の属性を持つ <button> 1つだけ
 * - スタイルは自前の <style> を head へ 1回入れるだけで、
 *   ChatGPT のクラスや既存要素には一切手を入れない
 * - position を触るのは、その要素が static のときだけ
 *
 * ボタンは本文に重ねない。1行目の文字と被って読めなくなるため。
 * - 回答: 回答のすぐ上の空きの中央。左には「◯秒考えました」などの表示、
 *   右には直前の質問のボタン列（コピー・編集）が来るので、どちらも避ける
 * - 質問: 吹き出しの下、ChatGPT 自身のボタン列（コピー・共有・編集）のすぐ左。
 *   吹き出しは overflow: hidden で、上には添付画像が来るので、そこには置けない
 * 位置は 2026-10-04 に実物の chatgpt.com で確かめた。
 */

export type ReadButtonKind = 'answer' | 'question';

const BTN_ATTR = 'data-cvb-read-btn';
const MARK_ATTR = 'data-cvb-actions';
const STYLE_ID = 'cvb-actions-style';

const LABELS: Record<ReadButtonKind, string> = {
  answer: '🔊 この回答を読む',
  question: '🔊 この質問を読む',
};

const CSS = `
[${BTN_ATTR}] {
  position: absolute; z-index: 50;
  box-sizing: border-box; height: 22px; padding: 0 8px;
  display: inline-flex; align-items: center; white-space: nowrap;
  font: 11px/1 -apple-system, "Hiragino Sans", sans-serif;
  border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.45);
  background: rgba(127,127,127,.15); color: inherit;
  opacity: 0; transition: opacity .12s ease;
}
[${BTN_ATTR}="answer"] { top: -24px; left: 50%; transform: translateX(-50%); }
/* ChatGPT のボタン列の位置が測れないときの置き場所。測れたら alignQuestionButton が上書きする */
[${BTN_ATTR}="question"] { bottom: 5px; right: 104px; }
/* 回答のボタンは枠の外にあるので、回答からボタンへマウスを動かす途中で消えないよう隙間を埋める */
[${BTN_ATTR}="answer"]::after { content: ""; position: absolute; left: 0; right: 0; top: 100%; height: 4px; }
[${MARK_ATTR}]:hover > [${BTN_ATTR}],
[${BTN_ATTR}]:focus-visible { opacity: 1; }
[${BTN_ATTR}]:hover { background: rgba(34,197,94,.25); border-color: rgba(34,197,94,.7); }
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * 発言それぞれへ読み上げボタンを用意する（既にあるものは触らない）。
 * 毎 tick 呼ばれるので冪等であること。
 */
export function syncReadButtons(
  turns: HTMLElement[],
  kind: ReadButtonKind,
  onRead: (turn: HTMLElement) => void,
): void {
  ensureStyle();
  for (const turn of turns) {
    // 印だけ残ってボタンが消えていることがある（ChatGPT 側の再描画）。ボタンの有無で判断する。
    const existing = turn.querySelector<HTMLElement>(`:scope > [${BTN_ATTR}]`);
    if (existing) {
      if (kind === 'question') alignQuestionButton(turn, existing);
      continue;
    }
    turn.setAttribute(MARK_ATTR, '');

    if (getComputedStyle(turn).position === 'static') turn.style.position = 'relative';

    const btn = document.createElement('button');
    btn.setAttribute(BTN_ATTR, kind);
    btn.type = 'button';
    btn.textContent = LABELS[kind];
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRead(turn);
    });
    turn.appendChild(btn);
    if (kind === 'question') alignQuestionButton(turn, btn);
  }
}

/**
 * 質問のボタンを、ChatGPT 自身のボタン列（コピー・共有・編集）のすぐ左へ寄せる。
 * ボタン列の数や幅は変わりうるので、決め打ちにせず毎回測る。
 */
function alignQuestionButton(turn: HTMLElement, btn: HTMLElement): void {
  const natives = Array.from(turn.querySelectorAll('button'))
    .filter((b) => b !== btn && b.closest('[data-user-message-bubble]') === null)
    .map((b) => b.getBoundingClientRect())
    .filter((r) => r.width > 0);
  if (natives.length === 0) return;
  const box = turn.getBoundingClientRect();
  const left = Math.min(...natives.map((r) => r.left));
  const row = natives[0];
  btn.style.right = `${Math.round(box.right - left + 6)}px`;
  btn.style.bottom = `${Math.round(box.bottom - row.bottom + (row.height - btn.offsetHeight) / 2)}px`;
}

/** 差し込んだものを全部取り除く（読み上げ OFF 時など） */
export function removeReadButtons(): void {
  document.querySelectorAll(`[${BTN_ATTR}]`).forEach((b) => b.remove());
  document.querySelectorAll(`[${MARK_ATTR}]`).forEach((t) => t.removeAttribute(MARK_ATTR));
}

/** 現在マウスで選択されている範囲を、要素ごと取り出す */
export function getSelectionFragment(): DocumentFragment | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  return sel.getRangeAt(0).cloneContents();
}
