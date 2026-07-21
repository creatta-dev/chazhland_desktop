# Increment 4 — libmpv player + WebTorrent streaming — Final Build Plan

> ⚠️ **Исторический документ (снимок плана на 2026-06-17), не описание текущего состояния.**
> Часть решений с тех пор изменилась (например, `files` в `package.json` уже включает `node_modules`,
> а mpv-окно пока не встроено через `--wid`). Как оно устроено сейчас — [WATCH-TOGETHER.md](WATCH-TOGETHER.md)
> и [BUILD.md](BUILD.md).

> Produced by a 10-agent research + design + adversarial-review workflow (2026-06-17).
> Backend + STOMP watch-sync already exist and are reused, not redesigned. All work is in
> `electron/` + `WatchView.tsx`. WebTorrent runs ONLY in the desktop app, never on the VPS.

## 1. TL;DR

Add real torrent + arbitrary-codec playback by running **`webtorrent` in the Electron main
process** (TCP/uTP/DHT, one client, localhost HTTP stream server) and playing media through a
**bundled `mpv.exe` child process embedded via `--wid`**, controlled over JSON IPC. Zero native
compilation (utp-native ships a win32-x64 prebuild; mpv is a vendored binary via `extraResources`).

**Inverted fallback (key decision):** HTML5 `<video>` is the **primary** path for browser-playable
codecs — both DIRECT mp4 **and** the webtorrent localhost MP4 stream (h264/aac). Embedded mpv is an
**additive** enhancement for LINK (yt-dlp) and exotic codecs (HEVC/AV1/MKV). A failed mpv-embed spike
degrades to "reduced codec coverage," not "feature dead," and takes the unprovable-from-macOS `--wid`
work off the critical ship path.

## 2. Player approach + shipping mpv on Windows

- **Chosen:** bundled `mpv.exe` child process, video embedded via `--wid`, controlled over JSON IPC
  (Windows named pipe `\\.\pipe\chazh-mpv-<uuid>`). Rejected: mpv.js (PPAPI gone from Electron 33),
  WebChimera.js (archived). Deferred (weeks-scale, out of scope): libmpv render-API addon for mac/Linux.
- Vendor pinned `shinchiro`/`zhongfly` build: `mpv.exe` + `yt-dlp.exe` under
  `resources/mpv/win32-x64/`. `electron-builder extraResources: [{from:"resources/mpv/win32-x64",to:"mpv"}]`.
  Binaries must NOT live in `app.asar`. Resolve: prod `path.join(process.resourcesPath,'mpv','mpv.exe')`,
  dev `path.join(APP_ROOT,'resources','mpv','win32-x64','mpv.exe')`; `fs.existsSync` guard before spawn.
- Child-process mpv (no linking) keeps the GPL story clean.

## 3. Confirmed must-fix issues (folded from all four reviews)

### Packaging / bundling (factual corrections)
- **`node-datachannel` is NOT a webtorrent@3 dep — delete all of it.** Only native dep is optional `utp-native`.
- **No cross-build/CI runner needed:** `utp-native` uses `node-gyp-build` (prebuildify) and ships
  `prebuilds/win32-x64/node.napi.node` (N-API) in its tarball; plain `npm install` on Mac is enough.
  `asarUnpack: ['**/*.node','node_modules/utp-native/**']`. Drop `bufferutil`/`utf-8-validate` unless `npm ls` shows a consumer.
- **webtorrent is ESM-only** — load via dynamic `await import('webtorrent')` in `electron/torrent.ts`; keep `external` in vite main build; import once at init to surface load errors.
- **`files` omits `node_modules`** → webtorrent can be silently excluded → `MODULE_NOT_FOUND` in the .exe. After first build verify with `npx asar list`. Pin **x64** (`electron-builder --win --x64`); kill stray `win-arm64`.
- **Windows runtime is unfalsifiable from Mac.** One packaged-Windows smoke run per native sub-increment (4a/4b/4d). Ship `torrent:selftest` IPC (logs resourcesPath, utp-native prebuild path, UTP/WEBRTC support) → one tester pastes a screenshot.
- **Electron 33 ships Node 20.18; webtorrent@3 declares `engines.node>=22`.** Passes tsc/Vite on Mac but may throw in main. Smoke-test `await import('webtorrent')` + a real magnet on the actual Electron 33 runtime before committing to v3; fallback webtorrent 2.6.x (`node>=16`). Wrap in try/catch (consider `utilityProcess`) so a crash = "torrents unavailable", not dead app.

