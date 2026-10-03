import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoicePicker, pushRecent } from '../src/voice-picker';
import type { StyleOption } from '../src/voicevox-client';

const opt = (styleId: number, speakerName: string, uuid: string, styleName: string): StyleOption => ({
  styleId,
  speakerName,
  speakerUuid: uuid,
  styleName,
  label: `${speakerName} / ${styleName}`,
});

const OPTIONS: StyleOption[] = [
  opt(2, '四国めたん', 'u-metan', 'ノーマル'),
  opt(36, '四国めたん', 'u-metan', 'ささやき'),
  opt(3, 'ずんだもん', 'u-zunda', 'ノーマル'),
  opt(22, 'ずんだもん', 'u-zunda', 'ささやき'),
  opt(8, '春日部つむぎ', 'u-tsumugi', 'ノーマル'),
  opt(16, '九州そら', 'u-sora', 'ノーマル'),
];

function setup(selected: number | null = 16) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  const onSelect = vi.fn();
  const onFavoritesChange = vi.fn();
  const onCollapsedChange = vi.fn();
  const loadIcon = vi.fn(async (id: number) => `blob:icon-${id}`);
  const picker = new VoicePicker({
    root, host, loadIcon, onSelect, onFavoritesChange, onCollapsedChange,
  });
  root.appendChild(picker.element);
  picker.setOptions(OPTIONS, selected);
  const panel = root.querySelector<HTMLElement>('.picker')!;
  // キャラの行（「最近使った」の行や見出しは含まない）
  const chars = () =>
    Array.from(root.querySelectorAll('.chars .item[data-kind="char"] .label')).map((e) => e.textContent);
  const recent = () =>
    Array.from(root.querySelectorAll('.chars .item[data-kind="recent"]')).map(
      (e) => `${e.querySelector('.label')!.textContent}/${e.querySelector('.sub')!.textContent}`,
    );
  const groups = () =>
    Array.from(root.querySelectorAll('.chars .group .t')).map((e) => e.textContent);
  const groupBtn = (key: string) =>
    root.querySelector<HTMLElement>(`.chars .group[data-group="${key}"]`)!;
  const charRow = (name: string) =>
    Array.from(root.querySelectorAll<HTMLElement>('.chars .item[data-kind="char"]')).find((b) =>
      b.textContent!.includes(name),
    )!;
  const styles = () =>
    Array.from(root.querySelectorAll('.styles .item .label')).map((e) => e.textContent);
  return {
    root, picker, panel, onSelect, onFavoritesChange, onCollapsedChange, loadIcon,
    chars, styles, recent, groups, groupBtn, charRow,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('VoicePicker', () => {
  it('groups 6 styles into 4 characters', () => {
    const { picker, chars } = setup();
    picker.element.click();
    expect(chars()).toEqual(['四国めたん', 'ずんだもん', '春日部つむぎ', '九州そら']);
  });

  it('opens on the currently selected character', () => {
    const { picker, root, styles } = setup(22);
    picker.element.click();
    expect(root.querySelector('.chars .item[data-kind="char"].active .label')!.textContent).toBe('ずんだもん');
    expect(styles()).toEqual(['ノーマル', 'ささやき']);
  });

  it('shows the styles of a character on hover (cascading menu)', () => {
    const { picker, root, styles } = setup(16);
    picker.element.click();
    const metan = Array.from(root.querySelectorAll<HTMLElement>('.chars .item[data-kind="char"]')).find(
      (b) => b.textContent!.includes('四国めたん'),
    )!;
    metan.dispatchEvent(new MouseEvent('mouseenter'));
    expect(styles()).toEqual(['ノーマル', 'ささやき']);
  });

  it('selects a style and closes', () => {
    const { picker, root, panel, onSelect } = setup(16);
    picker.element.click();
    const metan = Array.from(root.querySelectorAll<HTMLElement>('.chars .item[data-kind="char"]')).find(
      (b) => b.textContent!.includes('四国めたん'),
    )!;
    metan.dispatchEvent(new MouseEvent('mouseenter'));
    const whisper = Array.from(root.querySelectorAll<HTMLElement>('.styles .item')).find(
      (b) => b.textContent!.includes('ささやき'),
    )!;
    whisper.click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ styleId: 36 }));
    expect(panel.hidden).toBe(true);
    expect(picker.element.textContent).toContain('四国めたん');
    expect(picker.element.textContent).toContain('ささやき');
  });

  it('picks a single-style character with one click on the left', () => {
    const { picker, root, onSelect } = setup(16);
    picker.element.click();
    const tsumugi = Array.from(root.querySelectorAll<HTMLElement>('.chars .item[data-kind="char"]')).find(
      (b) => b.textContent!.includes('春日部つむぎ'),
    )!;
    tsumugi.click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ styleId: 8 }));
  });

  it('filters by style name across characters', () => {
    const { picker, root, chars, styles } = setup(16);
    picker.element.click();
    const search = root.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ささやき';
    search.dispatchEvent(new Event('input'));
    expect(chars()).toEqual(['四国めたん', 'ずんだもん']);
    expect(styles()).toEqual(['ささやき']);
  });

  it('filters by character name', () => {
    const { picker, root, chars } = setup(16);
    picker.element.click();
    const search = root.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ずんだ';
    search.dispatchEvent(new Event('input'));
    expect(chars()).toEqual(['ずんだもん']);
  });

  it('shows the current character face on the trigger button', async () => {
    const { picker, loadIcon } = setup(16);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadIcon).toHaveBeenCalledWith(16);
    expect(picker.element.querySelector<HTMLImageElement>('.face')!.src).toBe('blob:icon-16');
  });

  it('closes with Escape', () => {
    const { picker, panel } = setup();
    picker.element.click();
    expect(panel.hidden).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.hidden).toBe(true);
  });
});

