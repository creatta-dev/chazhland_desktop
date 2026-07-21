# Архитектура десктоп-клиента chazhland

Документ для нового разработчика. Описывает, из каких слоёв собран десктоп-клиент,
как устроено дерево `src/`, как данные идут от бэкенда в UI, что такое мост
`window.chazh`, как работает навигация и mock-режим.

Смежные документы:
- [README](../README.md) — обзор проекта и быстрый старт.
- [Сборка и стек](BUILD.md) — версии, команды сборки, упаковка под Windows.
- [Просмотр вместе](WATCH-TOGETHER.md) — torrent/mpv-плеер, синхронизация.
- [Голос](VOICE.md) — LiveKit, шумоподавление, демонстрация экрана.
- [Контракт бэкенда](BACKEND-CONTRACT.md) — устройство слоя `api.ts`/`http.ts`, где смотреть актуальный контракт (swagger бэка), STOMP-топики и неочевидное.

---

## 1. Слои приложения

Клиент — это приложение на **Electron + React/TypeScript/Vite**. Оно делится на два
крупных процесса Electron и веб-слой внутри окна (renderer):

```
┌─────────────────────────────────────────────────────────────────────┐
│ ELECTRON                                                              │
│                                                                       │
│  main process (electron/main.ts)        preload (electron/preload.*)  │
│  ─ окно, трей, нотификации              ─ contextBridge               │
│  ─ глобальный хоткей микрофона          ─ exposes window.chazh        │
│  ─ движок WebTorrent (127.0.0.1)        ─ единственный мост           │
│  ─ внешний плеер mpv (JSON-IPC)           renderer ↔ main             │
│  ─ перезапись Origin для WS                                           │
│                    ▲          contextIsolation = true                 │
│                    │  IPC (ipcMain ↔ ipcRenderer через preload)       │
│                    ▼                                                   │
│ ─────────────────────────────────────────────────────────────────── │
│ RENDERER (веб-UI в окне)                                              │
│                                                                       │
│   features/  (презентация)                                           │
│        │  использует                                                  │
│        ▼                                                              │
│   lib/      (data-layer)  ──── REST  ───▶ api.chazhland.ru           │
│   store/    (auth-context) ─── STOMP ───▶ wss://api.chazhland.ru/ws  │
│   theme/    (темизация)    ─── LiveKit ─▶ livekit.chazhland.ru       │
└─────────────────────────────────────────────────────────────────────┘
```

Ключевые свойства слоёв:

- **Electron main/preload** — нативный слой. `contextIsolation=true`,
  `nodeIntegration=false`, `sandbox=false` (последнее — временно, до миграции
  preload, см. TZ p.6). `webSecurity=false` допустим только потому, что renderer
  загружает **исключительно внутренний контент** (dev-сервер Vite или
  `dist/index.html`), а внешние ссылки принудительно открываются в системном
  браузере через `shell.openExternal`.
- **Renderer** — трёхслойный веб-UI:
  1. **Презентация** (`src/features/`) — React-компоненты.
  2. **Data-layer** (`src/lib/`) — HTTP-клиент, REST API, WebSocket/STOMP,
     presence, voice, soundboard и утилиты.
  3. **Бэкенд** — REST (`VITE_API_BASE`), STOMP-over-WebSocket (`VITE_WS_URL`),
     LiveKit (для голоса и демонстрации экрана).

Единственный канал между renderer и нативной частью — объект `window.chazh`,
описанный в `src/global.d.ts` и реализованный в `electron/preload.ts`. Прямого
доступа к Node API из renderer нет.

---

## 2. Дерево `src/` и роль каждой области

### Точки входа и корень

| Путь | Роль |
|------|------|
| `src/main.tsx` | Точка входа renderer: `createRoot` + `ThemeProvider > AuthProvider > App`. |
| `src/App.tsx` | Корневой роутер: `TitleBar` + `ConnectionBanner` (если есть сессия) + `AuthScreen` \| `MainWindow` + `Toaster`. |
| `src/global.d.ts` | Интерфейс `window.chazh` (мост preload): управление окном, нотификации, хоткеи, torrent/mpv-плеер. |

### `src/features/` — презентация

#### `src/features/auth/`
| Файл | Роль |
|------|------|
| `AuthScreen.tsx` | Экраны входа/регистрации/сброса пароля с валидацией полей и отображением ошибок сервера. |

