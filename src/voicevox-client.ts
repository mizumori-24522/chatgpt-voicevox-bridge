import { request, HttpError, NetworkError, AbortError } from './http';
import { log } from './logger';

export type SpeakerStyle = { id: number; name: string };
export type Speaker = { name: string; speaker_uuid: string; styles: SpeakerStyle[] };
export type StyleOption = { styleId: number; speakerName: string; styleName: string; label: string };

export type SynthesisParams = {
  speedScale: number;
  volumeScale: number;
  pitchScale: number;
  intonationScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLengthScale: number;
};

export class VoicevoxClient {
  constructor(private origin: string) {}

  setOrigin(origin: string): void {
    this.origin = origin.replace(/\/+$/, '');
  }

  getOrigin(): string {
    return this.origin;
  }

  async version(): Promise<string> {
    const text = (await request({
      method: 'GET',
      url: `${this.origin}/version`,
      responseType: 'text',
      timeoutMs: 4000,
    })) as string;
    return text.replace(/^"|"$/g, '').trim();
  }

  async speakers(): Promise<Speaker[]> {
    const text = (await request({
      method: 'GET',
      url: `${this.origin}/speakers`,
      responseType: 'text',
      timeoutMs: 8000,
    })) as string;
    return JSON.parse(text) as Speaker[];
  }

  /** WAV の ArrayBuffer を返す。abort されたら AbortError を投げる。 */
  async synthesize(
    text: string,
    styleId: number,
    params: SynthesisParams,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    const queryText = (await request({
      method: 'POST',
      url: `${this.origin}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`,
      responseType: 'text',
      timeoutMs: 20000,
      signal,
    })) as string;

    const query = JSON.parse(queryText) as Record<string, unknown>;
    // エンジンのバージョンによって存在しないキーがある。
    // 知らないキーを足すと 422 になり得るので、元からあるものだけ書き換える。
    for (const [key, value] of Object.entries(params)) {
      if (key in query) query[key] = value;
    }

    log('VOICEVOX', 'synthesis', { styleId, len: text.length });

    return (await request({
      method: 'POST',
      url: `${this.origin}/synthesis?speaker=${styleId}`,
      body: JSON.stringify(query),
      contentType: 'application/json',
      responseType: 'arraybuffer',
      timeoutMs: 60000,
      signal,
    })) as ArrayBuffer;
  }
}

/** 話者一覧を UI 用のフラットなリストへ変換する。 */
export function flattenStyles(speakers: Speaker[]): StyleOption[] {
  const out: StyleOption[] = [];
  for (const sp of speakers) {
    for (const st of sp.styles) {
      out.push({
        styleId: st.id,
        speakerName: sp.name,
        styleName: st.name,
        label: `${sp.name} / ${st.name}`,
      });
    }
  }
  return out;
}

/**
 * 保存済み styleId が今の環境に存在するか確認し、無ければ候補名から探す。
 * それも無ければ先頭を返す。speaker ID をハードコードしないための関数。
 */
export function resolveStyle(
  options: StyleOption[],
  savedStyleId: number | null,
  preferredSpeakerNames: string[] = ['中国うさぎ'],
): StyleOption | null {
  if (options.length === 0) return null;
  if (savedStyleId !== null) {
    const hit = options.find((o) => o.styleId === savedStyleId);
    if (hit) return hit;
  }
  for (const name of preferredSpeakerNames) {
    const hit = options.find((o) => o.speakerName === name && o.styleName === 'ノーマル');
    if (hit) return hit;
    const any = options.find((o) => o.speakerName === name);
    if (any) return any;
  }
  return options[0];
}

export function describeError(e: unknown): string {
  if (e instanceof AbortError) return '中断しました';
  if (e instanceof NetworkError) return 'VOICEVOXへ接続できません';
  if (e instanceof HttpError) {
    if (e.status === 422) return '音声合成に失敗しました（話者IDが不正の可能性）';
    return `VOICEVOXエラー (HTTP ${e.status})`;
  }
  return '不明なエラー';
}
