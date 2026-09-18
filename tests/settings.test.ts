import { describe, it, expect, beforeEach } from 'vitest';
import { loadSettings, saveSettings, migrate, DEFAULT_SETTINGS } from '../src/settings';

beforeEach(() => localStorage.clear());

describe('設定の移行', () => {
  it('v1 の「毎回伝える」を「最初の1回だけ」へ寄せる', () => {
    expect(migrate({ codeMode: 'announce' }).codeMode).toBe('announce-once');
  });

  it('意図して選んだ他の値は変えない', () => {
    expect(migrate({ codeMode: 'read' }).codeMode).toBe('read');
    expect(migrate({ codeMode: 'skip' }).codeMode).toBe('skip');
  });

  it('v1 の保存内容を読み込んで移行し、v2 として保存し直す', () => {
    localStorage.setItem(
      'cvb.settings.v1',
      JSON.stringify({ codeMode: 'announce', styleId: 61, speedScale: 1.3 }),
    );
    const s = loadSettings();
    expect(s.codeMode).toBe('announce-once');
    expect(s.styleId).toBe(61);
    expect(s.speedScale).toBe(1.3);
    expect(JSON.parse(localStorage.getItem('cvb.settings.v2')!).codeMode).toBe('announce-once');
  });

  it('v2 があれば v1 は見ない', () => {
    localStorage.setItem('cvb.settings.v1', JSON.stringify({ codeMode: 'announce' }));
    localStorage.setItem('cvb.settings.v2', JSON.stringify({ codeMode: 'announce' }));
    expect(loadSettings().codeMode).toBe('announce');
  });

  it('保存が無ければ既定値を返す', () => {
    expect(loadSettings().codeMode).toBe(DEFAULT_SETTINGS.codeMode);
  });

  it('壊れた内容でも落ちない', () => {
    localStorage.setItem('cvb.settings.v2', '{壊れている');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('保存した内容を読み戻せる', () => {
    saveSettings({ ...DEFAULT_SETTINGS, speedScale: 1.5 });
    expect(loadSettings().speedScale).toBe(1.5);
  });
});
