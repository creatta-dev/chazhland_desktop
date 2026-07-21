# Сборка и запуск (chazhland-desktop)

Десктоп-клиент мессенджера chazhland: **Electron + React + Vite + TypeScript**.
Windows-first: релизные артефакты — NSIS-установщик `chazhland-Setup-<version>.exe` **и** ZIP (x64), рядом собирается Linux AppImage. Сборка под macOS тоже поддержана (DMG, только локально).

> **Источник истины по релизной сборке — [`.github/workflows/build-win.yml`](../.github/workflows/build-win.yml).** Локальные `npm run dist:*` запускают `electron-builder` без флагов таргетов, поэтому берут таргеты из `package.json` (Windows → только ZIP) — это НЕ то же самое, что уезжает в релиз. Различия описаны в [§5](#5-упаковка-под-windows-основной-артефакт).

См. также: [README.md](../README.md) · [docs/ARCHITECTURE.md](ARCHITECTURE.md) · [docs/WATCH-TOGETHER.md](WATCH-TOGETHER.md) · [docs/VOICE.md](VOICE.md) · [docs/BACKEND-CONTRACT.md](BACKEND-CONTRACT.md)

---

## 1. Стек и версии

| Компонент | Версия | Заметка |
|---|---|---|
| React | 19.0.0 | |
| TypeScript | 5.7.2 | |
| Vite | 6.0.3 | |
| Electron | 33.2.0 | поставляется с **Node 20.18 LTS** |
| vite-plugin-electron | 0.29.0 | сборка main/preload + авто-ребилд в dev |
| vite-plugin-electron-renderer | 0.14.6 | |
| electron-builder | 25.1.8 | упаковка дистрибутивов |
| webtorrent | 3.0.16 | prod-зависимость, **ESM-only** |

Прочие ключевые настройки:

- `appId`: `ru.chazhland.desktop`
- `package.json` → `"type": "module"` (весь проект — ESM)
- `main`: `dist-electron/main.js`
- TypeScript: `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `jsx: react-jsx`
- Алиас путей: `@/*` → `src/*`

---

## 2. Требования к окружению

### 2.1 Node.js — 20 LTS или 22 (в CI — 22), НЕ 26+

> **Релизная сборка идёт на Node 22** (`actions/setup-node@v4` с `node-version: '22'` в [`build-win.yml`](../.github/workflows/build-win.yml)). Локально подойдёт и Node 20 LTS, и Node 22 — но эталон, на котором зелёный CI, это 22.

- **Node внутри Electron — это другое число.** Electron 33 несёт встроенный Node **20.18**, и именно он выполняет main/preload в рантайме, какой бы Node ни собирал проект.
- На dev-машинах с **Node 26+ возникают проблемы** с Electron 33 — это уже ловили на практике. Ставьте 20 LTS или 22 (через `nvm`, `fnm`, `volta` или установщик с nodejs.org).
- Зависимость `webtorrent@3` в своём `engines.node` декларирует `>=22`, но Electron 33 в рантайме всё равно даёт Node **20.18**. Подробности и обязательный smoke-test — см. [§7 Подводные камни](#7-подводные-камни-обязательно-к-прочтению).

Проверить версию:

```bash
node -v   # ожидаем v20.x или v22.x (в CI — v22.x)
```

### 2.2 mpv — в Windows-релиз вкладывается, локально ставится отдельно

Внешний плеер **mpv** (+ `yt-dlp` для LINK-источников) нужен для экзотических кодеков в «Смотреть вместе» (MKV / HEVC / 10-bit и т.п. — то, что не играет в `<video>`). **В git бинари не коммитятся** (см. `resources/mpv/.gitignore`), но появляются они по-разному:

- **Windows-релиз:** CI скачивает `mpv.exe` (zhongfly/mpv-winbuild) и `yt-dlp.exe` в `resources/mpv/win32-x64/`, и `package.json` → `build.win.extraResources` вкладывает их в дистрибутив (в `resources/mpv/` рядом с asar). Отдельная установка пользователю НЕ нужна. Если скачать не удалось — сборка падает на шаге `Verify vendored mpv + yt-dlp` (специально: релиз без mpv = молча мёртвое «смотреть вместе»).
- **Локальная разработка / macOS / Linux:** бинарей нет — ставьте mpv в систему. Для dev можно вручную положить бинари в `resources/mpv/<platform>-<arch>/` (см. `resources/mpv/win32-x64/README.md`).

```bash
# macOS
brew install mpv

# Linux (там AppImage бинари не бандлит — mpv берётся из PATH)
sudo apt install mpv yt-dlp

# Windows (только для запуска из исходников; в релизе mpv уже внутри)
winget install mpv
```

Как клиент ищет бинарь mpv в рантайме (`electron/mpv.ts`, порядок):

1. переменная окружения `MPV_PATH`;
2. **вендоренный бинарь**: `process.resourcesPath/mpv/mpv.exe` (упакованное приложение) → `<APP_ROOT>/resources/mpv/<platform>-<arch>/mpv` (dev);
3. `/opt/homebrew/bin/mpv` (Apple Silicon), `/usr/local/bin/mpv` (Intel macOS), `/usr/bin/mpv` (Linux);
4. `C:\Program Files\mpv\mpv.exe`, `C:\Program Files\mpv.net\mpvnet.exe` (Windows);
5. fallback — `mpv` из `PATH`.

Перед `spawn` есть проверка существования файла (`fs.existsSync`), так что без установленного mpv приложение не упадёт — просто экзотические кодеки покажут ошибку «требуется mpv». Подробнее в [docs/WATCH-TOGETHER.md](WATCH-TOGETHER.md).

> **Почему так:** GUI-приложения на macOS получают усечённый `PATH` от launchd — без `/opt/homebrew/bin` и `/usr/local/bin`. Поэтому простой `spawn('mpv')` не сработал бы, и клиент сначала перебирает захардкоженные пути. См. [§7](#7-подводные-камни-обязательно-к-прочтению).

### 2.3 Установка зависимостей

```bash
npm install
```

> **НЕ используйте `--omit=optional`.** Это ломает нативную сборку (в частности `@rollup/rollup-darwin-arm64`). Ставьте «голым» `npm install`. См. [§7](#7-подводные-камни-обязательно-к-прочтению).

---

## 3. Dev-режим

```bash
npm run dev
```

Это запускает **`vite`** — Vite dev-server для рендерера + авто-ребилд main- и preload-процессов.

### Как работает `vite-plugin-electron`

Плагин (`vite.config.ts`) описывает три цели:

- **`main`** — `entry: electron/main.ts`. В rollup помечены **external**: `webtorrent` и `node-datachannel` (не бандлятся в main, грузятся из `node_modules` в рантайме).
- **`preload`** — `input: electron/preload.ts`. Принудительно собирается как **ESM** (`rollupOptions.output.format = 'es'`), результат — `preload.mjs`. Почему именно ESM — см. [§7](#7-подводные-камни-обязательно-к-прочтению).
- **`renderer`** — обычный Vite-рендерер с алиасом `@ → src`.

В dev плагин сам поднимает Electron поверх Vite dev-server и пересобирает main/preload при изменениях. Адрес dev-сервера приходит в Electron через `VITE_DEV_SERVER_URL` (используется в навигационных гардах main-процесса).

### Mock-режим (работа без бэкенда)

Рендерер умеет работать **без живого бэкенда** через флаг `VITE_MOCK`:

| Переменная | Назначение | Дефолт |
|---|---|---|
| `VITE_MOCK` | `true` → все `api.*` отдают мок-данные из `src/mocks/data.ts`; WS — no-op | `false` (выключен) |
| `VITE_API_BASE` | базовый URL REST API | `http://localhost:8080` (prod: `https://api.chazhland.ru`) |
| `VITE_WS_URL` | STOMP-over-WebSocket эндпоинт | авто-вывод из API base (prod: `wss://api.chazhland.ru/ws`) |

- При `VITE_MOCK=true` сетевых запросов нет: `ws.connect` — no-op, presence-обновления — no-op, все `api.*` возвращают данные из `src/mocks/data.ts`. Удобно для быстрой итерации по UI без бэка.
- **Mock выключен по умолчанию и включается строго строкой `'true'`** (`src/lib/config.ts`): отсутствие переменной или опечатка = живой бэк. Проверка намеренно строгая — однажды прод-сборка молча уехала в моки.
- Заготовка `.env.example` настроена на живой прод-бэк; прод-сборка берёт значения из закоммиченного `.env.production` (Vite грузит его в production-режиме автоматически, в т.ч. в CI).

Как клиент общается с бэком (и где смотреть актуальный контракт) — в [docs/BACKEND-CONTRACT.md](BACKEND-CONTRACT.md).

---

## 4. Проверка типов

```bash
npm run typecheck   # tsc --noEmit
```

То же самое выполняется первым шагом в `npm run build` (`tsc --noEmit && vite build`), так что упаковка упадёт на ошибках типов — это by design.

---

## 5. Упаковка под Windows (основной артефакт)

```bash
npm run dist:win
```

Раскрывается в `npm run build && electron-builder --win`, то есть:

1. `tsc --noEmit` — проверка типов;
2. `vite build` — сборка рендерера (`dist/`) и main/preload (`dist-electron/`);
3. `electron-builder --win` — упаковка.

### Параметры сборки Windows (`package.json` → `build`)

- **Target:** `zip`, архитектура **x64** (только). Это таргет ЛОКАЛЬНОЙ сборки; релизный CI перекрывает его флагами (см. ниже).
- **Вывод:** каталог `release/` (`directories.output`).
- **buildResources:** `build/`.
- **`build.nsis`** — конфиг установщика (`oneClick: false`, `perMachine: false`, выбор каталога установки, `artifactName: ${productName}-Setup-${version}.${ext}`). Локальный `dist:win` его не задействует, потому что не просит таргет `nsis`; релизный CI — задействует, и `artifactName` отсюда попадает в `latest.yml`.
- **`build.publish`** — provider `github`, репозиторий `MrrMD/chazhland_desktop`. Нужен, чтобы electron-builder генерил `latest.yml`/`.blockmap` для авто-апдейтера даже при `--publish never`.

### Что на самом деле уезжает в релиз (CI)

Релиз собирает [`.github/workflows/build-win.yml`](../.github/workflows/build-win.yml) — одна матричная джоба на две платформы (Windows + Linux), **на Node 22**:

| Платформа | Команда упаковки | Ассеты релиза |
|---|---|---|
| Windows (`windows-latest`) | `electron-builder --win nsis zip --publish never` | `chazhland-Setup-<version>.exe` (имя из `build.nsis.artifactName`), ZIP-архив приложения, `latest.yml`, `*.blockmap` |
| Linux (`ubuntu-latest`) | `electron-builder --linux AppImage --publish never` | `*.AppImage`, `latest-linux.yml`, `*.blockmap` |

- **Флаги CLI перекрывают `package.json`.** `--win nsis zip` означает, что Windows-релиз содержит и NSIS-установщик, и ZIP, хотя в `package.json` объявлен только `zip`. Локальный `npm run dist:win` (без флагов таргетов) даст ТОЛЬКО ZIP — не пугайтесь расхождения.
- **Триггеры:** push в `dev` — только сборка (ничего никуда не грузится); push тега `vX.Y.Z` — ассеты заливаются прямо в GitHub Release; `workflow_dispatch` — артефакты `chazhland-win-x64` / `chazhland-linux-x64` на странице запуска.
- **Тело релиза** берётся из секции текущей версии в `CHANGELOG.md` (шаг «Extract release notes») — его читают окно «Что нового» и анонс в чат. Пустой раздел в CHANGELOG = пустое «Что нового» у пользователей.
- ⚠️ **Имена ассетов — контракт с `electron-updater`:** апдейтер качает файл по имени, записанному в `latest.yml`. Уже ловили «имя .exe не совпало с latest.yml → апдейтер 404». Меняя `artifactName`, таргеты или маски файлов в workflow, проверяйте `latest.yml` в собранном релизе.
- Перед упаковкой Windows CI проверяет, что `resources/mpv/win32-x64/{mpv.exe,yt-dlp.exe}` реально скачались (шаг `Verify vendored mpv + yt-dlp`), и падает, если нет.

### `files` — что попадает в asar

```json
"files": [
  "dist/**",
  "dist-electron/**",
  "build/tray*.png",
  "package.json",
  "node_modules/**/*"
]
```

Обратите внимание: `node_modules/**/*` включён целиком — потому что `webtorrent` и `node-datachannel` помечены как external и **должны физически лежать в `node_modules`** во время выполнения (см. ниже).

### `asar` / `asarUnpack`

```json
"asar": true,
"asarUnpack": [
  "**/*.node",
  "node_modules/node-datachannel/**"
]
```

- ASAR включён.
- `asarUnpack` распаковывает **все нативные `.node`-файлы** наружу из asar-архива и весь `node_modules/node-datachannel/**`. Без `**/*.node` нативный модуль остаётся «запертым» внутри asar и не загружается в рантайме.

### Нативные зависимости (webtorrent + node-datachannel) — сборка на Windows

- `webtorrent@3` и его нативные deps **не бандлятся** в main-бандл (`external` в `vite.config.ts`) — они грузятся из `node_modules` в рантайме. `main.ts` подключает webtorrent динамически: `await import('webtorrent')`.
- Если этих модулей **нет в `node_modules` после установки**, приложение в рантайме бросит `MODULE_NOT_FOUND`. После сборки можно проверить наличие в asar:

  ```bash
  npx asar list release/<...>/resources/app.asar | grep webtorrent
  ```

- `utp-native` поставляет prebuild под `win32-x64`; именно ради таких `.node` нужен `asarUnpack: ["**/*.node"]`.
- Ставьте зависимости **`npm install` без `--omit=optional`** — иначе нативные сборки ломаются (см. [§7](#7-подводные-камни-обязательно-к-прочтению)).

> **Windows-сборку нельзя проверить с macOS.** Упаковка под Windows непроверяема «на глаз» с Mac — на каждый инкремент, затрагивающий нативщину, обязателен **один прогон реально упакованного Windows-билда** (smoke-test). См. [§7](#7-подводные-камни-обязательно-к-прочтению).

### Бинари-ресурсы (mpv.exe, yt-dlp.exe)

В Windows-дистрибутив они **вкладываются**: CI кладёт их в `resources/mpv/win32-x64/`, `package.json` → `build.win.extraResources` копирует каталог в `resources/mpv/` рядом с asar (вне архива), а рантайм резолвит по `process.resourcesPath` (prod) или `APP_ROOT + resources/mpv/<platform>-<arch>` (dev). В git бинари не коммитятся, в Linux/macOS-сборки не вкладываются — там mpv берётся из системы (см. [§2.2](#22-mpv--в-windows-релиз-вкладывается-локально-ставится-отдельно)).

---

## 6. Упаковка под macOS

```bash
npm run dist:mac
```

- Target: **DMG**.
- `mac.identity: null` — без подписи кода (ad-hoc / без notarization).
- Иконка: `build/icon.png`.

Базовый `npm run dist` (без флага платформы) запускает `electron-builder` под текущую ОС.

---

## 7. Подводные камни (обязательно к прочтению)

### 7.1 Node 20 LTS или 22, не 26+

Electron 33 рассчитан на Node 20.18 LTS (этот Node он и несёт внутри). Собирать проект можно на Node 20 LTS или 22 — релизный CI зелёный именно на **22** (`node-version: '22'`). На dev-машинах с **Node 26+ ловили проблемы** с Electron 33. Подробности — [§2.1](#21-nodejs--20-lts-или-22-в-ci--22-не-26).

### 7.2 `--omit=optional` ломает `@rollup/rollup-darwin-arm64`

Не запускайте установку с `--omit=optional` — это выбрасывает опциональные нативные пакеты (в т.ч. `@rollup/rollup-darwin-arm64`) и ломает сборку. Ставьте **голым `npm install`**.

### 7.3 Preload должен быть ESM, иначе «require is not defined»

Из-за `"type": "module"` файл `preload.mjs` грузится как **ESM**. По умолчанию rollup пишет в него CJS-вызов `require("electron")`, что в ESM-области даёт ошибку:

```
require is not defined in ES module scope
```

→ preload не загружается. Поэтому в `vite.config.ts` для preload **форсируется ESM-вывод**:

```ts
preload: {
  input: path.join(__dirname, 'electron/preload.ts'),
  vite: { build: { rollupOptions: { output: { format: 'es' } } } },
}
```

Electron 33 при `sandbox: false` корректно грузит ESM-preload. Не убирайте этот override.

### 7.4 webtorrent@3: декларирует Node ≥22, а Electron даёт 20.18

`webtorrent@3` в `engines.node` требует `>=22`, но рантайм Electron 33 — Node **20.18**.
**Перед релизом обязателен smoke-test** `await import('webtorrent')` на реальном рантайме Electron 33 (а не на системном Node). Если несовместимо — откатываться на `webtorrent` 2.6.x.

### 7.5 webtorrent помечен external — должен лежать в node_modules

`webtorrent` (и `node-datachannel`) не бандлятся в main. Если они **отсутствуют в `node_modules` в рантайме**, приложение бросит `MODULE_NOT_FOUND`. Проверяйте наличие в собранном asar через `npx asar list` (см. [§5](#нативные-зависимости-webtorrent--node-datachannel--сборка-на-windows)).

### 7.6 Windows-упаковку не проверить с macOS

На каждый нативный инкремент — **один обязательный прогон упакованного Windows-билда** (smoke run). С Mac корректность Windows-пакета не фальсифицируема.

### 7.7 mpv: бинаря нет в репо (в Windows-релиз его кладёт CI)

В git бинари mpv/yt-dlp не коммитятся. В Windows-дистрибутив их вкладывает CI, а локально (и на macOS/Linux) mpv ставится в систему: `brew install mpv` / `sudo apt install mpv yt-dlp` / `winget install mpv`. Резолв в рантайме идёт по известным путям с проверкой `fs.existsSync` перед `spawn`. На macOS GUI-приложение получает усечённый `PATH` (без `/opt/homebrew/bin` и `/usr/local/bin`) — поэтому клиент сначала перебирает вендоренные и захардкоженные пути, и только потом `mpv` из `PATH`. Полный список путей — [§2.2](#22-mpv--в-windows-релиз-вкладывается-локально-ставится-отдельно).

### 7.8 `.node`-файлы должны быть в `asarUnpack`

`utp-native` тащит prebuild `win32-x64`. Без `asarUnpack: ["**/*.node"]` `.node`-файл остаётся внутри asar в «запертом» состоянии и не грузится.

---

## 8. CSP (Content-Security-Policy)

Рендерер работает под жёстким CSP. Точное значение:

```
default-src 'self';
img-src 'self' data: blob: https:;
media-src 'self' https: blob: http://127.0.0.1:*;
connect-src 'self' http: https: ws: wss:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com;
script-src 'self' 'wasm-unsafe-eval' blob:;
worker-src 'self' blob:
```

Что и зачем разрешено:

| Директива | Что разрешает | Зачем |
|---|---|---|
| `media-src ... http://127.0.0.1:*` | стрим с локалхоста | torrent-стрим WebTorrent отдаётся локальным HTTP-сервером на `127.0.0.1:<random-port>` |
| `script-src 'wasm-unsafe-eval'` | выполнение WASM | RNNoise (шумоподавление) — WebAssembly |
| `script-src ... blob:` / `worker-src 'self' blob:` | Web Workers из blob | воркеры (в т.ч. медиа-обработка) грузятся как blob |
| `img-src ... data: blob: https:` | inline/blob/удалённые картинки | аватары, превью вложений |
| `connect-src ... ws: wss:` | WebSocket | STOMP-over-WebSocket (чат, presence, watch-sync) |
| `style-src 'unsafe-inline' https://fonts.googleapis.com` + `font-src https://fonts.gstatic.com` | inline-стили и Google Fonts | шрифты и динамические стили темизации |

Подробнее про torrent-стрим и RNNoise — в [docs/WATCH-TOGETHER.md](WATCH-TOGETHER.md) и [docs/VOICE.md](VOICE.md).

---

## 9. Шпаргалка по командам

```bash
npm install            # установка зависимостей (БЕЗ --omit=optional)
npm run dev            # dev: Vite + Electron + авто-ребилд main/preload
npm run typecheck      # tsc --noEmit
npm run lint           # eslint . (есть lint:fix)
npm run build          # tsc --noEmit && vite build
npm run dist:win       # сборка + electron-builder --win (локально — только ZIP, x64)
npm run dist:mac       # сборка + electron-builder --mac (DMG)
npm run dist:linux     # сборка + electron-builder --linux (AppImage)
npm run dist           # сборка + electron-builder под текущую ОС
npm run icons          # node scripts/gen-icons.mjs (генерация иконок)
npm run preview        # vite preview (предпросмотр собранного рендерера)
```
