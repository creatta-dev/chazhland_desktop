import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ChazhBridge, MainToRendererEvents, MpvLoadParams, NotifyPayload, TorrentStartParams, Unsubscribe,
} from './ipc-contract'

/**
 * Одна подписка на событие main→renderer: вешает слушатель и возвращает отписку.
 * Канал и тип payload связаны картой MainToRendererEvents — тот же тип, которым main шлёт события.
 */
function subscribe<K extends keyof MainToRendererEvents>(
  channel: K,
  cb: (payload: MainToRendererEvents[K]) => void,
): Unsubscribe {
  const h = (_e: IpcRendererEvent, payload: MainToRendererEvents[K]) => cb(payload)
  ipcRenderer.on(channel, h)
  return () => { ipcRenderer.removeListener(channel, h) }
}

// Минимальный безопасный мост: только то, что нужно UI (TZ р.6 — IPC через contextBridge).
// `satisfies ChazhBridge` — расхождение моста и типов рендерера ловится компиляцией, а не в проде.
const bridge = {
  platform: process.platform,
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
  // уведомления
  notify: (p: NotifyPayload): Promise<void> => ipcRenderer.invoke('notify:show', p),
  onNotificationClick: (cb: (d: { channelId: string }) => void) => subscribe('notif:clicked', cb),
  setBadge: (count: number) => ipcRenderer.send('app:badge', count),
  // авто-обновление: версия приложения + событие «обновление загружено» (+ буфер, если пришло до готовности UI) + запуск установки
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPendingUpdate: () => ipcRenderer.invoke('update:getPending'),
  onUpdateDownloaded: (cb: (d: { version: string; releaseNotes?: string }) => void) => subscribe('update:downloaded', cb),
  restartToUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  // авто-idle: main опрашивает простой системы и шлёт idle:true/false
  onIdleChange: (cb: (d: { idle: boolean }) => void) => subscribe('idle:changed', cb),
  // глобальный тумблер микрофона
  setMicHotkey: (accel: string | null): Promise<string | null> => ipcRenderer.invoke('voice:setMicHotkey', accel),
  onToggleMic: (cb: () => void) => subscribe('voice:toggle-mic', cb),
  // трансляция системного звука при демонстрации экрана (loopback берётся в main)
  setShareAudio: (on: boolean): Promise<void> => ipcRenderer.invoke('screen:setAudio', on),
  // пикер демонстрации: список экранов/окон + выбор источника для следующего getDisplayMedia
  getScreenSources: () => ipcRenderer.invoke('screen:getSources'),
  pickScreenSource: (id: string | null): Promise<void> => ipcRenderer.invoke('screen:pickSource', id),
  // совместный просмотр торрентов: движок в main, отдаёт локальный stream-URL для <video>
  torrentStart: (p: TorrentStartParams) => ipcRenderer.invoke('torrent:start', p),
  torrentStop: (token?: string) => ipcRenderer.invoke('torrent:stop', token),
  torrentSelftest: () => ipcRenderer.invoke('torrent:selftest'),
  onTorrentProgress: (cb: (p: MainToRendererEvents['torrent:progress']) => void) => subscribe('torrent:progress', cb),
  // плеер mpv (для MKV/HEVC, что не тянет <video>): играет HTTP-поток торрента отдельным окном
  mpvLoad: (p: MpvLoadParams) => ipcRenderer.invoke('mpv:load', p),
  mpvLoadLink: (p: MpvLoadParams) => ipcRenderer.invoke('mpv:loadLink', p),
  mpvPause: (paused: boolean) => ipcRenderer.invoke('mpv:pause', paused),
  mpvSeek: (sec: number) => ipcRenderer.invoke('mpv:seek', sec),
  mpvSetAudio: (id: number | false) => ipcRenderer.invoke('mpv:setAudio', id),
  mpvSetSub: (id: number | false) => ipcRenderer.invoke('mpv:setSub', id),
  mpvSetSpeed: (v: number) => ipcRenderer.invoke('mpv:setSpeed', v),
  mpvStop: () => ipcRenderer.invoke('mpv:stop'),
  onMpvEvent: (cb: (e: MainToRendererEvents['mpv:event']) => void) => subscribe('mpv:event', cb),
} satisfies ChazhBridge

contextBridge.exposeInMainWorld('chazh', bridge)

// выгрузка/перезагрузка рендерера — снимаем глобальный хоткей, чтобы он не остался в ОС
window.addEventListener('beforeunload', () => { ipcRenderer.invoke('voice:setMicHotkey', null).catch(() => {}) })
