import type { StyleOption } from './voicevox-client';

/**
 * 話者の選択 UI。
 *
 * 127 行のプルダウンを縦にスクロールする代わりに、
 * 「キャラクター → スタイル」の 2 段メニューにする（ブックマークの入れ子と同じ形）。
 * 左でキャラにマウスを乗せると、右にそのキャラのスタイルが出る。
 */

export type PickerDeps = {
  root: ShadowRoot;
  host: HTMLElement;
  loadIcon: (styleId: number) => Promise<string | null>;
  onSelect: (option: StyleOption) => void;
};

type Character = { name: string; uuid: string; styles: StyleOption[] };

export const PICKER_CSS = `
.voice { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
  border: 1px solid #ccc; border-radius: 10px; background: transparent; }
.voice:hover { background: rgba(127,127,127,.08); }
.voice .face { width: 40px; height: 40px; }
.voice .who { flex: 1; min-width: 0; line-height: 1.25; }
.voice .who b { display: block; font-size: 13px; }
.voice .who span { font-size: 11px; opacity: .75; }
.voice .caret { opacity: .6; }
.face { flex: none; width: 28px; height: 28px; border-radius: 8px; object-fit: cover;
  background: rgba(127,127,127,.15); }

.picker { position: fixed; right: 284px; bottom: 16px; z-index: 2147483001;
  width: min(460px, calc(100vw - 300px)); height: min(480px, calc(100vh - 32px));
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: #1b1b1b; border: 1px solid #d5d5d5; border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0,0,0,.22); }
.picker[hidden] { display: none; }
@media (max-width: 760px) {
  .picker { right: 16px; width: calc(100vw - 32px); }
}
.picker-head { padding: 8px; border-bottom: 1px solid rgba(128,128,128,.25); }
.search { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px;
  border: 1px solid #ccc; border-radius: 8px; }
.cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.col { overflow-y: auto; padding: 4px; }
.col + .col { border-left: 1px solid rgba(128,128,128,.25); }
.item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
  border: 0; border-radius: 8px; background: transparent; }
.item:hover, .item.active { background: rgba(127,127,127,.14); }
.item.current { font-weight: 600; }
.item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .count, .item .check { flex: none; font-size: 11px; opacity: .6; }
.empty { padding: 12px; font-size: 12px; opacity: .6; }

@media (prefers-color-scheme: dark) {
  .picker { background: #202123; color: #ececec; border-color: #3a3a3a; }
  .voice { border-color: #4a4a4a; }
  .search { background: #2b2c2f; color: #ececec; border-color: #4a4a4a; }
}
`;

export class VoicePicker {
  private trigger: HTMLButtonElement;
  private panel: HTMLDivElement;
  private search: HTMLInputElement;
  private charCol: HTMLDivElement;
  private styleCol: HTMLDivElement;

  private characters: Character[] = [];
  private selectedId: number | null = null;
  private activeChar: string | null = null;

