/**
 * VOICEVOX Engine への HTTP 通信層。
 *
 * https://chatgpt.com から http://127.0.0.1:50021 を直接 fetch すると
 * CORS / Private Network Access で弾かれることが多いため、
 * Tampermonkey の GM_xmlhttpRequest を優先して使う。
 * (@connect は 127.0.0.1 / localhost のみに限定している)
 */

declare const GM_xmlhttpRequest: undefined | ((details: GMRequest) => GMHandle);

type GMRequest = {
  method: string;
  url: string;
  headers?: Record<string, string>;
  data?: string;
  responseType?: 'arraybuffer' | 'json' | 'text';
  timeout?: number;
  onload?: (r: { status: number; responseText: string; response: unknown }) => void;
  onerror?: (r: unknown) => void;
  ontimeout?: () => void;
  onabort?: () => void;
};

type GMHandle = { abort: () => void };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
    this.name = 'HttpError';
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class AbortError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortError';
  }
}

export function gmAvailable(): boolean {
  return typeof GM_xmlhttpRequest === 'function';
}

export type RequestOptions = {
  method: 'GET' | 'POST';
  url: string;
  body?: string;
  contentType?: string;
  responseType: 'text' | 'arraybuffer';
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function request(opts: RequestOptions): Promise<string | ArrayBuffer> {
  if (gmAvailable()) return gmRequest(opts);
  return fetchRequest(opts);
}

function gmRequest(opts: RequestOptions): Promise<string | ArrayBuffer> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new AbortError());
    const headers: Record<string, string> = {};
    if (opts.contentType) headers['Content-Type'] = opts.contentType;

    const handle = GM_xmlhttpRequest!({
      method: opts.method,
      url: opts.url,
      headers,
      data: opts.body,
      responseType: opts.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
      timeout: opts.timeoutMs ?? 30000,
      onload: (r) => {
        if (r.status < 200 || r.status >= 300) {
          reject(new HttpError(r.status, opts.url, r.responseText ?? ''));
          return;
        }
        if (opts.responseType === 'arraybuffer') {
          resolve(r.response as ArrayBuffer);
        } else {
          resolve(r.responseText);
        }
      },
      onerror: () => reject(new NetworkError(`接続失敗: ${opts.url}`)),
      ontimeout: () => reject(new NetworkError(`タイムアウト: ${opts.url}`)),
      onabort: () => reject(new AbortError()),
    });

    opts.signal?.addEventListener('abort', () => handle.abort(), { once: true });
  });
}

async function fetchRequest(opts: RequestOptions): Promise<string | ArrayBuffer> {
  const controller = new AbortController();
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30000);
  try {
    const res = await fetch(opts.url, {
      method: opts.method,
      body: opts.body,
      headers: opts.contentType ? { 'Content-Type': opts.contentType } : undefined,
      signal: controller.signal,
    });
    if (!res.ok) throw new HttpError(res.status, opts.url, await res.text().catch(() => ''));
    return opts.responseType === 'arraybuffer' ? await res.arrayBuffer() : await res.text();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (opts.signal?.aborted) throw new AbortError();
    if (e instanceof DOMException && e.name === 'AbortError') throw new NetworkError('タイムアウト');
    throw new NetworkError(`接続失敗: ${opts.url} (${String(e)})`);
  } finally {
    clearTimeout(timer);
  }
}
