# ChatGPT Web → VOICEVOX 自動読み上げブリッジ
## コーディングエージェント向け実装計画書

作成日: 2026-09-15

---

## 0. この計画書の目的

MacBook上で、ユーザーが **Aqua Voice → ChatGPT Web版** に音声入力し、
ChatGPTが生成した回答を **VOICEVOXへ自動送信して、選択したキャラクター音声で連続読み上げ** する仕組みを作る。

最初の完成形は、OpenAI APIを別途利用せず、ChatGPT Web版に表示された回答を利用する。

### 目標フロー

```text
ユーザーの声
   ↓
Aqua Voice
   ↓
ChatGPT Web版の入力欄
   ↓
ChatGPTが回答を生成
   ↓
ブラウザ側のUserScript / 拡張機能が回答を検出
   ↓
文章を読み上げ向けに分割・整形
   ↓
VOICEVOX Engine (localhost:50021)
   ↓
MacBookからVOICEVOX音声を再生
```

Aqua Voiceは既にシステム全体の音声入力として利用する前提。
本プロジェクトでは **Aqua Voice自体の制御や音声認識機能は実装しない**。

---

# 1. MVPのゴール

以下を満たせばVer.1完成とする。

1. ChatGPT Web版で通常どおり会話できる。
2. ChatGPTの新しい回答だけを自動検出できる。
3. 回答全文の完成を待たず、ある程度の文章単位でVOICEVOXへ送れる。
4. VOICEVOXが文章を順番に読み上げる。
5. 同じ文章を二重に読まない。
6. 新しい質問を始めた際、古い読み上げを停止・キュー消去できる。
7. VOICEVOXの話者・スタイルをUIから選択できる。
8. 話速を調整できる。
9. コードブロックやURLなど、読み上げに不向きな内容を適切に省略できる。
10. VOICEVOXが起動していない場合は、分かりやすいエラー表示を行う。

---

# 2. 推奨する実装方式

## 第一候補: TypeScript製UserScript

Chrome系ブラウザ + Tampermonkeyを想定。

開発時は以下のような構成を推奨する。

```text
TypeScript
   ↓
vite-plugin-monkey 等でビルド
   ↓
dist/chatgpt-voicevox.user.js
   ↓
Tampermonkey
   ↓
ChatGPT Web
```

### 理由

- ChatGPT Web版をそのまま使える
- OpenAI APIキー不要
- Aqua Voiceとの相性がよい
- MacBook内だけで完結できる
- VOICEVOXのHTTP APIをlocalhost経由で利用できる
- 将来Chrome Extensionへ移行しやすい

### 重要

ChatGPTのDOM構造は変更される可能性がある。

**CSSの生成クラス名へ強く依存しないこと。**

可能なら以下を優先する。

- semantic attributes
- data-* attributes
- role
- aria attributes
- DOM構造上の意味的な位置

ChatGPT固有部分は `chatgpt-adapter.ts` に隔離し、
UI変更時にそこだけ直せる設計にする。

---

# 3. VOICEVOXとの接続

標準接続先:

```text
http://127.0.0.1:50021
```

起動時にヘルスチェックを行う。

候補:

```text
GET /version
GET /speakers
```

## 基本の音声合成フロー

### 1. audio_query

```text
POST /audio_query?speaker={style_id}&text={text}
```

### 2. synthesis

```text
POST /synthesis?speaker={style_id}
Content-Type: application/json
Body: audio_query のJSON
```

返ってきたWAVをブラウザで再生する。

将来的にはVOICEVOX Engineが対応している場合、
`/streaming_synthesis` も評価する。

ただしMVPは通常の `/synthesis` でよい。

---

# 4. 話者選択

話者IDをコードへ固定しない。

起動時に:

```text
GET /speakers
```

を取得し、

```text
キャラクター名
  └ スタイル名
       └ style_id
```

としてUIに表示する。

初期候補は:

```text
中国うさぎ
└ ノーマル
```

ただし該当話者が存在しない環境でも壊れないこと。

前回選択した `style_id` はlocalStorage等へ保存する。

---

# 5. ChatGPT回答の検出

## MutationObserverを使用

ChatGPTの回答領域を監視し、生成中の文章変更を検出する。

概念:

