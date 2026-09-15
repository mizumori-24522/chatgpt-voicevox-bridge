import type { CodeMode, UrlMode } from './settings';

export type SanitizeOptions = {
  urlMode: UrlMode;
  codeMode: CodeMode;
  tableMode: 'skip' | 'announce' | 'read';
  /** インラインコードをそのまま読む上限文字数 */
  inlineCodeMaxLength: number;
};

export const DEFAULT_SANITIZE_OPTIONS: SanitizeOptions = {
  urlMode: 'announce',
  codeMode: 'announce',
  tableMode: 'announce',
  inlineCodeMaxLength: 24,
};

const URL_RE = /https?:\/\/[^\s<>"'）)」』】]+/g;
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'BR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'BLOCKQUOTE', 'UL', 'OL', 'TR', 'HR', 'SECTION', 'ARTICLE',
]);

/**
 * assistant メッセージの DOM から読み上げ用テキストを抽出する。
 *
 * Markdown のテキストを後からパースするのではなく、ChatGPT が既に
 * レンダリングした DOM の構造（pre / table / a など）を根拠に判定するため、
 * 生成途中の未閉じコードフェンスなどにも強い。
 */
export function extractSpeechText(root: Element, opts: SanitizeOptions): string {
  const parts: string[] = [];
  walk(root, opts, parts);
  return normalizeWhitespace(parts.join(''));
}

function walk(node: Node, opts: SanitizeOptions, out: string[]): void {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(replaceUrls(node.nodeValue ?? '', opts.urlMode));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  const tag = el.tagName;

  if (isHidden(el) || isCitation(el)) return;

  if (tag === 'PRE') {
    out.push(opts.codeMode === 'read' ? `\n${el.textContent ?? ''}\n` : '');
    if (opts.codeMode === 'announce') out.push('\nここにコードがあります。\n');
    return;
  }

  if (tag === 'TABLE') {
    if (opts.tableMode === 'skip') return;
    if (opts.tableMode === 'announce') {
      out.push('\n表があります。\n');
      return;
    }
  }

  if (tag === 'CODE' && el.closest('pre') === null) {
    const t = (el.textContent ?? '').trim();
    out.push(t.length <= opts.inlineCodeMaxLength ? t : 'コード');
    return;
  }

  if (tag === 'A') {
    const text = (el.textContent ?? '').trim();
    const href = el.getAttribute('href') ?? '';
    const textIsUrl = /^https?:\/\//.test(text);
    if (textIsUrl || text.length === 0) {
      out.push(linkPlaceholder(opts.urlMode, href));
    } else {
      out.push(replaceUrls(text, opts.urlMode));
    }
    return;
  }

  if (tag === 'IMG' || tag === 'SVG' || tag === 'BUTTON' || tag === 'SCRIPT' || tag === 'STYLE') return;

  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) out.push('\n');
  for (const child of Array.from(el.childNodes)) walk(child, opts, out);
  if (isBlock) out.push('\n');
}

function isHidden(el: Element): boolean {
  if (el.getAttribute('aria-hidden') === 'true') return true;
  if (el.hasAttribute('hidden')) return true;
  const cls = el.getAttribute('class') ?? '';
  return /\bsr-only\b|\bvisually-hidden\b/.test(cls);
}

/** Web検索回答に付く引用マーカー・出典フッターを除外する。 */
function isCitation(el: Element): boolean {
  const tag = el.tagName;
  if (tag === 'SUP') return true;
  const testid = el.getAttribute('data-testid') ?? '';
  if (/citation|sources|search-result|turn-source/i.test(testid)) return true;
  if (el.hasAttribute('data-citation')) return true;
  return false;
}

function linkPlaceholder(mode: UrlMode, href: string): string {
  if (mode === 'skip') return '';
  if (mode === 'read') return href;
  return 'リンクがあります。';
}

function replaceUrls(text: string, mode: UrlMode): string {
  if (mode === 'read') return text;
  return text.replace(URL_RE, mode === 'skip' ? '' : 'リンクがあります。');
}

/**
 * プレーンな Markdown テキストを読み上げ向けに整形する。
 * DOM が取れない場合のフォールバックと、単体テスト用。
 */
export function sanitizeMarkdown(input: string, opts: SanitizeOptions): string {
  let t = input;

  // フェンス付きコードブロック（未閉じも含む）
  t = t.replace(/```[\s\S]*?(?:```|$)/g, () =>
    opts.codeMode === 'announce' ? '\nここにコードがあります。\n' : '\n',
  );

  // インラインコード
  t = t.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= opts.inlineCodeMaxLength ? code : 'コード',
  );

  // 画像・リンク
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 見出し・引用・リストマーカー
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');
  t = t.replace(/^\s{0,3}\d+[.)]\s+/gm, '');

  // 水平線
  t = t.replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '');

  // 強調
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  t = t.replace(/~~([^~]+)~~/g, '$1');

  t = replaceUrls(t, opts.urlMode);

  return normalizeWhitespace(t);
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^\n+/, '');
}
