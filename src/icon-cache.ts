import type { SpeakerInfo, StyleOption, VoicevoxClient } from './voicevox-client';
import { warn } from './logger';

/**
 * キャラクターの顔アイコンを取得・保持する。
 *
 * 1 枚 70KB 前後あり全スタイル分だと数 MB になるので、
 * 必要になった分だけ取りに行き、同じものは二度取らない。
 */
export class IconCache {
  private infos = new Map<string, Promise<SpeakerInfo | null>>();
  private icons = new Map<number, Promise<string | null>>();
  private byStyle = new Map<number, StyleOption>();

  constructor(private client: VoicevoxClient) {}

  setOptions(options: StyleOption[]): void {
    this.byStyle = new Map(options.map((o) => [o.styleId, o]));
  }

  /** スタイルの顔アイコン（表示用 URL）。取れなければ null。 */
  icon(styleId: number): Promise<string | null> {
    const cached = this.icons.get(styleId);
    if (cached) return cached;

    const job = (async () => {
      const opt = this.byStyle.get(styleId);
      if (!opt) return null;
      const info = await this.info(opt.speakerUuid);
      const resource = info?.styleIcons.get(styleId);
      if (!resource) return null;
      try {
        return await this.client.imageUrl(resource);
      } catch (e) {
        warn('UI', 'アイコン取得に失敗', styleId, e);
        return null;
      }
    })();

    this.icons.set(styleId, job);
    return job;
  }

  private info(uuid: string): Promise<SpeakerInfo | null> {
    const cached = this.infos.get(uuid);
    if (cached) return cached;
    const job = this.client.speakerInfo(uuid).catch((e) => {
      warn('UI', 'speaker_info 取得に失敗', uuid, e);
      this.infos.delete(uuid);
      return null;
    });
    this.infos.set(uuid, job);
    return job;
  }
}
