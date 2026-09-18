# ChatGPT → VOICEVOX Bridge

ChatGPT Web版の回答を、生成の途中から **VOICEVOX** の好きなキャラクター音声で
自動的に読み上げる UserScript です。

OpenAI API は使いません。音声入力（Aqua Voice 等）は OS 側の機能をそのまま使います。

```
声 → Aqua Voice → ChatGPT Web → この UserScript → VOICEVOX(localhost:50021) → スピーカー
```

## 必要環境

- macOS
- Chrome 系ブラウザ
- [Tampermonkey](https://www.tampermonkey.net/)
- VOICEVOX（アプリ、または VOICEVOX Engine 単体）
- ChatGPT Web（Plus 等のアカウント）

## 導入手順

1. VOICEVOX を起動する（`http://127.0.0.1:50021` が待ち受け状態になる）
2. このリポジトリで UserScript をビルドする

   ```bash
   npm install
   npm run build
   ```

   `dist/chatgpt-voicevox.user.js` が生成されます。

3. Tampermonkey のダッシュボードを開く →「新規スクリプトを作成」
4. `dist/chatgpt-voicevox.user.js` の中身を全部貼り付けて保存
   （または Tampermonkey の設定でローカルファイルへのアクセスを許可し、
   `file://` の URL からインストールする）
5. https://chatgpt.com を開く
6. 右下に 🐇 VOICEVOX パネルが出る。緑の ● と `v0.xx.x` が出れば接続成功
7. 話者を選び、「テスト発声」で音が出ることを確認
8. 普段どおり ChatGPT へ質問すると、回答の生成途中から読み上げが始まります

### 起動順

```
1. VOICEVOX を起動
2. ブラウザを起動
3. ChatGPT を開く
4. パネルの接続表示を確認
5. Aqua Voice 等で質問する
```

## パネルの操作

| 項目 | 内容 |
| --- | --- |
| ● / ○ | VOICEVOX の接続状態（クリックでパネル開閉） |
| 話者（顔アイコン付き） | 押すと「キャラクター → スタイル」の2段メニュー。左のキャラに乗せると右にスタイルが出る。上の欄で「ささやき」のように絞り込める |
| 話速 / 音量 | `audio_query` の `speedScale` / `volumeScale` |
| 文間 | チャンク末尾の無音 `postPhonemeLength`。箇条書きの移りの速さに効く |
| 🔊 ON / 🔇 OFF | 読み上げの有効・無効 |
| 🔈 選択した部分を読む | ページ上でドラッグ選択した範囲だけを読む |
| ■ STOP | 再生・合成・キュー・未確定バッファを即座に破棄 |
| コード | 読まない / 最初の1回だけ伝える（既定）/ 毎回伝える / 読む |
| URL / 表 | 読まない・あることだけ伝える・読む |
| 記号を読む（_ - . /） | ファイル名やパスの中の記号を読み上げる。既定 OFF |
| 新しい質問で読み上げ停止 | 既定 ON |
| テスト発声 / 再接続 | 動作確認用 |

各 assistant 回答にマウスを乗せると右上に **「🔊 この回答を読む」** が出ます。
過去のやりとりを指定して読み直すのはこれです。

設定は `localStorage`（キー `cvb.settings.v2`）へ保存されます。
`v1` の保存内容があれば自動で移行します。話速の初期値は 1.15 です。

### 単語の読み方を直したいとき

VOICEVOX 本体の **「読み方＆アクセント辞書」** がそのまま効く。
辞書はエンジン側（`/user_dict`）で適用されるので、この UserScript には何も足さなくてよい。
`NVIDIA → エヌビディア` のように登録すれば、次の読み上げから反映される。

このツール側で扱うのは記号だけ（`ChatGPT_PLAN.md` の `_` や `.`）で、
パネルの「記号を読む」で切り替える。英数字に挟まれた記号だけが対象なので、
普通の文中のハイフンや `2026/09/18` のような日付は巻き込まない。

## 仕組み

| モジュール | 役割 |
| --- | --- |
| `chatgpt-adapter.ts` | ChatGPT の DOM 依存を全部ここへ隔離。UI 変更時はここだけ直す |
| `observer.ts` | MutationObserver + 200ms ポーリング。mutation を直接 TTS へ流さない |
| `text-diff.ts` | 「消費済み文字数」を持ち、再描画されても同じ文章を二度読まない |
| `chunker.ts` | `。！？` 改行を境界に、35〜180 文字の自然な単位へ切り出す |
| `speech-sanitizer.ts` | DOM 構造を根拠にコード・表・URL・引用番号を処理 |
| `voicevox-client.ts` | `/version` `/speakers` `/audio_query` `/synthesis` |
| `playback-queue.ts` | 合成ループと再生ループを分離。喋りながら次を先読み合成する |
| `ui.ts` | Shadow DOM のフローティングパネル（ChatGPT の CSS と干渉しない） |
| `voice-picker.ts` | キャラクター → スタイルの2段メニュー |
| `icon-cache.ts` | 顔アイコンを必要な分だけ取り、同じものは二度取らない |
| `message-actions.ts` | 各回答へ「この回答を読む」ボタンを差し込む |

### 実測した ChatGPT の DOM (2026-09-15 / GPT-6 世代 UI)

```html
<section data-turn="assistant" data-turn-id="<uuid>"
         data-testid="conversation-turn-10">
  <div data-message-author-role="assistant" data-message-id="<uuid>">
    <div class="... markdown prose ...">  ← 本文
```

- 会話は**仮想化**されており、画面外のターンでは内側の
  `[data-message-author-role]` が DOM から消える。外側の
  `section[data-turn]` は残るので、そちらを一次の拠り所にしている。
- メッセージ同一性は `data-turn-id`（UUID）→ `data-message-id` の順で採用。
- Web検索の出典は `[data-testid="webpage-citation-pill"]` なので読み上げから除外。
- **ページを開き直しただけの回答は読み上げない。** 会話が仮想化されているため
  「回答が DOM に現れた」だけでは新規生成と区別できない。新しい質問を観測したか、
  生成中を観測したときにだけ読み上げを解禁している。
- 文と文の間に無音を作らないため、**再生中に次のチャンクを先読み合成**する
  （既定2つ先まで）。再生そのものは常に1本だけで、音声は重ならない。
- VOICEVOX は既定で 1 チャンクの前後に 0.1 秒ずつ無音を付ける。箇条書きのように
  短い項目が連続すると、これが項目ごとの間として積み上がる。既定を
  `prePhonemeLength=0.0` / `postPhonemeLength=0.05` / `pauseLengthScale=0.9` に
  下げてある（実測で 1 チャンクあたり約 0.13 秒短縮）。
- コードブロックは、罫線で描いた図（`┌─┐│└┘` などが3割以上）なら
  「ここに図があります」、そうでなければ「ここにコードがあります」と言い分ける。
- 既定では**1つの回答につき最初の1回しか知らせない**。図やコードが何度も出てくる
  回答で同じ台詞を繰り返さないため。毎回知らせたいなら設定で変えられる。
- 絵文字は読み上げ前に除去する。VOICEVOX へ渡すと不自然な間が入るため。
- 生成中判定は停止ボタンに**依存しきらない**。本文の増加が 1.2 秒止まったら
  生成完了とみなして残りを吐き出すため、ChatGPT がボタンの命名を変えても
  読み上げが尻切れにならない。

Markdown をテキストとしてパースするのではなく、ChatGPT が既にレンダリングした
DOM（`<pre>` `<table>` `<a>` など）を見て判定しています。
生成途中の未閉じコードフェンスに強いのが理由です。

## キャラクター画像

顔アイコンは VOICEVOX Engine の `/speaker_info` から取る。既定のままだとサンプル音声まで
base64 で同梱されて 1 キャラ 5MB を超えるので、`resource_format=url` で URL だけ受け取り、
画像は表示するものだけ個別に取りに行く。

chatgpt.com のページから `http://127.0.0.1` の画像を `<img>` で直接読むことはできない
（Private Network Access で止まる）。`GM_xmlhttpRequest` でバイト列を取り、`blob:` URL に
変換して表示している。

## CORS について

`https://chatgpt.com` から `http://127.0.0.1:50021` への直接 `fetch` は
CORS / Private Network Access で弾かれることがあります。
そのため通信は **Tampermonkey の `GM_xmlhttpRequest`** 経由で行います。
権限は最小限に絞っています。

```
@connect 127.0.0.1
@connect localhost
```

`@connect *` は使っていません。

## プライバシー

会話内容を外部へ送信しません。通信先は以下だけです。

```
ChatGPT Web 自身
127.0.0.1:50021 (VOICEVOX Engine)
```

- analytics / telemetry なし
- 外部ログ送信なし
- API キーの保存なし
- 読み上げたテキストの永続保存なし

## 開発

```bash
npm test        # 単体テスト (vitest)
npm run typecheck
npm run build
```

**編集しているのは `src/` の TypeScript であって、Tampermonkey の中のコードではない。**
`npm run build` で `dist/chatgpt-voicevox.user.js` を作り直し、それを
Tampermonkey へ入れ直して初めて反映される。

### 毎回入れ直したくない場合

Tampermonkey のスクリプトを1行だけにして、ビルド成果物を直接読ませる。

```js
// ==UserScript==
// @name         ChatGPT → VOICEVOX Bridge (dev)
// @match        https://chatgpt.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// @require      file:///Users/<ユーザー名>/chatgpt-voicevox-bridge/dist/chatgpt-voicevox.user.js
// ==/UserScript==
```

`chrome://extensions` の Tampermonkey で
**「ファイルの URL へのアクセスを許可する」を ON** にすること。
以後は `npm run build` してページをリロードするだけで反映される。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| ○ 未接続 | VOICEVOX を起動してから「再接続」 |
| 「再生がブロックされました」 | ページを一度クリックしてから再度質問する（ブラウザの自動再生制限） |
| 読み上げが始まらない | パネルが 🔊 ON か確認。詳細設定の「デバッグログ」を ON にして Console を見る |
| 途中から二重に読む | Console の `[Observer]` ログを添えて報告してください |
| パネルが出ない | Tampermonkey でスクリプトが有効か、`@match` が今の URL と一致するか確認 |

## 非目標（Ver.1）

OpenAI API 利用 / ChatGPT Voice Mode 統合 / Aqua Voice 制御 / スマホ対応 / MCP。
詳細は [PLAN.md](PLAN.md) を参照。
