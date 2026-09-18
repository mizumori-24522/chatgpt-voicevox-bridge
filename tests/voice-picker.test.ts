import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VoicePicker } from '../src/voice-picker';
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
  const loadIcon = vi.fn(async (id: number) => `blob:icon-${id}`);
  const picker = new VoicePicker({ root, host, loadIcon, onSelect });
  root.appendChild(picker.element);
  picker.setOptions(OPTIONS, selected);
  const panel = root.querySelector<HTMLElement>('.picker')!;
  const chars = () =>
    Array.from(root.querySelectorAll('.chars .item .label')).map((e) => e.textContent);
  const styles = () =>
    Array.from(root.querySelectorAll('.styles .item .label')).map((e) => e.textContent);
  return { root, picker, panel, onSelect, loadIcon, chars, styles };
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
    expect(root.querySelector('.chars .item.active .label')!.textContent).toBe('ずんだもん');
    expect(styles()).toEqual(['ノーマル', 'ささやき']);
  });

  it('shows the styles of a character on hover (cascading menu)', () => {
    const { picker, root, styles } = setup(16);
    picker.element.click();
    const metan = Array.from(root.querySelectorAll<HTMLElement>('.chars .item')).find(
      (b) => b.textContent!.includes('四国めたん'),
    )!;
    metan.dispatchEvent(new MouseEvent('mouseenter'));
    expect(styles()).toEqual(['ノーマル', 'ささやき']);
  });

  it('selects a style and closes', () => {
    const { picker, root, panel, onSelect } = setup(16);
    picker.element.click();
    const metan = Array.from(root.querySelectorAll<HTMLElement>('.chars .item')).find(
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
    const tsumugi = Array.from(root.querySelectorAll<HTMLElement>('.chars .item')).find(
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