describe('pushRecent', () => {
  it('puts the chosen style first without duplicates', () => {
    expect(pushRecent([3, 2, 8], 2)).toEqual([2, 3, 8]);
  });
  it('keeps at most 5', () => {
    expect(pushRecent([1, 2, 3, 4, 5], 6)).toEqual([6, 1, 2, 3, 4]);
  });
});

describe('VoicePicker 最近使った・お気に入り', () => {
  it('shows the current style under 最近使った even before anything is recorded', () => {
    const { picker, recent, groups } = setup(16);
    picker.element.click();
    expect(groups()).toEqual(['最近使った', 'すべてのキャラ']);
    expect(recent()).toEqual(['九州そら/ノーマル']);
  });

  it('lists recent styles newest first, with the current one on top', () => {
    const { picker, recent } = setup(16);
    picker.setPrefs([36, 3], []);
    picker.element.click();
    expect(recent()).toEqual(['九州そら/ノーマル', '四国めたん/ささやき', 'ずんだもん/ノーマル']);
  });

  it('selects a recent style with one click', () => {
    const { picker, root, onSelect, panel } = setup(16);
    picker.setPrefs([36], []);
    picker.element.click();
    const row = root.querySelector<HTMLElement>('.item[data-kind="recent"][data-style-id="36"]')!;
    row.click();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ styleId: 36 }));
    expect(panel.hidden).toBe(true);
  });

  it('shows the styles of a recent character on hover', () => {
    const { picker, root, styles } = setup(16);
    picker.setPrefs([36], []);
    picker.element.click();
    root
      .querySelector<HTMLElement>('.item[data-kind="recent"][data-style-id="36"]')!
      .dispatchEvent(new MouseEvent('mouseenter'));
    expect(styles()).toEqual(['ノーマル', 'ささやき']);
  });

  it('adds a favorite with the star and moves it above the full list', () => {
    const { picker, charRow, groups, chars, onFavoritesChange, onSelect } = setup(16);
    picker.element.click();
    (charRow('ずんだもん').querySelector('[data-star]') as HTMLElement).click();

    expect(onFavoritesChange).toHaveBeenCalledWith(['u-zunda']);
    // 星を押しただけでは話者は変わらない
    expect(onSelect).not.toHaveBeenCalled();
    expect(groups()).toEqual(['最近使った', '★ お気に入り', 'すべてのキャラ']);
    // お気に入りが先頭、すべてのキャラからは外れる
    expect(chars()).toEqual(['ずんだもん', '四国めたん', '春日部つむぎ', '九州そら']);
    expect(charRow('ずんだもん').querySelector('.star')!.textContent).toBe('★');
  });

  it('removes a favorite with the star', () => {
    const { picker, charRow, groups, onFavoritesChange } = setup(16);
    picker.setPrefs([], ['u-zunda']);
    picker.element.click();
    (charRow('ずんだもん').querySelector('[data-star]') as HTMLElement).click();
    expect(onFavoritesChange).toHaveBeenCalledWith([]);
    expect(groups()).toEqual(['最近使った', 'すべてのキャラ']);
  });

  it('ignores remembered styles or favorites that no longer exist in the engine', () => {
    const { picker, recent, groups } = setup(16);
    picker.setPrefs([999, 36], ['u-gone']);
    picker.element.click();
    expect(recent()).toEqual(['九州そら/ノーマル', '四国めたん/ささやき']);
    expect(groups()).toEqual(['最近使った', 'すべてのキャラ']);
  });

  it('hides the sections while searching', () => {
    const { picker, root, groups, recent, chars } = setup(16);
    picker.setPrefs([36], ['u-zunda']);
    picker.element.click();
    const search = root.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ささやき';
    search.dispatchEvent(new Event('input'));
    expect(groups()).toEqual([]);
    expect(recent()).toEqual([]);
    expect(chars()).toEqual(['四国めたん', 'ずんだもん']);
  });
});