#### `src/features/main/`
| Файл | Роль |
|------|------|
| `MainWindow.tsx` | Главный контейнер приложения: управление состоянием, диспетчеризация вида, переключение offline/admin, подписки voice/presence. |
| `ChatFeed.tsx` | Виртуализированный список сообщений: автоскролл, разделители по дням, кнопка «к непрочитанным». |
| `Message.tsx` | Отрисовка одного сообщения: бейдж автора, реакции, превью ответа, контекстные действия. |
| `Composer.tsx` | Поле ввода: rich text, эмодзи-пикер, загрузка файлов (drag-drop, до 10 вложений). |
| `BottomBar.tsx` | Нижняя панель: селектор статуса, кнопки микрофона/глушения/live, счётчик непрочитанного, доступ к admin/настройкам. |
| `GuildRail.tsx` | Самая левая колонка: список серверов, создание сервера и вход по инвайту. |
| `ChannelSidebar.tsx` | Левый сайдбар: категории, каналы, DM, ростеры голосовых каналов; `CreateChannelModal.tsx` / `ChannelSettingsModal.tsx` — создание и правка канала. |
| `MembersRail.tsx` | Сворачиваемая правая панель: онлайн/офлайн участники, участники голоса. |
| `ScreenSharePane.tsx` | Просмотр удалённой демонстрации экрана: несколько демонстраций с переключателем, полноэкранный режим; `ScreenPicker.tsx` — выбор источника. |
| `SettingsModal.tsx` | Вкладочные настройки: профиль и аватар, аудио (`SettingsAudio.tsx` — устройства, PTT-клавиша, шумодав), уведомления, оформление, косметика, безопасность. |
| `WatchView.tsx` | Синхронный видеоплеер (управление через WebSocket): torrent-стриминг с прогрессом, mpv-фолбэк для экзотических кодеков. |
| `ChatPanel.tsx` | Вертикальная обёртка чата (область контента канала). |
| `StatsPanel.tsx`, `MuseumPanel.tsx`, `AchievementsPanel.tsx` | Панели дайджеста «Wrapped», музея цитат и ачивок. |
| `ProfileModal.tsx`, `ServerActionsModal.tsx`, `UpdateModal.tsx` | Карточка участника, действия с сервером (инвайты/переименование/выход), окно «Что нового» авто-апдейтера. |

#### `src/features/admin/`
| Файл | Роль |
|------|------|
| `AdminScreen.tsx` | Вкладочный UI модерации (Members \| Roles \| Channels \| Audit). |
| `RolesTab.tsx` | CRUD серверных ролей, матрица прав, назначение по ролям. |
| `ChannelAccessTab.tsx` | Редактор ACL канала: overwrite для роли/участника (allow/deny/neutral). |
| `modals.tsx` | Хелперы `ConfirmModal`, `ChangeRoleModal`. |

### `src/lib/` — data-layer

**Аутентификация и HTTP**
| Файл | Роль |
|------|------|
| `http.ts` | Базовый HTTP-клиент: Bearer-авторизация, повтор по 401 с single-flight refresh токена. |
| `config.ts` | Конфигурация окружения: `VITE_API_BASE`, `VITE_WS_URL`, `VITE_MOCK` (по умолчанию выключен). |

**API и типы**
| Файл | Роль |
|------|------|
| `api.ts` | REST-клиент и единственное место с путями бэка (auth, серверы и инвайты, каналы, сообщения, участники, роли, саундпад, аудит, ранги/ачивки/дайджесты). При `VITE_MOCK=true` возвращает данные из `src/mocks/data.ts`. Подробнее — [BACKEND-CONTRACT.md](BACKEND-CONTRACT.md). |
| `types.ts` | DTO-схема: `User`, `Member`, `Channel`, `Message`, `Attachment`, `Role`, `Permission`, `WatchState`, `ChatEvent`. |

**Realtime и состояние**
| Файл | Роль |
|------|------|
| `ws.ts` | STOMP-over-WebSocket клиент (подписки `/topic/channel.*`, `/topic/watch.*`, `/topic/presence`, серверные `/topic/server.{id}.*` — presence/ранги/кворум/ачивки/AFK). Подписки переживают reconnect; no-op в mock-режиме. |
| `presence.ts` | Кэш статусов участников (online/idle/dnd/offline) и участников голоса по каналам. Снимок `/presence` + дельты; периодическая ресинхронизация (30 с). |

