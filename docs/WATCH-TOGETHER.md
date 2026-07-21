# Совместный просмотр (Watch Together)

Документ для нового разработчика: как устроен совместный просмотр в десктоп-клиенте chazhland.
Покрывает три типа источника, торрент-движок внутри Electron main, плеер mpv, синхронизацию по STOMP
и — отдельным крупным разделом — поиск по названию через Prowlarr с иностранным SOCKS5-прокси.

Связанные документы:
[README.md](../README.md) ·
[docs/ARCHITECTURE.md](./ARCHITECTURE.md) ·
[docs/BUILD.md](./BUILD.md) ·
[docs/VOICE.md](./VOICE.md) ·
[docs/BACKEND-CONTRACT.md](./BACKEND-CONTRACT.md)

> Все смежные документы (`docs/ARCHITECTURE.md`, `docs/BUILD.md`, `docs/VOICE.md`, `docs/BACKEND-CONTRACT.md`) созданы и лежат рядом.

---

## 1. Обзор

Совместный просмотр позволяет участникам канала типа `WATCH` смотреть видео синхронно: позиция, пауза и
перемотка раздаются всем через WebSocket. Канал просмотра показывается на месте ленты сообщений —
компонент [`src/features/main/WatchView.tsx`](../src/features/main/WatchView.tsx) рендерится вместо `ChatFeed`,
когда выбран `WATCH`-канал.

Основные файлы:

| Слой | Файл | Назначение |
| --- | --- | --- |
| UI клиента | `src/features/main/WatchView.tsx` | Выбор плеера, ввод URL/magnet, прогресс загрузки, реконсиляция дрифта |
| Electron main (торрент) | `electron/torrent.ts` | WebTorrent-движок, localhost stream-сервер с токеном |
| Electron main (mpv) | `electron/mpv.ts` | Запуск внешнего mpv, JSON-IPC по сокету/пайпу |
| Backend | `WatchService`, `WatchController`, `WatchWsController` | Хранение состояния, REST, WebSocket-управление |
| Backend (безопасность) | `MagnetSanitizer`, `SsrfGuard` | Очистка magnet, валидация URL |
| Backend (поиск) | `ProwlarrClient` | Поиск торрентов по названию |

---

## 2. Три типа источника (WatchSourceKind)

Тип источника задаётся перечислением `WatchSourceKind` в бэкенде
(`backend/src/main/java/com/chazhland/messenger/watch/WatchSourceKind.java`):

| Kind | Что это | Как играется |
| --- | --- | --- |
| `DIRECT` | Прямой media-URL (mp4, HLS) или публичный URL файла из MinIO | HTML5 `<video>` в браузере (рендерер) |
| `TORRENT` | Magnet-ссылка или info hash (40 hex / 32 base32) | WebTorrent в Electron main → localhost HTTP-стрим; `<video>` для mp4/webm или окно mpv для MKV/HEVC и прочих кодеков |
| `LINK` | URL страницы (YouTube, VK, Rutube и т.п.) | Отложенная фича: планируется mpv + yt-dlp, **пока не реализовано** |

### Как клиент выбирает плеер

В [`WatchView.tsx`](../src/features/main/WatchView.tsx) функция `resolve()` определяет плеер для каждого
источника:

- `video` — для `DIRECT` и веб-проигрываемых торрентов;
- `mpv` — для торрентов с «экзотическим» кодеком;
- состояние ошибки — кодек не поддержан, не удалось запустить и т.п.

Веб-проигрываемые расширения (плеер `<video>`, mpv не нужен): `.mp4`, `.m4v`, `.webm`, `.ogv`.
Для них торрент-движок возвращает `TorrentStartResult.webPlayable = true`.
Для MKV/HEVC/AC3/10-bit и прочего возвращается `webPlayable = false` → подключается mpv.

Возможные состояния-ошибки, отображаемые в UI:

- кодек не поддержан (нужен mpv, но не найден);
- failed (нет сидов / некорректный magnet);
- ссылка пока не поддержана (`LINK`);
- `nobridge` — мост (`window.chazh`) не загружен (например, запуск не в Electron).

---

## 3. Торрент-движок (WebTorrent, только на клиенте)

Файл: [`electron/torrent.ts`](../electron/torrent.ts). Движок работает **только в Electron main-процессе**.

