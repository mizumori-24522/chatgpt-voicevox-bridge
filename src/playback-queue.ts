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
  /** 一時停止中か */
  paused: boolean;
  /** 読んでいる途中の文も、これから読む文も無い */
  idle: boolean;
};

/** 再生中に先読み合成しておくチャンク数。文と文の間の無音をなくすための肝。 */
const LOOKAHEAD = 2;
/** notify の取りこぼしで固まらないための保険 */
const WAIT_TIMEOUT_MS = 150;

/**
 * テキスト → 合成 → 再生 のパイプライン。
 *
 * 合成ループと再生ループを分けてあるので、ある文を喋っている間に
 * 次の文の合成が進む。再生は常に 1 本だけで、音声は重ならない。
 */
export class PlaybackQueue {
  private textQueue: { text: string; styleId?: number }[] = [];
  private audioQueue: ArrayBuffer[] = [];
  private synthRunning = false;
  private playRunning = false;
  private currentAudio: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  /** 今の文を読み終えたことにして次へ進む。再開に失敗したときに使う */
  private finishCurrent: (() => void) | null = null;
  private paused = false;
  private abortController: AbortController | null = null;
  private waiters: (() => void)[] = [];
  /** stopAll のたびに増やす。世代が違う非同期処理は破棄する。 */
  private generation = 0;

  constructor(private deps: QueueDeps) {}

  /** styleId を渡すと、そのチャンクだけ指定の話者で読む（省略時は今選んでいる話者） */
  enqueue(text: string, styleId?: number): void {
    const t = text.trim();
    if (!t) return;
    this.textQueue.push({ text: t, styleId });
    log('Playback', 'enqueue', t.slice(0, 40));
    this.notify();
    this.emit();
    void this.synthLoop();
    void this.playLoop();
  }

  /**
   * 一時停止。今の文はその場で止め、続きは resume まで流さない。
   * 止めている間に増えた文（生成中の回答の続きなど）も貯めておき、再開したら続けて読む。
   * 何も読んでいないときは何もしない。止めたまま忘れて、次の回答が黙ってしまうのを防ぐため。
   */
  pause(): void {
    if (this.paused || this.isIdle()) return;
    this.paused = true;
    this.currentAudio?.pause();
    log('Playback', 'pause');
    this.emit();
  }

  /** 一時停止を解いて、止めた位置から続きを読む */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    log('Playback', 'resume');
    const audio = this.currentAudio;
    if (audio) {
      audio.play().catch((e) => {
        if (this.paused || this.currentAudio !== audio) return;
        warn('Playback', 'resume rejected', e);
        this.deps.onError('再生がブロックされました。ページを一度クリックしてください');
        this.finishCurrent?.();
      });
    }
    this.notify();
    this.emit();
    void this.playLoop();
  }

  /** 止める・読み直す・新しい質問では、一時停止も解く（新しく読むものが黙らないように） */
  stopAll(): void {
    this.generation++;
    this.paused = false;
    this.textQueue = [];
    this.audioQueue = [];
    this.abortController?.abort();
    this.abortController = null;
    this.teardownAudio();
    this.synthRunning = false;
    this.playRunning = false;
    this.notify();
    log('Playback', 'stopAll');
    this.emit();
  }

  get snapshot(): PlaybackSnapshot {
    return {
      queued: this.textQueue.length + this.audioQueue.length,
      speaking: this.currentAudio !== null,
      paused: this.paused,
      idle: this.isIdle(),
    };
  }

  private isIdle(): boolean {
    return (
      this.currentAudio === null &&
      !this.synthRunning &&
      !this.playRunning &&
      this.textQueue.length === 0 &&
      this.audioQueue.length === 0
    );
  }

  private emit(): void {
    this.deps.onStateChange(this.snapshot);
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  private wait(): Promise<void> {
    return new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this.waiters.push(finish);
      setTimeout(finish, WAIT_TIMEOUT_MS);
    });
  }

  private teardownAudio(): void {
    if (this.currentAudio) {
      this.currentAudio.onended = null;
      this.currentAudio.onerror = null;
      this.currentAudio.pause();
      this.currentAudio.src = '';
      this.currentAudio = null;
    }
    this.finishCurrent = null;
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }
  }

  /** 先読みしながらテキストを音声へ変換し続ける */
  private async synthLoop(): Promise<void> {
    if (this.synthRunning) return;
    this.synthRunning = true;
    const gen = this.generation;

    try {
      while (gen === this.generation) {
        if (this.textQueue.length === 0) break;

        if (this.audioQueue.length >= LOOKAHEAD) {
          await this.wait();
          continue;
        }

        const styleId = this.textQueue[0].styleId ?? this.deps.getStyleId();
        if (styleId === null) {
          this.deps.onError('話者が選択されていません');
          this.textQueue = [];
          break;
        }

        const { text } = this.textQueue.shift()!;
        this.abortController = new AbortController();
        try {
          const wav = await this.deps.client.synthesize(
            text,
            styleId,
            this.deps.getParams(),
            this.abortController.signal,
          );
          if (gen !== this.generation) break;
          this.audioQueue.push(wav);
          this.notify();
          this.emit();
          void this.playLoop();
        } catch (e) {
          if (e instanceof AbortError || gen !== this.generation) break;
          warn('Playback', 'synthesis failed', e);
          this.deps.onError(describeError(e));
          this.textQueue = [];
          break;
        } finally {
          this.abortController = null;
        }
      }
    } finally {
      this.synthRunning = false;
      this.notify();
      this.emit();
      if (gen === this.generation && this.textQueue.length > 0) void this.synthLoop();
    }
  }

  /** 合成済みの音声を 1 本ずつ順番に再生し続ける */
  private async playLoop(): Promise<void> {
    if (this.playRunning) return;
    this.playRunning = true;
    const gen = this.generation;

    try {
      while (gen === this.generation) {
        // 一時停止中は次の文へ進まない（合成の先読みは続ける）
        if (this.paused) {
          await this.wait();
          continue;
        }
        if (this.audioQueue.length === 0) {
          // まだ合成中なら待つ。合成もテキストも無ければ終了。
          if (!this.synthRunning && this.textQueue.length === 0) break;
          await this.wait();
          continue;
        }
        const wav = this.audioQueue.shift()!;
        this.notify();
        this.emit();
        await this.play(wav, gen);
      }
    } finally {
      this.playRunning = false;
      this.emit();
      if (gen === this.generation && this.audioQueue.length > 0) void this.playLoop();
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

      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (this.currentAudio === audio) this.teardownAudio();
        else URL.revokeObjectURL(url);
        this.notify();
        this.emit();
        resolve();
      };
      this.finishCurrent = finish;

      audio.onended = finish;
      audio.onerror = () => {
        warn('Playback', 'audio playback failed');
        this.deps.onError('音声の再生に失敗しました');
        finish();
      };

      audio.play().catch((e) => {
        // 再生が始まる前に一時停止した。この文は捨てず、再開のときに頭から読む
        if (this.paused && this.currentAudio === audio) return;
        warn('Playback', 'play() rejected', e);
        this.deps.onError('再生がブロックされました。ページを一度クリックしてください');
        finish();
      });
    });
  }
}