**Голос и медиа**
| Файл | Роль |
|------|------|
| `voice.ts` | LiveKit WebRTC-клиент: микрофон/глушение, PTT, демонстрация экрана (качество `source`/`q1080`/`q720`/`q360`), мониторинг уровня звука. |
| `rnnoise.ts` | Нейросетевое шумоподавление RNNoise (клиентский WASM, 48 кГц), обёрнутое в LiveKit `TrackProcessor`. |
| `soundboard.ts` | Общие аудиоклипы: получение (`GET /soundboard`), загрузка (presign + PUT в S3), микс и публикация отдельным треком. |

**UI и UX**
| Файл | Роль |
|------|------|
| `toast.ts` | Глобальные уведомления (`ok`/`error`/`info`); модель подписки для компонента `Toaster`. |
| `sfx.ts` | Процедурный синтез тонов UI (микрофон вкл/выкл, глушение, демонстрация, join/leave) через Web Audio; `AudioContext` приостановлен до действия пользователя (autoplay-политика). |
| `markdown.tsx` | Rich text: `@упоминания`, `#каналы`, эмодзи, `**жирный**`, `*курсив*`, блоки кода. |
| `emojis.ts` | Список эмодзи для пикера. |
| `mentions.ts` | Токенизация `@упоминаний` для автодополнения. |

**Права и утилиты**
| Файл | Роль |
|------|------|
| `permissions.ts` | Метаданные прав (подписи, описания, группы, цвета ролей). |
| `useEscape.ts` | React-хук на клавишу ESC (закрытие модалок); отписка при размонтировании. |

### `src/store/` — состояние и auth
| Файл | Роль |
|------|------|
| `auth.tsx` | React Context: сессия (`user` + токен), `login`/`register`/`logout`, refresh по 401, reconnect WS, очистка voice при logout. Refresh-токен — в `localStorage`, access-токен — только в памяти (безопаснее против XSS). |

### `src/theme/` — темизация
| Файл | Роль |
|------|------|
| `ThemeProvider.tsx` | React Context: переключение темы (`light`/`dark`), выбор акцентного цвета; CSS-переменные на `document.root`; хранение в `localStorage` (`chazh.theme`, `chazh.accent`). |
| `themes.ts` | Дизайн-токены по темам (`--bg`, `--surface`, `--text`, `--accent`, `--border`), палитра `ACCENTS` (по умолчанию Discord blurple). |
| `global.css` | Глобальные стили: reset, скроллбар, анимации, утилитарные классы. |

### `src/mocks/`
| Файл | Роль |
|------|------|
| `data.ts` | Mock-данные (`MOCK_USER`, `MOCK_CATEGORIES`, `MOCK_CHANNELS`, `MOCK_MEMBERS`, `MOCK_MESSAGES`), используются при `VITE_MOCK=true`. |

---

## 3. Поток данных: как сообщение/состояние идёт от бэка в UI

Состояние приходит двумя путями — **pull (REST)** для первичной загрузки/действий и
**push (STOMP)** для realtime-обновлений. Все сетевые вызовы проходят через
data-layer (`src/lib/`), компоненты `features/` не ходят в сеть напрямую.

### 3.1. Первичная загрузка (REST, pull)

```
MainWindow / ChatFeed
      │ вызывает
      ▼
src/lib/api.ts  ─── строит запрос ───▶ src/lib/http.ts (Bearer, refresh по 401)
      │                                        │
      │ (если VITE_MOCK=true)                  ▼
      ▼                              GET https://api.chazhland.ru/...
src/mocks/data.ts                            │
                                             ▼
                                  Page<MessageDto> (newest-first)
      │
      ▼ маппинг в типы из src/lib/types.ts, разворот в хронологический порядок
React-стейт компонента ──▶ отрисовка в ChatFeed/Message
```

Особенности (важно для отладки):
- История канала (`GET /channels/{id}/messages`) приходит **newest-first** и
  разворачивается на клиенте в хронологический порядок.
- ID сообщений — **ULID** (лексикографически = хронологически), сортировка по ID
  эквивалентна сортировке по времени.
- Курсорная пагинация `before={id}` / `after={id}` **исключает** опорное
  сообщение — при переходе из поиска/пинов результаты нужно мерджить отдельно.

### 3.2. Realtime-обновления (STOMP, push)

