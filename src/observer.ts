import { ChatGptAdapter } from './chatgpt-adapter';
import { StreamTracker } from './text-diff';
import { SpeechChunker } from './chunker';
import { extractSpeechText, type SanitizeOptions } from './speech-sanitizer';
import type { ChunkerOptions } from './chunker';
import { log } from './logger';

export type ObserverDeps = {
  adapter: ChatGptAdapter;
  getEnabled: () => boolean;
  getSanitizeOptions: () => SanitizeOptions;
  getChunkerOptions: () => ChunkerOptions;
  onChunk: (text: string) => void;
  onNewUserMessage: () => void;
};

const TICK_MS = 200;
/**
 * 本文の増加が止まってからこの時間が経てば「生成完了」とみなし、
 * 残りバッファを吐き出す。停止ボタンの検出に失敗しても
 * 読み上げが尻切れにならないための保険。
 */
const SETTLE_MS = 1200;

/** URL から会話 ID を取り出す。新規チャット（/）など会話未確定なら null */
export function conversationKey(pathname: string): string | null {
  const m = pathname.match(/\/c\/([^/]+)/);
  return m ? m[1] : null;
}

/**
 * DOM の変化を監視し、正規化した「新しく増えた本文」だけをチャンク化して流す。
 * mutation をそのまま TTS へ渡さない。
 */
export class ChatObserver {
  private mo: MutationObserver | null = null;
  private timer: number | null = null;
  private scheduled = false;

  private currentMessageId: string | null = null;
  private tracker = new StreamTracker();
  private chunker: SpeechChunker;
  private lastUserMessageId: string | null = null;
  private lastDeltaAt = 0;
  /**
   * 「今から現れる回答は読み上げてよい」状態か。
   *
   * ChatGPT の会話は仮想化されており、ページを開き直しただけでも
   * 質問と回答が「後から DOM に現れる」ため、出現だけでは新規と区別できない。
   * 解禁するのは次のいずれかを観測したときだけ:
   *   1. 送信操作そのもの（notifySubmitted）
   *   2. 同じ会話の中で質問が増えた
   *   3. 生成中
   * 解禁は回答 1 つを読み始めたら使い切る。
   */
  private armed = false;
  /**
   * 今の回答を読み上げ中か（読み始めてから読み切るまで）。
   *
   * ChatGPT は生成中に回答ターンの ID を差し替えることがある
   * （仮の枠 → 本物の ID、新規チャットで URL が確定したときの再描画など）。
   * 解禁は最初の ID で使い切っているので、これが無いと差し替え後の
   * 回答を「前からある回答」とみなして黙ってしまう。
   */
  private live = false;
  /** 今の回答を最後まで読み切ったか */
  private finished = false;
  /** lastUserMessageId をどの会話で記録したか。会話が変わったら基準を捨てる。 */
  private conversationPath = location.pathname;

  constructor(private deps: ObserverDeps) {
    this.chunker = new SpeechChunker(deps.getChunkerOptions());
  }

  /** 入力欄での送信操作を検出したときに呼ぶ */
  notifySubmitted(): void {
    this.armed = true;
    this.live = false;
    log('Observer', '送信を検出');
    this.deps.onNewUserMessage();
  }

  start(): void {
    const root = this.deps.adapter.getObserverRoot();
    this.lastUserMessageId = this.deps.adapter.getLatestUserMessageId();

    this.mo = new MutationObserver(() => this.schedule());
    this.mo.observe(root, { childList: true, subtree: true, characterData: true });
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    log('Observer', 'started');
  }

