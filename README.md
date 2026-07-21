# chazhland-desktop

Десктоп-клиент самостоятельно хостящегося мессенджера **chazhland** — аналог Discord «для своей тусовки»: текстовые каналы, голос, демонстрация экрана, совместный просмотр видео (watch-together) и админка с ролями/правами.

Это **Electron**-приложение (Windows-first; в релизном CI собирается ещё Linux AppImage, локально — macOS DMG) поверх веб-клиента на **React 19 + TypeScript + Vite**. Реалтайм — STOMP-over-WebSocket, голос и демонстрация экрана — LiveKit (WebRTC), совместный просмотр — WebTorrent (в main-процессе) + внешний плеер mpv для экзотических кодеков.

> Бэкенд (Spring Boot, отдельный репозиторий `chazhland/backend`) и веб-версия живут отдельно. Этот репозиторий — только десктоп-клиент.

---

## 1. Что это

| | |
|---|---|
| **Назначение** | Десктоп-клиент мессенджера chazhland (чат + голос + screen-share + watch-together + админка) |
| **appId** | `ru.chazhland.desktop` |
| **Прод REST API** | `https://api.chazhland.ru` |
| **Прод WebSocket (STOMP)** | `wss://api.chazhland.ru/ws` |
| **Прод LiveKit** | `livekit.chazhland.ru` |
| **Веб-домен (Origin)** | `https://chat.chazhland.ru` |

### Стек

| Компонент | Версия |
|---|---|
| React | 19.0.0 |
| TypeScript | 5.7.2 |
| Vite | 6.0.3 |
| Electron | 33.2.0 (содержит Node 20.18 LTS) |
| vite-plugin-electron | 0.29.0 |
| vite-plugin-electron-renderer | 0.14.6 |
| WebTorrent | 3.0.16 (prod-зависимость, ESM-only) |