```
Бэкенд публикует в STOMP-топик
      │
      ▼
src/lib/ws.ts  (STOMP-over-WebSocket, подписки переживают reconnect)
      │  раскладывает событие по топику
      ├── /topic/channel.{id}  ──▶ ChatEvent (message / typing / reaction)
      │         └─▶ обновление списка сообщений в ChatFeed
      ├── /topic/watch.{id}    ──▶ WatchState
      │         └─▶ src/features/main/WatchView.tsx (синхронизация плеера)
      └── /topic/presence      ──▶ PRESENCE_UPDATE / VOICE_UPDATE
                └─▶ src/lib/presence.ts (кэш) ──▶ MembersRail / BottomBar / switcher
```

Публикация с клиента (управляющие сообщения):
- `/app/channel.{id}.typing` — индикатор набора.
- `/app/watch.{id}.control` — `{ action, positionSeconds }` для play/pause/seek
  в синхронном просмотре.
- `/app/presence.heartbeat` — продление онлайна (опционально `{ status }`).

### 3.3. Presence как источник истины

`presence.statusOf(userId)` и `presence.voiceMembers(channelId)` — **авторитетные**
данные об онлайне в UI. Поле `Member.status` из первичной загрузки считается
устаревшим (stale); живые статусы приходят дельтами через `/topic/presence`.

### 3.4. Голос и медиа (LiveKit, отдельный канал)

Голос не идёт через STOMP. `src/lib/voice.ts` получает JWT через
`api.livekitToken(channelId)` и подключается к комнате LiveKit. Аудио микрофона и
soundboard публикуются как **отдельные** `MediaStreamTrack` (трек soundboard
именуется `soundboard`). Демонстрация экрана — трек `Track.Source.ScreenShare`,
который рендерится в `ScreenSharePane.tsx`.

### 3.5. Загрузка вложений (presigned S3, в обход API-авторизации)

```
Composer ──▶ api.uploadFile
      │
      ▼ POST /attachments/presign  ──▶ { uploadUrl, objectKey }
      │
      ▼ PUT {uploadUrl}  (БЕЗ заголовков авторизации, прямо в S3)
      │
      ▼ ссылка objectKey прикрепляется к сообщению
```
Размер/ширина/высота файла измеряются на клиенте до отправки; у вложений нет
`thumbnailUrl`, превью строится из `url` + width/height.

---

## 4. Мост `window.chazh` (preload IPC)

Определён в `src/global.d.ts`, реализован в `electron/preload.ts`. Это
**единственный** способ для renderer обратиться к нативным возможностям. Доступен
только под Electron — в обычном браузере `window.chazh` отсутствует, поэтому
нативные фичи нужно вызывать с проверкой существования объекта.

### 4.1. Управление окном и трей

| Метод | IPC-канал | Сигнатура / поведение |
|-------|-----------|-----------------------|
| `platform` | — | строка `process.platform`. |
| `minimize()` | `win:minimize` | `ipcRenderer.send` — свернуть окно. |
| `maximize()` | `win:maximize` | `ipcRenderer.send` — развернуть/восстановить. |
| `close()` | `win:close` | `ipcRenderer.send` — закрыть (с учётом minimize-to-tray). |
| `isMaximized()` | `win:isMaximized` | `invoke` → `Promise<boolean>`. |

### 4.2. Нотификации и бейдж

| Метод | IPC-канал | Сигнатура / поведение |
|-------|-----------|-----------------------|
| `notify(p)` | `notify:show` | `invoke`, `p = { title, body, channelId? }`. |
| `onNotificationClick(cb)` | `notif:clicked` | подписка на клик по нотификации, `cb(d: { channelId })`; возвращает функцию-отписку. |
| `setBadge(count)` | `app:badge` | `send` — счётчик непрочитанного на иконке приложения. |

### 4.3. Голос (глобальный хоткей и аудио демонстрации)

| Метод | IPC-канал | Сигнатура / поведение |
|-------|-----------|-----------------------|
| `setMicHotkey(accel)` | `voice:setMicHotkey` | `invoke(accel: string \| null)` → `Promise<string \| null>`; регистрирует глобальный хоткей микрофона. |
| `onToggleMic(cb)` | `voice:toggle-mic` | подписка на срабатывание хоткея, `cb()`; возвращает отписку. |
| `setShareAudio(on)` | `screen:setAudio` | `invoke(on: boolean)` → `Promise<void>`; loopback системного звука (только Windows), вызывать **до** `getDisplayMedia`. |

