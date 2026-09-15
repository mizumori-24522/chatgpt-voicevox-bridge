export type ChunkerOptions = {
  minimumChunkLength: number;
  preferredChunkLength: number;
  maximumChunkLength: number;
};

export const DEFAULT_CHUNKER_OPTIONS: ChunkerOptions = {
  minimumChunkLength: 35,
  preferredChunkLength: 110,
  maximumChunkLength: 180,
};

const HARD_BOUNDARY = /[。．.！!？?\n]/;
const SOFT_BOUNDARY = /[、，,；;：:）)」』】　 ]/;
/** 文末記号の直後に続く閉じ記号は同じチャンクへ含める */
const TRAILING = /[」』）)】"'…。！？!?]/;

/** 読み上げる価値のある文字が含まれているか */
export function hasSpeakableContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

/**
 * ストリーミング中のテキストを、自然な読み上げ単位へ切り出すバッファ。
 */
export class SpeechChunker {
  private buffer = '';

  constructor(private opts: ChunkerOptions) {}

  setOptions(opts: ChunkerOptions): void {
    this.opts = opts;
  }

  append(text: string): void {
    this.buffer += text;
  }

  get pending(): string {
    return this.buffer;
  }

  clear(): void {
    this.buffer = '';
  }

  /**
   * 切り出せるチャンクを全て返す。
   * final=true なら残り全部を吐き出す（生成完了時）。
   */
  take(final: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const cut = this.findCut(final);
      if (cut <= 0) break;
      const raw = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut);
      const cleaned = raw.trim();
      if (cleaned && hasSpeakableContent(cleaned)) out.push(cleaned);
    }
    if (final) {
      const rest = this.buffer.trim();
      this.buffer = '';
      if (rest && hasSpeakableContent(rest)) out.push(rest);
    }
    return out;
  }

  /** 切り出し位置（exclusive index）。0 ならまだ切れない。 */
  private findCut(final: boolean): number {
    const { minimumChunkLength, maximumChunkLength } = this.opts;
    const buf = this.buffer;
    if (buf.length === 0) return 0;
    if (!final && buf.length < minimumChunkLength) return 0;

    const limit = Math.min(buf.length, maximumChunkLength);

    for (let i = minimumChunkLength - 1; i < limit; i++) {
      if (HARD_BOUNDARY.test(buf[i])) {
        let end = i + 1;
        while (end < buf.length && TRAILING.test(buf[end])) end++;
        // 直後がまだ届いていない可能性があるので、末尾ぴったりなら次を待つ
        if (!final && end >= buf.length && buf.length < maximumChunkLength) return 0;
        return end;
      }
    }

    if (buf.length < maximumChunkLength) return 0;

    for (let i = limit - 1; i >= minimumChunkLength; i--) {
      if (SOFT_BOUNDARY.test(buf[i])) return i + 1;
    }
    return maximumChunkLength;
  }
}
