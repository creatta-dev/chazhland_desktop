// ЕДИНЫЙ контракт IPC: main-процесс ↔ preload-мост ↔ рендерер.
// Раньше он был описан ТРИЖДЫ (electron/preload.ts, src/global.d.ts, модули main) и расходился молча.
// Теперь тип один: модули main шлют события через sendToRenderer() с типизированным каналом, preload
// проверяется через `satisfies ChazhBridge`, а src/global.d.ts просто ре-экспортирует эти типы в global.
// Любое расхождение ловит КОМПИЛЯТОР, а не пользователь.
//
// Файл специально «тонкий»: из рантайма здесь только sendToRenderer, всё остальное — типы (импорт
// 'electron' — type-only, поэтому d.ts рендерера может импортировать этот модуль без побочных эффектов).
import type { BrowserWindow } from 'electron'

// ───────────────────────── доменные типы ─────────────────────────

/** Источник демонстрации экрана (из desktopCapturer): экран или окно. */
export interface ScreenSource {
  id: string
  name: string
  type: 'screen' | 'window'
  thumbnail: string | null // dataURL-превью
  appIcon: string | null   // dataURL иконки приложения (для окон)
}

export interface TorrentStartResult {
  ok: boolean
  token?: string
  streamUrl?: string
  name?: string
  length?: number
  webPlayable?: boolean // true → играет <video>; false → нужен mpv (экзотический кодек)
  error?: string
}

export interface TorrentProgress {
  token: string
  progress: number
  downloaded: number
  length: number
  downloadSpeed: number
  numPeers: number
  ready: boolean
}

/** Диагностика торрент-движка для проверки упакованной Windows-сборки. */
export interface TorrentSelftestResult {
  ok: boolean
  nodeVersion?: string
  webtorrent?: boolean
  ready?: boolean
  error?: string
}

/** Дорожка mpv (аудио/субтитры). */
export interface MpvTrack { id: number; title?: string; lang?: string; codec?: string }

/** События плеера mpv (из main по 'mpv:event'). */
export type MpvEvent =
  | { type: 'ready' }
  | { type: 'loaded' }
  | { type: 'time-pos'; value: number }
  | { type: 'pause'; value: boolean }
  | { type: 'buffering'; value: boolean } // paused-for-cache: mpv добуферивает
  | { type: 'tracks'; audio: MpvTrack[]; sub: MpvTrack[]; aid: number | false; sid: number | false }
  | { type: 'track-change'; kind: 'audio' | 'sub'; id: number | false }
  | { type: 'end'; reason?: string }
  | { type: 'exit' }
  | { type: 'spawn-error'; error: string }

/** Обновление, скачанное автоапдейтером (releaseNotes — HTML тела GitHub-релиза). */
export interface UpdateInfo { version: string; releaseNotes?: string }

export interface NotifyPayload { title: string; body: string; channelId?: string }
export interface TorrentStartParams { magnet?: string; infoHash?: string }
export interface MpvLoadParams { url: string; paused?: boolean; start?: number }

export interface OkResult { ok: boolean }
export interface OkOrError { ok: boolean; error?: string }

/** Отписка, которую возвращает любой on*-метод моста. */
export type Unsubscribe = () => void

// ───────────────────── события main → renderer ─────────────────────

/** Канал → payload. Одна карта и для sendToRenderer (main), и для subscribe (preload). */
export interface MainToRendererEvents {
  'notif:clicked': { channelId: string }
  'idle:changed': { idle: boolean }
  'voice:toggle-mic': void
  'torrent:progress': TorrentProgress
  'mpv:event': MpvEvent
  'update:downloaded': UpdateInfo
}

/**
 * Единственный способ послать событие в рендерер: проверяет, что окно вообще живо.
 * Раньше это писалось четырьмя способами, половина без isDestroyed() → «Object has been destroyed»
 * при отправке в уже закрытое окно.
 */
