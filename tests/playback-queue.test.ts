import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackQueue } from '../src/playback-queue';
import { AbortError } from '../src/http';
import type { VoicevoxClient } from '../src/voicevox-client';

/** 再生順と同時再生の有無、一時停止を観測できる Audio のスタブ */
class FakeAudio {
  static playing = 0;
  static maxConcurrent = 0;
  static instances: FakeAudio[] = [];
  static playMs = 5;
  static events: string[] = [];
  /** play() を毎回失敗させる（自動再生の制限を真似る） */
  static rejectPlay = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  paused = true;
  playCalls = 0;
  private remaining = FakeAudio.playMs;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(_url: string) {
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.playCalls++;
    if (FakeAudio.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
    if (!this.paused) return Promise.resolve();
    this.paused = false;
    FakeAudio.playing++;
    FakeAudio.maxConcurrent = Math.max(FakeAudio.maxConcurrent, FakeAudio.playing);
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.paused = true;
      FakeAudio.playing--;
      FakeAudio.events.push('play-end');
      this.onended?.();
    }, this.remaining);
    return Promise.resolve();
  }
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.remaining = Math.max(0, this.remaining - (Date.now() - this.startedAt));
      FakeAudio.playing--;
    }
  }
}

function setup(synth?: (text: string, signal?: AbortSignal) => Promise<ArrayBuffer>) {
  const spoken: string[] = [];
  const errors: string[] = [];
  const client = {
    synthesize: vi.fn(async (text: string, _id: number, _p: unknown, signal?: AbortSignal) => {
      if (synth) return synth(text, signal);
      spoken.push(text);
      return new ArrayBuffer(8);
    }),
  } as unknown as VoicevoxClient;

  const queue = new PlaybackQueue({
    client,
    getStyleId: () => 1,
    getParams: () => ({
      speedScale: 1,
      volumeScale: 1,
      pitchScale: 0,
      intonationScale: 1,
      prePhonemeLength: 0,
      postPhonemeLength: 0.05,
      pauseLengthScale: 1,
    }),
    onError: (m) => errors.push(m),
    onStateChange: () => {},
  });
  return { queue, spoken, errors, client };
}

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  FakeAudio.playing = 0;
  FakeAudio.maxConcurrent = 0;
  FakeAudio.instances = [];
  FakeAudio.events = [];
  FakeAudio.playMs = 5;
  FakeAudio.rejectPlay = false;
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  vi.stubGlobal('Blob', class {});
});

describe('PlaybackQueue', () => {
  it('plays chunks one at a time, in order', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('いち。');
    queue.enqueue('に。');
    queue.enqueue('さん。');
    await tick(150);
    expect(spoken).toEqual(['いち。', 'に。', 'さん。']);
    expect(FakeAudio.maxConcurrent).toBe(1);
  });

  it('ignores empty text', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('   ');
    await tick();
    expect(spoken).toEqual([]);
  });

  it('stopAll clears the queue and aborts in-flight synthesis', async () => {
    let aborted = false;
    const { queue } = setup(
      (_text, signal) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            reject(new AbortError());
          });
        }),
    );
    queue.enqueue('長い文章。');
    queue.enqueue('次の文章。');
    await tick(10);
    queue.stopAll();
    await tick(30);
    expect(aborted).toBe(true);
    expect(queue.snapshot.queued).toBe(0);
    expect(queue.snapshot.speaking).toBe(false);
  });

  it('reports an error and drains the queue when synthesis fails', async () => {
    const { queue, errors } = setup(() => Promise.reject(new Error('boom')));
    queue.enqueue('だめな文章。');
    queue.enqueue('続きの文章。');
    await tick(50);
    expect(errors.length).toBe(1);
    expect(queue.snapshot.queued).toBe(0);
  });

  it('synthesizes the next chunk while the current one is still playing', async () => {
    // 直列だと文と文の間に合成時間ぶんの無音が入る。先読みできているか。
    const events: string[] = [];
    FakeAudio.playMs = 40;
    const { queue } = setup(async (text) => {
      await new Promise((r) => setTimeout(r, 30));
      events.push(`synth-done:${text}`);
      FakeAudio.events.push(`synth-done:${text}`);
      return new ArrayBuffer(8);
    });

    queue.enqueue('いち。');
    queue.enqueue('に。');
    queue.enqueue('さん。');
    await tick(300);

    const secondSynth = FakeAudio.events.indexOf('synth-done:に。');
    const firstPlayEnd = FakeAudio.events.indexOf('play-end');
    expect(secondSynth).toBeGreaterThanOrEqual(0);
    expect(firstPlayEnd).toBeGreaterThanOrEqual(0);
    expect(secondSynth).toBeLessThan(firstPlayEnd);
    expect(FakeAudio.maxConcurrent).toBe(1);
  });

  it('reads a chunk with the voice given to it, and the rest with the selected voice', async () => {
    const { queue, client } = setup();
    queue.enqueue('質問です。', 8);
    queue.enqueue('回答です。');
    await tick(120);
    const calls = (client.synthesize as ReturnType<typeof vi.fn>).mock.calls.map((c) => [c[0], c[1]]);
    expect(calls).toEqual([
      ['質問です。', 8],
      ['回答です。', 1],
    ]);
  });

  it('accepts new text after a stop', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('古い。');
    queue.stopAll();
    queue.enqueue('新しい。');
    await tick(120);
    expect(spoken).toContain('新しい。');
  });
});