### 3.1 Инвариант: VPS не качает торренты

> **Торрент-трафик никогда не идёт через сервер.** Скачивание торрента происходит исключительно на клиенте
> через WebTorrent. Вся P2P-полоса берётся у пиров клиента; VPS торренты не загружает.

Это ключевой инвариант архитектуры: бэкенд хранит лишь состояние просмотра (включая info hash), но не
является торрент-клиентом.

### 3.2 Библиотека и сборка

- Библиотека: `webtorrent` (ESM-импорт, без типов). Версия `webtorrent@3.0.16`, production-зависимость.
- В [`vite.config.ts`](../vite.config.ts) `webtorrent` и `node-datachannel` помечены как `external` — они
  **не бандлятся** в main-сборку.
- В main подключается динамическим импортом: `await import('webtorrent')` в [`electron/main.ts`](../electron/main.ts).

> **Gotcha (сборка):** `webtorrent` помечен external — если его нет в `node_modules` во время рантайма,
> приложение упадёт с `MODULE_NOT_FOUND`. Проверять после сборки через `npx asar list`.
> `webtorrent@3` декларирует `engines.node >= 22`, но Electron 33 поставляет Node 20.18 — **обязателен
> smoke-тест** `await import('webtorrent')` на реальном рантайме Electron 33 перед релизом; при
> несовместимости — откат на `webtorrent 2.6.x`. Подробнее в [docs/BUILD.md](./BUILD.md).

### 3.3 Санитизация magnet

`MagnetSanitizer.sanitize()` (бэкенд) и логика клиента оставляют в magnet **только** `xt=urn:btih:<hash>`
и отбрасывают параметры `tr=`, `ws=`, `xs=`, `as=`.

> **Зачем:** несанитизированный magnet ведёт к SSRF и утечке IP зрителей на трекер, контролируемый
> атакующим. **Всегда** вызывайте `MagnetSanitizer.sanitize()` перед сохранением/рассылкой состояния.

Ограничения формата:

- максимальная длина magnet: 4096 символов;
- info hash: 40-символьный hex (btih v1, в нижнем регистре) или 32-символьный base32 (btih v2, в верхнем регистре);
  некорректные форматы отвергаются.

### 3.4 Публичные трекеры и поиск пиров

Пиры ищутся через DHT + список из 7 публичных UDP-трекеров:

```
udp://tracker.opentrackr.org:1337/announce
udp://open.tracker.cl:1337/announce
udp://tracker.openbittorrent.com:6969/announce
udp://exodus.desync.com:6969/announce
udp://tracker.torrent.eu.org:451/announce
udp://open.stealth.si:80/announce
udp://tracker.dler.org:6969/announce
```

> **Gotcha (DHT):** DHT требует открытых портов / UPnP или ручного проброса. В части корпоративных сетей
> DHT заблокирован — тогда движок опирается только на публичные трекеры, а молчание DHT остаётся тихим
> сбоем.

### 3.5 Кэш

Временная директория кэша: `${os.tmpdir()}/chazh-wt-cache`.
Кэш подметается при старте приложения, при переключении источника и при выходе
(`destroyStore: true`). На старте `sweepTorrentCacheOnStartup()` чистит «осиротевшие» файлы от прошлого
аварийного завершения; кэш также чистится на каждом новом `start()`.

### 3.6 Выбор файла и ограничения

- Движок авто-выбирает **самый крупный видеофайл** в раздаче и качает только его (остальные снимает с
  выбора).
- Белый список видеорасширений: `.mp4 .m4v .webm .mkv .avi .mov .ts .wmv .flv .mpg .mpeg .ogv`.

Лимиты:

| Параметр | Значение |
| --- | --- |
| Максимальный суммарный объём | 60 ГБ (`MAX_TOTAL_BYTES`) |
| Максимум файлов | 5000 (`MAX_FILES`) |
| Таймаут метаданных | 60 секунд (`METADATA_TIMEOUT_MS`) |
| Требуемое свободное место | 3 ГБ (`MIN_FREE_BYTES`) |

