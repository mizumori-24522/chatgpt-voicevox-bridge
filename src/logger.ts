export type LogTag = 'Observer' | 'ChatGPT' | 'Chunker' | 'VOICEVOX' | 'Playback' | 'UI' | 'Main';

let debugEnabled = false;

export function setDebug(v: boolean): void {
  debugEnabled = v;
}

export function isDebug(): boolean {
  return debugEnabled;
}

export function log(tag: LogTag, ...args: unknown[]): void {
  if (!debugEnabled) return;
  console.log(`[${tag}]`, ...args);
}

export function warn(tag: LogTag, ...args: unknown[]): void {
  console.warn(`[${tag}]`, ...args);
}

export function error(tag: LogTag, ...args: unknown[]): void {
  console.error(`[${tag}]`, ...args);
}