```text
ChatGPTが文字を追加
   ↓
MutationObserver
   ↓
現在のassistantメッセージ本文を取得
   ↓
前回取得済みの本文との差分を計算
   ↓
新しく追加されたテキストだけbufferへ送る
```

## 最重要: 二重読み上げ防止

React等によるDOM再描画で同じ文章を複数回検出する可能性がある。

各assistantメッセージについて状態を持つ。

例:

```ts
type MessageState = {
  id: string;
  lastFullText: string;
  spokenUntil: number;
  pendingBuffer: string;
};
```

可能ならChatGPT側のメッセージIDを利用する。

取れない場合は、

- DOM要素
- 出現順
- ハッシュ

などを組み合わせる。

単純にMutationObserverのmutation単位をそのまま読ませないこと。

---

# 6. ストリーミング読み上げ

全文生成完了を待たない。

## 推奨ルール

まずbufferへ文字列を追加する。

以下の境界でチャンク化する。

優先順位:

```text
。
！
？
！？
改行
```

ただし短すぎるチャンクはまとめる。

### 初期値案

```text
minimumChunkLength = 35文字
preferredChunkLength = 80〜140文字
maximumChunkLength = 180文字
```

### 動作例

ChatGPT生成:

```text
ジャンクションとは、魔法を能力値に装備する仕組みです。
たとえば力にファイガを100個装備すると……
```

処理:

```text
[Chunk 1]
ジャンクションとは、魔法を能力値に装備する仕組みです。

↓ VOICEVOXへ即送信

ChatGPTはその間も続きを生成
```

これにより「回答完成後にようやく喋り始める」待ち時間を減らす。

---

# 7. 音声再生キュー

複数チャンクを同時再生しない。

```text
textChunkQueue
      ↓
VOICEVOXで合成
      ↓
audioQueue
      ↓
順番に1個ずつ再生
```

状態例:

```ts
type PlaybackState = {
  textQueue: string[];
  isSynthesizing: boolean;
  currentAudio: HTMLAudioElement | null;
  abortController: AbortController | null;
};
```

## 必須機能

### enqueue(text)

読み上げ待ちへ追加。

### playNext()

前の音声が終了したら次を合成・再生。

### stopAll()

以下を全て行う。

- 現在のAudioを停止
- fetchをAbortControllerで中断
- text queueを空にする
- 未確定bufferも消す

---

# 8. 新しい質問をした場合

ユーザーが新しい質問を送信したら、
前の回答の読み上げが残っている場合に自動停止する設定を用意する。

初期値:

```text
「新しい質問を送信したら以前の読み上げを停止」 = ON
```

理由:

会話テンポを崩さないため。

ただし将来設定でOFFにもできるようにする。

---

# 9. 読み上げ前のテキスト整形

ChatGPTの表示内容をそのままVOICEVOXへ渡さない。

`speech-sanitizer.ts` を用意する。

## デフォルトで読む

- 普通の日本語文章
- 見出し本文
- 箇条書き本文
- 数字
- 一般的な英単語

## デフォルトで省略 / 変換

### Markdown記号

```text
**太字** → 太字
# 見出し → 見出し本文
> 引用 → 引用本文
```

### URL

長いURLは読み上げない。

例:

```text
https://example.com/very/long/url
```

↓

```text
「リンクがあります」
```

または完全省略。

設定可能にする。

### コードブロック

デフォルト:

```text
コードブロックを省略
```

必要なら:

```text
「ここにコードがあります」
```

とだけ読む。

### インラインコード

短いものは読む。

例:

```text
localhost
VOICEVOX
MutationObserver
```

### 表

MVPでは完全な表読み上げを目指さない。

原則:

```text
「表があります」
```

として省略してよい。

### 引用・出典番号

Web検索回答等に付く引用表示は読み上げ対象から除外する。

---

# 10. VOICEVOX音声パラメータ

最低限、以下を変更可能にする。

```text
speaker / style
speedScale
volumeScale
```

`audio_query` のJSONを取得後に値を変更する。

例:

```ts
query.speedScale = settings.speedScale;
query.volumeScale = settings.volumeScale;
```

初期値:

```text
speedScale = 1.0
volumeScale = 1.0
```

---

# 11. ブラウザ上の操作UI

ChatGPT画面の邪魔にならない小型フローティングパネルを作る。

例:

