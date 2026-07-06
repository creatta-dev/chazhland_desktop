export {}

declare global {
  /** Источник демонстрации экрана (из desktopCapturer): экран или окно. */
  interface ScreenSource {
    id: string
    name: string
    type: 'screen' | 'window'
    thumbnail: string | null // dataURL-превью
    appIcon: string | null   // dataURL иконки приложения (для окон)
  }
  interface TorrentStartResult {
    ok: boolean
    token?: string
    streamUrl?: string
    name?: string
    length?: number
    webPlayable?: boolean // true → играет <video>; false → нужен mpv (экзотический кодек)
    error?: string
  }
  interface TorrentProgress {
    token: string
    progress: number
    downloaded: number
    length: number
    downloadSpeed: number
    numPeers: number
    ready: boolean
  }
  // дорожка mpv (аудио/субтитры)
  interface MpvTrack { id: number; title?: string; lang?: string; codec?: string }
  // события плеера mpv (из main по 'mpv:event')
  type MpvEvent =
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
  interface ChazhBridge {
    platform: NodeJS.Platform
    minimize: () => void
    maximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    notify: (p: { title: string; body: string; channelId?: string }) => Promise<void>
    onNotificationClick: (cb: (d: { channelId: string }) => void) => () => void
    setBadge: (count: number) => void
    /** Версия приложения (из package.json, только в упакованной сборке). */
    getVersion: () => Promise<string>
    /** Буфер «обновление загружено» — если событие пришло до монтирования UI. */
    getPendingUpdate: () => Promise<{ version: string; releaseNotes?: string } | null>
    /** Подписка на «обновление загружено» (releaseNotes — HTML тела GitHub-релиза); возвращает отписку. */
    onUpdateDownloaded: (cb: (d: { version: string; releaseNotes?: string }) => void) => () => void
    /** Перезапустить и установить скачанное обновление. */
    restartToUpdate: () => Promise<void>
    /** Авто-idle: подписка на смену простоя системы (main опрашивает powerMonitor); возвращает отписку. */
    onIdleChange: (cb: (d: { idle: boolean }) => void) => () => void
    setMicHotkey: (accel: string | null) => Promise<string | null>
    onToggleMic: (cb: () => void) => () => void
    /** Захватывать ли системный звук при демонстрации экрана (loopback; реально только Windows). */
    setShareAudio: (on: boolean) => Promise<void>
    /** Список экранов/окон с превью для пикера демонстрации. */
    getScreenSources: () => Promise<ScreenSource[]>
    /** Выбрать источник демонстрации для следующего getDisplayMedia (одноразово). */
    pickScreenSource: (id: string | null) => Promise<void>
    /** Запустить торрент в main, получить локальный stream-URL для плеера. */
    torrentStart: (p: { magnet?: string; infoHash?: string }) => Promise<TorrentStartResult>
    /** Остановить торрент (по токену из torrentStart) и очистить кэш. */
    torrentStop: (token?: string) => Promise<{ ok: boolean }>
    /** Диагностика для проверки упакованной Windows-сборки. */
    torrentSelftest: () => Promise<{ ok: boolean; nodeVersion?: string; webtorrent?: boolean; ready?: boolean; error?: string }>
    /** Подписка на прогресс загрузки торрента; возвращает функцию отписки. */
    onTorrentProgress: (cb: (p: TorrentProgress) => void) => () => void
    /** Плеер mpv (MKV/HEVC и пр.): загрузить URL-поток (доверенный, напр. loopback-поток торрента). */
    mpvLoad: (p: { url: string; paused?: boolean; start?: number }) => Promise<{ ok: boolean; error?: string }>
    /** LINK-источник (YouTube/VK/…): mpv+yt-dlp с SSRF-проверкой page-URL в main. */
    mpvLoadLink: (p: { url: string; paused?: boolean; start?: number }) => Promise<{ ok: boolean; error?: string }>
    mpvPause: (paused: boolean) => Promise<{ ok: boolean }>
    mpvSeek: (sec: number) => Promise<{ ok: boolean }>
    /** Выбрать аудиодорожку (id из tracks) или false=отключить. */
    mpvSetAudio: (id: number | false) => Promise<{ ok: boolean }>
    /** Выбрать субтитры (id из tracks) или false=выключить. */
    mpvSetSub: (id: number | false) => Promise<{ ok: boolean }>
    /** Скорость воспроизведения (для плавного авто-доката при отставании). */
    mpvSetSpeed: (v: number) => Promise<{ ok: boolean }>
    mpvStop: () => Promise<{ ok: boolean }>
    /** Подписка на события mpv (time-pos/pause/loaded/end/exit); возвращает отписку. */
    onMpvEvent: (cb: (e: MpvEvent) => void) => () => void
  }
  interface Window {
    /** Мост из preload (electron/preload.ts). Отсутствует при запуске в обычном браузере. */
    chazh?: ChazhBridge
  }
}
