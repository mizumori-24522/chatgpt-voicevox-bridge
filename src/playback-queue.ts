import type { SynthesisParams, VoicevoxClient } from './voicevox-client';
import { describeError } from './voicevox-client';
import { AbortError } from './http';
import { log, warn } from './logger';

export type QueueDeps = {
  client: VoicevoxClient;
  getStyleId: () => number | null;
  getParams: () => SynthesisParams;
  onError: (message: string) => void;
  onStateChange: (state: PlaybackSnapshot) => void;
};

export type PlaybackSnapshot = {
  queued: number;
  speaking: boolean;
};

/**
 * テキスト → 合成 → 再生 を 1 本ずつ直列に処理するキュー。
 * 同時再生・音声の重なりを構造的に起こさない。
 */
export class PlaybackQueue {
  private textQueue: string[] = [];
  private running = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private abortController: AbortController | null = null;
  /** stopAll のたびに増やす。古い非同期処理は世代が違えば破棄する。 */
  private generation = 0;

  constructor(private deps: QueueDeps) {}

  enqueue(text: string): void {
    const t = text.trim();
    if (!t) return;
    this.textQueue.push(t);
    log('Playback', 'enqueue', t.slice(0, 40));
    this.emit();
    void this.pump();
  }

  stopAll(): void {
    this.generation++;
    this.textQueue = [];
    this.abortController?.abort();
    this.abortController = null;
    this.teardownAudio();
    this.running = false;
    log('Playback', 'stopAll');
    this.emit();
  }

  get snapshot(): PlaybackSnapshot {
    return { queued: this.textQueue.length, speaking: this.currentAudio !== null };
  }

  private emit(): void {
    this.deps.onStateChange(this.snapshot);
  }

  private teardownAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const gen = this.generation;

    try {
      while (this.textQueue.length > 0 && gen === this.generation) {
        const text = this.textQueue.shift()!;
        this.emit();

        const styleId = this.deps.getStyleId();
        if (styleId === null) {
          this.deps.onError('話者が選択されていません');
          this.textQueue = [];
          break;
        }

        let wav: ArrayBuffer;
        this.abortController = new AbortController();
        try {
          wav = await this.deps.client.synthesize(
            text,
            styleId,
            this.deps.getParams(),
            this.abortController.signal,
          );
        } catch (e) {
          if (e instanceof AbortError || gen !== this.generation) break;
          warn('Playback', 'synthesis failed', e);
          this.deps.onError(describeError(e));
          this.textQueue = [];
          break;
        } finally {
          this.abortController = null;
        }

        if (gen !== this.generation) break;
        await this.play(wav, gen);
      }
    } finally {
      this.running = false;
      this.emit();
      // stopAll 以外で新しい要素が積まれていたら継続する
      if (gen === this.generation && this.textQueue.length > 0) void this.pump();
    }
  }

  private play(wav: ArrayBuffer, gen: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (gen !== this.generation) return resolve();

      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const audio = new Audio(url);
      this.currentAudio = audio;
      this.currentUrl = url;
      this.emit();

      const finish = () => {
        if (this.currentAudio === audio) this.teardownAudio();
        else URL.revokeObjectURL(url);
        this.emit();
        resolve();
      };

      audio.onended = finish;
      audio.onerror = () => {
        warn('Playback', 'audio playback failed');
        this.deps.onError('音声の再生に失敗しました');
        finish();
      };

      audio.play().catch((e) => {
        warn('Playback', 'play() rejected', e);
        this.deps.onError('再生がブロックされました。ページを一度クリックしてください');
        finish();
      });
    });
  }
}