### mpv embed / layout
- mpv surface tracks the placeholder `<div>`'s live rect via `ResizeObserver`+`IntersectionObserver` (NOT `win.getBounds()`), re-reported on `membersExpanded`/`panel`/`screenFull`/`screenTrack`/DPR changes. Frameless window → renderer-measured rect is authoritative.
- Native HWND ignores React unmount → explicit "hide mpv surface" IPC on WatchView unmount/visibility-loss and `screenFull=true` (else it paints over fullscreen screen-share). Test: WATCH → peer Go Live → toggle `screenFull` → mpv hides.
- DPI: convert CSS px → device px (`screen.getDisplayMatching().scaleFactor` × `webContents.zoomFactor`); subscribe `display-metrics-changed`. Test 125%/150% + dual-monitor.
- Spawn-from-asar ENOENT only appears packaged → resolve via `process.resourcesPath` + `fs.existsSync`. mpv `--no-config`/`--load-scripts=no`; restrict named-pipe DACL.
- **4b is a hard ~1-day go/no-go spike on real Windows.** Sibling overlay window (for badge/buffering UI) is a required deliverable. If not solid → ship HTML5 for DIRECT+torrent, defer mpv-only codecs.

### Sync correctness
- **Replace fixed 400ms wall-clock echo window with `request_id`/content-based self-write tracking** (mpv seek echo can be seconds late → self-amplifying SEEK storm across clients). Tag outbound writes with JSON-IPC `request_id`+target; treat observed change as user-initiated only when no outstanding self-write explains it (~0.5s seek tolerance, exact for pause).
- SEEK dedup guard re-derived against **last commanded target** (synchronous), never the laggy `time-pos`.
- **"loading" suppression keyed on loadfile `request_id`**, armed before loadfile, disarmed on `file-loaded`/`end-file` (NOT a timer) — loadfile fires a burst of pause→play→seek. Recompute `start=` from `effectivePos(s)` immediately before loadfile (after awaits).
- `paused-for-cache` ≠ user PAUSE; publish PAUSE/PLAY only on a `pause` transition with `paused-for-cache==false` + consistent `core-idle`; never derive from `core-idle` alone. Hard-gate SEEK/PAUSE on `time-pos!=null && file-loaded`.
- Ship local **behind/desynced detection + honest badge** (target−pos>~5s AND target>seekable end → "отстаём, докачиваем…"); cap `speed 1.05` boost; single catch-up seek when buffered. (Host soft-hold readiness gate is deferred/over-engineered for 10 users.)
- Allow the FIRST post-load reconciliation to hard-seek into unbuffered range (fresh load ≠ mid-playback drift).
- Keep DIRECT on the proven `<video>` path through 4c; flip to mpv only after the 2-client test passes.
- 4c Mac mock must be **adversarial**: randomized-delay echoes (incl. > window), bursty loadfile events, `paused-for-cache` transitions, null `time-pos` before `file-loaded`.
- Abandon superseded TORRENT swarms by token: `startTorrent`→token, `stopTorrent(token)`, serialize start in main (replace-and-await-teardown).

### Security / lifecycle
- **Stream-server token is a real auth gate:** `X-Watch-Token: crypto.randomBytes(32) hex`, `crypto.timingSafeEqual`, bare 404 on mismatch; if `<video>` can't set headers, use a high-entropy unguessable path segment validated with `timingSafeEqual` (loopback-only); verify `server.address()` is 127.0.0.1.
- **Treat every inbound `WatchSource.url` as hostile (resolution moved client-side).** In MAIN before mpv/yt-dlp: scheme exactly `https` (reject file:/data:/blob:/http:); resolve host, reject RFC1918/loopback/link-local/.local/metadata; re-validate magnet shape + infohash (40 hex/32 base32).
- **Sanitize magnets in MAIN:** rebuild minimal magnet from only `xt=urn:btih:<hash>`; drop `ws=`/`as=`/`xs=`/`tr=`. Same sanitizer for backend-synthesized and user-pasted.
- **yt-dlp:** `--no-exec --no-playlist` https-only; SSRF-check the resolved media URL; invoke the VENDORED `yt-dlp.exe` (verify by hash at build).
- **Cache manager (LRU is name-only today):** on start, sum `wt-cache` sizes, delete LRU dirs until <~10GB; refuse when `statfs` free below floor; `torrent.destroy({destroyStore:true})` on stop/leave; startup orphan sweep; ONE concurrent torrent; put `wt-cache` OUTSIDE userData (e.g. `app.getPath('temp')`).
- Validate torrent metadata before selecting (path-traversal on write): pin a webtorrent that sanitizes `..`/absolute paths; reject length>~60GB or >5000 files; `deselect` all then select only chosen file; metadata-timeout→destroy+"unsupported".
- **Register torrent/mpv IPC ONCE at `app.whenReady()`/module scope, NOT in `createWindow()`** (re-runs on macOS activate → "second handler" + stacked listeners → duplicate events → echo storm). `removeHandler` on teardown; renderer subscriptions return unsubscribe; WatchView cleanup calls it on channel switch.
- Kill mpv on unhappy paths: `render-process-gone`+`child-process-gone` → destroy mpv+torrent; Windows Job Object / `taskkill /T`; kill in `will-quit`; close cache handles before LRU delete (Windows file locks).
- Clamp `effectivePos` to `[0,duration]`; bound wall-clock extrapolation (ignore >few-min deltas as clock skew).