> **Gotcha (метаданные):** если рой слишком мал/мёртв, DHT-bootstrap не наберёт метаданные за 60 секунд →
> ошибка «Не удалось получить метаданные раздачи».
> **Gotcha (мульти-видео):** авто-выбирается только один (крупнейший) видеофайл; ручной выбор файла для
> многосерийных раздач пока не реализован.

### 3.7 Localhost stream-сервер с токеном

- HTTP-сервер слушает **только** на `127.0.0.1` на случайном порту: `http.createServer` на `127.0.0.1:0`.
- Путь стрима: `http://127.0.0.1:<random-port>/<token>/stream`.
- Токен: `crypto.randomBytes(24).toString('hex')` (24 байта / 192 бита).
- Гейтинг токена: сравнение константного времени `crypto.timingSafeEqual()`; при несовпадении — `404`
  (без подсказок, что токен неверный — защита от тайминг-атак).
- Поддержка HTTP Range: заголовок `Accept-Ranges: bytes`, `Content-Type` по расширению файла, ответы
  `206 Partial Content` для перемотки.

CSP рендерера разрешает `http://127.0.0.1:*` именно ради этого localhost-стрима (см. `media-src` в
[docs/BUILD.md](./BUILD.md)).

> **Gotcha (Range):** парсинг диапазона использует regex `bytes=X-Y` и ручной `parseInt`, формат
> предполагается HTTP/1.1; некорректные диапазоны молча считаются невалидными. Некоторые клиенты
> (`mpv`, `<video>`) запрашивают range неэффективно → лаги на медленном рое.

### 3.8 IPC и прогресс

IPC-канал `torrent:start` (async invoke) принимает `{ magnet?, infoHash? }` и возвращает
`TorrentStartResult`:

```
{ ok, token?, streamUrl?, name?, length?, webPlayable?, error? }
```

Другие каналы: `torrent:stop` (async invoke), `torrent:selftest` (async invoke, диагностика для проверки
упакованной Windows-сборки), `torrent:progress` (async send, каждые 1000 мс).

Полезная нагрузка `torrent:progress`:

```
{ token, progress, downloaded, length, downloadSpeed, numPeers, ready }
```

Прогресс отображается в [`WatchView.tsx`](../src/features/main/WatchView.tsx) как процент + число пиров,
обновляется раз в секунду.

> **Gotcha (одновременность):** одновременно активен только один торрент — новый `start()` дожидается
> `destroySession()` предыдущего. Операции start/stop сериализуются через `enqueue()` (цепочка Promise
> `opChain`). `registerTorrentIpc(getWin)` вызывается **один раз** на `app.whenReady()`, а не на каждое
> создание окна. `destroySession()` ждёт до 4 секунд завершения `torrent.destroy({ destroyStore: true })`,
> затем принудительно по таймауту.

API моста для рендерера (`window.chazh`, определён в `src/global.d.ts`, реализован в `electron/preload`):

- `torrentStart(p: { magnet?, infoHash? })` → `ipcRenderer.invoke('torrent:start', p)`
- `torrentStop(token?)` → `ipcRenderer.invoke('torrent:stop', token)`
- `torrentSelftest()` → `ipcRenderer.invoke('torrent:selftest')`
- `onTorrentProgress(cb)` → подписка на `torrent:progress`, возвращает функцию отписки

---

## 4. Плеер mpv (экзотические кодеки)

Файл: [`electron/mpv.ts`](../electron/mpv.ts). Запускается, когда торрент не веб-проигрываемый
(`webPlayable = false`): MKV, HEVC, AC3, 10-bit.

### 4.1 Установка mpv (отдельно от репозитория)

> **mpv НЕ входит в репозиторий** — бинарь нужно установить отдельно:
>
> - macOS: `brew install mpv`
> - Windows: `winget install mpv`

Поиск бинаря в рантайме (в этом порядке):

1. переменная окружения `MPV_PATH`;
2. `/opt/homebrew/bin/mpv` (Apple Silicon);
3. `/usr/local/bin/mpv` (Intel);
4. `/usr/bin/mpv` (\*nix);
5. `C:\Program Files\mpv\mpv.exe` и `C:\Program Files\mpv.net\mpvnet.exe` (Windows);
6. fallback `mpv` из `PATH`.