describe('PlaybackQueue 一時停止', () => {
  it('stops at the current sentence and continues from there on resume', async () => {
    FakeAudio.playMs = 40;
    const { queue } = setup();
    queue.enqueue('いち。');
    queue.enqueue('に。');
    await tick(15);
    expect(FakeAudio.instances).toHaveLength(1);

    queue.pause();
    expect(queue.snapshot.paused).toBe(true);
    expect(FakeAudio.instances[0].paused).toBe(true);
    await tick(120);
    // 止めている間は、今の文も次の文も鳴らない
    expect(FakeAudio.events).toEqual([]);
    expect(FakeAudio.instances).toHaveLength(1);

    queue.resume();
    expect(queue.snapshot.paused).toBe(false);
    await tick(150);
    // 同じ音声の続きから再開し、そのあと次の文へ進む（頭から読み直さない）
    expect(FakeAudio.instances[0].playCalls).toBe(2);
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.events).toEqual(['play-end', 'play-end']);
    expect(FakeAudio.maxConcurrent).toBe(1);
  });

  it('keeps sentences that arrive while paused and reads them after resuming', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('いち。');
    await tick(1);
    queue.pause();
    queue.enqueue('に。');
    queue.enqueue('さん。');
    await tick(100);
    expect(FakeAudio.events).toEqual([]);
    expect(queue.snapshot.queued).toBeGreaterThan(0);

    queue.resume();
    await tick(150);
    expect(spoken).toEqual(['いち。', 'に。', 'さん。']);
    expect(FakeAudio.events).toHaveLength(3);
  });

  it('does not lose the sentence when paused before its playback has started', async () => {
    const { queue } = setup();
    queue.enqueue('いち。');
    queue.pause(); // 合成中に止める
    await tick(60);
    expect(FakeAudio.instances.every((a) => a.playCalls === 0)).toBe(true);
    queue.resume();
    await tick(80);
    expect(FakeAudio.events).toEqual(['play-end']);
  });

  it('does nothing when there is nothing to read', async () => {
    const { queue } = setup();
    queue.pause();
    expect(queue.snapshot.paused).toBe(false);
    expect(queue.snapshot.idle).toBe(true);
    queue.enqueue('あとから来た文。');
    await tick(80);
    expect(FakeAudio.events).toEqual(['play-end']);
  });

  it('is released by STOP, so the next thing to read is not silent', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('古い文。');
    await tick(1);
    queue.pause();
    queue.stopAll();
    expect(queue.snapshot.paused).toBe(false);
    queue.enqueue('新しい文。');
    await tick(100);
    expect(spoken).toContain('新しい文。');
    expect(FakeAudio.events).toContain('play-end');
  });

  it('reports a blocked resume and moves on instead of getting stuck', async () => {
    FakeAudio.playMs = 40;
    const { queue, errors } = setup();
    queue.enqueue('いち。');
    queue.enqueue('に。');
    await tick(15);
    queue.pause();
    FakeAudio.rejectPlay = true;
    queue.resume(); // 再開の play() だけが失敗する
    FakeAudio.rejectPlay = false;
    await tick(20);
    expect(errors).toEqual(['再生がブロックされました。ページを一度クリックしてください']);
    await tick(120);
    // 止まったままにならず、次の文へ進んでいる
    expect(FakeAudio.instances.length).toBeGreaterThanOrEqual(2);
  });
});