### Dropped as over-engineered for ~10 trusted users
Host soft-hold readiness gate; mandatory windows-CI runner (recommended, not required); mac/Linux mpv render addon; yt-dlp domain allowlist + download throttle; arm64 Windows; the dead NSIS/.ico block.

## 4. Phased sub-increments

**4a — webtorrent in main + IPC + localhost stream + HTML5 playback** `[Mac-buildable]` + `[Windows-test to mark done]`
WebTorrent client in main (dynamic import); `torrent:start(token)/stop(token)/progress` IPC; tokenized
`X-Watch-Token` 127.0.0.1 stream server (timingSafeEqual, bare-404); cache manager (LRU, destroyStore,
single torrent, startup sweep, statfs floor); MAIN-side inbound URL/magnet SSRF + sanitize; metadata
validation; idempotent module-scope IPC; `torrent:selftest`. **Play the localhost MP4 stream through
HTML5 `<video>`** → complete shippable DIRECT+TORRENT(h264/aac) slice, NO mpv.
- Mac verifies: magnet streams bytes, curl Range, token 404, SSRF rejects file:/RFC1918, LRU evicts, no swarm leak on rapid source change.
- Windows gate (≥1 client): packaged zip runs, utp-native loads, `await import('webtorrent')` ok, magnet→localhost URL, `<video>` plays it.

**4b — mpv embed + ship (go/no-go spike)** `[Windows-test]` (unfalsifiable from Mac); Mac only for IPC-client logic + typecheck
mpv JSON-IPC client (`--no-config`, hardened DACL); `--wid` embed; sibling overlay window (required);
bounds+visibility via placeholder observers + CSS→device-px; `extraResources`+`asarUnpack`; `fs.existsSync`+arch guard; Job-Object kill + process-gone teardown.
- Windows go/no-go matrix: z-order; reposition on resize/maximize/membersExpanded/panel/screenFull; 125%/150%; dual-monitor; long-uptime; **screen-share coexistence**. Not solid in ~a day → ship HTML5-for-DIRECT+torrent, defer mpv codecs.

**4c — WatchView wire + sync** `[Mac-buildable]` typecheck + adversarial mock; then `[Windows-test]` `[>=2 clients]`
Async `apply()` + generation guard with per-torrent token teardown; request_id/content echo suppression;
loadfile-burst suppression gated on file-loaded; re-derived dedup vs commanded target; paused-for-cache/core-idle
truth table; buffer-aware drift + local "behind" badge; per-kind resolveInput (DIRECT→`<video>`, LINK→yt-dlp,
TORRENT→token IPC); effectivePos clamp; `loadUrl()` magnet detection.
- Mac (adversarial mock): no spurious SEEK/PAUSE under late echoes / bursts / null time-pos / cache transitions.
- Windows (≥2 clients): no SEEK ping-pong; one peer's cache stall doesn't pause room; behind-peer honest badge + catches up.

**4d — codec/buffer UX + DIRECT→mpv flip** `[Windows-test]` `[>=2 clients]`
`hwdec=d3d11va`+sw fallback; `vo=gpu-next`; buffering spinner from `cache-buffering-state`; LINK-loading vs
TORRENT-buffering states; `unsupported` UI on `end-file` error; flip DIRECT→mpv only after 4c 2-client test.
- Windows: HEVC/AV1/MKV play; voice+screen-share+4K torrent concurrent on a real 8GB box.

## 5. Honest blockers
- Windows packaging dependency is real (3 package-time-and-Windows-only failures: asar.unpacked resolves utp-native `.node`; ESM `await import('webtorrent')` inside asar-packed ESM main; loopback stream bind). One packaged-Windows smoke per native sub-increment is mandatory (one tester → selftest screenshot). Windows CI recommended, not required.
- `--wid` embed fragility is the single load-bearing risk, unfalsifiable from macOS → inverted fallback de-risks it; treat 4b as hard 1-day go/no-go.
- webtorrent@3 vs Electron 33 Node 20.18 → smoke-test on real runtime; fallback 2.6.x.
- 2-client sync correctness unprovable on Mac beyond the adversarial mock.

Files (all under `chazhland-desktop/`): `electron/torrent.ts` (new), `electron/mpv.ts` (new), `electron/mpv-ipc.ts` (new), `resources/mpv/win32-x64/{mpv.exe,yt-dlp.exe}` (vendored), `src/features/main/TorrentPlayer.tsx` (new), `electron/main.ts`, `electron/preload.ts`, `src/global.d.ts`, `src/features/main/WatchView.tsx`, `src/features/main/MainWindow.tsx`, `src/features/main/ScreenSharePane.tsx`, `vite.config.ts`, `package.json`.
