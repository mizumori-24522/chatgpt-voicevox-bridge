import { describe, it, expect, vi } from 'vitest';
import { IconCache } from '../src/icon-cache';
import type { VoicevoxClient, StyleOption } from '../src/voicevox-client';

const options: StyleOption[] = [
  { styleId: 3, speakerName: 'ずんだもん', speakerUuid: 'u-z', styleName: 'ノーマル', label: '' },
  { styleId: 1, speakerName: 'ずんだもん', speakerUuid: 'u-z', styleName: 'あまあま', label: '' },
];

function makeClient() {
  return {
    speakerInfo: vi.fn(async () => ({
      portrait: 'p',
      styleIcons: new Map([
        [3, 'http://127.0.0.1:50021/_resources/a'],
        [1, 'http://127.0.0.1:50021/_resources/b'],
      ]),
    })),
    imageUrl: vi.fn(async (r: string) => `blob:${r.slice(-1)}`),
  };
}

describe('IconCache', () => {
  it('resolves a style to its own icon', async () => {
    const client = makeClient();
    const cache = new IconCache(client as unknown as VoicevoxClient);
    cache.setOptions(options);
    expect(await cache.icon(3)).toBe('blob:a');
    expect(await cache.icon(1)).toBe('blob:b');
  });

  it('asks speaker_info once per character, not per style', async () => {
    const client = makeClient();
    const cache = new IconCache(client as unknown as VoicevoxClient);
    cache.setOptions(options);
    await Promise.all([cache.icon(3), cache.icon(1), cache.icon(3)]);
    expect(client.speakerInfo).toHaveBeenCalledTimes(1);
    expect(client.imageUrl).toHaveBeenCalledTimes(2);
  });

  it('returns null for unknown styles instead of throwing', async () => {
    const cache = new IconCache(makeClient() as unknown as VoicevoxClient);
    cache.setOptions(options);
    expect(await cache.icon(999)).toBeNull();
  });

  it('returns null when the engine fails, and retries next time', async () => {
    const client = makeClient();
    client.speakerInfo.mockRejectedValueOnce(new Error('down'));
    const cache = new IconCache(client as unknown as VoicevoxClient);
    cache.setOptions(options);
    expect(await cache.icon(3)).toBeNull();
    // 別スタイルなら speaker_info を取り直せる
    expect(await cache.icon(1)).toBe('blob:b');
  });
});
