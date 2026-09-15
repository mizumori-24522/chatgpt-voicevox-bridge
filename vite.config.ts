import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'ChatGPT → VOICEVOX Bridge',
        namespace: 'local.chatgpt-voicevox-bridge',
        version: '0.1.0',
        description: 'ChatGPT Web の回答を VOICEVOX で逐次読み上げする',
        author: 'local',
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
