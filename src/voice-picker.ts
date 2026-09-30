import type { StyleOption } from './voicevox-client';

/**
 * 話者の選択 UI。
 *
 * 127 行のプルダウンを縦にスクロールする代わりに、
 * 「キャラクター → スタイル」の 2 段メニューにする（ブックマークの入れ子と同じ形）。
 * 左でキャラにマウスを乗せると、右にそのキャラのスタイルが出る。
 *
 * 左の列は上から「最近使った」「★ お気に入り」「すべてのキャラ」。
 * 43 人全員を使うことはまず無いので、よく使う話者に 1 クリックで届くようにする。
 */

export type PickerDeps = {
  root: ShadowRoot;
  host: HTMLElement;
  loadIcon: (styleId: number) => Promise<string | null>;
  onSelect: (option: StyleOption) => void;
  /** お気に入りの付け外し。引数は変更後のお気に入り（キャラの UUID）一覧 */
  onFavoritesChange: (favorites: string[]) => void;
  /** 区分の開け閉め。引数は変更後の「畳んでいる区分」一覧 */
  onCollapsedChange: (collapsed: PickerGroup[]) => void;
};

/** 左の列の区分 */
export type PickerGroup = 'recent' | 'favorites' | 'all';

/** 「最近使った」に並べる数 */
export const RECENT_LIMIT = 5;

