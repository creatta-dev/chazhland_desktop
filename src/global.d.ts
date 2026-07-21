// Единственный источник правды по IPC — electron/ipc-contract.ts (там же его использует preload и main).
// Здесь мы только поднимаем эти типы в global, чтобы компоненты рендерера пользовались ими без импорта.
import type * as Ipc from '../electron/ipc-contract'

export {}

declare global {
  /** Источник демонстрации экрана (из desktopCapturer): экран или окно. */
  type ScreenSource = Ipc.ScreenSource
  type TorrentStartResult = Ipc.TorrentStartResult
  type TorrentProgress = Ipc.TorrentProgress
  /** Дорожка mpv (аудио/субтитры). */
  type MpvTrack = Ipc.MpvTrack
  /** События плеера mpv (из main по 'mpv:event'). */
  type MpvEvent = Ipc.MpvEvent
  /** Мост из preload (electron/preload.ts). */
  type ChazhBridge = Ipc.ChazhBridge

  interface Window {
    /** Мост из preload (electron/preload.ts). Отсутствует при запуске в обычном браузере. */
    chazh?: ChazhBridge
  }
}
