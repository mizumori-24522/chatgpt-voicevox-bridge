import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackQueue } from '../src/playback-queue';
import { AbortError } from '../src/http';
import type { VoicevoxClient } from '../src/voicevox-client';

/** 再生順と同時再生の有無を観測できる Audio のスタブ */
class FakeAudio {
  static playing = 0;
  static maxConcurrent = 0;
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  constructor(_url: string) {
    FakeAudio.instances.push(this);
  }
  static playMs = 5;
  static events: string[] = [];
  play(): Promise<void> {
    FakeAudio.playing++;
    FakeAudio.maxConcurrent = Math.max(FakeAudio.maxConcurrent, FakeAudio.playing);
    setTimeout(() => {
      FakeAudio.playing--;
      FakeAudio.events.push('play-end');
      this.onended?.();
    }, FakeAudio.playMs);
    return Promise.resolve();
  }
  pause(): void {
    /* no-op */
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
    getParams: () => ({ speedScale: 1, volumeScale: 1, pitchScale: 0, intonationScale: 1 }),
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

  it('accepts new text after a stop', async () => {
    const { queue, spoken } = setup();
    queue.enqueue('古い。');
    queue.stopAll();
    queue.enqueue('新しい。');
    await tick(120);
    expect(spoken).toContain('新しい。');
  });
});
