# chazhland-desktop · документация

Десктоп-клиент chazhland — self-hosted мессенджер в духе Discord (чат, голос, демонстрация экрана, совместный просмотр, админка, ЛС). Стек: **React 19 + TypeScript 5.7 + Vite 6 + Electron 33** (внутри Electron — Node 20.18 LTS; сборка идёт на системном Node 20 или 22).

Эта папка — точка входа в техническую документацию проекта. Ниже — карта документов и порядок чтения для нового разработчика.

---

## С чего начать новому разработчику

1. **Подними проект локально.** Установи зависимости «голым» `npm install` (без `--omit=optional` — он ломает нативные сборки), заведи `.env` и запусти dev-режим:

   ```bash
   npm install
   cp .env.example .env
   npm run dev
   ```

   `.env.example` по умолчанию смотрит в **живой прод-бэкенд**. Для разработки UI без бэкенда есть mock-режим: `VITE_MOCK=true` (данные из `src/mocks/data.ts`, WebSocket — no-op, сеть не дёргается). Флаг выключен по умолчанию и включается строго строкой `'true'`. Подробности сборки и переменных окружения — в [BUILD.md](BUILD.md).

   > ⚠️ Нужен **Node 20 LTS или 22** (релизный CI собирает на 22). На Node 26+ Electron 33 ловит проблемы (см. [BUILD.md](BUILD.md)).

2. **Разберись в архитектуре.** Прочитай [ARCHITECTURE.md](ARCHITECTURE.md): как устроены слои Electron (main/preload) ↔ Renderer (features → lib → backend), мост `window.chazh`, стор аутентификации, навигация.

3. **Пойми, как клиент говорит с бэком.** [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md) — про устройство слоя `src/lib/api.ts` (http-клиент, Bearer + single-flight refresh, mock-ветки, серверные и «домашние» роуты) и про неочевидное в контракте. Каталога эндпоинтов там нет намеренно: актуальный контракт отдаёт сам бэк — swagger `<API_BASE>/swagger-ui.html` и спека `/v3/api-docs`.

4. **Углубись в нужную фичу** — голос ([VOICE.md](VOICE.md)) или совместный просмотр ([WATCH-TOGETHER.md](WATCH-TOGETHER.md)) — это самые сложные и нативно-зависимые части (LiveKit, WebTorrent, mpv, SOCKS5-туннель для Prowlarr).

5. **Перед релизом** обязательно прогони один упакованный Windows-smoke-run на каждый нативный инкремент (webtorrent / mpv / utp-native) — упаковка непроверяема с macOS. Релиз собирает [`.github/workflows/build-win.yml`](../.github/workflows/build-win.yml) (Windows: NSIS-установщик + ZIP, Linux: AppImage), локальный `npm run dist:win` даёт только ZIP. См. раздел gotchas в [BUILD.md](BUILD.md).

---

## Карта документов

| Документ | Статус | О чём |
|----------|--------|-------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | ✅ создан | Слоистая архитектура клиента: Electron main/preload ↔ Renderer (features → lib data-layer → backend), мост `window.chazh`, IPC-каналы, стор `auth`, темизация, паттерны навигации. |
| [BUILD.md](BUILD.md) | ✅ создан | Сборка и стек: версии (React 19 / TS 5.7 / Vite 6 / Electron 33 с Node 20.18 внутри), npm-скрипты (`dev`, `build`, `dist:win`, `dist:mac`, `typecheck`, `lint`, `icons`), упаковка `electron-builder` (локально Windows-ZIP x64; релизный CI — NSIS + ZIP и Linux AppImage), ASAR/`asarUnpack`, CSP, и критичные грабли (Node 20/22, ESM-preload, webtorrent external, вендоринг mpv). |
| [WATCH-TOGETHER.md](WATCH-TOGETHER.md) | ✅ создан | Совместный просмотр: три вида источников (`DIRECT` / `TORRENT` / `LINK`), синхронизация через Redis + STOMP `/topic/watch.{channelId}`, клиентский WebTorrent-движок (localhost stream-server), mpv для экзотических кодеков, SSRF-guard и санитайзинг magnet-ссылок, drift-реконсиляция. |
| [VOICE.md](VOICE.md) | ✅ создан | Голос и демонстрация экрана на LiveKit: микрофонные режимы (voice / PTT), voice-activation gate, RNNoise-шумодав (WASM), deafen, выбор устройств, качество демонстрации (source/1080/720/360), system-audio loopback на Windows, soundboard, состояние участников. |
| [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md) | ✅ создан | Работа с бэком: где смотреть актуальный контракт (swagger `/swagger-ui.html`, спека `/v3/api-docs`, Java-код), устройство слоя `src/lib/api.ts` + `http.ts`, прод-адреса и подмена `Origin` в Electron, аутентификация (Bearer, ротация refresh-токена `chazh.refresh`, single-flight), STOMP-топики и неочевидное в контракте (идемпотентность `clientMessageId`, курсоры, конверт `Page`, presign-загрузка). |
| [INCREMENT_4_PLAN.md](INCREMENT_4_PLAN.md) | исторический | Снимок плана инкремента №4 (2026-06-17). Не описание текущего состояния — сверяйтесь с WATCH-TOGETHER.md / BUILD.md. |
| [DESIGN_BRIEF.md](DESIGN_BRIEF.md) | исторический | Дизайн-бриф: визуальный язык, токены, экраны, «семена» промптов. Инвентаризация API внутри — снимок на момент генерации, сверяйтесь со swagger. Сопутствующие ассеты — в `docs/design/`. |

> Все перечисленные документы созданы и лежат рядом в `docs/`.

---

## Ключевые ориентиры в коде

Для быстрой навигации (полные детали — в профильных документах):

- **Точка входа:** `src/main.tsx` → `ThemeProvider > AuthProvider > App` (`src/App.tsx`).
- **Главный контейнер UI:** `src/features/main/MainWindow.tsx`.
- **Слой данных:** `src/lib/` (`http.ts`, `api.ts`, `ws.ts`, `presence.ts`, `voice.ts`, `config.ts`, `types.ts`).
- **Мост Electron:** интерфейс `window.chazh` в `src/global.d.ts`, реализация в `electron/preload.ts` (preload собирается как **ESM**).
- **Нативные движки (main-процесс):** `electron/torrent.ts` (WebTorrent), `electron/mpv.ts` (внешний mpv), `electron/main.ts`.
- **Совместный просмотр (renderer):** `src/features/main/WatchView.tsx`.
- **Голос (renderer):** `src/lib/voice.ts`, `src/lib/rnnoise.ts`, `src/lib/soundboard.ts`.
- **Инфраструктура поиска раздач живёт в ДРУГОМ репозитории** — бэкенд/деплой `chazhland` (`infra/socks-tunnel/` + контейнер Prowlarr, доступ к UI только через SSH-туннель). В этом desktop-репо её нет. См. [WATCH-TOGETHER.md](WATCH-TOGETHER.md).