### 4.4. Torrent-движок (WebTorrent, только main-процесс)

| Метод | IPC-канал | Сигнатура / поведение |
|-------|-----------|-----------------------|
| `torrentStart(p)` | `torrent:start` | `invoke(p: { magnet?, infoHash? })` → `TorrentStartResult { ok, token?, streamUrl?, name?, length?, webPlayable?, error? }`. |
| `torrentStop(token?)` | `torrent:stop` | `invoke(token?: string)`. |
| `torrentSelftest()` | `torrent:selftest` | `invoke` — диагностика (валидация упакованного Windows-билда). |
| `onTorrentProgress(cb)` | `torrent:progress` | подписка (раз в 1000 мс), `cb(p)` с `{ token, progress, downloaded, length, downloadSpeed, numPeers, ready }`; возвращает отписку. |

Стрим-сервер слушает на `127.0.0.1:<random>` по пути `/<token>/stream` (токен
сверяется через `crypto.timingSafeEqual`). Веб-проигрываемые форматы
(`.mp4`, `.m4v`, `.webm`, `.ogv`) играются в `<video>`; остальные требуют mpv.
Подробности — в [WATCH-TOGETHER.md](WATCH-TOGETHER.md).

### 4.5. Внешний плеер mpv (экзотические кодеки)

| Метод | IPC-канал | Сигнатура / поведение |
|-------|-----------|-----------------------|
| `mpvLoad(p)` | `mpv:load` | `invoke(p: { url, paused?, start? })`. |
| `mpvPause(paused)` | `mpv:pause` | `invoke(paused: boolean)`. |
| `mpvSeek(sec)` | `mpv:seek` | `invoke(sec: number)`. |
| `mpvStop()` | `mpv:stop` | `invoke`. |
| `onMpvEvent(cb)` | `mpv:event` | подписка на события плеера (`time-pos`, `pause`, `loaded`, `end`, `ready`, `spawn-error`, `exit`); возвращает отписку. |

> mpv-бинарник **не входит** в репозиторий — его ставят отдельно
> (`brew install mpv` / `winget install mpv`). Подробности — в
> [WATCH-TOGETHER.md](WATCH-TOGETHER.md).

### 4.6. Поведение preload при выгрузке

В `beforeunload` (срабатывает и на reload, и на unload) preload вызывает
`ipcRenderer.invoke('voice:setMicHotkey', null).catch(() => {})`, чтобы снять
глобальный хоткей и не оставить его зарегистрированным в ОС. Обработчик не должен
бросать исключения.

---

## 5. Навигационный паттерн

Навигация **не маршрутная** (нет URL-роутера) — она построена на состоянии
`MainWindow` и модальном стеке.

```
        ┌──────────────┐  есть сессия?  ┌───────────────────────────────┐
START ─▶│  AuthScreen  │ ─── нет ──────│ остаётся экран входа           │
        └──────────────┘                └───────────────────────────────┘
               │ да
               ▼
        ┌──────────────────────────────────────────────────────────────┐
        │ MainWindow                                                     │
        │  ┌──────────┬───────────────────────────┬──────────────────┐  │
        │  │ GuildRail│ ChatPanel/ChatFeed         │ MembersRail      │  │
        │  │ +Channel │  ИЛИ WatchView (WATCH)      │ (сворачиваемая)  │  │
        │  │  Sidebar │  ИЛИ ScreenSharePane        │                  │  │
        │  ├──────────┴───────────────────────────┴──────────────────┤  │
        │  │ BottomBar: статус · mic/deaf/live · непрочитанное ·       │  │
        │  │            admin (если OWNER/ADMIN) · настройки           │  │
        │  └──────────────────────────────────────────────────────────┘  │
        └──────────────────────────────────────────────────────────────┘
```

Правила навигации:

- **Выбор сервера и канала.** Постоянные колонки слева: `GuildRail` (серверы) и
  `ChannelSidebar` (категории, каналы TEXT/VOICE/WATCH, DM, живые ростеры голосовых
  каналов через `presence`, кнопка создания канала).
- **Вложенные модалки.** Из сайдбара открываются `CreateChannelModal` /
  `ChannelSettingsModal`, из них — вложенные подтверждения. ESC закрывает сначала
  внутреннюю модалку, потом внешнюю (см. `src/lib/useEscape.ts`).