> **Gotcha (PATH на macOS):** GUI-приложения Electron получают усечённый `PATH` без `/opt/homebrew/bin` и
> `/usr/local/bin`, поэтому `spawn('mpv')` падает даже при установке через brew — функция поиска бинаря
> сначала проверяет хардкод-пути. Перед `spawn` есть guard `fs.existsSync`.

### 4.2 Запуск и аргументы

mpv запускается как внешний `ChildProcess` через `spawn()` со `stdio: 'ignore'` (без parent-child пайпа —
только JSON-IPC сокет). Аргументы:

```
--no-config --no-terminal --idle=yes --force-window=yes --keep-open=yes \
--input-ipc-server=<address> --pause=<yes|no> --start=<sec> \
--title='chazhland · кинозал' <url>
```

`--no-config` блокирует загрузку пользовательского конфига (защита от инъекции кода).

### 4.3 IPC-протокол

- Транспорт: Unix-сокет (macOS/Linux) или именованный пайп (Windows).
  - Windows: `\\.\pipe\chazh-mpv-<id>`
  - иначе: `path.join(os.tmpdir(), 'chazh-mpv-<id>.sock')`
- Протокол: построчный JSON `{ command: [...], request_id: <id> }`.
- Наблюдаемые свойства при подключении: `observe_property 1 time-pos`, `observe_property 2 pause`.
- Команды: `loadfile` (`mpv:load`), `set_property pause` (`mpv:pause`),
  `set_property time-pos` (`mpv:seek`), `quit` (`mpv:stop`).
- Подключение к сокету: до 60 попыток с интервалом 100 мс (всего ~6 секунд).

События в рендерер (`mpv:event`):

| Источник | Событие |
| --- | --- |
| property-change `time-pos` | `{ type: 'time-pos', value: <sec> }` |
| property-change `pause` | `{ type: 'pause', value: <bool> }` |
| `end-file` | `{ type: 'end', reason: <reason> }` |
| `file-loaded` | `{ type: 'loaded' }` |
| подключение к сокету | `{ type: 'ready' }` |
| ошибка процесса | `{ type: 'spawn-error' }` |
| выход процесса | `{ type: 'exit' }` |

### 4.4 Окно и подавление эха

- mpv открывает **отдельное окно** (не встроенное в окно приложения).
- Подавление эха команд на клиенте: 1500 мс после load, 800 мс после seek/pause — чтобы избежать петли
  обратной связи (эхо собственных команд не должно трактоваться как действие пользователя).

### 4.5 Статус встраивания

> Встраивание mpv в окно приложения **пока не сделано**: mpv открывается отдельным окном. Будущая работа
> включает встраивание через `--wid` и бандлинг Windows-бинаря.

> **Gotcha (заголовок окна):** заголовок установлен в `chazhland · кинозал` (кириллица); на терминалах без
> поддержки UTF-8 возможна порча escape-последовательностей.

API моста для рендерера (`window.chazh`):

- `mpvLoad(p: { url, paused?, start? })` → `mpv:load`
- `mpvPause(paused)` → `mpv:pause`
- `mpvSeek(sec)` → `mpv:seek`
- `mpvStop()` → `mpv:stop`
- `onMpvEvent(cb)` → подписка на `mpv:event`, возвращает функцию отписки

---

## 5. Синхронизация по STOMP

### 5.1 Хранение и рассылка состояния

- Состояние просмотра хранится в Redis под ключом `watch:{channelId}` как JSON-сериализованный `WatchState`.
- Рассылка: на каждое изменение состояния публикуется STOMP-сообщение в `/topic/watch.{channelId}`
  (через `WatchPublisher.toChannel(channelId, state)`).
- Управление (низкая задержка play/pause/seek): клиент шлёт `WatchControl` через WebSocket-маппинг
  `/app/watch.{channelId}.control` (`WatchWsController`).

`WatchControl` содержит `action` (`PLAY` / `PAUSE` / `SEEK`) и `positionSeconds`.

Поля `WatchState`:

| Поле | Описание |
| --- | --- |
| `source` | `WatchSource` или `null` |
| `url` | nullable |
| `paused` | boolean |
| `positionSeconds` | double |
| `updatedAt` | epoch ms |
| `hostId` | userId инициатора |
| `lastController` | userId последнего управлявшего |

`WatchSource`: `kind` (`WatchSourceKind`), `url` (для `DIRECT`/`LINK`), `infoHash` (для `TORRENT`, nullable).