```text
┌─────────────────────┐
│ 🐇 VOICEVOX  ●接続中 │
│ 中国うさぎ / ノーマル │
│ 話速 1.00            │
│ [🔊 ON] [■ STOP]     │
└─────────────────────┘
```

## UI項目

必須:

- 読み上げON / OFF
- STOP
- VOICEVOX接続状態
- 話者 / スタイル選択
- 話速

あると便利:

- 音量
- コードを読む / 読まない
- URLを読む / 読まない
- 新質問時に旧音声停止
- テスト発声

設定はlocalStorageへ保存。

---

# 12. 起動時の状態

## VOICEVOX起動済み

```text
● VOICEVOX 接続中
```

となる。

## VOICEVOX未起動

アプリ全体を壊さず、

```text
○ VOICEVOX 未接続
VOICEVOXを起動してください
```

と表示する。

数秒ごとに延々ポーリングする必要はない。

以下で十分。

- 起動時チェック
- UIの再接続ボタン
- 音声合成失敗時に再チェック

---

# 13. CORS

VOICEVOX Engine側にはCORS制御が存在する。

まずブラウザ/UserScriptから直接:

```text
http://127.0.0.1:50021
```

へ接続できるか確認する。

Tampermonkeyを使う場合、
必要なconnect権限は最小限にする。

例:

```text
@connect 127.0.0.1
@connect localhost
```

`@connect *` は使わない。

直接接続が安定しない場合のみ、
Phase 2としてローカルbridge processを追加する。

---

# 14. オプション: ローカルBridge

MVPでは原則不要。

ただし以下の問題が起きた場合に採用する。

- CORS
- ブラウザ制限
- VOICEVOXとの通信安定性
- 将来のショートカット連携
- OSレベル制御

構成:

```text
ChatGPT UserScript
   ↓ WebSocket / HTTP
localhost bridge
   ↓
VOICEVOX Engine
```

Node.jsまたはPythonでよい。

Bridgeを作る場合もインターネットへ公開しない。

```text
127.0.0.1 only
```

でlistenする。

---

# 15. プロジェクト構成案

```text
chatgpt-voicevox-bridge/
│
├─ src/
│  ├─ main.ts
│  ├─ chatgpt-adapter.ts
│  ├─ observer.ts
│  ├─ text-diff.ts
│  ├─ chunker.ts
│  ├─ speech-sanitizer.ts
│  ├─ voicevox-client.ts
│  ├─ playback-queue.ts
│  ├─ settings.ts
│  └─ ui.ts
│
├─ tests/
│  ├─ text-diff.test.ts
│  ├─ chunker.test.ts
│  ├─ speech-sanitizer.test.ts
│  └─ playback-queue.test.ts
│
├─ dist/
│  └─ chatgpt-voicevox.user.js
│
├─ package.json
├─ tsconfig.json
├─ README.md
└─ PLAN.md
```

---

# 16. モジュール責務

## chatgpt-adapter.ts

ChatGPTのDOM依存部分をすべてここへ隔離。

責務:

- assistantメッセージ取得
- 最新メッセージ識別
- generation開始 / 終了判定
- 新しいuserメッセージ検出

---

## observer.ts

MutationObserver管理。

DOM mutationを直接TTSへ流さず、
adapter経由で正規化した状態だけを扱う。

---

## text-diff.ts

前回本文と現在本文から追加分を抽出。

再描画・差し替えにもできるだけ耐える。

---

## chunker.ts

文章を自然な読み上げ単位へ分割。

---

## speech-sanitizer.ts

Markdown、URL、コード、引用などを音声向け文章へ変換。

---

## voicevox-client.ts

VOICEVOX Engine APIとの通信。

責務:

- health check
- speakers取得
- audio_query
- synthesis
- error handling

---

## playback-queue.ts

音声の逐次再生。

責務:

- enqueue
- synthesize
- play
- stop
- abort
- queue clear

---

## settings.ts

localStorageによる設定保存。

---

## ui.ts

ChatGPTページ上の小型操作UI。

---

# 17. エラーハンドリング

少なくとも以下を区別する。

```text
VOICEVOX未起動
VOICEVOX HTTPエラー
音声合成失敗
Audio再生失敗
ChatGPT DOM取得失敗
設定されたspeakerが見つからない
```

consoleにも詳細ログを出す。

ユーザー向けUIには短い説明だけ表示する。

---

# 18. ログ

