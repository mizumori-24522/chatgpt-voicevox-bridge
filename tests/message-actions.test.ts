import { describe, it, expect, beforeEach, vi } from 'vitest';
import { syncReadButtons, removeReadButtons } from '../src/message-actions';

const BTN = '[data-cvb-read-btn]';

function turns(n: number): HTMLElement[] {
  document.body.innerHTML = Array.from({ length: n }, (_, i) => `<div class="turn" id="t${i}"><p>本文</p></div>`).join('');
  return Array.from(document.querySelectorAll<HTMLElement>('.turn'));
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
});

describe('syncReadButtons', () => {
  it('adds one button per turn and stays idempotent', () => {
    const list = turns(2);
    syncReadButtons(list, 'answer', () => {});
    syncReadButtons(list, 'answer', () => {});
    expect(document.querySelectorAll(BTN)).toHaveLength(2);
    expect(document.querySelectorAll('#cvb-actions-style')).toHaveLength(1);
  });

  it('labels answers and questions differently and puts them on opposite sides', () => {
    const [answer, question] = turns(2);
    syncReadButtons([answer], 'answer', () => {});
    syncReadButtons([question], 'question', () => {});
    expect(answer.querySelector(BTN)!.textContent).toBe('🔊 この回答を読む');
    expect(answer.querySelector(BTN)!.getAttribute('data-cvb-read-btn')).toBe('answer');
    expect(question.querySelector(BTN)!.textContent).toBe('🔊 この質問を読む');
    expect(question.querySelector(BTN)!.getAttribute('data-cvb-read-btn')).toBe('question');

    // 本文に重ねない：回答は上の空きの中央、質問は吹き出しの下のボタン列の左
    const css = document.getElementById('cvb-actions-style')!.textContent!;
    expect(css).toMatch(/\[data-cvb-read-btn="answer"\]\s*\{\s*top:\s*-24px;\s*left:\s*50%/);
    expect(css).toMatch(/\[data-cvb-read-btn="question"\]\s*\{\s*bottom:/);
  });

  it('calls back with the turn that was clicked', () => {
    const list = turns(2);
    const onRead = vi.fn();
    syncReadButtons(list, 'question', onRead);
    list[1].querySelector<HTMLElement>(BTN)!.click();
    expect(onRead).toHaveBeenCalledTimes(1);
    expect(onRead).toHaveBeenCalledWith(list[1]);
  });

  it('puts the button back when the site re-renders the turn and drops it', () => {
    const list = turns(1);
    syncReadButtons(list, 'answer', () => {});
    list[0].querySelector(BTN)!.remove();
    syncReadButtons(list, 'answer', () => {});
    expect(list[0].querySelectorAll(BTN)).toHaveLength(1);
  });

  it('removeReadButtons clears everything', () => {
    const list = turns(2);
    syncReadButtons(list, 'answer', () => {});
    removeReadButtons();
    expect(document.querySelectorAll(BTN)).toHaveLength(0);
    expect(document.querySelectorAll('[data-cvb-actions]')).toHaveLength(0);
  });

  it('moves the question button next to the site\'s own buttons when they can be measured', () => {
    const [turn] = turns(1);
    turn.innerHTML = '<div data-user-message-bubble="true"><button id="in-bubble">中</button></div><button id="copy">コピー</button><button id="edit">編集</button>';
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    turn.getBoundingClientRect = () => rect(600, 100, 800, 190);
    turn.querySelector<HTMLElement>('#in-bubble')!.getBoundingClientRect = () => rect(900, 110, 30, 30);
    turn.querySelector<HTMLElement>('#copy')!.getBoundingClientRect = () => rect(1300, 254, 32, 32);
    turn.querySelector<HTMLElement>('#edit')!.getBoundingClientRect = () => rect(1364, 254, 32, 32);

    syncReadButtons([turn], 'question', () => {});
    const btn = turn.querySelector<HTMLElement>(BTN)!;
    // 右端 1400 から、いちばん左のボタン 1300 の手前（6px 空ける）まで
    expect(btn.style.right).toBe('106px');
    expect(btn.style.bottom).not.toBe('');
  });

  it('leaves the answer button to the stylesheet', () => {
    const [turn] = turns(1);
    syncReadButtons([turn], 'answer', () => {});
    expect(turn.querySelector<HTMLElement>(BTN)!.style.right).toBe('');
  });
});