  constructor(private deps: PickerDeps) {
    this.trigger = document.createElement('button');
    this.trigger.className = 'voice';
    this.trigger.type = 'button';
    this.trigger.innerHTML = `
      <img class="face" alt="">
      <span class="who"><b>話者を取得中…</b><span></span></span>
      <span class="caret">▾</span>`;
    this.trigger.addEventListener('click', () => this.toggle());

    this.panel = document.createElement('div');
    this.panel.className = 'picker';
    this.panel.hidden = true;
    this.panel.innerHTML = `
      <div class="picker-head">
        <input class="search" type="search" placeholder="キャラ名・スタイルで絞り込み（例: ささやき）">
      </div>
      <div class="cols"><div class="col chars"></div><div class="col styles"></div></div>`;
    this.search = this.panel.querySelector('.search')!;
    this.charCol = this.panel.querySelector('.chars')!;
    this.styleCol = this.panel.querySelector('.styles')!;

    this.search.addEventListener('input', () => this.renderCharacters());
    this.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });

    // パネルの外をクリックしたら閉じる（Shadow DOM 越しなので composedPath で判定）
    document.addEventListener(
      'mousedown',
      (e) => {
        if (this.panel.hidden) return;
        if (!e.composedPath().includes(this.deps.host)) this.close();
      },
      true,
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.panel.hidden) this.close();
    });

    this.deps.root.appendChild(this.panel);
  }

  /** パネル内に置くボタン */
  get element(): HTMLButtonElement {
    return this.trigger;
  }

  setOptions(options: StyleOption[], selectedId: number | null): void {
    const byUuid = new Map<string, Character>();
    for (const o of options) {
      let c = byUuid.get(o.speakerUuid);
      if (!c) {
        c = { name: o.speakerName, uuid: o.speakerUuid, styles: [] };
        byUuid.set(o.speakerUuid, c);
      }
      c.styles.push(o);
    }
    this.characters = Array.from(byUuid.values());
    this.setSelected(selectedId);
  }

  setSelected(styleId: number | null): void {
    this.selectedId = styleId;
    const opt = this.find(styleId);
    const face = this.trigger.querySelector<HTMLImageElement>('.face')!;
    const name = this.trigger.querySelector('.who b')!;
    const style = this.trigger.querySelector('.who span')!;

    if (!opt) {
      name.textContent = this.characters.length ? '話者を選んでください' : '話者なし';
      style.textContent = '';
      face.removeAttribute('src');
      return;
    }
    name.textContent = opt.speakerName;
    style.textContent = opt.styleName;
    this.setIcon(face, opt.styleId);
  }

  private find(styleId: number | null): StyleOption | undefined {
    if (styleId === null) return undefined;
    for (const c of this.characters) {
      const hit = c.styles.find((s) => s.styleId === styleId);
      if (hit) return hit;
    }
    return undefined;
  }

  private toggle(): void {
    if (this.panel.hidden) this.open();
    else this.close();
  }

  private open(): void {
    if (this.characters.length === 0) return;
    this.panel.hidden = false;
    this.search.value = '';
    this.activeChar = this.find(this.selectedId)?.speakerUuid ?? this.characters[0].uuid;
    this.renderCharacters();
    this.charCol.querySelector<HTMLElement>('.item.active')?.scrollIntoView?.({ block: 'center' });
    this.search.focus();
  }

  close(): void {
    this.panel.hidden = true;
  }

  private matches(c: Character, q: string): StyleOption[] | null {
    if (!q) return c.styles;
    if (c.name.includes(q)) return c.styles;
    const styles = c.styles.filter((s) => s.styleName.includes(q));
    return styles.length ? styles : null;
  }

  private renderCharacters(): void {
    const q = this.search.value.trim();
    this.charCol.textContent = '';
    const visible = this.characters.filter((c) => this.matches(c, q) !== null);

    if (visible.length === 0) {
      this.charCol.innerHTML = '<div class="empty">見つかりません</div>';
      this.styleCol.textContent = '';
      return;
    }
    if (!visible.some((c) => c.uuid === this.activeChar)) this.activeChar = visible[0].uuid;

    const current = this.find(this.selectedId);
    for (const c of visible) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      if (c.uuid === this.activeChar) btn.classList.add('active');
      if (current?.speakerUuid === c.uuid) btn.classList.add('current');
      btn.innerHTML = `<img class="face" alt=""><span class="label"></span><span class="count"></span>`;
      btn.querySelector('.label')!.textContent = c.name;
      btn.querySelector('.count')!.textContent = c.styles.length > 1 ? `${c.styles.length} ›` : '';
      this.setIcon(btn.querySelector('.face')!, c.styles[0].styleId);

      // ブックマークメニューと同じく、乗せただけで右にスタイルを出す
      const activate = () => {
        if (this.activeChar === c.uuid) return;
        this.activeChar = c.uuid;
        this.charCol.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
        btn.classList.add('active');
        this.renderStyles(c, q);
      };
      btn.addEventListener('mouseenter', activate);
      btn.addEventListener('focus', activate);
      // スタイルが 1 つしかないキャラは、左をクリックしただけで決定
      btn.addEventListener('click', () => {
        activate();
        if (c.styles.length === 1) this.choose(c.styles[0]);
      });
      this.charCol.appendChild(btn);
    }

    const active = visible.find((c) => c.uuid === this.activeChar)!;
    this.renderStyles(active, q);
  }

  private renderStyles(c: Character, q: string): void {
    this.styleCol.textContent = '';
    const styles = this.matches(c, q) ?? c.styles;
    for (const s of styles) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item';
      if (s.styleId === this.selectedId) btn.classList.add('current');
      btn.innerHTML = `<img class="face" alt=""><span class="label"></span><span class="check"></span>`;
      btn.querySelector('.label')!.textContent = s.styleName;
      btn.querySelector('.check')!.textContent = s.styleId === this.selectedId ? '✓' : '';
      this.setIcon(btn.querySelector('.face')!, s.styleId);
      btn.addEventListener('click', () => this.choose(s));
      this.styleCol.appendChild(btn);
    }
  }

  private choose(opt: StyleOption): void {
    this.close();
    this.setSelected(opt.styleId);
    this.deps.onSelect(opt);
  }

  private setIcon(img: HTMLImageElement, styleId: number): void {
    img.dataset.styleId = String(styleId);
    void this.deps.loadIcon(styleId).then((url) => {
      // 取得中に別のキャラへ切り替わっていたら上書きしない
      if (url && img.dataset.styleId === String(styleId)) img.src = url;
    });
  }
}