### 5.2 Экстраполяция позиции на клиенте

Клиент получает `WatchState` (позиция + timestamp + флаг paused) и считает текущую позицию:

```
paused ? positionSeconds : positionSeconds + (Date.now() - updatedAt) / 1000
```

### 5.3 Реконсиляция дрифта

- Только для плеера `<video>`: каждые 4 секунды, если `|localTime - serverExtrapolated| > 2.5s`,
  выполняется seek к серверной позиции.
- Для mpv периодического цикла нет — он управляется напрямую из `apply()` на каждое изменение состояния.

> **Gotcha (потеря команд):** если клиент шлёт 3 SEEK за 100 мс, обработается только последний. Очереди
> нет — сервер читает последний `WatchControl`. Это осознанный компромисс ради низкой задержки.

### 5.4 Права доступа

- Управление (setSource / control / search): нужен `CONNECT` на watch-канале.
- Чтение состояния (getState): достаточно `VIEW`.

### 5.5 REST-контракт

| Метод и путь | Назначение |
| --- | --- |
| `GET /channels/{channelId}/watch` | Текущий `WatchState` (`204 No Content`, если источника нет → `null`) |
| `GET /channels/{channelId}/watch/search?q=<query>` | `List<WatchSearchResult>` (запрос 2–200 символов, минимум 1 сид) |
| `POST /channels/{channelId}/watch/source` | Тело `WatchSourceRequest { kind?, url?, infoHash? }` → `WatchState` |
| `DELETE /channels/{channelId}/watch` | Остановить просмотр (`204 No Content`) |

`WatchSourceRequest`: `kind` (опционально, по умолчанию `DIRECT` — legacy-совместимость), `url`
(опционально), `infoHash` (опционально).

Как клиент вообще работает с бэком (слой `api.ts`, авторизация, неочевидное) — см.
[docs/BACKEND-CONTRACT.md](./BACKEND-CONTRACT.md); точные схемы запросов/ответов — в swagger бэка
(`<API_BASE>/swagger-ui.html`).

---

## 6. Поиск по названию (Prowlarr + иностранный SOCKS5-прокси)

Это отдельный крупный механизм: пользователь ищет раздачу по названию прямо из клиента, а бэкенд ходит во
внутренний контейнер Prowlarr, который опрашивает трекеры. Часть трекеров заблокирована на РФ-VPS по SNI,
поэтому поисковый трафик к ним идёт через наш иностранный SOCKS5-прокси.

### 6.1 Поток данных (целиком)

1. Клиент шлёт запрос `GET /channels/{id}/watch/search?q=movie`.
2. Бэкенд вызывает `ProwlarrClient.search("movie")`.
3. Prowlarr опрашивает индексеры; для заблокированных трекеров — через SOCKS5-туннель на зарубежный VPS.
4. Результаты (magnet-URL, infohash) возвращаются клиенту.
5. Клиент получает список `WatchSearchResult` (title, size, seeders, leechers, magnet, infoHash, indexer).
6. Пользователь выбирает magnet → клиент вызывает `api.setWatchSource({ kind: 'TORRENT', url: magnet })`.
7. Скачивание торрента идёт **на клиенте** через WebTorrent — **НЕ** через туннель.

> Повтор инварианта: через туннель идёт только небольшой HTTPS-трафик поисковых запросов (метаданные).
> Торрент-трафик остаётся P2P на клиенте и никогда не проходит через туннель.

### 6.2 ProwlarrClient

`ProwlarrClient.search(query)` делает HTTP-запрос:

```
GET http://prowlarr:9696/api/v1/search?type=search&limit=30&query=<encoded>
X-Api-Key: <ключ>
```

Фильтрация: оставляются результаты торрент-протокола с magnet/infoHash, проверяется минимум сидов.

`WatchSearchResult`:

```
{ title, size, seeders, leechers, magnet, infoHash, indexer }
```

Переменные окружения бэкенда:

| Переменная | Назначение |
| --- | --- |
| `PROWLARR_ENABLED` | Включение поиска |
| `PROWLARR_BASE_URL` | Базовый URL Prowlarr |
| `PROWLARR_API_KEY` | API-ключ Prowlarr |
| `PROWLARR_MIN_SEEDERS` | Минимум сидов для результата |
| `PROWLARR_MAX_RESULTS` | Лимит результатов |