export function sendToRenderer<K extends keyof MainToRendererEvents>(
  win: BrowserWindow | null | undefined,
  channel: K,
  ...args: MainToRendererEvents[K] extends void ? [] : [payload: MainToRendererEvents[K]]
): void {
  if (!win || win.isDestroyed()) return
  try { win.webContents.send(channel, ...args) } catch { /* окно умерло между проверкой и отправкой */ }
}

// ───────────────────────── мост в рендерере ─────────────────────────

/** window.chazh — то, что preload выставляет через contextBridge (см. electron/preload.ts). */
export interface ChazhBridge {
  platform: NodeJS.Platform
  minimize: () => void
  maximize: () => void
  close: () => void
  isMaximized: () => Promise<boolean>
  notify: (p: NotifyPayload) => Promise<void>
  onNotificationClick: (cb: (d: { channelId: string }) => void) => Unsubscribe
  setBadge: (count: number) => void
  /** Версия приложения (из package.json, только в упакованной сборке). */
  getVersion: () => Promise<string>
  /** Буфер «обновление загружено» — если событие пришло до монтирования UI. */
  getPendingUpdate: () => Promise<UpdateInfo | null>
  /** Подписка на «обновление загружено»; возвращает отписку. */
  onUpdateDownloaded: (cb: (d: UpdateInfo) => void) => Unsubscribe
  /** Перезапустить и установить скачанное обновление. */
  restartToUpdate: () => Promise<void>
  /** Авто-idle: подписка на смену простоя системы (main опрашивает powerMonitor); возвращает отписку. */
  onIdleChange: (cb: (d: { idle: boolean }) => void) => Unsubscribe
  setMicHotkey: (accel: string | null) => Promise<string | null>
  onToggleMic: (cb: () => void) => Unsubscribe
  /** Захватывать ли системный звук при демонстрации экрана (loopback; реально только Windows). */
  setShareAudio: (on: boolean) => Promise<void>
  /** Список экранов/окон с превью для пикера демонстрации. */
  getScreenSources: () => Promise<ScreenSource[]>
  /** Выбрать источник демонстрации для следующего getDisplayMedia (одноразово). */
  pickScreenSource: (id: string | null) => Promise<void>
  /** Запустить торрент в main, получить локальный stream-URL для плеера. */
  torrentStart: (p: TorrentStartParams) => Promise<TorrentStartResult>
  /** Остановить торрент (по токену из torrentStart) и очистить кэш. */
  torrentStop: (token?: string) => Promise<OkResult>
  /** Диагностика для проверки упакованной Windows-сборки. */
  torrentSelftest: () => Promise<TorrentSelftestResult>
  /** Подписка на прогресс загрузки торрента; возвращает функцию отписки. */
  onTorrentProgress: (cb: (p: TorrentProgress) => void) => Unsubscribe
  /** Плеер mpv (MKV/HEVC и пр.): загрузить URL-поток (доверенный, напр. loopback-поток торрента). */
  mpvLoad: (p: MpvLoadParams) => Promise<OkOrError>
  /** LINK-источник (YouTube/VK/…): mpv+yt-dlp с SSRF-проверкой page-URL в main. */
  mpvLoadLink: (p: MpvLoadParams) => Promise<OkOrError>
  mpvPause: (paused: boolean) => Promise<OkResult>
  mpvSeek: (sec: number) => Promise<OkResult>
  /** Выбрать аудиодорожку (id из tracks) или false=отключить. */
  mpvSetAudio: (id: number | false) => Promise<OkResult>
  /** Выбрать субтитры (id из tracks) или false=выключить. */
  mpvSetSub: (id: number | false) => Promise<OkResult>
  /** Скорость воспроизведения (для плавного авто-доката при отставании). */
  mpvSetSpeed: (v: number) => Promise<OkResult>
  mpvStop: () => Promise<OkResult>
  /** Подписка на события mpv (time-pos/pause/loaded/end/exit); возвращает отписку. */
  onMpvEvent: (cb: (e: MpvEvent) => void) => Unsubscribe
}
