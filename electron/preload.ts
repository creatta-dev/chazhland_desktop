import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

// Минимальный безопасный мост: только то, что нужно UI (TZ р.6 — IPC через contextBridge)
contextBridge.exposeInMainWorld('chazh', {
  platform: process.platform,
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('win:isMaximized'),
  // уведомления
  notify: (p: { title: string; body: string; channelId?: string }) => ipcRenderer.invoke('notify:show', p),
  onNotificationClick: (cb: (d: { channelId: string }) => void) => {
    const h = (_e: IpcRendererEvent, d: { channelId: string }) => cb(d)
    ipcRenderer.on('notif:clicked', h)
    return () => ipcRenderer.removeListener('notif:clicked', h)
  },
  setBadge: (count: number) => ipcRenderer.send('app:badge', count),
  // авто-обновление: версия приложения + событие «обновление загружено» (+ буфер, если пришло до готовности UI) + запуск установки
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  getPendingUpdate: (): Promise<{ version: string; releaseNotes?: string } | null> => ipcRenderer.invoke('update:getPending'),
  onUpdateDownloaded: (cb: (d: { version: string; releaseNotes?: string }) => void) => {
    const h = (_e: IpcRendererEvent, d: { version: string; releaseNotes?: string }) => cb(d)
    ipcRenderer.on('update:downloaded', h)
    return () => ipcRenderer.removeListener('update:downloaded', h)
  },
  restartToUpdate: (): Promise<void> => ipcRenderer.invoke('update:install'),
  // авто-idle: main опрашивает простой системы и шлёт idle:true/false
  onIdleChange: (cb: (d: { idle: boolean }) => void) => {
    const h = (_e: IpcRendererEvent, d: { idle: boolean }) => cb(d)
    ipcRenderer.on('idle:changed', h)
    return () => ipcRenderer.removeListener('idle:changed', h)
  },
  // глобальный тумблер микрофона
  setMicHotkey: (accel: string | null): Promise<string | null> => ipcRenderer.invoke('voice:setMicHotkey', accel),
  onToggleMic: (cb: () => void) => {
    const h = () => cb()
    ipcRenderer.on('voice:toggle-mic', h)
    return () => ipcRenderer.removeListener('voice:toggle-mic', h)
  },
  // трансляция системного звука при демонстрации экрана (loopback берётся в main)
  setShareAudio: (on: boolean): Promise<void> => ipcRenderer.invoke('screen:setAudio', on),
  // пикер демонстрации: список экранов/окон + выбор источника для следующего getDisplayMedia
  getScreenSources: () => ipcRenderer.invoke('screen:getSources'),
  pickScreenSource: (id: string | null): Promise<void> => ipcRenderer.invoke('screen:pickSource', id),
  // совместный просмотр торрентов: движок в main, отдаёт локальный stream-URL для <video>
  torrentStart: (p: { magnet?: string; infoHash?: string }) => ipcRenderer.invoke('torrent:start', p),
  torrentStop: (token?: string) => ipcRenderer.invoke('torrent:stop', token),
  torrentSelftest: () => ipcRenderer.invoke('torrent:selftest'),
  onTorrentProgress: (cb: (p: unknown) => void) => {
    const h = (_e: IpcRendererEvent, p: unknown) => cb(p)
    ipcRenderer.on('torrent:progress', h)
    return () => ipcRenderer.removeListener('torrent:progress', h)
  },
  // плеер mpv (для MKV/HEVC, что не тянет <video>): играет HTTP-поток торрента отдельным окном
  mpvLoad: (p: { url: string; paused?: boolean; start?: number }) => ipcRenderer.invoke('mpv:load', p),
  mpvLoadLink: (p: { url: string; paused?: boolean; start?: number }) => ipcRenderer.invoke('mpv:loadLink', p),
  mpvPause: (paused: boolean) => ipcRenderer.invoke('mpv:pause', paused),
  mpvSeek: (sec: number) => ipcRenderer.invoke('mpv:seek', sec),
  mpvSetAudio: (id: number | false) => ipcRenderer.invoke('mpv:setAudio', id),
  mpvSetSub: (id: number | false) => ipcRenderer.invoke('mpv:setSub', id),
  mpvSetSpeed: (v: number) => ipcRenderer.invoke('mpv:setSpeed', v),
  mpvStop: () => ipcRenderer.invoke('mpv:stop'),
  onMpvEvent: (cb: (p: unknown) => void) => {
    const h = (_e: IpcRendererEvent, p: unknown) => cb(p)
    ipcRenderer.on('mpv:event', h)
    return () => ipcRenderer.removeListener('mpv:event', h)
  },
})

// выгрузка/перезагрузка рендерера — снимаем глобальный хоткей, чтобы он не остался в ОС
window.addEventListener('beforeunload', () => { ipcRenderer.invoke('voice:setMicHotkey', null).catch(() => {}) })