TypeScript: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`. Алиас путей: `@/*` → `src/*`.

---

## 2. Быстрый старт

> **Требуется Node 20 LTS или 22** (релизный CI собирает на 22). Electron 33 несёт внутри Node 20.18 — это рантайм main/preload, а не то, чем собирается проект. На машинах с Node 26+ возникают проблемы при сборке/запуске. См. раздел [Главные подводные камни](#8-главные-подводные-камни).

```bash
# 1. клонировать репозиторий
git clone <repo-url>
cd chazhland-desktop

# 2. установить зависимости (именно так, без --omit=optional — это ломает нативные сборки)
npm install

# 3. подготовить окружение
cp .env.example .env      # заготовка смотрит в живой прод-бэк (см. раздел 6 «Конфигурация»)

# 4. запустить dev-режим (Vite dev-сервер + автоперезапуск main/preload + окно Electron)
npm run dev
```

`.env.example` по умолчанию настроен на **живой прод-бэкенд**. Для работы над UI без бэкенда есть mock-режим: `VITE_MOCK=true` — данные берутся из `src/mocks/data.ts`, сеть не задействуется. Флаг по умолчанию выключен и включается строго строкой `'true'` (см. раздел 6).

### Прочие npm-скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Vite dev-сервер + авто-ребилд main/preload + окно Electron |
| `npm run build` | `tsc --noEmit && vite build` — type-check + сборка renderer и main/preload |
| `npm run typecheck` | `tsc --noEmit` — только проверка типов |
| `npm run lint` / `lint:fix` | `eslint .` — линт (с `--fix` во втором варианте) |
| `npm run preview` | `vite preview` — предпросмотр собранного рендерера в браузере |
| `npm run dist:win` | `npm run build` + `electron-builder --win` (Windows ZIP, x64) |
| `npm run dist:mac` | `npm run build` + `electron-builder --mac` (macOS DMG) |
| `npm run dist:linux` | `npm run build` + `electron-builder --linux` (AppImage) |
| `npm run dist` | `npm run build` + `electron-builder` под текущую ОС |
| `npm run icons` | `node scripts/gen-icons.mjs` — генерация иконок |

---

## 3. Сборка под Windows

```bash
npm run dist:win   # build + electron-builder --win → Windows ZIP (x64)
```

Локальная сборка даёт **только ZIP, x64** (таргет из `package.json`). Релиз собирает CI — [`.github/workflows/build-win.yml`](.github/workflows/build-win.yml) на Node 22: Windows-джоба зовёт `electron-builder --win nsis zip`, то есть выпускает **NSIS-установщик `chazhland-Setup-<version>.exe` + ZIP + `latest.yml`**, параллельная Linux-джоба — **AppImage**. Не пугайтесь расхождения локального и релизного набора артефактов.

Приложение упаковывается в ASAR; нативные модули (`**/*.node`, `node_modules/node-datachannel/**`) распаковываются через `asarUnpack`. `mpv.exe` и `yt-dlp.exe` в Windows-релиз вкладываются самим CI (`extraResources`), локально их надо ставить в систему.

> Windows-сборку **нельзя проверить с macOS** — после каждого изменения, затрагивающего нативную часть (WebTorrent, node-datachannel, mpv), обязателен один прогон собранного Windows-приложения (smoke-test).

Подробности (вендоринг `mpv.exe`/`yt-dlp.exe`, ESM-preload, проверка `npx asar list`, gotcha с webtorrent@3, контракт имён ассетов с авто-апдейтером) — см. **[docs/BUILD.md](docs/BUILD.md)**.

---

## 4. Структура проекта

```
electron/
  main.ts            main-процесс: frameless-окно, IPC, трей, нативные уведомления, rewrite Origin
  preload.ts         contextBridge → window.chazh (preload собирается в ESM; на рантайме preload.mjs)
  ipc-contract.ts    ЕДИНЫЙ тип IPC-контракта main ↔ preload ↔ renderer (раньше жил в трёх копиях)
  updater.ts         авто-обновление (electron-updater): проверка, докачка, «Что нового»
  torrent.ts         WebTorrent-движок: стрим на 127.0.0.1 с токеном, sweep кэша, лимиты
  mpv.ts             внешний плеер mpv: spawn + JSON-IPC по сокету/pipe (MKV/HEVC/экзотика)

src/
  main.tsx           точка входа: createRoot → ThemeProvider > AuthProvider > App
  App.tsx            корневой роутер: TitleBar + ConnectionBanner + AuthScreen|MainWindow + Toaster
  global.d.ts        window.chazh в global — ре-экспорт типов из electron/ipc-contract.ts

  store/
    auth.tsx         React Context: сессия (user + token), login/register/logout, refresh на 401

  components/        общие примитивы: Modal, Avatar, TitleBar, Toaster, ConnectionBanner,
                     ErrorBoundary, Skeleton, RankChip/RankBadge, косметика профиля

  features/
    auth/AuthScreen.tsx        вход / регистрация / сброс пароля
    main/MainWindow.tsx        контейнер приложения: состояние, маршрутизация, voice/presence
    main/GuildRail.tsx         самая левая колонка — серверы; создать сервер / войти по инвайту
    main/ChannelSidebar.tsx    категории, каналы, DM, участники голосовых каналов
    main/ChatPanel.tsx         вертикальная обёртка чата
    main/ChatFeed.tsx          лента сообщений, авто-скролл, jump-to-unread
    main/Message.tsx           одно сообщение: автор, реакции, превью-ответ, контекстные действия
    main/Composer.tsx          ввод текста, emoji-пикер, загрузка файлов (drag-drop)
    main/BottomBar.tsx         статус, mic/deaf/live, бейдж непрочитанного, доступ к админке
    main/MembersRail.tsx       правый сайдбар: онлайн/офлайн, участники голоса
    main/ScreenSharePane.tsx   просмотр чужого экрана (несколько шар, fullscreen); ScreenPicker.tsx — выбор источника
    main/SettingsModal.tsx     профиль, аватар, пароль, уведомления, тема, косметика; SettingsAudio.tsx — устройства, PTT, шумодав
    main/WatchView.tsx         синхронный плеер: <video> для DIRECT/торрентов, mpv для экзотики
    main/StatsPanel.tsx        дайджест «Wrapped»; MuseumPanel.tsx — музей цитат; AchievementsPanel.tsx — ачивки
    main/UpdateModal.tsx       окно «Что нового» для авто-апдейтера
    admin/AdminScreen.tsx      админка (вкладки: Members | Roles | Channels | Audit)
    admin/RolesTab.tsx         CRUD ролей, матрица прав, назначение участникам
    admin/ChannelAccessTab.tsx ACL по каналам (allow/deny/neutral)

  lib/
    http.ts          HTTP-клиент: Bearer, single-flight refresh, повтор на 401
    config.ts        env: VITE_API_BASE, VITE_WS_URL, VITE_MOCK
    api.ts           единственное место с путями бэка: auth, серверы и инвайты, каналы, сообщения,
                     роли, саундпад, аудит, ранги/ачивки/дайджесты (+ мок-ветка почти в каждом методе)
    types.ts         типы UI: User, Member, Channel, Message, Role, Permission, WatchState …
    ws.ts            STOMP-over-WebSocket (/topic/channel.*, /topic/watch.*, /topic/server.*)
    presence.ts      кэш статусов участников и голосовых членов канала
    voice.ts         LiveKit-клиент: mic/deaf, PTT, screen-share, шумодав
    rnnoise.ts       RNNoise (WASM-шумодав) как LiveKit TrackProcessor
    soundboard.ts    общие аудиоклипы: fetch + presign-upload в S3, публикация отдельным треком
    ranks.ts         цвета рангов; cosmetics.ts / loadouts.ts — косметика профиля и её пресеты
    toast.ts         глобальные тосты (ok|error|info)
    sfx.ts           процедурные UI-звуки (Web Audio)
    markdown.tsx     рендер @mentions, #channels, emoji, **bold**, code
    permissions.ts   метаданные прав (подписи, описания, цвета ролей)
    format.ts        форматтеры дат/чисел/размеров — единственное место с локалью
    prefs.ts         локальные настройки уведомлений (localStorage)

  theme/
    ThemeProvider.tsx  Context: тема light/dark, акцент; CSS-переменные в document.root
    themes.ts          токены по темам, палитра акцентов
    global.css         reset, скроллбар, анимации, утилиты

  mocks/
    data.ts          мок-данные (MOCK_USER, MOCK_CHANNELS, MOCK_MESSAGES …) при VITE_MOCK=true
```

---

## 5. Возможности

| Область | Описание |
|---|---|
| **Чат** | Сообщения с CRUD (правка/удаление), ответы, реакции, группировка по автору, превью вложений, markdown (@mentions, #channels, emoji, **bold**, code). ID сообщений — ULID (сортировка по ID = хронология). |
| **Голос** | LiveKit WebRTC: микрофон, deafen, режимы voice / PTT (по умолчанию `Space`), глобальный хоткей `CommandOrControl+Shift+M`, выбор устройств, авто-gain, эхоподавление, RNNoise-шумодав (клиентский WASM, без серверной лицензии). |
| **Демонстрация экрана** | Несколько одновременных шар с пикером, пресеты качества (`source` / `q1080` / `q720` / `q360`), системный звук-loopback (только Windows). |
| **Совместный просмотр** | Три типа источника: **DIRECT** (прямой URL → `<video>`), **TORRENT** (magnet/infoHash → WebTorrent в main-процессе → стрим на `127.0.0.1`, для MKV/HEVC — внешний mpv), **LINK** (страница, отложено). Синхронизация play/pause/seek через WebSocket. Поиск торрентов через Prowlarr. |
| **Серверы** | Несколько серверов в левом рейле (`GuildRail`): создание, вход по инвайту, выход, переименование. Каждый сервер изолирован — свои каналы, участники и роли. |
| **Админка / роли** | Вкладки Members / Roles / Channels / Audit: кик участников, CRUD кастомных ролей с иерархией позиций и матрицей прав, ACL по каналам (allow/deny/neutral). Доступна только OWNER/ADMIN. |
| **Прогресс и фан-механики** | Ранги и XP с косметикой профиля (её можно надевать), ачивки, музей цитат, дайджест активности «Wrapped», авто-AFK. Всё гейтится флагами на бэке: выключено — панели просто пустые. |
| **Авто-обновление** | `electron-updater`: проверка релизов на GitHub, докачка и окно «Что нового» (тело релиза берётся из `CHANGELOG.md`). |
| **Прочее** | Presence (online/idle/dnd/offline + голосовые члены каналов), soundboard (общие аудиоклипы отдельным треком), DM, нативные уведомления и трей (свёртывание в трей), бейдж непрочитанного. |

Подробности по конкретным подсистемам — см. раздел [7. Документация](#7-документация).

---

## 6. Конфигурация

Все настройки клиента задаются через переменные окружения `VITE_*` (читаются в `src/lib/config.ts`). Скопируйте `.env.example` → `.env` и при необходимости переопределите.

| Переменная | Назначение | По умолчанию | Прод-значение |
|---|---|---|---|
| `VITE_API_BASE` | Базовый URL REST-бэка | `http://localhost:8080` | `https://api.chazhland.ru` |
| `VITE_WS_URL` | STOMP WebSocket-эндпоинт | автовывод как `ws://localhost:8080/ws` | `wss://api.chazhland.ru/ws` |
| `VITE_MOCK` | Mock-режим (данные из `src/mocks/data.ts`, WS — no-op) | `false` (выключен) | `false` |

### Пример `.env`

```env
# Боевое подключение — то, что нужно большинству (так же настроен .env.example).
VITE_API_BASE=https://api.chazhland.ru
VITE_WS_URL=wss://api.chazhland.ru/ws
VITE_MOCK=false

# Разработка UI без бэкенда (мок-данные) — раскомментируйте вместо блока выше:
# VITE_API_BASE=http://localhost:8080
# VITE_WS_URL=ws://localhost:8080/ws
# VITE_MOCK=true
```

> Mock включается **строго** строкой `'true'`: отсутствие переменной или опечатка = живой бэк. Проверка намеренно строгая — однажды прод-сборка молча ушла в моки. Прод-сборка берёт значения из закоммиченного `.env.production` (Vite грузит его автоматически в production-режиме).

Прочие детали контракта (авторизация Bearer, single-flight refresh, ключ `chazh.refresh` в localStorage, заголовок Origin) — см. [docs/BACKEND-CONTRACT.md](docs/BACKEND-CONTRACT.md).

---

## 7. Документация

| Документ | О чём |
|---|---|
| [README.md](README.md) | Этот файл — точка входа, обзор, быстрый старт |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура: Electron (main/preload) ↔ renderer (features → lib → бэк), мост `window.chazh`, IPC |
| [docs/BUILD.md](docs/BUILD.md) | Сборка и упаковка: dev/prod, electron-builder, ASAR, Windows-нюансы |
| [docs/WATCH-TOGETHER.md](docs/WATCH-TOGETHER.md) | Совместный просмотр: WebTorrent-движок, mpv, синхронизация, поиск через Prowlarr + SOCKS5-туннель |
| [docs/VOICE.md](docs/VOICE.md) | Голос/демонстрация экрана: LiveKit, PTT, RNNoise, soundboard, screen-share |
| [docs/BACKEND-CONTRACT.md](docs/BACKEND-CONTRACT.md) | Работа с бэком: устройство слоя `src/lib/api.ts`, где смотреть актуальный контракт (swagger бэка), авторизация, STOMP-топики, неочевидное в контракте |

---

## 8. Главные подводные камни

- **Node 20 LTS или 22, не 26+.** Electron 33 несёт внутри Node 20.18 (это рантайм main/preload); собирать проект можно на Node 20 LTS или 22 — релизный CI собирает на 22. На dev-машинах с Node 26+ возникают проблемы. Не используйте `npm install --omit=optional` — это ломает нативные сборки.
- **mpv: в Windows-релизе вложен, локально ставится отдельно.** Бинарей mpv в репозитории нет; в Windows-дистрибутив их скачивает и вкладывает CI, а для запуска из исходников (и на macOS/Linux) поставьте mpv сами: `brew install mpv` / `sudo apt install mpv yt-dlp` / `winget install mpv`. На рантайме клиент ищет его по `MPV_PATH`, затем среди вендоренных (`resourcesPath/mpv/`, в dev — `resources/mpv/<platform>-<arch>/`), затем `/opt/homebrew/bin/mpv`, `/usr/local/bin/mpv`, `/usr/bin/mpv` (*nix) или `C:\Program Files\mpv\mpv.exe` / `C:\Program Files\mpv.net\mpvnet.exe` (Windows), и лишь в конце — `mpv` из PATH. На macOS GUI-приложения получают усечённый PATH без `/opt/homebrew/bin`, поэтому перебор путей обязателен. Без mpv торренты с MKV/HEVC не воспроизводятся.
- **Поиск торрентов требует прокси.** Прод-VPS в России, РКН режет многие трекеры по TLS SNI. Поиск через Prowlarr ходит к заблокированным трекерам через SOCKS5-туннель на зарубежный VPS (контейнер `socks-tunnel`). Сам торрент качается P2P на клиенте, **не** через туннель. Без настроенного Prowlarr (`PROWLARR_ENABLED=true` + `PROWLARR_API_KEY`) поиск отдаёт 503. Детали — в [docs/WATCH-TOGETHER.md](docs/WATCH-TOGETHER.md).
- **WebTorrent@3 объявляет `engines.node>=22`**, но Electron 33 несёт Node 20.18 — перед релизом обязательно smoke-test `await import('webtorrent')` на реальном рантайме Electron 33. Модуль помечен как external и должен оставаться в `node_modules`, иначе приложение падает с `MODULE_NOT_FOUND` (проверка: `npx asar list`).
- **mock-режим по умолчанию ВЫКЛЮЧЕН** (`VITE_MOCK` включается строго строкой `'true'`): без `.env` клиент пойдёт в сеть по `VITE_API_BASE` (по умолчанию `http://localhost:8080`). Для работы над UI без бэкенда явно ставьте `VITE_MOCK=true`.
- **`window.chazh` есть только в Electron.** Нативные функции (уведомления, хоткеи, торрент, mpv) недоступны в обычном браузере — проверяйте существование `window.chazh`.