> **Gotcha (503):** поиск требует `PROWLARR_ENABLED=true` + `PROWLARR_API_KEY` в `.env`. Если чего-то нет,
> `/watch/search` возвращает `503` (service unavailable), а не `400`.
> **Gotcha (фильтрация):** если у результата нет ни magnet, ни infoHash — он отбрасывается. Мёртвые/
> бессидовые релизы часто без magnet, поэтому поиск может вернуть меньше результатов, чем «сырой» счётчик
> Prowlarr.

### 6.3 Контейнер Prowlarr (внутренний)

- Имя сервиса: `prowlarr:9696` (внутренняя сеть docker-compose).
- Привязка: `127.0.0.1:9696` (только loopback, **публичного порта нет**).

### 6.4 Наш иностранный SOCKS5-прокси (контейнер `socks-tunnel`)

**Проблема.** Прод-VPS в России; РКН блокирует многие торрент-трекеры через TLS SNI reset. Prowlarr не
может достучаться до заблокированных трекеров напрямую. SNI-блок работает на уровне TLS (сбой согласования),
поэтому смена IP не помогает — нужно увести сам TLS-handshake за границу.

**Решение.** SOCKS5-туннель на зарубежный VPS (Нидерланды, IP по умолчанию `72.56.22.214`) — только для
поиска по трекерам.

> ⚠️ **Вся инфраструктура ниже (Prowlarr, `socks-tunnel`, `infra/...`) живёт в ДРУГОМ репозитории —
> бэкенд/деплой `chazhland` (`/Users/.../IdeaProjects/chazhland`), а НЕ в этом desktop-репо.** В
> `chazhland-desktop` папки `infra/` нет. Пути вида `infra/socks-tunnel/…`, `infra/tunnel/id_tunnel`
> относятся к репозиторию бэкенда.

**Docker Compose сервис `socks-tunnel`** (в репозитории бэкенда `chazhland/infra/`)**:**

| Параметр | Значение |
| --- | --- |
| Образ | Собирается из `./infra/socks-tunnel/Dockerfile` |
| Команда | SSH с SOCKS5-прокси: `ssh -D 0.0.0.0:1080` |
| Порт | `1080` (SOCKS5) только внутри сети compose — через `expose`, не `ports` |
| Volumes | `./tunnel/` (ro) — SSH-ключ + known_hosts |
| Окружение | `TUNNEL_REMOTE=root@<ip>` (настраивается через `.env`) |
| Память | лимит 64 МБ |
| Restart | `unless-stopped` |

**SSH-ключ (forwarding-only):**

- Приватный ключ: `./infra/tunnel/id_tunnel` (в gitignore, только на VPS).
- Права: `600` (выставляет entrypoint).
- На удалённом хосте ключ ограничен **только проброс портов** — выполнение команд запрещено.
- `known_hosts`: `./infra/tunnel/known_hosts` (предварительно проверен, в gitignore).

**Entrypoint** (`./infra/socks-tunnel/entrypoint.sh`):

```bash
ssh -NT \
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -o ExitOnForwardFailure=yes \
  -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/tunnel/known_hosts \
  -o IdentitiesOnly=yes \
  -i /root/.ssh/id_tunnel \
  -D 0.0.0.0:1080 \
  "${TUNNEL_REMOTE}"
```

- `ServerAliveInterval=30` — пинг каждые 30 с; выход после 3 неудачных пингов (docker перезапустит).
- `ExitOnForwardFailure=yes` — выход, если туннель умер → docker перезапускает.
- `StrictHostKeyChecking=yes` — проверка хост-ключа по `known_hosts`.
- `-D 0.0.0.0:1080` — SOCKS5-сервер на всех интерфейсах (но достижим только внутри docker-сети).

> **Gotcha (восстановление):** связка `ExitOnForwardFailure=yes` + restart-политика docker обеспечивает
> авто-восстановление при обрыве туннеля.
> **Gotcha (частичные результаты):** если туннель лежит, Prowlarr может таймаутить на заблокированных
> индексерах, но продолжит с незаблокированными — поиск вернёт частичный результат. Приложение это не
> различает.
> **Gotcha (что обходит, а что нет):** SOCKS5 уводит все handshake на NL-VPS, обходя SNI-фильтрацию; от
> блокировок по IP не защищает.