/** 選んだスタイルを「最近使った」の先頭へ入れる（重複は除き、上限を超えたら古いものから落とす） */
export function pushRecent(list: number[], styleId: number, limit = RECENT_LIMIT): number[] {
  return [styleId, ...list.filter((id) => id !== styleId)].slice(0, limit);
}

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
  width: min(460px, calc(100vw - 300px));
  /* 区分を畳んだときは中身に合わせて縮む。広がるのは最大 480px まで */
  max-height: min(480px, calc(100vh - 32px));
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
.cols { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
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
.group { display: flex; align-items: center; gap: 4px; width: 100%; padding: 8px 6px 3px;
  font: inherit; font-size: 11px; font-weight: 600; letter-spacing: .02em; text-align: left;
  color: inherit; opacity: .55; border: 0; background: transparent; cursor: pointer; }
.group:hover { opacity: .9; }
.group:first-child { padding-top: 2px; }
.group .arrow { display: inline-block; width: 10px; transition: transform .12s ease; }
.group.collapsed .arrow { transform: rotate(-90deg); }
.group .n { font-weight: 400; opacity: .8; }
.item .sub { flex: none; max-width: 45%; font-size: 11px; opacity: .6;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.star { flex: none; width: 18px; text-align: center; font-size: 13px; line-height: 1;
  opacity: 0; color: #d4a017; cursor: pointer; }
.item:hover .star, .star.on { opacity: 1; }
.star:not(.on) { color: inherit; }
.item:hover .star:not(.on) { opacity: .45; }
.star:hover { opacity: 1 !important; transform: scale(1.15); }

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
  private recent: number[] = [];
  private favorites: string[] = [];
  private collapsed: PickerGroup[] = [];

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

  /** 「最近使った」（スタイル ID）・「お気に入り」（キャラの UUID）・畳んでいる区分を渡す */
  setPrefs(recent: number[], favorites: string[], collapsed: PickerGroup[] = []): void {
    this.recent = recent;
    this.favorites = favorites;
    this.collapsed = collapsed;
    if (!this.panel.hidden) this.renderCharacters();
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
    // 「最近使った」が一番上にあるので、スクロールは先頭のまま
    this.charCol.scrollTop = 0;
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

  /** 今使っているスタイルを先頭にした「最近使った」の中身 */
  private recentOptions(): StyleOption[] {
    const ids = this.selectedId === null ? this.recent : pushRecent(this.recent, this.selectedId);
    return ids.map((id) => this.find(id)).filter((o): o is StyleOption => o !== undefined);
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

    if (q) {
      // 絞り込み中は、区分けせずに当てはまるキャラだけを並べる
      for (const c of visible) this.charCol.appendChild(this.characterRow(c, q));
    } else {
      const recent = this.recentOptions();
      if (recent.length > 0) {
        this.charCol.appendChild(this.groupTitle('recent', '最近使った', recent.length));
        if (!this.isCollapsed('recent')) {
          for (const o of recent) this.charCol.appendChild(this.recentRow(o));
        }
      }

      const favs = this.favorites
        .map((uuid) => this.characters.find((c) => c.uuid === uuid))
        .filter((c): c is Character => c !== undefined);
      if (favs.length > 0) {
        this.charCol.appendChild(this.groupTitle('favorites', '★ お気に入り', favs.length));
        if (!this.isCollapsed('favorites')) {
          for (const c of favs) this.charCol.appendChild(this.characterRow(c, q));
        }
      }

      const rest = this.characters.filter((c) => !this.favorites.includes(c.uuid));
      this.charCol.appendChild(this.groupTitle('all', 'すべてのキャラ', rest.length));
      if (!this.isCollapsed('all')) {
        for (const c of rest) this.charCol.appendChild(this.characterRow(c, q));
      }
    }

    const active = visible.find((c) => c.uuid === this.activeChar)!;
    this.renderStyles(active, q);
  }

  private isCollapsed(group: PickerGroup): boolean {
    return this.collapsed.includes(group);
  }

  /** 区分の見出し。押すとその区分を畳む／開く */
  private groupTitle(group: PickerGroup, text: string, count: number): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'group';
    el.dataset.group = group;
    const collapsed = this.isCollapsed(group);
    el.classList.toggle('collapsed', collapsed);
    el.setAttribute('aria-expanded', String(!collapsed));
    el.innerHTML = `<span class="arrow">▾</span><span class="t"></span><span class="n"></span>`;
    el.querySelector('.t')!.textContent = text;
    // 畳んでいるときだけ件数を出す（開いていれば見れば分かる）
    el.querySelector('.n')!.textContent = collapsed ? `（${count}）` : '';
    el.addEventListener('click', () => this.toggleGroup(group));
    return el;
  }

  private toggleGroup(group: PickerGroup): void {
    this.collapsed = this.isCollapsed(group)
      ? this.collapsed.filter((g) => g !== group)
      : [...this.collapsed, group];
    const scroll = this.charCol.scrollTop;
    this.renderCharacters();
    this.charCol.scrollTop = scroll;
    this.deps.onCollapsedChange(this.collapsed);
  }

  /** 左の列を「このキャラが選ばれている」表示にし、右にスタイルを出す */
  private activate(c: Character, row: HTMLElement, q: string): void {
    this.charCol.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
    row.classList.add('active');
    if (this.activeChar === c.uuid) return;
    this.activeChar = c.uuid;
    this.renderStyles(c, q);
  }

  /** 「最近使った」の行。スタイル単位で、押せばその場で決定 */
  private recentRow(o: StyleOption): HTMLButtonElement {
    const c = this.characters.find((ch) => ch.uuid === o.speakerUuid)!;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.dataset.kind = 'recent';
    btn.dataset.styleId = String(o.styleId);
    if (o.styleId === this.selectedId) btn.classList.add('current');
    btn.innerHTML = `<img class="face" alt=""><span class="label"></span><span class="sub"></span>`;
    btn.querySelector('.label')!.textContent = o.speakerName;
    btn.querySelector('.sub')!.textContent = o.styleName;
    this.setIcon(btn.querySelector('.face')!, o.styleId);
    btn.addEventListener('mouseenter', () => this.activate(c, btn, ''));
    btn.addEventListener('focus', () => this.activate(c, btn, ''));
    btn.addEventListener('click', () => this.choose(o));
    return btn;
  }

  /** キャラの行。乗せると右にスタイル、☆ でお気に入りの付け外し */
  private characterRow(c: Character, q: string): HTMLButtonElement {
    const current = this.find(this.selectedId);
    const fav = this.favorites.includes(c.uuid);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'item';
    btn.dataset.kind = 'char';
    btn.dataset.uuid = c.uuid;
    if (c.uuid === this.activeChar) btn.classList.add('active');
    if (current?.speakerUuid === c.uuid) btn.classList.add('current');
    btn.innerHTML =
      `<img class="face" alt=""><span class="label"></span>` +
      `<span class="count"></span><span class="star" data-star role="button"></span>`;
    btn.querySelector('.label')!.textContent = c.name;
    btn.querySelector('.count')!.textContent = c.styles.length > 1 ? `${c.styles.length} ›` : '';
    const star = btn.querySelector<HTMLElement>('.star')!;
    star.textContent = fav ? '★' : '☆';
    star.classList.toggle('on', fav);
    star.title = fav ? 'お気に入りから外す' : 'お気に入りに追加';
    this.setIcon(btn.querySelector('.face')!, c.styles[0].styleId);

    // ブックマークメニューと同じく、乗せただけで右にスタイルを出す
    btn.addEventListener('mouseenter', () => this.activate(c, btn, q));
    btn.addEventListener('focus', () => this.activate(c, btn, q));
    btn.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[data-star]')) {
        e.preventDefault();
        this.toggleFavorite(c.uuid);
        return;
      }
      this.activate(c, btn, q);
      // スタイルが 1 つしかないキャラは、左をクリックしただけで決定
      if (c.styles.length === 1) this.choose(c.styles[0]);
    });
    return btn;
  }

  private toggleFavorite(uuid: string): void {
    const next = this.favorites.includes(uuid)
      ? this.favorites.filter((u) => u !== uuid)
      : [...this.favorites, uuid];
    this.favorites = next;
    const scroll = this.charCol.scrollTop;
    this.renderCharacters();
    this.charCol.scrollTop = scroll;
    this.deps.onFavoritesChange(next);
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