開発中はdebugログを用意する。

```text
[Observer]
[ChatGPT]
[Chunker]
[VOICEVOX]
[Playback]
```

本番ではdebug modeをOFFにできるようにする。

読み上げた全文を永続保存する必要はない。

---

# 19. セキュリティ / プライバシー

重要。

このツールはChatGPTの回答本文を読むため、
不要な外部通信をしない。

許可する通信先:

```text
ChatGPT Web自身
127.0.0.1:50021
```

追加サーバーへ会話内容を送らない。

以下を禁止:

- analytics
- telemetry
- 外部ログ送信
- 無関係な外部API
- APIキーの保存

READMEに明記する。

---

# 20. 非目標

Ver.1では実装しない。

```text
× OpenAI APIを使った独自チャット
× ChatGPT Voice Modeとの統合
× Aqua Voiceの制御
× iPhone対応
× Android対応
× MCP
× VTuberアバター連携
× 感情解析による自動話者変更
× 複数キャラクター会話
× 音声ファイルの自動保存
```

まず一本道を完成させる。

---

# 21. テスト項目

## 単体テスト

### text diff

```text
前: 今日は
後: 今日は晴れです。
結果: 晴れです。
```

### chunk

```text
これは一文目です。これは二文目です。
```

が自然な単位に分割されること。

### sanitization

```text
**重要**
```

↓

```text
重要
```

コードブロックが省略されること。

---

## 手動E2Eテスト

### Case 1

VOICEVOXを起動。

ChatGPT:

```text
日本の四季について短く説明して
```

期待:

生成途中からVOICEVOXが読み始める。

---

### Case 2

長文回答。

期待:

- 文章が順番に読まれる
- 重複しない
- 音声が重ならない

---

### Case 3

回答にコードブロック。

期待:

コード本文を大量に読み上げない。

---

### Case 4

回答中に新しい質問を送る。

期待:

旧回答の音声が停止し、
新回答へ切り替わる。

---

### Case 5

VOICEVOX停止状態。

期待:

ChatGPT自体は正常に利用できる。
UIに未接続表示。

---

# 22. 完成条件 / Acceptance Criteria

以下を全て満たしたらMVP完成。

- [ ] ChatGPT Webの新しいassistant回答だけを取得できる
- [ ] 生成途中から読み上げ開始できる
- [ ] 同じ文章を二重読み上げしない
- [ ] VOICEVOXへローカル通信できる
- [ ] `/speakers` から話者一覧を取得できる
- [ ] 中国うさぎ / ノーマル等を選択できる
- [ ] 音声を逐次再生できる
- [ ] STOPですぐ停止できる
- [ ] 新質問時に旧queueを破棄できる
- [ ] 話速を変更できる
- [ ] コードブロックを省略できる
- [ ] URLを適切に処理できる
- [ ] VOICEVOX未起動でもChatGPT利用を妨げない
- [ ] 設定を保存できる
- [ ] READMEに導入手順がある
- [ ] `dist/*.user.js` をTampermonkeyへ導入できる

---

# 23. 実装順序

## Phase 0: 調査

1. 現在のChatGPT Web DOMを確認
2. assistantメッセージを安定して取得できるselectorを探す
3. VOICEVOX localhost APIへブラウザから疎通確認

この段階でコードを大量に書かない。

---

## Phase 1: VOICEVOX単体

1. `/version`
2. `/speakers`
3. `/audio_query`
4. `/synthesis`
5. ブラウザでWAV再生

まず固定文字列:

```text
VOICEVOX接続テストです。
```

を喋らせる。

---

## Phase 2: ChatGPT回答取得

1. 最新assistant message取得
2. MutationObserver
3. 生成中の本文追跡
4. diff

この段階ではconsole.logでよい。

---

## Phase 3: Chunker

文章単位でbufferから切り出す。

console:

```text
[TTS CHUNK] ...
```

を確認。

---

## Phase 4: VOICEVOX接続

Chunk → synthesis → queue → playbackを接続。

---

## Phase 5: STOP / interrupt

新質問検出時に、

```text
Abort
Pause
Queue Clear
Buffer Clear
```

を行う。

---

## Phase 6: UI

最低限のフローティングパネルを追加。

---

## Phase 7: 整形・品質改善

- Markdown
- URL
- コード
- 表
- 引用
- 数字
- 英語混在