  stop(): void {
    this.mo?.disconnect();
    this.mo = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** 読み上げ中断時に、未確定バッファも破棄する */
  resetBuffers(): void {
    this.chunker.clear();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.tick();
    });
  }

  private extract(content: Element): string {
    return extractSpeechText(content, this.deps.getSanitizeOptions());
  }

  private tick(): void {
    const adapter = this.deps.adapter;

    // --- 会話の切り替え検出（SPA 遷移・新規チャットの URL 確定） ---
    if (location.pathname !== this.conversationPath) {
      const prevKey = conversationKey(this.conversationPath);
      this.conversationPath = location.pathname;
      // 別の会話で記録した「最後の質問」は基準にならない。
      // ここを捨てないと、遷移先の過去の質問を「新しい質問」と誤認する。
      this.lastUserMessageId = null;
      if (prevKey !== null && prevKey !== conversationKey(location.pathname)) {
        // 本当に別の会話へ移った。送信直後でも、移動先の回答は読まない。
        this.armed = false;
        this.live = false;
        log('Observer', '会話が切り替わった', location.pathname);
      } else {
        // 新規チャットで送信した直後に URL が確定しただけ。解禁は維持する。
        log('Observer', '新規チャットの URL が確定', location.pathname);
      }
    }

    // --- 新しい user メッセージ検出 ---
    const userId = adapter.getLatestUserMessageId();
    if (userId !== null && userId !== this.lastUserMessageId) {
      const known = this.lastUserMessageId !== null;
      this.lastUserMessageId = userId;
      if (known) {
        // 同じ会話の中で質問が増えた = 本当に送られた
        this.armed = true;
        this.live = false;
        log('Observer', 'new user message', userId);
        this.deps.onNewUserMessage();
      } else {
        // 基準が無い状態で現れた質問 = 描画されただけの過去の質問
        log('Observer', '既存の質問を基準として記録', userId);
      }
    }

    const generating = adapter.isGenerating();
    if (generating) this.armed = true;
    const latest = adapter.getLatestAssistantMessage();
    if (!latest) return;

    if (latest.id !== this.currentMessageId) {
      const prevId = this.currentMessageId;
      this.currentMessageId = latest.id;

      if (this.live && this.isContinuation(this.extract(latest.content))) {
        // 読み上げ中の回答の ID が差し替わっただけ。続きから読み続ける。
        log('Observer', '回答の ID が差し替わった（続きから読む）', prevId, '→', latest.id);
      } else {
        this.beginMessage(latest);
        if (!this.live) return;
      }
    }

    if (!this.deps.getEnabled()) {
      // OFF の間も本文追従だけ行い、ON にした瞬間に過去分を一気読みしない
      this.tracker.push(this.extract(latest.content));
      this.chunker.clear();
      return;
    }

    const text = this.extract(latest.content);
    // 再描画の一瞬だけ本文が空になることがある。ここで追従すると
    // 消費済み位置が 0 に戻り、頭から読み直してしまう。
    if (text === '' && this.tracker.consumedLength > 0) return;

    const delta = this.tracker.push(text);
    if (!this.live) {
      // 黙って取り込んだ回答が、その後も伸び続けている = 実は生成中だった
      // （送信も生成中も検出できなかった場合の保険）。読み切った回答は対象外。
      if (!delta || this.finished) return;
      this.live = true;
      log('Observer', '取り込み済みの回答が伸びたので読み始める', latest.id);
    }

    this.chunker.setOptions(this.deps.getChunkerOptions());
    if (delta) {
      this.chunker.append(delta);
      this.lastDeltaAt = Date.now();
    }

    const settled = Date.now() - this.lastDeltaAt >= SETTLE_MS;
    const done = !generating && settled;
    const chunks = this.chunker.take(done);
    for (const c of chunks) {
      log('Chunker', 'chunk', c);
      this.deps.onChunk(c);
    }
    // 本文が出始める前（思考中など）は、止まって見えても終わりではない
    if (done && this.tracker.consumedLength > 0) {
      this.live = false;
      this.finished = true;
      log('Observer', '回答を読み切った', latest.id);
    }
  }

  /** 差し替え後の本文が、今読んでいる本文の続きとみなせるか */
  private isContinuation(text: string): boolean {
    const tracked = this.tracker.text;
    return text === '' || text.startsWith(tracked) || tracked.startsWith(text);
  }

  /** 別の回答に切り替わった。解禁されていれば読み始め、そうでなければ黙って取り込む。 */
  private beginMessage(latest: { id: string; content: Element }): void {
    this.finished = false;
    this.tracker.reset();
    this.chunker.clear();
    this.lastDeltaAt = Date.now();

    if (!this.armed) {
      // 質問もしていないのに現れた回答 = 前から存在したもの。
      // 読み上げず、本文だけ取り込んで追従する。
      this.live = false;
      this.tracker.push(this.extract(latest.content));
      log('Observer', '既存の回答として無言で取り込み', latest.id);
      return;
    }
    log('Observer', 'new assistant message', latest.id);
    // 解禁はこの回答で使い切る。別の会話へ移っても読み続けないため。
    this.armed = false;
    this.live = true;
  }
}