describe('VoicePicker 区分を畳む', () => {
  it('collapses すべてのキャラ by clicking its heading and reports it', () => {
    const { picker, groupBtn, chars, recent, onCollapsedChange } = setup(16);
    picker.setPrefs([36], ['u-zunda']);
    picker.element.click();
    groupBtn('all').click();

    expect(onCollapsedChange).toHaveBeenCalledWith(['all']);
    // お気に入りだけが残り、すべてのキャラは隠れる
    expect(chars()).toEqual(['ずんだもん']);
    expect(recent()).toEqual(['九州そら/ノーマル', '四国めたん/ささやき']);
    // 畳んだ見出しには件数が出る
    expect(groupBtn('all').textContent).toContain('（3）');
    expect(groupBtn('all').getAttribute('aria-expanded')).toBe('false');
  });

  it('opens it again with a second click', () => {
    const { picker, groupBtn, chars, onCollapsedChange } = setup(16);
    picker.setPrefs([], [], ['all']);
    picker.element.click();
    expect(chars()).toEqual([]);
    groupBtn('all').click();
    expect(onCollapsedChange).toHaveBeenLastCalledWith([]);
    expect(chars()).toEqual(['四国めたん', 'ずんだもん', '春日部つむぎ', '九州そら']);
  });

  it('remembers the collapsed state across reopening', () => {
    const { picker, chars } = setup(16);
    picker.setPrefs([], [], ['all']);
    picker.element.click();
    picker.close();
    picker.element.click();
    expect(chars()).toEqual([]);
  });

  it('can collapse 最近使った too', () => {
    const { picker, groupBtn, recent } = setup(16);
    picker.setPrefs([36, 3], []);
    picker.element.click();
    groupBtn('recent').click();
    expect(recent()).toEqual([]);
    expect(groupBtn('recent').textContent).toContain('（3）');
  });

  it('ignores collapsing while searching so matches are never hidden', () => {
    const { picker, root, chars } = setup(16);
    picker.setPrefs([], [], ['all', 'favorites']);
    picker.element.click();
    const search = root.querySelector<HTMLInputElement>('.search')!;
    search.value = 'ずんだ';
    search.dispatchEvent(new Event('input'));
    expect(chars()).toEqual(['ずんだもん']);
  });
});

describe('VoicePicker 質問用の小さいボタン', () => {
  function make(deps: { emptyLabel?: string; compact?: boolean; onOpen?: () => void }) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    const picker = new VoicePicker({
      root,
      host,
      loadIcon: async () => null,
      onSelect: () => {},
      onFavoritesChange: () => {},
      onCollapsedChange: () => {},
      ...deps,
    });
    root.appendChild(picker.element);
    picker.setOptions(OPTIONS, null);
    return { picker, panel: root.querySelector<HTMLElement>('.picker')! };
  }

  it('shows its own wording while nothing is chosen', () => {
    const { picker } = make({ emptyLabel: '回答と同じ声', compact: true });
    expect(picker.element.querySelector('.who b')!.textContent).toBe('回答と同じ声');
    expect(picker.element.classList.contains('compact')).toBe(true);
    picker.setSelected(3);
    expect(picker.element.querySelector('.who b')!.textContent).toBe('ずんだもん');
  });

  it('keeps the default wording and size when not asked otherwise', () => {
    const { picker } = make({});
    expect(picker.element.querySelector('.who b')!.textContent).toBe('話者を選んでください');
    expect(picker.element.classList.contains('compact')).toBe(false);
  });

  it('tells the owner when it opens, so the other menu can be closed', () => {
    const onOpen = vi.fn();
    const { picker, panel } = make({ onOpen });
    picker.element.click();
    expect(panel.hidden).toBe(false);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