---

## Phase 8: README / 配布

導入手順を書く。

---

# 24. READMEに必要な導入手順

最低限以下を書く。

## 必要環境

- macOS
- Chrome系ブラウザ
- Tampermonkey
- VOICEVOX
- ChatGPT Web
- Aqua Voice（音声入力に使用する場合）

## 起動順

```text
1. VOICEVOXを起動
2. ブラウザを起動
3. ChatGPTを開く
4. UserScriptを有効化
5. VOICEVOX接続表示を確認
6. Aqua Voice等でChatGPTへ質問
```

---

# 25. UX上の理想

ユーザーが意識する操作はほぼこれだけにする。

```text
Aqua Voiceキーを押す
↓
話す
↓
ChatGPTへ送信
↓
数秒後
↓
VOICEVOXが自然に回答を読み始める
```

ユーザーが毎回、

```text
コピー
↓
VOICEVOXへ貼り付け
↓
再生
```

を行う設計にはしない。

---

# 26. 将来拡張

MVP完成後に検討。

## Ver.2

- `/streaming_synthesis` 評価
- より低遅延な先読み
- 読み上げ中テキストのハイライト
- pause / resume
- 読み上げ履歴
- キーボードショートカット
- macOSメニューバー常駐

## Ver.3

- MCP対応
- Claude Web等へのadapter追加
- Gemini Web等へのadapter追加
- 複数話者
- assistantの内容に応じた話者切替
- キャラクター別プロンプト
- 字幕オーバーレイ
- VRChat / OBS連携

---

# 27. コーディングエージェントへの指示

以下の方針を守って実装すること。

1. 最初から巨大なコードを書かない。
2. Phaseごとに動作確認する。
3. ChatGPT DOM依存を1モジュールへ隔離する。
4. speaker IDをハードコードしない。
5. 同じ文章の二重読み上げ防止を最優先する。
6. 生成完了待ちではなく、逐次読み上げを目標にする。
7. 外部サーバーへ会話内容を送らない。
8. VOICEVOX未起動でもChatGPTを壊さない。
9. UserScriptが壊れてもChatGPT本体の操作を妨害しない。
10. 各Phase終了時に、何が動いたか・何が未解決かを報告する。
11. 不明なChatGPT DOM構造を推測で実装せず、実際のページを確認してからadapterを書く。
12. まずMVPを完成させ、MCPや高度な機能へ脱線しない。

---

# 28. コーディングエージェントへ最初に渡す短縮プロンプト

```text
このリポジトリに、Mac上のChatGPT Web → VOICEVOX自動読み上げUserScriptを実装してください。

入力はAqua Voiceを使うため音声認識機能は不要です。
OpenAI APIも使用しません。

ChatGPT Webに表示されるassistant回答をMutationObserver等で検出し、
生成途中から自然な文章単位に分割して、
localhost:50021 のVOICEVOX Engineへ送信してください。

VOICEVOXは /speakers から話者・style_idを取得し、
speaker IDをハードコードしないでください。

音声は必ず逐次キュー再生し、
二重読み上げ、音声の重複再生を防止してください。

新しいuserメッセージが送信された場合、
既存読み上げ・合成リクエスト・queueを停止できるようにしてください。

ChatGPT DOM依存コードはadapterへ隔離してください。
生成CSSクラスへ過度に依存しないでください。

コードブロック、URL、Markdown等は読み上げ向けにsanitizeしてください。

最初はMVPに集中してください。
MCP、独自OpenAI API、スマホ対応は実装しないでください。

実装前にPLAN.mdを読み、
Phase 0 → Phase 1 → ... の順番で進め、
各Phaseごとに動作確認結果を報告してください。
```

---

# 29. 最終イメージ

```text
🎙️ ユーザー
「FFVIIIのジャンクションについて簡単に教えて」

        ↓ Aqua Voice

💬 ChatGPT Web
「ジャンクションとは……」

        ↓ 自動検出

🌉 ChatGPT-VOICEVOX Bridge
文章分割 → Queue

        ↓ localhost

🐇 VOICEVOX
「ジャンクションとはですね……」

        ↓

🔊 MacBook
```

画面を見るためだけのAIではなく、
MacBookの中で「話しかける → 考える → 声で返す」が一続きになることを
このプロジェクトの完成形とする。
