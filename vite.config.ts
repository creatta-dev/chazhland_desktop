import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'
import path from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // webtorrent (ESM) + нативные deps + electron-updater не бандлим — грузятся из node_modules в
        // рантайме (updater ещё и ищет app-update.yml относительно node_modules; бандл ломает lazy-require).
        vite: { build: { rollupOptions: { external: ['webtorrent', 'node-datachannel', 'electron-updater'] } } },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        // package.json "type":"module" → preload.mjs грузится как ESM. По умолчанию rollup пишет в него
        // require("electron") (CJS) → «require is not defined in ES module scope» → preload не загружается.
        // Форсим ESM-вывод (import), чтобы .mjs реально был ESM (Electron 33 + sandbox:false это умеет).
        vite: { build: { rollupOptions: { output: { format: 'es' } } } },
      },
      renderer: {},
    }),
  ],
})
