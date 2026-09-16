/**
 * 過去の回答を「これを読んで」と指定するための小さなボタンを、
 * 各 assistant ターンへ差し込む。
 *
 * ChatGPT 側の DOM はできるだけ触らない。
 * - 追加するのは自前の属性を持つ <button> 1つだけ
 * - スタイルは自前の <style> を head へ 1回入れるだけで、
 *   ChatGPT のクラスや既存要素には一切手を入れない
 * - position を触るのは、その要素が static のときだけ
 */

const BTN_ATTR = 'data-cvb-read-btn';
const MARK_ATTR = 'data-cvb-actions';
const STYLE_ID = 'cvb-actions-style';

const CSS = `
[${BTN_ATTR}] {
  position: absolute; top: 6px; right: 6px; z-index: 50;
  font: 11px/1 -apple-system, "Hiragino Sans", sans-serif;
  padding: 4px 8px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.45);
  background: rgba(127,127,127,.15); color: inherit;
  opacity: 0; transition: opacity .12s ease;
}
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
 * assistant ターンそれぞれへ読み上げボタンを用意する（既にあるものは触らない）。
 * 毎 tick 呼ばれるので冪等であること。
 */
export function syncReadButtons(
  turns: HTMLElement[],
  onRead: (turn: HTMLElement) => void,
): void {
  ensureStyle();
  for (const turn of turns) {
    if (turn.hasAttribute(MARK_ATTR)) continue;
    turn.setAttribute(MARK_ATTR, '');

    if (getComputedStyle(turn).position === 'static') turn.style.position = 'relative';

    const btn = document.createElement('button');
    btn.setAttribute(BTN_ATTR, '');
    btn.type = 'button';
    btn.textContent = '🔊 この回答を読む';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onRead(turn);
    });
    turn.appendChild(btn);
  }
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
