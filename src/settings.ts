export type UrlMode = 'skip' | 'announce' | 'read';
export type CodeMode = 'skip' | 'announce-once' | 'announce' | 'read';

export type Settings = {
  enabled: boolean;
  styleId: number | null;
  speakerLabel: string;
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
  stopOnNewQuestion: true,
  engineOrigin: 'http://127.0.0.1:50021',
  debug: false,
  minimumChunkLength: 35,
  preferredChunkLength: 110,
  maximumChunkLength: 180,
};

const KEY = 'cvb.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
