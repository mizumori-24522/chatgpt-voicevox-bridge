// ==UserScript==
// @name         ChatGPT → VOICEVOX Bridge
// @namespace    local.chatgpt-voicevox-bridge
// @version      0.2.1
// @author       mizumori-24522
// @description  ChatGPT Web の回答を VOICEVOX で逐次読み上げする
// @homepageURL  https://github.com/mizumori-24522/chatgpt-voicevox-bridge
// @supportURL   https://github.com/mizumori-24522/chatgpt-voicevox-bridge/issues
// @downloadURL  https://raw.githubusercontent.com/mizumori-24522/chatgpt-voicevox-bridge/main/dist/chatgpt-voicevox.user.js
// @updateURL    https://raw.githubusercontent.com/mizumori-24522/chatgpt-voicevox-bridge/main/dist/chatgpt-voicevox.user.js
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    styleId: null,
    speakerLabel: "",
    speedScale: 1.15,
    volumeScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    prePhonemeLength: 0,
    postPhonemeLength: 0.05,
    pauseLengthScale: 0.9,
    urlMode: "announce",
    codeMode: "announce-once",
    tableMode: "announce",
    readSymbols: false,
    stopOnNewQuestion: true,
    engineOrigin: "http://127.0.0.1:50021",
    debug: false,
    minimumChunkLength: 35,
    preferredChunkLength: 110,
    maximumChunkLength: 180
  };
  const KEY = "cvb.settings.v2";
  const LEGACY_KEY = "cvb.settings.v1";
  function migrate(old) {
    const next = { ...old };
    if (next.codeMode === "announce") next.codeMode = "announce-once";
    return next;
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      }
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const migrated = migrate(JSON.parse(legacy));
        const settings = { ...DEFAULT_SETTINGS, ...migrated };
        saveSettings(settings);
        return settings;
      }
      return { ...DEFAULT_SETTINGS };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }
  function saveSettings(s) {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
    }
  }
  let debugEnabled = false;
  function setDebug(v) {
    debugEnabled = v;
  }
  function log(tag, ...args) {
    if (!debugEnabled) return;
    console.log(`[${tag}]`, ...args);
  }
  function warn(tag, ...args) {
    console.warn(`[${tag}]`, ...args);
  }
  function error(tag, ...args) {
    console.error(`[${tag}]`, ...args);
  }
  class HttpError extends Error {
    constructor(status, url, body) {
      super(`HTTP ${status} ${url}: ${body.slice(0, 200)}`);
      this.status = status;
      this.url = url;
      this.body = body;
      this.name = "HttpError";
    }
  }
  class NetworkError extends Error {
    constructor(message) {
      super(message);
      this.name = "NetworkError";
    }
  }
  class AbortError extends Error {
    constructor() {
      super("aborted");
      this.name = "AbortError";
    }
  }
  function gmAvailable() {
    return typeof GM_xmlhttpRequest === "function";
  }
  async function request(opts) {
    if (gmAvailable()) return gmRequest(opts);
    return fetchRequest(opts);
  }
  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      var _a, _b;
      if ((_a = opts.signal) == null ? void 0 : _a.aborted) return reject(new AbortError());
      const headers = {};
      if (opts.contentType) headers["Content-Type"] = opts.contentType;
      const handle = GM_xmlhttpRequest({
        method: opts.method,
        url: opts.url,
        headers,
        data: opts.body,
        responseType: opts.responseType === "arraybuffer" ? "arraybuffer" : "text",
        timeout: opts.timeoutMs ?? 3e4,
        onload: (r) => {
          if (r.status < 200 || r.status >= 300) {
            reject(new HttpError(r.status, opts.url, r.responseText ?? ""));
            return;
          }
          if (opts.responseType === "arraybuffer") {
            resolve(r.response);
          } else {
            resolve(r.responseText);
          }
        },
        onerror: () => reject(new NetworkError(`接続失敗: ${opts.url}`)),
        ontimeout: () => reject(new NetworkError(`タイムアウト: ${opts.url}`)),
        onabort: () => reject(new AbortError())
      });
      (_b = opts.signal) == null ? void 0 : _b.addEventListener("abort", () => handle.abort(), { once: true });
    });
  }
  async function fetchRequest(opts) {
    var _a, _b;
    const controller = new AbortController();
    (_a = opts.signal) == null ? void 0 : _a.addEventListener("abort", () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 3e4);
    try {
      const res = await fetch(opts.url, {
        method: opts.method,
        body: opts.body,
        headers: opts.contentType ? { "Content-Type": opts.contentType } : void 0,
        signal: controller.signal
      });
      if (!res.ok) throw new HttpError(res.status, opts.url, await res.text().catch(() => ""));
      return opts.responseType === "arraybuffer" ? await res.arrayBuffer() : await res.text();
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if ((_b = opts.signal) == null ? void 0 : _b.aborted) throw new AbortError();
      if (e instanceof DOMException && e.name === "AbortError") throw new NetworkError("タイムアウト");
      throw new NetworkError(`接続失敗: ${opts.url} (${String(e)})`);
    } finally {
      clearTimeout(timer);
    }
  }
  class VoicevoxClient {
    constructor(origin) {
      this.origin = origin;
    }
    setOrigin(origin) {
      this.origin = origin.replace(/\/+$/, "");
    }
    getOrigin() {
      return this.origin;
    }
    async version() {
      const text = await request({
        method: "GET",
        url: `${this.origin}/version`,
        responseType: "text",
        timeoutMs: 4e3
      });
      return text.replace(/^"|"$/g, "").trim();
    }
    async speakers() {
      const text = await request({
        method: "GET",
        url: `${this.origin}/speakers`,
        responseType: "text",
        timeoutMs: 8e3
      });
      return JSON.parse(text);
    }
    /**
     * キャラクター画像の情報。
     *
     * 既定のままだとサンプル音声まで base64 で同梱され 1 キャラ 5MB 超になるため、
     * resource_format=url で URL だけ受け取る。古いエンジンが未対応なら base64 で取り直す。
     */
    async speakerInfo(speakerUuid) {
      const base = `${this.origin}/speaker_info?speaker_uuid=${encodeURIComponent(speakerUuid)}`;
      let text;
      try {
        text = await request({
          method: "GET",
          url: `${base}&resource_format=url`,
          responseType: "text",
          timeoutMs: 8e3
        });
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 422) throw e;
        text = await request({ method: "GET", url: base, responseType: "text", timeoutMs: 2e4 });
      }
      const raw = JSON.parse(text);
      return {
        portrait: raw.portrait,
        styleIcons: new Map(raw.style_infos.map((s) => [s.id, s.icon]))
      };
    }
    /**
     * 画像リソースを <img> で表示できる URL に変換する。
     *
     * chatgpt.com のページから http://127.0.0.1 の画像は直接読めない
     * （Private Network Access で止まる）ため、バイト列を取ってきて blob: にする。
     */
    async imageUrl(resource) {
      if (!/^https?:\/\//.test(resource)) return `data:image/png;base64,${resource}`;
      if (!resource.startsWith(`${this.origin}/`)) throw new Error(`unexpected resource origin: ${resource}`);
      const bytes = await request({
        method: "GET",
        url: resource,
        responseType: "arraybuffer",
        timeoutMs: 8e3
      });
      return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    }
    /** WAV の ArrayBuffer を返す。abort されたら AbortError を投げる。 */
    async synthesize(text, styleId, params, signal) {
      const queryText = await request({
        method: "POST",
        url: `${this.origin}/audio_query?speaker=${styleId}&text=${encodeURIComponent(text)}`,
        responseType: "text",
        timeoutMs: 2e4,
        signal
      });
      const query = JSON.parse(queryText);
      for (const [key, value] of Object.entries(params)) {
        if (key in query) query[key] = value;
      }
      log("VOICEVOX", "synthesis", { styleId, len: text.length });
      return await request({
        method: "POST",
        url: `${this.origin}/synthesis?speaker=${styleId}`,
        body: JSON.stringify(query),
        contentType: "application/json",
        responseType: "arraybuffer",
        timeoutMs: 6e4,
        signal
      });
    }
  }
  function flattenStyles(speakers) {
    const out = [];
    for (const sp of speakers) {
      for (const st of sp.styles) {
        out.push({
          styleId: st.id,
          speakerName: sp.name,
          speakerUuid: sp.speaker_uuid,
          styleName: st.name,
          label: `${sp.name} / ${st.name}`
        });
      }
    }
    return out;
  }
  function resolveStyle(options, savedStyleId, preferredSpeakerNames = ["中国うさぎ"]) {
    if (options.length === 0) return null;
    if (savedStyleId !== null) {
      const hit = options.find((o) => o.styleId === savedStyleId);
      if (hit) return hit;
    }
    for (const name of preferredSpeakerNames) {
      const hit = options.find((o) => o.speakerName === name && o.styleName === "ノーマル");
      if (hit) return hit;
      const any = options.find((o) => o.speakerName === name);
      if (any) return any;
    }
    return options[0];
  }
  function describeError(e) {
    if (e instanceof AbortError) return "中断しました";
    if (e instanceof NetworkError) return "VOICEVOXへ接続できません";
    if (e instanceof HttpError) {
      if (e.status === 422) return "音声合成に失敗しました（話者IDが不正の可能性）";
      return `VOICEVOXエラー (HTTP ${e.status})`;
    }
    return "不明なエラー";
  }
  const LOOKAHEAD = 2;
  const WAIT_TIMEOUT_MS = 150;
  class PlaybackQueue {
    constructor(deps) {
      this.deps = deps;
      this.textQueue = [];
      this.audioQueue = [];
      this.synthRunning = false;
      this.playRunning = false;
      this.currentAudio = null;
      this.currentUrl = null;
      this.abortController = null;
      this.waiters = [];
      this.generation = 0;
    }
    enqueue(text) {
      const t = text.trim();
      if (!t) return;
      this.textQueue.push(t);
      log("Playback", "enqueue", t.slice(0, 40));
      this.notify();
      this.emit();
      void this.synthLoop();
      void this.playLoop();
    }
    stopAll() {
      var _a;
      this.generation++;
      this.textQueue = [];
      this.audioQueue = [];
      (_a = this.abortController) == null ? void 0 : _a.abort();
      this.abortController = null;
      this.teardownAudio();
      this.synthRunning = false;
      this.playRunning = false;
      this.notify();
      log("Playback", "stopAll");
      this.emit();
    }
    get snapshot() {
      return {
        queued: this.textQueue.length + this.audioQueue.length,
        speaking: this.currentAudio !== null
      };
    }
    emit() {
      this.deps.onStateChange(this.snapshot);
    }
    notify() {
      const waiters = this.waiters;
      this.waiters = [];
      for (const w of waiters) w();
    }
    wait() {
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        this.waiters.push(finish);
        setTimeout(finish, WAIT_TIMEOUT_MS);
      });
    }
    teardownAudio() {
      if (this.currentAudio) {
        this.currentAudio.onended = null;
        this.currentAudio.onerror = null;
        this.currentAudio.pause();
        this.currentAudio.src = "";
        this.currentAudio = null;
      }
      if (this.currentUrl) {
        URL.revokeObjectURL(this.currentUrl);
        this.currentUrl = null;
      }
    }
    /** 先読みしながらテキストを音声へ変換し続ける */
    async synthLoop() {
      if (this.synthRunning) return;
      this.synthRunning = true;
      const gen = this.generation;
      try {
        while (gen === this.generation) {
          if (this.textQueue.length === 0) break;
          if (this.audioQueue.length >= LOOKAHEAD) {
            await this.wait();
            continue;
          }
          const styleId = this.deps.getStyleId();
          if (styleId === null) {
            this.deps.onError("話者が選択されていません");
            this.textQueue = [];
            break;
          }
          const text = this.textQueue.shift();
          this.abortController = new AbortController();
          try {
            const wav = await this.deps.client.synthesize(
              text,
              styleId,
              this.deps.getParams(),
              this.abortController.signal
            );
            if (gen !== this.generation) break;
            this.audioQueue.push(wav);
            this.notify();
            this.emit();
            void this.playLoop();
          } catch (e) {
            if (e instanceof AbortError || gen !== this.generation) break;
            warn("Playback", "synthesis failed", e);
            this.deps.onError(describeError(e));
            this.textQueue = [];
            break;
          } finally {
            this.abortController = null;
          }
        }
      } finally {
        this.synthRunning = false;
        this.notify();
        this.emit();
        if (gen === this.generation && this.textQueue.length > 0) void this.synthLoop();
      }
    }
    /** 合成済みの音声を 1 本ずつ順番に再生し続ける */
    async playLoop() {
      if (this.playRunning) return;
      this.playRunning = true;
      const gen = this.generation;
      try {
        while (gen === this.generation) {
          if (this.audioQueue.length === 0) {
            if (!this.synthRunning && this.textQueue.length === 0) break;
            await this.wait();
            continue;
          }
          const wav = this.audioQueue.shift();
          this.notify();
          this.emit();
          await this.play(wav, gen);
        }
      } finally {
        this.playRunning = false;
        this.emit();
        if (gen === this.generation && this.audioQueue.length > 0) void this.playLoop();
      }
    }
    play(wav, gen) {
      return new Promise((resolve) => {
        if (gen !== this.generation) return resolve();
        const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
        const audio = new Audio(url);
        this.currentAudio = audio;
        this.currentUrl = url;
        this.emit();
        const finish = () => {
          if (this.currentAudio === audio) this.teardownAudio();
          else URL.revokeObjectURL(url);
          this.notify();
          this.emit();
          resolve();
        };
        audio.onended = finish;
        audio.onerror = () => {
          warn("Playback", "audio playback failed");
          this.deps.onError("音声の再生に失敗しました");
          finish();
        };
        audio.play().catch((e) => {
          warn("Playback", "play() rejected", e);
          this.deps.onError("再生がブロックされました。ページを一度クリックしてください");
          finish();
        });
      });
    }
  }
  const TURN_SEL = "[data-turn]";
  const TURN_FALLBACK_SEL = '[data-testid^="conversation-turn-"]';
  const ASSISTANT_SEL = '[data-message-author-role="assistant"]';
  const USER_SEL = '[data-message-author-role="user"]';
  const CONTENT_SELECTORS = [".markdown", '[class*="markdown"]', ".prose", '[class*="prose"]'];
  class ChatGptAdapter {
    getObserverRoot() {
      const main2 = document.querySelector("main");
      return main2 ?? document.body;
    }
    /** assistant ターンを出現順に全部返す（任意の回答を指定して読ませる用） */
    assistantTurns() {
      return this.turns().filter(
        (t) => t.getAttribute("data-turn") === "assistant" || t.getAttribute("data-turn") === null && t.querySelector(ASSISTANT_SEL) !== null
      );
    }
    /** ターンから本文要素を取り出す */
    contentOfTurn(turn) {
      const message = turn.matches(ASSISTANT_SEL) ? turn : turn.querySelector(ASSISTANT_SEL) ?? turn;
      return this.findContentRoot(message);
    }
    turns() {
      const byTurn = document.querySelectorAll(TURN_SEL);
      if (byTurn.length > 0) return Array.from(byTurn);
      return Array.from(document.querySelectorAll(TURN_FALLBACK_SEL));
    }
    lastTurnOfRole(role) {
      const turns = this.turns();
      for (let i = turns.length - 1; i >= 0; i--) {
        const t = turns[i];
        const attr = t.getAttribute("data-turn");
        if (attr === role) return t;
        if (attr === null && t.querySelector(`[data-message-author-role="${role}"]`)) return t;
      }
      const sel = role === "assistant" ? ASSISTANT_SEL : USER_SEL;
      const nodes = document.querySelectorAll(sel);
      return nodes.length > 0 ? nodes[nodes.length - 1] : null;
    }
    getLatestAssistantMessage() {
      const turn = this.lastTurnOfRole("assistant");
      if (!turn) return null;
      const message = turn.matches(ASSISTANT_SEL) ? turn : turn.querySelector(ASSISTANT_SEL) ?? turn;
      return { id: this.turnId(turn, message), element: message, content: this.findContentRoot(message) };
    }
    getLatestUserMessageId() {
      const turn = this.lastTurnOfRole("user");
      if (!turn) return null;
      const message = turn.matches(USER_SEL) ? turn : turn.querySelector(USER_SEL) ?? turn;
      return this.turnId(turn, message);
    }
    /**
     * メッセージ ID。data-turn-id / data-message-id を優先し、
     * 取れない場合のみ会話パス + 出現順で代用する。
     */
    turnId(turn, message) {
      const turnId = turn.getAttribute("data-turn-id");
      if (turnId) return `turn:${turnId}`;
      const msgId = message.getAttribute("data-message-id");
      if (msgId) return `msg:${msgId}`;
      const testid = turn.getAttribute("data-testid");
      if (testid) return `${location.pathname}:${testid}`;
      const siblings = this.turns();
      return `${location.pathname}:idx-${siblings.indexOf(turn)}`;
    }
    /** 本文（markdown レンダリング結果）のルート。無ければメッセージ要素自身。 */
    findContentRoot(el) {
      for (const sel of CONTENT_SELECTORS) {
        const hit = el.querySelector(sel);
        if (hit) return hit;
      }
      return el;
    }
    /**
     * 生成中かどうか。停止ボタン等が取れればそれを使うが、
     * ChatGPT の UI 変更で取れなくなる可能性が高いので、
     * observer 側の「本文が増え続けているか」判定と併用する前提。
     */
    isGenerating() {
      if (document.querySelector('[data-testid="stop-button"]')) return true;
      if (document.querySelector('button[aria-label*="Stop"], button[aria-label*="停止"]')) return true;
      if (document.querySelector('[class*="result-streaming"]')) return true;
      return false;
    }
    getComposer() {
      return document.querySelector("#prompt-textarea") ?? document.querySelector('[data-composer-body] [contenteditable="true"]') ?? document.querySelector('form [contenteditable="true"]') ?? document.querySelector("form textarea");
    }
    /**
     * 質問の送信操作を検出する。「読み上げを解禁してよい」の一番確かな根拠。
     *
     * ChatGPT 側がイベントを止めても拾えるよう、capture で document に付ける。
     * 日本語入力の変換確定の Enter（isComposing）は送信ではないので除外する。
     */
    onSubmit(cb) {
      const inComposer = (t) => {
        if (!(t instanceof Element)) return false;
        const composer = this.getComposer();
        return composer !== null && (composer === t || composer.contains(t));
      };
      const hasText = () => {
        var _a;
        return (((_a = this.getComposer()) == null ? void 0 : _a.textContent) ?? "").trim().length > 0;
      };
      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key !== "Enter" || e.shiftKey || e.isComposing || e.keyCode === 229) return;
          if (!inComposer(e.target) || !hasText()) return;
          cb();
        },
        true
      );
      document.addEventListener(
        "click",
        (e) => {
          const t = e.target;
          if (!(t instanceof Element)) return;
          if (t.closest('[data-testid="send-button"], button[aria-label*="送信"], button[aria-label*="Send"]')) {
            cb();
          }
        },
        true
      );
    }
    probe() {
      const turns = this.turns().length;
      const composer = this.getComposer() !== null;
      const ok = composer || turns > 0;
      const detail = `turns=${turns} composer=${composer}`;
      if (ok) log("ChatGPT", "probe ok", detail);
      else warn("ChatGPT", "DOM を認識できません", detail);
      return { ok, detail };
    }
  }
  function commonPrefixLength(a, b) {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
    return i;
  }
  class StreamTracker {
    constructor() {
      this.lastText = "";
      this.consumed = 0;
    }
    /** 現在の本文全体を渡すと、新しく増えた分だけを返す。 */
    push(fullText) {
      if (fullText === this.lastText) return "";
      if (fullText.startsWith(this.lastText)) {
        const delta = fullText.slice(this.consumed);
        this.lastText = fullText;
        this.consumed = fullText.length;
        return delta;
      }
      const common = commonPrefixLength(this.lastText, fullText);
      this.lastText = fullText;
      if (common >= this.consumed) {
        const delta = fullText.slice(this.consumed);
        this.consumed = fullText.length;
        return delta;
      }
      this.consumed = fullText.length;
      return "";
    }
    /** 直近に観測した本文全体 */
    get text() {
      return this.lastText;
    }
    get consumedLength() {
      return this.consumed;
    }
    reset() {
      this.lastText = "";
      this.consumed = 0;
    }
  }
  const HARD_BOUNDARY = /[。．.！!？?\n]/;
  const SOFT_BOUNDARY = /[、，,；;：:）)」』】　 ]/;
  const TRAILING = /[」』）)】"'…。！？!?]/;
  function hasSpeakableContent(text) {
    return /[\p{L}\p{N}]/u.test(text);
  }
  class SpeechChunker {
    constructor(opts) {
      this.opts = opts;
      this.buffer = "";
    }
    setOptions(opts) {
      this.opts = opts;
    }
    append(text) {
      this.buffer += text;
    }
    get pending() {
      return this.buffer;
    }
    clear() {
      this.buffer = "";
    }
    /**
     * 切り出せるチャンクを全て返す。
     * final=true なら残り全部を吐き出す（生成完了時）。
     */
    take(final) {
      const out = [];
      for (; ; ) {
        const cut = this.findCut(final);
        if (cut <= 0) break;
        const raw = this.buffer.slice(0, cut);
        this.buffer = this.buffer.slice(cut);
        const cleaned = raw.trim();
        if (cleaned && hasSpeakableContent(cleaned)) out.push(cleaned);
      }
      if (final) {
        const rest = this.buffer.trim();
        this.buffer = "";
        if (rest && hasSpeakableContent(rest)) out.push(rest);
      }
      return out;
    }
    /** 切り出し位置（exclusive index）。0 ならまだ切れない。 */
    findCut(final) {
      const { minimumChunkLength, maximumChunkLength } = this.opts;
      const buf = this.buffer;
      if (buf.length === 0) return 0;
      if (!final && buf.length < minimumChunkLength) return 0;
      const limit = Math.min(buf.length, maximumChunkLength);
      for (let i = minimumChunkLength - 1; i < limit; i++) {
        if (HARD_BOUNDARY.test(buf[i])) {
          let end = i + 1;
          while (end < buf.length && TRAILING.test(buf[end])) end++;
          if (!final && end >= buf.length && /[！？!?]$/.test(buf)) return 0;
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
  const DEFAULT_SANITIZE_OPTIONS = {
    urlMode: "announce",
    codeMode: "announce-once",
    tableMode: "announce",
    inlineCodeMaxLength: 24,
    readSymbols: false
  };
  const SYMBOL_WORDS = {
    _: " アンダーバー ",
    "-": " ハイフン ",
    ".": " ドット ",
    "/": " スラッシュ ",
    ":": " コロン ",
    "+": " プラス ",
    "#": " シャープ ",
    "@": " アット ",
    "~": " チルダ ",
    "*": " アスタリスク "
  };
  function expandSymbols(text) {
    const TOKEN = /[A-Za-z0-9]+(?:[_\-./:+#@~*][A-Za-z0-9]+)+/g;
    return text.replace(TOKEN, (token) => {
      if (!/[A-Za-z]/.test(token)) return token;
      return token.replace(/[_\-./:+#@~*]/g, (sym) => SYMBOL_WORDS[sym] ?? sym);
    });
  }
  const URL_RE = /https?:\/\/[^\s<>"'）)」』】]+/g;
  const BLOCK_TAGS = /* @__PURE__ */ new Set([
    "P",
    "DIV",
    "LI",
    "BR",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "BLOCKQUOTE",
    "UL",
    "OL",
    "TR",
    "HR",
    "SECTION",
    "ARTICLE"
  ]);
  function extractSpeechText(root, opts) {
    const parts = [];
    walk(root, opts, parts, { blocks: 0 });
    return normalizeWhitespace(parts.join(""));
  }
  function walk(node, opts, out, state) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = replaceUrls(node.nodeValue ?? "", opts.urlMode);
      out.push(opts.readSymbols ? expandSymbols(t) : t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node;
    const tag = el.tagName;
    if (isHidden(el) || isCitation(el)) return;
    if (tag === "PRE") {
      if (opts.codeMode === "read") {
        out.push(`
${el.textContent ?? ""}
`);
        return;
      }
      state.blocks++;
      if (opts.codeMode === "skip") return;
      if (opts.codeMode === "announce-once" && state.blocks > 1) return;
      out.push(isDiagram(el.textContent ?? "") ? "\nここに図があります。\n" : "\nここにコードがあります。\n");
      return;
    }
    if (tag === "TABLE") {
      if (opts.tableMode === "skip") return;
      if (opts.tableMode === "announce") {
        out.push("\n表があります。\n");
        return;
      }
    }
    if (tag === "CODE" && el.closest("pre") === null) {
      const t = (el.textContent ?? "").trim();
      if (t.length > opts.inlineCodeMaxLength) {
        out.push("コード");
        return;
      }
      out.push(opts.readSymbols ? expandSymbols(t) : t);
      return;
    }
    if (tag === "A") {
      const text = (el.textContent ?? "").trim();
      const href = el.getAttribute("href") ?? "";
      const textIsUrl = /^https?:\/\//.test(text);
      if (textIsUrl || text.length === 0) {
        out.push(linkPlaceholder(opts.urlMode, href));
      } else {
        const t = replaceUrls(text, opts.urlMode);
        out.push(opts.readSymbols ? expandSymbols(t) : t);
      }
      return;
    }
    if (tag === "IMG" || tag === "SVG" || tag === "BUTTON" || tag === "SCRIPT" || tag === "STYLE") return;
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) out.push("\n");
    for (const child of Array.from(el.childNodes)) walk(child, opts, out, state);
    if (isBlock) out.push("\n");
  }
  function isDiagram(text) {
    const body = text.replace(/\s/g, "");
    if (body.length === 0) return false;
    const boxChars = (body.match(/[|｜│─━┃┌┐└┘├┤┬┴┼＋+\-=_*▲▼◀▶←→↑↓]/g) ?? []).length;
    return boxChars / body.length >= 0.3;
  }
  function isHidden(el) {
    if (el.getAttribute("aria-hidden") === "true") return true;
    if (el.hasAttribute("hidden")) return true;
    const cls = el.getAttribute("class") ?? "";
    return /\bsr-only\b|\bvisually-hidden\b/.test(cls);
  }
  function isCitation(el) {
    const tag = el.tagName;
    if (tag === "SUP") return true;
    const testid = el.getAttribute("data-testid") ?? "";
    if (/citation|sources|search-result|turn-source/i.test(testid)) return true;
    if (el.hasAttribute("data-citation")) return true;
    return false;
  }
  function linkPlaceholder(mode, href) {
    if (mode === "skip") return "";
    if (mode === "read") return href;
    return "リンクがあります。";
  }
  function replaceUrls(text, mode) {
    if (mode === "read") return text;
    return text.replace(URL_RE, mode === "skip" ? "" : "リンクがあります。");
  }
  const DECORATION_RE = /[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0E}\u{FE0F}\u{200D}\u{20E3}]/gu;
  function stripDecorations(text) {
    return text.replace(DECORATION_RE, "");
  }
  function normalizeWhitespace(text) {
    return stripDecorations(text).replace(/\r\n?/g, "\n").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{2,}/g, "\n").replace(/^\s+|\s+$/g, "");
  }
  const TICK_MS = 200;
  const SETTLE_MS = 1200;
  function conversationKey(pathname) {
    const m = pathname.match(/\/c\/([^/]+)/);
    return m ? m[1] : null;
  }
  class ChatObserver {
    constructor(deps) {
      this.deps = deps;
      this.mo = null;
      this.timer = null;
      this.scheduled = false;
      this.currentMessageId = null;
      this.tracker = new StreamTracker();
      this.lastUserMessageId = null;
      this.lastDeltaAt = 0;
      this.armed = false;
      this.live = false;
      this.finished = false;
      this.conversationPath = location.pathname;
      this.chunker = new SpeechChunker(deps.getChunkerOptions());
    }
    /** 入力欄での送信操作を検出したときに呼ぶ */
    notifySubmitted() {
      this.armed = true;
      this.live = false;
      log("Observer", "送信を検出");
      this.deps.onNewUserMessage();
    }
    start() {
      const root = this.deps.adapter.getObserverRoot();
      this.lastUserMessageId = this.deps.adapter.getLatestUserMessageId();
      this.mo = new MutationObserver(() => this.schedule());
      this.mo.observe(root, { childList: true, subtree: true, characterData: true });
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
      log("Observer", "started");
    }
    stop() {
      var _a;
      (_a = this.mo) == null ? void 0 : _a.disconnect();
      this.mo = null;
      if (this.timer !== null) window.clearInterval(this.timer);
      this.timer = null;
    }
    /** 読み上げ中断時に、未確定バッファも破棄する */
    resetBuffers() {
      this.chunker.clear();
    }
    schedule() {
      if (this.scheduled) return;
      this.scheduled = true;
      requestAnimationFrame(() => {
        this.scheduled = false;
        this.tick();
      });
    }
    extract(content) {
      return extractSpeechText(content, this.deps.getSanitizeOptions());
    }
    tick() {
      const adapter = this.deps.adapter;
      if (location.pathname !== this.conversationPath) {
        const prevKey = conversationKey(this.conversationPath);
        this.conversationPath = location.pathname;
        this.lastUserMessageId = null;
        if (prevKey !== null && prevKey !== conversationKey(location.pathname)) {
          this.armed = false;
          this.live = false;
          log("Observer", "会話が切り替わった", location.pathname);
        } else {
          log("Observer", "新規チャットの URL が確定", location.pathname);
        }
      }
      const userId = adapter.getLatestUserMessageId();
      if (userId !== null && userId !== this.lastUserMessageId) {
        const known = this.lastUserMessageId !== null;
        this.lastUserMessageId = userId;
        if (known) {
          this.armed = true;
          this.live = false;
          log("Observer", "new user message", userId);
          this.deps.onNewUserMessage();
        } else {
          log("Observer", "既存の質問を基準として記録", userId);
        }
      }
      const generating = adapter.isGenerating();
      if (generating) this.armed = true;
      const latest = adapter.getLatestAssistantMessage();
      if (!latest) return;
      if (latest.id !== this.currentMessageId) {
        const prevId = this.currentMessageId;
        this.currentMessageId = latest.id;
        if (this.live && this.isContinuation(this.extract(latest.content))) {
          log("Observer", "回答の ID が差し替わった（続きから読む）", prevId, "→", latest.id);
        } else {
          this.beginMessage(latest);
          if (!this.live) return;
        }
      }
      if (!this.deps.getEnabled()) {
        this.tracker.push(this.extract(latest.content));
        this.chunker.clear();
        return;
      }
      const text = this.extract(latest.content);
      if (text === "" && this.tracker.consumedLength > 0) return;
      const delta = this.tracker.push(text);
      if (!this.live) {
        if (!delta || this.finished) return;
        this.live = true;
        log("Observer", "取り込み済みの回答が伸びたので読み始める", latest.id);
      }
      this.chunker.setOptions(this.deps.getChunkerOptions());
      if (delta) {
        this.chunker.append(delta);
        this.lastDeltaAt = Date.now();
      }
      const settled = Date.now() - this.lastDeltaAt >= SETTLE_MS;
      const done = !generating && settled;
      const chunks = this.chunker.take(done);
      for (const c of chunks) {
        log("Chunker", "chunk", c);
        this.deps.onChunk(c);
      }
      if (done && this.tracker.consumedLength > 0) {
        this.live = false;
        this.finished = true;
        log("Observer", "回答を読み切った", latest.id);
      }
    }
    /** 差し替え後の本文が、今読んでいる本文の続きとみなせるか */
    isContinuation(text) {
      const tracked = this.tracker.text;
      return text === "" || text.startsWith(tracked) || tracked.startsWith(text);
    }
    /** 別の回答に切り替わった。解禁されていれば読み始め、そうでなければ黙って取り込む。 */
    beginMessage(latest) {
      this.finished = false;
      this.tracker.reset();
      this.chunker.clear();
      this.lastDeltaAt = Date.now();
      if (!this.armed) {
        this.live = false;
        this.tracker.push(this.extract(latest.content));
        log("Observer", "既存の回答として無言で取り込み", latest.id);
        return;
      }
      log("Observer", "new assistant message", latest.id);
      this.armed = false;
      this.live = true;
    }
  }
  const PICKER_CSS = `
.voice { display: flex; align-items: center; gap: 8px; width: 100%; padding: 5px 8px;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
  border: 1px solid #ccc; border-radius: 10px; background: transparent; }
.voice:hover { background: rgba(127,127,127,.08); }
.voice .face { width: 40px; height: 40px; }
.voice .who { flex: 1; min-width: 0; line-height: 1.25; }
.voice .who b { display: block; font-size: 13px; }
.voice .who span { font-size: 11px; opacity: .75; }
.voice .caret { opacity: .6; }
.face { flex: none; width: 28px; height: 28px; border-radius: 8px; object-fit: cover;
  background: rgba(127,127,127,.15); }

.picker { position: fixed; right: 284px; bottom: 16px; z-index: 2147483001;
  width: min(460px, calc(100vw - 300px)); height: min(480px, calc(100vh - 32px));
  display: flex; flex-direction: column; overflow: hidden;
  background: #fff; color: #1b1b1b; border: 1px solid #d5d5d5; border-radius: 12px;
  box-shadow: 0 10px 32px rgba(0,0,0,.22); }
.picker[hidden] { display: none; }
@media (max-width: 760px) {
  .picker { right: 16px; width: calc(100vw - 32px); }
}
.picker-head { padding: 8px; border-bottom: 1px solid rgba(128,128,128,.25); }
.search { width: 100%; box-sizing: border-box; font: inherit; padding: 5px 8px;
  border: 1px solid #ccc; border-radius: 8px; }
.cols { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; }
.col { overflow-y: auto; padding: 4px; }
.col + .col { border-left: 1px solid rgba(128,128,128,.25); }
.item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px;
  font: inherit; color: inherit; text-align: left; cursor: pointer;
  border: 0; border-radius: 8px; background: transparent; }
.item:hover, .item.active { background: rgba(127,127,127,.14); }
.item.current { font-weight: 600; }
.item .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .count, .item .check { flex: none; font-size: 11px; opacity: .6; }
.empty { padding: 12px; font-size: 12px; opacity: .6; }

@media (prefers-color-scheme: dark) {
  .picker { background: #202123; color: #ececec; border-color: #3a3a3a; }
  .voice { border-color: #4a4a4a; }
  .search { background: #2b2c2f; color: #ececec; border-color: #4a4a4a; }
}
`;
  class VoicePicker {
    constructor(deps) {
      this.deps = deps;
      this.characters = [];
      this.selectedId = null;
      this.activeChar = null;
      this.trigger = document.createElement("button");
      this.trigger.className = "voice";
      this.trigger.type = "button";
      this.trigger.innerHTML = `
      <img class="face" alt="">
      <span class="who"><b>話者を取得中…</b><span></span></span>
      <span class="caret">▾</span>`;
      this.trigger.addEventListener("click", () => this.toggle());
      this.panel = document.createElement("div");
      this.panel.className = "picker";
      this.panel.hidden = true;
      this.panel.innerHTML = `
      <div class="picker-head">
        <input class="search" type="search" placeholder="キャラ名・スタイルで絞り込み（例: ささやき）">
      </div>
      <div class="cols"><div class="col chars"></div><div class="col styles"></div></div>`;
      this.search = this.panel.querySelector(".search");
      this.charCol = this.panel.querySelector(".chars");
      this.styleCol = this.panel.querySelector(".styles");
      this.search.addEventListener("input", () => this.renderCharacters());
      this.search.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.close();
      });
      document.addEventListener(
        "mousedown",
        (e) => {
          if (this.panel.hidden) return;
          if (!e.composedPath().includes(this.deps.host)) this.close();
        },
        true
      );
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !this.panel.hidden) this.close();
      });
      this.deps.root.appendChild(this.panel);
    }
    /** パネル内に置くボタン */
    get element() {
      return this.trigger;
    }
    setOptions(options, selectedId) {
      const byUuid = /* @__PURE__ */ new Map();
      for (const o of options) {
        let c = byUuid.get(o.speakerUuid);
        if (!c) {
          c = { name: o.speakerName, uuid: o.speakerUuid, styles: [] };
          byUuid.set(o.speakerUuid, c);
        }
        c.styles.push(o);
      }
      this.characters = Array.from(byUuid.values());
      this.setSelected(selectedId);
    }
    setSelected(styleId) {
      this.selectedId = styleId;
      const opt = this.find(styleId);
      const face = this.trigger.querySelector(".face");
      const name = this.trigger.querySelector(".who b");
      const style = this.trigger.querySelector(".who span");
      if (!opt) {
        name.textContent = this.characters.length ? "話者を選んでください" : "話者なし";
        style.textContent = "";
        face.removeAttribute("src");
        return;
      }
      name.textContent = opt.speakerName;
      style.textContent = opt.styleName;
      this.setIcon(face, opt.styleId);
    }
    find(styleId) {
      if (styleId === null) return void 0;
      for (const c of this.characters) {
        const hit = c.styles.find((s) => s.styleId === styleId);
        if (hit) return hit;
      }
      return void 0;
    }
    toggle() {
      if (this.panel.hidden) this.open();
      else this.close();
    }
    open() {
      var _a, _b, _c;
      if (this.characters.length === 0) return;
      this.panel.hidden = false;
      this.search.value = "";
      this.activeChar = ((_a = this.find(this.selectedId)) == null ? void 0 : _a.speakerUuid) ?? this.characters[0].uuid;
      this.renderCharacters();
      (_c = (_b = this.charCol.querySelector(".item.active")) == null ? void 0 : _b.scrollIntoView) == null ? void 0 : _c.call(_b, { block: "center" });
      this.search.focus();
    }
    close() {
      this.panel.hidden = true;
    }
    matches(c, q) {
      if (!q) return c.styles;
      if (c.name.includes(q)) return c.styles;
      const styles = c.styles.filter((s) => s.styleName.includes(q));
      return styles.length ? styles : null;
    }
    renderCharacters() {
      const q = this.search.value.trim();
      this.charCol.textContent = "";
      const visible = this.characters.filter((c) => this.matches(c, q) !== null);
      if (visible.length === 0) {
        this.charCol.innerHTML = '<div class="empty">見つかりません</div>';
        this.styleCol.textContent = "";
        return;
      }
      if (!visible.some((c) => c.uuid === this.activeChar)) this.activeChar = visible[0].uuid;
      const current = this.find(this.selectedId);
      for (const c of visible) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item";
        if (c.uuid === this.activeChar) btn.classList.add("active");
        if ((current == null ? void 0 : current.speakerUuid) === c.uuid) btn.classList.add("current");
        btn.innerHTML = `<img class="face" alt=""><span class="label"></span><span class="count"></span>`;
        btn.querySelector(".label").textContent = c.name;
        btn.querySelector(".count").textContent = c.styles.length > 1 ? `${c.styles.length} ›` : "";
        this.setIcon(btn.querySelector(".face"), c.styles[0].styleId);
        const activate = () => {
          if (this.activeChar === c.uuid) return;
          this.activeChar = c.uuid;
          this.charCol.querySelectorAll(".item.active").forEach((el) => el.classList.remove("active"));
          btn.classList.add("active");
          this.renderStyles(c, q);
        };
        btn.addEventListener("mouseenter", activate);
        btn.addEventListener("focus", activate);
        btn.addEventListener("click", () => {
          activate();
          if (c.styles.length === 1) this.choose(c.styles[0]);
        });
        this.charCol.appendChild(btn);
      }
      const active = visible.find((c) => c.uuid === this.activeChar);
      this.renderStyles(active, q);
    }
    renderStyles(c, q) {
      this.styleCol.textContent = "";
      const styles = this.matches(c, q) ?? c.styles;
      for (const s of styles) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "item";
        if (s.styleId === this.selectedId) btn.classList.add("current");
        btn.innerHTML = `<img class="face" alt=""><span class="label"></span><span class="check"></span>`;
        btn.querySelector(".label").textContent = s.styleName;
        btn.querySelector(".check").textContent = s.styleId === this.selectedId ? "✓" : "";
        this.setIcon(btn.querySelector(".face"), s.styleId);
        btn.addEventListener("click", () => this.choose(s));
        this.styleCol.appendChild(btn);
      }
    }
    choose(opt) {
      this.close();
      this.setSelected(opt.styleId);
      this.deps.onSelect(opt);
    }
    setIcon(img, styleId) {
      img.dataset.styleId = String(styleId);
      void this.deps.loadIcon(styleId).then((url) => {
        if (url && img.dataset.styleId === String(styleId)) img.src = url;
      });
    }
  }
  const CSS$1 = `
:host { all: initial; }
.panel {
  position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
  width: 260px; font: 12px/1.5 -apple-system, "Hiragino Sans", sans-serif;
  color: #1b1b1b; background: #fff; border: 1px solid #d5d5d5;
  border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden;
}
.head { display: flex; align-items: center; gap: 6px; padding: 8px 10px;
  border-bottom: 1px solid rgba(128,128,128,.25); cursor: pointer; }
.title { font-weight: 600; flex: 1; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #999; flex: none; }
.dot.connected { background: #22c55e; }
.dot.connecting { background: #eab308; }
.dot.disconnected { background: #9ca3af; }
.body { padding: 8px 10px; display: grid; gap: 7px; }
.body.hidden { display: none; }
.row { display: flex; align-items: center; gap: 6px; }
.row > label { flex: none; opacity: .8; }
select, input[type=number] { flex: 1; min-width: 0; font: inherit; padding: 2px 4px;
  border: 1px solid #ccc; border-radius: 6px; background: #fff; color: inherit; }
input[type=range] { flex: 1; min-width: 0; }
.btn { flex: 1; font: inherit; padding: 4px 6px; border: 1px solid #ccc;
  border-radius: 7px; background: #f6f6f6; cursor: pointer; color: inherit; }
.btn:hover { filter: brightness(.96); }
.btn.on { background: #22c55e; border-color: #22c55e; color: #fff; }
.btn.stop { background: #ef4444; border-color: #ef4444; color: #fff; }
.status { font-size: 11px; opacity: .8; min-height: 15px; }
.status.err { color: #ef4444; opacity: 1; }
.val { flex: none; width: 34px; text-align: right; font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; opacity: .8; font-size: 11px; }
.chk { display: flex; align-items: center; gap: 5px; font-size: 11px; }

/* ダーク配色は必ず最後に置く。前に置くと通常の指定に上書きされ、白地に白文字になる */
@media (prefers-color-scheme: dark) {
  .panel { color: #ececec; background: #202123; border-color: #3a3a3a; }
  select, input[type=number] { color: #ececec; background: #2b2c2f; border-color: #4a4a4a; }
  .btn { background: #2b2c2f; border-color: #4a4a4a; color: #ececec; }
  .btn.on { background: #22c55e; border-color: #22c55e; color: #fff; }
  .btn.stop { background: #ef4444; border-color: #ef4444; color: #fff; }
}
`;
  class UiPanel {
    constructor(settings, cb) {
      this.settings = settings;
      this.cb = cb;
      this.collapsed = false;
      this.host = document.createElement("div");
      this.host.id = "chatgpt-voicevox-bridge-root";
      this.root = this.host.attachShadow({ mode: "open" });
      this.render();
      document.body.appendChild(this.host);
    }
    render() {
      const style = document.createElement("style");
      style.textContent = CSS$1 + PICKER_CSS;
      const panel = document.createElement("div");
      panel.className = "panel";
      panel.innerHTML = `
      <div class="head" part="head">
        <span class="dot disconnected" id="dot"></span>
        <span class="title">VOICEVOX</span>
        <span id="conn" style="font-size:11px;opacity:.75">未接続</span>
      </div>
      <div class="body" id="body">
        <div class="row" id="voiceSlot"></div>
        <div class="row">
          <label>話速</label>
          <input type="range" id="speed" min="0.5" max="2" step="0.05">
          <span class="val" id="speedVal"></span>
        </div>
        <div class="row">
          <label>音量</label>
          <input type="range" id="volume" min="0" max="2" step="0.05">
          <span class="val" id="volumeVal"></span>
        </div>
        <div class="row" title="文と文の間の無音。小さいほど箇条書きの移りが速くなります">
          <label>文間</label>
          <input type="range" id="gap" min="0" max="0.3" step="0.01">
          <span class="val" id="gapVal"></span>
        </div>
        <div class="row">
          <button class="btn" id="toggle">🔊 ON</button>
          <button class="btn stop" id="stop">■ STOP</button>
        </div>
        <div class="row">
          <button class="btn" id="speakSel" title="ページ上で選択した部分だけを読み上げます">
            🔈 選択した部分を読む
          </button>
        </div>
        <div class="status" id="status"></div>
        <details>
          <summary>詳細設定</summary>
          <div class="body" style="padding:6px 0 0">
            <div class="row"><label>コード</label>
              <select id="codeMode">
                <option value="skip">読まない</option>
                <option value="announce-once">最初の1回だけ伝える</option>
                <option value="announce">毎回あることを伝える</option>
                <option value="read">読む</option>
              </select></div>
            <div class="row"><label>URL</label>
              <select id="urlMode">
                <option value="skip">読まない</option>
                <option value="announce">あることだけ伝える</option>
                <option value="read">読む</option>
              </select></div>
            <div class="row"><label>表</label>
              <select id="tableMode">
                <option value="skip">読まない</option>
                <option value="announce">あることだけ伝える</option>
                <option value="read">読む</option>
              </select></div>
            <label class="chk" title="ファイル名やパスの中の _ - . / を読み上げます">
              <input type="checkbox" id="readSymbols">記号を読む（_ - . /）</label>
            <label class="chk"><input type="checkbox" id="stopOnNew">新しい質問で読み上げ停止</label>
            <label class="chk"><input type="checkbox" id="debug">デバッグログ</label>
            <div class="row">
              <button class="btn" id="test">テスト発声</button>
              <button class="btn" id="reconnect">再接続</button>
            </div>
          </div>
        </details>
      </div>`;
      this.root.append(style, panel);
      const q = (id) => this.root.getElementById(id);
      this.el = {
        dot: q("dot"),
        conn: q("conn"),
        body: q("body"),
        voiceSlot: q("voiceSlot"),
        speed: q("speed"),
        speedVal: q("speedVal"),
        volume: q("volume"),
        volumeVal: q("volumeVal"),
        gap: q("gap"),
        gapVal: q("gapVal"),
        toggle: q("toggle"),
        stop: q("stop"),
        status: q("status"),
        codeMode: q("codeMode"),
        urlMode: q("urlMode"),
        tableMode: q("tableMode"),
        stopOnNew: q("stopOnNew"),
        debug: q("debug"),
        readSymbols: q("readSymbols"),
        test: q("test"),
        reconnect: q("reconnect"),
        speakSel: q("speakSel")
      };
      this.root.querySelector(".head").addEventListener("click", () => {
        this.collapsed = !this.collapsed;
        this.el.body.classList.toggle("hidden", this.collapsed);
        this.picker.close();
      });
      this.el.toggle.addEventListener("click", () => this.cb.onToggleEnabled(!this.settings.enabled));
      this.el.stop.addEventListener("click", () => this.cb.onStop());
      this.el.test.addEventListener("click", () => this.cb.onTestSpeak());
      this.el.speakSel.addEventListener("mousedown", (e) => e.preventDefault());
      this.el.speakSel.addEventListener("click", () => this.cb.onSpeakSelection());
      this.el.reconnect.addEventListener("click", () => this.cb.onReconnect());
      this.picker = new VoicePicker({
        root: this.root,
        host: this.host,
        loadIcon: this.cb.loadIcon,
        onSelect: (opt) => this.cb.onChange({ styleId: opt.styleId, speakerLabel: opt.label })
      });
      this.el.voiceSlot.appendChild(this.picker.element);
      const range = (key, input, out) => {
        input.addEventListener("input", () => {
          const v = Number(input.value);
          out.textContent = v.toFixed(2);
          this.cb.onChange({ [key]: v });
        });
      };
      range("speedScale", this.el.speed, this.el.speedVal);
      range("volumeScale", this.el.volume, this.el.volumeVal);
      this.el.gap.addEventListener("input", () => {
        const v = Number(this.el.gap.value);
        this.el.gapVal.textContent = v.toFixed(2);
        this.cb.onChange({ postPhonemeLength: v });
      });
      for (const key of ["codeMode", "urlMode", "tableMode"]) {
        this.el[key].addEventListener("change", (e) => {
          this.cb.onChange({ [key]: e.target.value });
        });
      }
      this.el.readSymbols.addEventListener("change", (e) => {
        this.cb.onChange({ readSymbols: e.target.checked });
      });
      this.el.stopOnNew.addEventListener("change", (e) => {
        this.cb.onChange({ stopOnNewQuestion: e.target.checked });
      });
      this.el.debug.addEventListener("change", (e) => {
        this.cb.onChange({ debug: e.target.checked });
      });
    }
    setSettings(s) {
      this.settings = s;
      this.el.speed.value = String(s.speedScale);
      this.el.speedVal.textContent = s.speedScale.toFixed(2);
      this.el.volume.value = String(s.volumeScale);
      this.el.volumeVal.textContent = s.volumeScale.toFixed(2);
      this.el.gap.value = String(s.postPhonemeLength);
      this.el.gapVal.textContent = s.postPhonemeLength.toFixed(2);
      this.el.codeMode.value = s.codeMode;
      this.el.urlMode.value = s.urlMode;
      this.el.tableMode.value = s.tableMode;
      this.el.readSymbols.checked = s.readSymbols;
      this.el.stopOnNew.checked = s.stopOnNewQuestion;
      this.el.debug.checked = s.debug;
      this.el.toggle.textContent = s.enabled ? "🔊 ON" : "🔇 OFF";
      this.el.toggle.classList.toggle("on", s.enabled);
      this.picker.setSelected(s.styleId);
    }
    setSpeakers(options, selectedId) {
      this.picker.setOptions(options, selectedId);
    }
    setConnection(state, text) {
      this.el.dot.className = `dot ${state}`;
      this.el.conn.textContent = text;
    }
    setStatus(text, isError = false) {
      this.el.status.textContent = text;
      this.el.status.classList.toggle("err", isError);
    }
    /**
     * ChatGPT は SPA なので、ページ遷移で body ごと作り直されると
     * パネルが DOM から外れて消える。外れていたら付け直す。
     */
    ensureMounted() {
      if (!document.body.contains(this.host)) {
        document.body.appendChild(this.host);
      }
    }
    destroy() {
      this.host.remove();
    }
  }
  const BTN_ATTR = "data-cvb-read-btn";
  const MARK_ATTR = "data-cvb-actions";
  const STYLE_ID = "cvb-actions-style";
  const CSS = `
[${BTN_ATTR}] {
  position: absolute; top: 6px; right: 6px; z-index: 50;
  font: 11px/1 -apple-system, "Hiragino Sans", sans-serif;
  padding: 4px 8px; border-radius: 999px; cursor: pointer;
  border: 1px solid rgba(128,128,128,.45);
  background: rgba(127,127,127,.15); color: inherit;
  opacity: 0; transition: opacity .12s ease;
}
[${MARK_ATTR}]:hover > [${BTN_ATTR}],
[${BTN_ATTR}]:focus-visible { opacity: 1; }
[${BTN_ATTR}]:hover { background: rgba(34,197,94,.25); border-color: rgba(34,197,94,.7); }
`;
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  function syncReadButtons(turns, onRead) {
    ensureStyle();
    for (const turn of turns) {
      if (turn.hasAttribute(MARK_ATTR)) continue;
      turn.setAttribute(MARK_ATTR, "");
      if (getComputedStyle(turn).position === "static") turn.style.position = "relative";
      const btn = document.createElement("button");
      btn.setAttribute(BTN_ATTR, "");
      btn.type = "button";
      btn.textContent = "🔊 この回答を読む";
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        onRead(turn);
      });
      turn.appendChild(btn);
    }
  }
  function removeReadButtons() {
    document.querySelectorAll(`[${BTN_ATTR}]`).forEach((b) => b.remove());
    document.querySelectorAll(`[${MARK_ATTR}]`).forEach((t) => t.removeAttribute(MARK_ATTR));
  }
  function getSelectionFragment() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    return sel.getRangeAt(0).cloneContents();
  }
  class IconCache {
    constructor(client) {
      this.client = client;
      this.infos = /* @__PURE__ */ new Map();
      this.icons = /* @__PURE__ */ new Map();
      this.byStyle = /* @__PURE__ */ new Map();
    }
    setOptions(options) {
      this.byStyle = new Map(options.map((o) => [o.styleId, o]));
    }
    /** スタイルの顔アイコン（表示用 URL）。取れなければ null。 */
    icon(styleId) {
      const cached = this.icons.get(styleId);
      if (cached) return cached;
      const job = (async () => {
        const opt = this.byStyle.get(styleId);
        if (!opt) return null;
        const info = await this.info(opt.speakerUuid);
        const resource = info == null ? void 0 : info.styleIcons.get(styleId);
        if (!resource) return null;
        try {
          return await this.client.imageUrl(resource);
        } catch (e) {
          warn("UI", "アイコン取得に失敗", styleId, e);
          return null;
        }
      })();
      this.icons.set(styleId, job);
      return job;
    }
    info(uuid) {
      const cached = this.infos.get(uuid);
      if (cached) return cached;
      const job = this.client.speakerInfo(uuid).catch((e) => {
        warn("UI", "speaker_info 取得に失敗", uuid, e);
        this.infos.delete(uuid);
        return null;
      });
      this.infos.set(uuid, job);
      return job;
    }
  }
  function main() {
    let settings = loadSettings();
    setDebug(settings.debug);
    const client = new VoicevoxClient(settings.engineOrigin);
    const adapter = new ChatGptAdapter();
    const icons = new IconCache(client);
    let styleOptions = [];
    const queue = new PlaybackQueue({
      client,
      getStyleId: () => settings.styleId,
      getParams: () => ({
        speedScale: settings.speedScale,
        volumeScale: settings.volumeScale,
        pitchScale: settings.pitchScale,
        intonationScale: settings.intonationScale,
        prePhonemeLength: settings.prePhonemeLength,
        postPhonemeLength: settings.postPhonemeLength,
        pauseLengthScale: settings.pauseLengthScale
      }),
      onError: (msg) => {
        ui.setStatus(msg, true);
        if (msg.includes("接続")) void connect();
      },
      onStateChange: (s) => {
        if (!s.speaking && s.queued === 0) ui.setStatus("");
        else ui.setStatus(`${s.speaking ? "読み上げ中" : "合成中"}（待ち ${s.queued}）`);
      }
    });
    const ui = new UiPanel(settings, {
      onToggleEnabled: (v) => {
        update({ enabled: v });
        if (!v) {
          stopSpeaking();
          removeReadButtons();
        }
      },
      onStop: () => stopSpeaking(),
      onReconnect: () => void connect(),
      onTestSpeak: () => queue.enqueue("ボイスボックス接続テストです。"),
      onSpeakSelection: () => speakSelection(),
      loadIcon: (styleId) => icons.icon(styleId),
      onChange: (patch) => update(patch)
    });
    const sanitizeOptions = () => ({
      ...DEFAULT_SANITIZE_OPTIONS,
      urlMode: settings.urlMode,
      codeMode: settings.codeMode,
      tableMode: settings.tableMode,
      readSymbols: settings.readSymbols
    });
    const chunkerOptions = () => ({
      minimumChunkLength: settings.minimumChunkLength,
      preferredChunkLength: settings.preferredChunkLength,
      maximumChunkLength: settings.maximumChunkLength
    });
    function speakElement(el) {
      stopSpeaking();
      const text = extractSpeechText(el, sanitizeOptions());
      if (!text) {
        ui.setStatus("読み上げる内容がありません", true);
        return;
      }
      const chunker = new SpeechChunker(chunkerOptions());
      chunker.append(text);
      for (const c of chunker.take(true)) queue.enqueue(c);
    }
    function speakSelection() {
      const fragment = getSelectionFragment();
      if (!fragment) {
        ui.setStatus("先に読みたい部分を選択してください", true);
        return;
      }
      const holder = document.createElement("div");
      holder.appendChild(fragment);
      speakElement(holder);
    }
    const observer = new ChatObserver({
      adapter,
      getEnabled: () => settings.enabled,
      getSanitizeOptions: sanitizeOptions,
      getChunkerOptions: chunkerOptions,
      onChunk: (text) => {
        if (!settings.enabled) return;
        queue.enqueue(text);
      },
      onNewUserMessage: () => {
        if (settings.stopOnNewQuestion) stopSpeaking();
      }
    });
    function stopSpeaking() {
      queue.stopAll();
      observer.resetBuffers();
      ui.setStatus("");
    }
    function update(patch) {
      settings = { ...settings, ...patch };
      saveSettings(settings);
      setDebug(settings.debug);
      ui.setSettings(settings);
    }
    async function connect() {
      ui.setConnection("connecting", "接続中…");
      try {
        const version = await client.version();
        const speakers = await client.speakers();
        styleOptions = flattenStyles(speakers);
        icons.setOptions(styleOptions);
        const chosen = resolveStyle(styleOptions, settings.styleId);
        ui.setSpeakers(styleOptions, (chosen == null ? void 0 : chosen.styleId) ?? null);
        if (chosen && chosen.styleId !== settings.styleId) {
          update({ styleId: chosen.styleId, speakerLabel: chosen.label });
        } else {
          ui.setSettings(settings);
        }
        ui.setConnection("connected", `v${version}`);
        ui.setStatus(chosen ? "" : "話者が見つかりません", !chosen);
        log("VOICEVOX", "connected", version, `${styleOptions.length} styles`);
      } catch (e) {
        warn("VOICEVOX", "connect failed", e);
        ui.setConnection("disconnected", "未接続");
        ui.setStatus(`${describeError(e)}。VOICEVOXを起動してください`, true);
      }
    }
    ui.setSettings(settings);
    const probe = adapter.probe();
    if (!probe.ok) ui.setStatus("ChatGPTの画面を認識できません", true);
    if (!gmAvailable()) {
      warn("Main", "GM_xmlhttpRequest が使えません。fetch へフォールバックします（CORSに注意）");
    }
    observer.start();
    adapter.onSubmit(() => observer.notifySubmitted());
    void connect();
    window.setInterval(() => {
      try {
        ui.ensureMounted();
      } catch (e) {
        warn("UI", "パネルの再設置に失敗", e);
      }
      if (!settings.enabled) return;
      try {
        syncReadButtons(adapter.assistantTurns(), (turn) => speakElement(adapter.contentOfTurn(turn)));
      } catch (e) {
        warn("UI", "ボタン差し込みに失敗", e);
      }
    }, 1e3);
    log("Main", "ChatGPT → VOICEVOX Bridge started");
  }
  try {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => main(), { once: true });
    } else {
      main();
    }
  } catch (e) {
    error("Main", "fatal", e);
  }

})();