### 6.5 Настройка Prowlarr-UI по SSH-туннелю

Prowlarr-UI **не выставлен наружу** (loopback `127.0.0.1:9696`). Настраивать индексеры, аутентификацию и
SOCKS-прокси можно **только** через SSH-туннель с админ-машины:

```bash
ssh -L 9696:localhost:9696 root@<prod-vps-ip>
```

Затем открыть в браузере `http://localhost:9696/`.

В UID Prowlarr настраивается Indexer Proxy типа SOCKS5 с адресом `socks-tunnel:1080`. Прокси
**тегируется выборочно** — только на заблокированных РКН трекерах; незаблокированные ходят напрямую.

> **Gotcha (доступ):** веб-доступа к Prowlarr из интернета нет. Конфигурируйте индексеры/прокси только по
> SSH-туннелю.

### 6.6 Фолбэк: rutracker-капча → ручной magnet

Часть трекеров (например, rutracker) отдаёт капчу, из-за чего автоматический поиск через Prowlarr может
не сработать. В этом случае рабочий фолбэк — **вставить magnet вручную**: найти раздачу на трекере в
браузере, скопировать magnet-ссылку и вставить её в поле ввода `WatchView` (см. раздел 7).

> Специальной серверной обработки капчи rutracker нет (и не планируется как обязательная) — ручная вставка
> magnet остаётся штатным и всегда рабочим обходным путём.

---

## 7. Как пользоваться (для пользователя)

Компонент [`WatchView.tsx`](../src/features/main/WatchView.tsx) предоставляет поле ввода. Поддерживаются:

| Ввод | Тип источника | Плеер |
| --- | --- | --- |
| `https://...` (mp4, HLS, публичный файл MinIO) | `DIRECT` | `<video>` |
| `magnet:?...` | `TORRENT` | `<video>` (mp4/webm) или окно mpv (MKV/HEVC) |
| info hash: 40 hex или 32 base32 | `TORRENT` | как выше |
| URL страницы (YouTube/VK/Rutube) | `LINK` | **пока не поддержано** |

Сценарии:

1. **Прямая ссылка.** Вставьте `https://`-URL на mp4/HLS — играет сразу в `<video>`.
2. **Magnet.** Вставьте `magnet:?...` или хеш — запускается WebTorrent на клиенте; виден процент загрузки и
   число пиров; mp4/webm играет в `<video>`, MKV/HEVC — в окне mpv (нужен установленный mpv, см. 4.1).
3. **Поиск по названию.** Введите название (2–200 символов) → бэкенд через Prowlarr вернёт список раздач
   (title, размер, сиды/личи, индексер) → выберите нужную → клиент подставит её magnet как источник.
4. **Фолбэк при капче трекера.** Если поиск не находит раздачу (капча на трекере), найдите magnet вручную
   в браузере и вставьте его (сценарий 2).

Любой участник с правом `CONNECT` на watch-канале может управлять воспроизведением (play/pause/seek) — оно
синхронизируется всем через STOMP (раздел 5).

---

## 8. Чек-лист для разработчика

- [ ] mpv установлен локально (`brew install mpv` / `winget install mpv`) — иначе MKV/HEVC-торренты не играются.
- [ ] Для живого бэкенда выставлен `VITE_MOCK=false` (иначе `api.*` отдаёт моки, WS — no-op). См. [docs/BACKEND-CONTRACT.md](./BACKEND-CONTRACT.md).
- [ ] Для поиска на бэкенде заданы `PROWLARR_ENABLED=true` и `PROWLARR_API_KEY` (иначе `/watch/search` → `503`).
- [ ] `webtorrent` присутствует в `node_modules` после сборки (`npx asar list`) — иначе `MODULE_NOT_FOUND`.
- [ ] Один packaged Windows smoke-run после изменений в торрент/mpv-слое (нативщину нельзя проверить с macOS). См. [docs/BUILD.md](./BUILD.md).
- [ ] Помнить инвариант: **VPS торренты не качает**; через SOCKS5-туннель идёт только поисковый трафик.
