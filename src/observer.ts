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
  private wasGenerating = false;

  constructor(private deps: ObserverDeps) {
    this.chunker = new SpeechChunker(deps.getChunkerOptions());
  }

  start(): void {
    const root = this.deps.adapter.getObserverRoot();
    this.lastUserMessageId = this.deps.adapter.getLatestUserMessageId();
    const latest = this.deps.adapter.getLatestAssistantMessage();
    if (latest) {
      // 起動時点で既に画面にある回答は読み上げない
      this.currentMessageId = latest.id;
      this.tracker.push(this.extract(latest.content));
    }

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

    // --- 新しい user メッセージ検出 ---
    const userId = adapter.getLatestUserMessageId();
    if (userId !== null && userId !== this.lastUserMessageId) {
      this.lastUserMessageId = userId;
      log('Observer', 'new user message', userId);
      this.deps.onNewUserMessage();
    }

    const generating = adapter.isGenerating();
    const latest = adapter.getLatestAssistantMessage();
    if (!latest) {
      this.wasGenerating = generating;
      return;
    }

    if (latest.id !== this.currentMessageId) {
      log('Observer', 'new assistant message', latest.id);
      this.currentMessageId = latest.id;
      this.tracker.reset();
      this.chunker.clear();
    }

    if (!this.deps.getEnabled()) {
      // OFF の間も本文追従だけ行い、ON にした瞬間に過去分を一気読みしない
      this.tracker.push(this.extract(latest.content));
      this.chunker.clear();
      this.wasGenerating = generating;
      return;
    }

    this.chunker.setOptions(this.deps.getChunkerOptions());

    const delta = this.tracker.push(this.extract(latest.content));
    if (delta) this.chunker.append(delta);

    const finished = this.wasGenerating && !generating;
    const chunks = this.chunker.take(finished || !generating);
    for (const c of chunks) {
      log('Chunker', 'chunk', c);
      this.deps.onChunk(c);
    }

    this.wasGenerating = generating;
  }
}
