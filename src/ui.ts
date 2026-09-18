import type { Settings } from './settings';
import type { StyleOption } from './voicevox-client';

export type UiCallbacks = {
  onToggleEnabled: (v: boolean) => void;
  onStop: () => void;
  onReconnect: () => void;
  onTestSpeak: () => void;
  onSpeakSelection: () => void;
  onChange: (patch: Partial<Settings>) => void;
};

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 260px; font: 12px/1.5 -apple-system, "Hiragino Sans", sans-serif;
  color: #1b1b1b; background: #fff; border: 1px solid #d5d5d5;
  border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden;
}
@media (prefers-color-scheme: dark) {
  .panel { color: #ececec; background: #202123; border-color: #3a3a3a; }
  select, input[type=number] { color: #ececec; background: #2b2c2f; border-color: #4a4a4a; }
  .btn { background: #2b2c2f; border-color: #4a4a4a; color: #ececec; }
}
.head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid rgba(128,128,128,.25); cursor: pointer; }
.title { font-weight: 600; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #999; flex: none; }
.dot.connected { background: #22c55e; }
.dot.connecting { background: #eab308; }
.dot.disconnected { background: #9ca3af; }
.body { padding: 8px 10px; display: grid; gap: 7px; }
.body.hidden { display: none; }
.row { display: flex; align-items: center; gap: 6px; }
.row > label { flex: none; opacity: .8; }
select, input[type=number] { flex: 1; min-width: 0; font: inherit; padding: 2px 4px;
  border: 1px solid #ccc; border-radius: 6px; background: #fff; color: inherit; }
input[type=range] { flex: 1; min-width: 0; }
.btn { flex: 1; font: inherit; padding: 4px 6px; border: 1px solid #ccc;
  border-radius: 7px; background: #f6f6f6; cursor: pointer; color: inherit; }
.btn:hover { filter: brightness(.96); }
.btn.on { background: #22c55e; border-color: #22c55e; color: #fff; }
.btn.stop { background: #ef4444; border-color: #ef4444; color: #fff; }
.status { font-size: 11px; opacity: .8; min-height: 15px; }
.status.err { color: #ef4444; opacity: 1; }
.val { flex: none; width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; opacity: .8; font-size: 11px; }
.chk { display: flex; align-items: center; gap: 5px; font-size: 11px; }
`;

export class UiPanel {
  private host: HTMLDivElement;
  private root: ShadowRoot;
  private el!: Record<string, HTMLElement>;
  private collapsed = false;

  constructor(
    private settings: Settings,
    private cb: UiCallbacks,
  ) {
    this.host = document.createElement('div');
    this.host.id = 'chatgpt-voicevox-bridge-root';
    this.root = this.host.attachShadow({ mode: 'open' });
    this.render();
    document.body.appendChild(this.host);
  }

  private render(): void {
    const style = document.createElement('style');
    style.textContent = CSS;

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="head" part="head">
        <span class="dot disconnected" id="dot"></span>
        <span class="title">🐇 VOICEVOX</span>
        <span id="conn" style="font-size:11px;opacity:.75">未接続</span>
      </div>
      <div class="body" id="body">
        <div class="row">
          <select id="speaker"><option value="">話者を取得中…</option></select>
        </div>
        <div class="row">
          <label>話速</label>
          <input type="range" id="speed" min="0.5" max="2" step="0.05">
          <span class="val" id="speedVal"></span>
        </div>
        <div class="row">
          <label>音量</label>
          <input type="range" id="volume" min="0" max="2" step="0.05">
          <span class="val" id="volumeVal"></span>
        </div>
        <div class="row" title="文と文の間の無音。小さいほど箇条書きの移りが速くなります">
          <label>文間</label>
          <input type="range" id="gap" min="0" max="0.3" step="0.01">
          <span class="val" id="gapVal"></span>
        </div>
        <div class="row">
          <button class="btn" id="toggle">🔊 ON</button>
          <button class="btn stop" id="stop">■ STOP</button>
        </div>
        <div class="row">
          <button class="btn" id="speakSel" title="ページ上で選択した部分だけを読み上げます">
            🔈 選択した部分を読む
          </button>
        </div>
        <div class="status" id="status"></div>
        <details>
          <summary>詳細設定</summary>
          <div class="body" style="padding:6px 0 0">
            <div class="row"><label>コード</label>
              <select id="codeMode">
                <option value="skip">読まない</option>
                <option value="announce">あることだけ伝える</option>
                <option value="read">読む</option>
              </select></div>
            <div class="row"><label>URL</label>
              <select id="urlMode">
                <option value="skip">読まない</option>
                <option value="announce">あることだけ伝える</option>
                <option value="read">読む</option>
              </select></div>
            <div class="row"><label>表</label>
              <select id="tableMode">
                <option value="skip">読まない</option>
                <option value="announce">あることだけ伝える</option>
                <option value="read">読む</option>
              </select></div>
            <label class="chk" title="ファイル名やパスの中の _ - . / を読み上げます">
              <input type="checkbox" id="readSymbols">記号を読む（_ - . /）</label>
            <label class="chk"><input type="checkbox" id="stopOnNew">新しい質問で読み上げ停止</label>
            <label class="chk"><input type="checkbox" id="debug">デバッグログ</label>
            <div class="row">
              <button class="btn" id="test">テスト発声</button>
              <button class="btn" id="reconnect">再接続</button>
            </div>
          </div>
        </details>
      </div>`;

    this.root.append(style, panel);

    const q = <T extends HTMLElement>(id: string) => this.root.getElementById(id) as T;
    this.el = {
      dot: q('dot'), conn: q('conn'), body: q('body'), speaker: q('speaker'),
      speed: q('speed'), speedVal: q('speedVal'), volume: q('volume'),
      volumeVal: q('volumeVal'), gap: q('gap'), gapVal: q('gapVal'),
      toggle: q('toggle'), stop: q('stop'),
      status: q('status'), codeMode: q('codeMode'), urlMode: q('urlMode'),
      tableMode: q('tableMode'), stopOnNew: q('stopOnNew'), debug: q('debug'),
      readSymbols: q('readSymbols'),
      test: q('test'), reconnect: q('reconnect'), speakSel: q('speakSel'),
    };

    this.root.querySelector('.head')!.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.el.body.classList.toggle('hidden', this.collapsed);
    });

    this.el.toggle.addEventListener('click', () => this.cb.onToggleEnabled(!this.settings.enabled));
    this.el.stop.addEventListener('click', () => this.cb.onStop());
    this.el.test.addEventListener('click', () => this.cb.onTestSpeak());
    // mousedown で選択が消える環境があるため、押す前の選択を保持する
    this.el.speakSel.addEventListener('mousedown', (e) => e.preventDefault());
    this.el.speakSel.addEventListener('click', () => this.cb.onSpeakSelection());
    this.el.reconnect.addEventListener('click', () => this.cb.onReconnect());

    (this.el.speaker as HTMLSelectElement).addEventListener('change', (e) => {
      const sel = e.target as HTMLSelectElement;
      this.cb.onChange({
        styleId: Number(sel.value),
        speakerLabel: sel.options[sel.selectedIndex].text,
      });
    });

    const range = (key: 'speedScale' | 'volumeScale', input: HTMLElement, out: HTMLElement): void => {
      input.addEventListener('input', () => {
        const v = Number((input as HTMLInputElement).value);
        out.textContent = v.toFixed(2);
        this.cb.onChange({ [key]: v } as Partial<Settings>);
      });
    };
    range('speedScale', this.el.speed, this.el.speedVal);
    range('volumeScale', this.el.volume, this.el.volumeVal);

    // 「文間」は postPhonemeLength（チャンク末尾の無音）を直接動かす
    this.el.gap.addEventListener('input', () => {
      const v = Number((this.el.gap as HTMLInputElement).value);
      this.el.gapVal.textContent = v.toFixed(2);
      this.cb.onChange({ postPhonemeLength: v });
    });

    for (const key of ['codeMode', 'urlMode', 'tableMode'] as const) {
      this.el[key].addEventListener('change', (e) => {
        this.cb.onChange({ [key]: (e.target as HTMLSelectElement).value } as Partial<Settings>);
      });
    }
    this.el.readSymbols.addEventListener('change', (e) => {
      this.cb.onChange({ readSymbols: (e.target as HTMLInputElement).checked });
    });
    this.el.stopOnNew.addEventListener('change', (e) => {
      this.cb.onChange({ stopOnNewQuestion: (e.target as HTMLInputElement).checked });
    });
    this.el.debug.addEventListener('change', (e) => {
      this.cb.onChange({ debug: (e.target as HTMLInputElement).checked });
    });
  }

  setSettings(s: Settings): void {
    this.settings = s;
    (this.el.speed as HTMLInputElement).value = String(s.speedScale);
    this.el.speedVal.textContent = s.speedScale.toFixed(2);
    (this.el.volume as HTMLInputElement).value = String(s.volumeScale);
    this.el.volumeVal.textContent = s.volumeScale.toFixed(2);
    (this.el.gap as HTMLInputElement).value = String(s.postPhonemeLength);
    this.el.gapVal.textContent = s.postPhonemeLength.toFixed(2);
    (this.el.codeMode as HTMLSelectElement).value = s.codeMode;
    (this.el.urlMode as HTMLSelectElement).value = s.urlMode;
    (this.el.tableMode as HTMLSelectElement).value = s.tableMode;
    (this.el.readSymbols as HTMLInputElement).checked = s.readSymbols;
    (this.el.stopOnNew as HTMLInputElement).checked = s.stopOnNewQuestion;
    (this.el.debug as HTMLInputElement).checked = s.debug;
    this.el.toggle.textContent = s.enabled ? '🔊 ON' : '🔇 OFF';
    this.el.toggle.classList.toggle('on', s.enabled);
    if (s.styleId !== null) (this.el.speaker as HTMLSelectElement).value = String(s.styleId);
  }

  setSpeakers(options: StyleOption[], selectedId: number | null): void {
    const sel = this.el.speaker as HTMLSelectElement;
    sel.innerHTML = '';
    if (options.length === 0) {
      sel.innerHTML = '<option value="">話者なし</option>';
      return;
    }
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = String(o.styleId);
      opt.textContent = o.label;
      sel.appendChild(opt);
    }
    if (selectedId !== null) sel.value = String(selectedId);
  }

  setConnection(state: ConnectionState, text: string): void {
    this.el.dot.className = `dot ${state}`;
    this.el.conn.textContent = text;
  }

  setStatus(text: string, isError = false): void {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('err', isError);
  }

  /**
   * ChatGPT は SPA なので、ページ遷移で body ごと作り直されると
   * パネルが DOM から外れて消える。外れていたら付け直す。
   */
  ensureMounted(): void {
    if (!document.body.contains(this.host)) {
      document.body.appendChild(this.host);
    }
  }

  destroy(): void {
    this.host.remove();
  }
}
