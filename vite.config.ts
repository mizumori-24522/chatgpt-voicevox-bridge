import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import pkg from './package.json';

const REPO = 'mizumori-24522/chatgpt-voicevox-bridge';
/** Tampermonkey が更新を確認しに行く先。@version が上がっていれば取り込まれる */
const DIST_URL = `https://raw.githubusercontent.com/${REPO}/main/dist/chatgpt-voicevox.user.js`;

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'ChatGPT → VOICEVOX Bridge',
        namespace: 'local.chatgpt-voicevox-bridge',
        version: pkg.version,
        description: 'ChatGPT Web の回答を VOICEVOX で逐次読み上げする',
        author: 'mizumori-24522',
        homepageURL: `https://github.com/${REPO}`,
        supportURL: `https://github.com/${REPO}/issues`,
        updateURL: DIST_URL,
        downloadURL: DIST_URL,
        match: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
        connect: ['127.0.0.1', 'localhost'],
        grant: ['GM_xmlhttpRequest'],
        'run-at': 'document-idle',
      },
      build: { fileName: 'chatgpt-voicevox.user.js', autoGrant: false },
    }),
  ],
  build: { minify: false },
});
