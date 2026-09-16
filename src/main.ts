import { loadSettings, saveSettings, type Settings } from './settings';
import { setDebug, log, warn, error } from './logger';
import { VoicevoxClient, flattenStyles, resolveStyle, describeError, type StyleOption } from './voicevox-client';
import { PlaybackQueue } from './playback-queue';
import { ChatGptAdapter } from './chatgpt-adapter';
import { ChatObserver } from './observer';
import { UiPanel } from './ui';
import { DEFAULT_SANITIZE_OPTIONS, extractSpeechText, type SanitizeOptions } from './speech-sanitizer';
import { SpeechChunker, type ChunkerOptions } from './chunker';
import { syncReadButtons, removeReadButtons, getSelectionFragment } from './message-actions';
import { gmAvailable } from './http';

function main(): void {
  let settings: Settings = loadSettings();
  setDebug(settings.debug);

  const client = new VoicevoxClient(settings.engineOrigin);
  const adapter = new ChatGptAdapter();
  let styleOptions: StyleOption[] = [];

  const queue = new PlaybackQueue({
    client,
    getStyleId: () => settings.styleId,
    getParams: () => ({
      speedScale: settings.speedScale,
      volumeScale: settings.volumeScale,
      pitchScale: settings.pitchScale,
      intonationScale: settings.intonationScale,
    }),
    onError: (msg) => {
      ui.setStatus(msg, true);
      if (msg.includes('接続')) void connect();
    },
    onStateChange: (s) => {
      if (!s.speaking && s.queued === 0) ui.setStatus('');
      else ui.setStatus(`${s.speaking ? '読み上げ中' : '合成中'}（待ち ${s.queued}）`);
    },
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
    onTestSpeak: () => queue.enqueue('ボイスボックス接続テストです。'),
    onSpeakSelection: () => speakSelection(),
    onChange: (patch) => update(patch),
  });

  const sanitizeOptions = (): SanitizeOptions => ({
    ...DEFAULT_SANITIZE_OPTIONS,
    urlMode: settings.urlMode,
    codeMode: settings.codeMode,
    tableMode: settings.tableMode,
  });
  const chunkerOptions = (): ChunkerOptions => ({
    minimumChunkLength: settings.minimumChunkLength,
    preferredChunkLength: settings.preferredChunkLength,
    maximumChunkLength: settings.maximumChunkLength,
  });

  /** 指定した要素の内容を、今の設定で整形してから最初から読み上げる */
  function speakElement(el: Element): void {
    stopSpeaking();
    const text = extractSpeechText(el, sanitizeOptions());
    if (!text) {
      ui.setStatus('読み上げる内容がありません', true);
      return;
    }
    const chunker = new SpeechChunker(chunkerOptions());
    chunker.append(text);
    for (const c of chunker.take(true)) queue.enqueue(c);
  }

  function speakSelection(): void {
    const fragment = getSelectionFragment();
    if (!fragment) {
      ui.setStatus('先に読みたい部分を選択してください', true);
      return;
    }
    const holder = document.createElement('div');
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
    },
  });

  function stopSpeaking(): void {
    queue.stopAll();
    observer.resetBuffers();
    ui.setStatus('');
  }

  function update(patch: Partial<Settings>): void {
    settings = { ...settings, ...patch };
    saveSettings(settings);
    setDebug(settings.debug);
    ui.setSettings(settings);
  }

  async function connect(): Promise<void> {
    ui.setConnection('connecting', '接続中…');
    try {
      const version = await client.version();
      const speakers = await client.speakers();
      styleOptions = flattenStyles(speakers);
      const chosen = resolveStyle(styleOptions, settings.styleId);
      ui.setSpeakers(styleOptions, chosen?.styleId ?? null);
      if (chosen && chosen.styleId !== settings.styleId) {
        update({ styleId: chosen.styleId, speakerLabel: chosen.label });
      } else {
        ui.setSettings(settings);
      }
      ui.setConnection('connected', `v${version}`);
      ui.setStatus(chosen ? '' : '話者が見つかりません', !chosen);
      log('VOICEVOX', 'connected', version, `${styleOptions.length} styles`);
    } catch (e) {
      warn('VOICEVOX', 'connect failed', e);
      ui.setConnection('disconnected', '未接続');
      ui.setStatus(`${describeError(e)}。VOICEVOXを起動してください`, true);
    }
  }

  ui.setSettings(settings);
  const probe = adapter.probe();
  if (!probe.ok) ui.setStatus('ChatGPTの画面を認識できません', true);
  if (!gmAvailable()) {
    warn('Main', 'GM_xmlhttpRequest が使えません。fetch へフォールバックします（CORSに注意）');
  }

  observer.start();
  void connect();

  // 過去の回答へ「この回答を読む」ボタンを差し込む。
  // 会話は仮想化されるので、新しく現れたターンへ定期的に付け直す。
  window.setInterval(() => {
    if (!settings.enabled) return;
    try {
      syncReadButtons(adapter.assistantTurns(), (turn) => speakElement(adapter.contentOfTurn(turn)));
    } catch (e) {
      warn('UI', 'ボタン差し込みに失敗', e);
    }
  }, 1000);

  log('Main', 'ChatGPT → VOICEVOX Bridge started');
}

try {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => main(), { once: true });
  } else {
    main();
  }
} catch (e) {
  // UserScript が壊れても ChatGPT 本体の操作を妨げない
  error('Main', 'fatal', e);
}