- **Admin.** Кнопка-щит в `BottomBar` видна только ролям OWNER/ADMIN и
  переключает `MainWindow` на `AdminScreen` (вкладки Members / Roles / Channels /
  Audit). Это не отдельный маршрут, а состояние вида.
- **Голос.** Кнопки mic/deaf в `BottomBar` или хоткей (глобальный
  `Cmd/Ctrl+Shift+M`, либо настроенная PTT-клавиша).
- **Демонстрация экрана.** Кнопка-монитор в `BottomBar`; источник выбирается в
  `ScreenPicker`, качество — в меню той же кнопки (`SCREEN_QUALITY_ORDER`).
- **Синхронный просмотр.** При выборе канала типа WATCH вместо `ChatFeed`
  показывается `WatchView`.

---

## 6. Mock-режим

Управляется переменной окружения **`VITE_MOCK`** — по умолчанию **выключен**, включается строго
строкой `'true'` (опечатка или отсутствие переменной = живой бэк; проверка намеренно строгая, однажды
прод-сборка молча уехала в моки). Предназначен для быстрой итерации и тестирования дизайна без бэкенда.

| `VITE_MOCK` | Поведение |
|-------------|-----------|
| `'true'` | Все вызовы `api.*` возвращают данные из `src/mocks/data.ts`. `ws.connect` — no-op, `presence.subscribe` возвращает no-op. Сетевых запросов нет. |
| любое другое значение (по умолчанию) | Клиент ходит в живой бэкенд по `VITE_API_BASE` / `VITE_WS_URL`. |

Важно:
- В mock-режиме `MembersRail` читает статусы из статического `Member[]`, а не из
  живого presence-кэша.
- Нативные фичи (`window.chazh`: нотификации, хоткеи, torrent, mpv) существуют
  только под Electron независимо от mock-режима — в браузере их нет, проверяйте
  наличие `window.chazh`.

Связанные переменные окружения (см. `src/lib/config.ts`):

| Переменная | Назначение | Значение по умолчанию |
|------------|-----------|-----------------------|
| `VITE_API_BASE` | База REST API | `http://localhost:8080` (prod: `https://api.chazhland.ru`) |
| `VITE_WS_URL` | Эндпоинт WebSocket | авто-вывод `ws://localhost:8080/ws` (prod: `wss://api.chazhland.ru/ws`) |
| `VITE_MOCK` | Mock-режим | `false` (выключен) |

---

## 7. Сводная диаграмма (текстом)

```
ПОЛЬЗОВАТЕЛЬ
   │ клики, ввод, хоткеи
   ▼
features/ (React-компоненты: AuthScreen, MainWindow, GuildRail, ChannelSidebar,
   │       ChatFeed, Composer, BottomBar, MembersRail, WatchView, AdminScreen…)
   │
   │ вызовы методов data-layer / подписки
   ▼
lib/ (data-layer)
   ├── http.ts  ─────────────┐
   ├── api.ts ───────────────┤── REST ──▶  api.chazhland.ru
   │     └─(VITE_MOCK=true)─▶ mocks/data.ts
   ├── ws.ts ────────────────┼── STOMP ─▶  wss://api.chazhland.ru/ws
   │     ▲ /topic/channel.* /topic/watch.* /topic/presence /topic/server.*
   ├── presence.ts ──────────┘ (кэш статусов и голоса)
   ├── voice.ts ─────────────── LiveKit ─▶ livekit.chazhland.ru
   ├── soundboard.ts ────────── presign + PUT ─▶ S3
   └── store/auth.tsx (сессия, токены: refresh→localStorage, access→память)

   ▲ нативные возможности через единственный мост
   │
window.chazh  (global.d.ts ↔ electron/preload.ts ↔ ipcMain в main.ts)
   ├── окно: minimize / maximize / close / isMaximized
   ├── нотификации: notify / onNotificationClick / setBadge
   ├── голос: setMicHotkey / onToggleMic / setShareAudio
   ├── torrent: torrentStart / torrentStop / onTorrentProgress / torrentSelftest
   └── mpv: mpvLoad / mpvPause / mpvSeek / mpvStop / onMpvEvent
   │
   ▼
ELECTRON main process (окно, трей, WebTorrent на 127.0.0.1, внешний mpv,
   глобальный хоткей, перезапись Origin для WS на api.chazhland.ru)
```
