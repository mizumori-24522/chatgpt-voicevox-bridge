export type UrlMode = 'skip' | 'announce' | 'read';
export type CodeMode = 'skip' | 'announce-once' | 'announce' | 'read';

export type Settings = {
  enabled: boolean;
  styleId: number | null;
  speakerLabel: string;
  /** 最近使ったスタイル ID（新しい順、最大 5） */
  recentStyleIds: number[];
  /** お気に入りのキャラ（speaker_uuid） */
  favoriteSpeakers: string[];
  speedScale: number;
  volumeScale: number;
  pitchScale: number;
  intonationScale: number;
  /** チャンクの前後に入る無音（秒）。VOICEVOX 既定はどちらも 0.1 */
  prePhonemeLength: number;
  postPhonemeLength: number;
  /** 読点・句点の間の倍率 */
  pauseLengthScale: number;
  urlMode: UrlMode;
  codeMode: CodeMode;
  tableMode: 'skip' | 'announce' | 'read';
  readSymbols: boolean;
  /** チャットを開いたら、そのチャットの最新の回答を読む */
  readOnOpen: boolean;
  stopOnNewQuestion: boolean;
  engineOrigin: string;
  debug: boolean;
  minimumChunkLength: number;
  preferredChunkLength: number;
  maximumChunkLength: number;
};

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  styleId: null,
  speakerLabel: '',
  recentStyleIds: [],
  favoriteSpeakers: [],
  speedScale: 1.15,
  volumeScale: 1.0,
  pitchScale: 0.0,
  intonationScale: 1.0,
  prePhonemeLength: 0.0,
  postPhonemeLength: 0.05,
  pauseLengthScale: 0.9,
  urlMode: 'announce',
  codeMode: 'announce-once',
  tableMode: 'announce',
  readSymbols: false,
  readOnOpen: true,
  stopOnNewQuestion: true,
  engineOrigin: 'http://127.0.0.1:50021',
  debug: false,
  minimumChunkLength: 35,
  preferredChunkLength: 110,
  maximumChunkLength: 180,
};

const KEY = 'cvb.settings.v2';
const LEGACY_KEY = 'cvb.settings.v1';

/**
 * v1 の設定を v2 へ移行する。
 *
 * v1 では codeMode の既定が 'announce'（毎回伝える）だったため、
 * そのまま引き継ぐと「ここに図があります」を1回の回答で何度も言う。
 * 意図して選んだ値ではないので 'announce-once' へ寄せる。
 */
export function migrate(old: Partial<Settings>): Partial<Settings> {
  const next = { ...old };
  if (next.codeMode === 'announce') next.codeMode = 'announce-once';
  return next;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrate(JSON.parse(legacy) as Partial<Settings>);
      const settings = { ...DEFAULT_SETTINGS, ...migrated };
      saveSettings(settings);
      return settings;
    }
    return { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* localStorage unavailable; keep running in-memory */
  }
}
