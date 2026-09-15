export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * 1つの assistant メッセージについて「まだ読み上げへ回していない部分」を追跡する。
 *
 * React の再描画で同じ本文が何度も観測されるため、mutation ごとではなく
 * 「消費済み文字数」を状態として持つ。これが二重読み上げ防止の中核。
 */
export class StreamTracker {
  private lastText = '';
  private consumed = 0;

  /** 現在の本文全体を渡すと、新しく増えた分だけを返す。 */
  push(fullText: string): string {
    if (fullText === this.lastText) return '';

    if (fullText.startsWith(this.lastText)) {
      const delta = fullText.slice(this.consumed);
      this.lastText = fullText;
      this.consumed = fullText.length;
      return delta;
    }

    const common = commonPrefixLength(this.lastText, fullText);
    this.lastText = fullText;

    if (common >= this.consumed) {
      // 消費済みより後ろだけが書き換わった → 差分を出す
      const delta = fullText.slice(this.consumed);
      this.consumed = fullText.length;
      return delta;
    }

    // 消費済み範囲が書き換わった（再描画・編集）。
    // 読み直すと二重読み上げになるので、読み上げずに追従だけする。
    this.consumed = fullText.length;
    return '';
  }

  get consumedLength(): number {
    return this.consumed;
  }

  reset(): void {
    this.lastText = '';
    this.consumed = 0;
  }
}
