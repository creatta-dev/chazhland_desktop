import { app, ipcMain, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater — CommonJS; при ESM ("type":"module") берём autoUpdater из default-экспорта.
const { autoUpdater } = electronUpdater

type UpdatePayload = { version: string; releaseNotes?: string }
let pending: UpdatePayload | null = null // последнее «загружено» — на случай, если UI ещё не смонтирован

// Авто-обновление через публичный GitHub-репо (MrrMD/chazhland_desktop → latest.yml в релизе; releaseNotes
// апдейтер берёт из тела релиза через releases.atom). Работает ТОЛЬКО в упакованной сборке. Логика: проверка
// через 10с после старта + раз в 2ч, автоскачивание; по готовности — событие в рендерер (окно «Что нового»
// с кнопкой «Перезапустить»), иначе установится при следующем закрытии. UI показывает своё окно; тут только
// системное уведомление как ненавязчивый сигнал.
export function setupAutoUpdate(getWin: () => BrowserWindow | null) {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console as unknown as typeof autoUpdater.logger

  // рендерер запрашивает буфер при монтировании (если событие пришло раньше готовности UI)
  ipcMain.handle('update:getPending', () => pending)
  // кнопка «Перезапустить сейчас» из окна «Что нового»
  ipcMain.handle('update:install', () => { setImmediate(() => autoUpdater.quitAndInstall()) })

  autoUpdater.on('update-downloaded', (info) => {
    const releaseNotes = typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined
    pending = { version: info.version, releaseNotes }
    try { new Notification({ title: 'chazhland', body: `Обновление ${info.version} загружено` }).show() } catch { /* уведомления недоступны — не критично */ }
    getWin()?.webContents.send('update:downloaded', pending)
  })
  autoUpdater.on('error', (err) => console.error('[updater] error:', err?.message || err))

  const check = () => autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e?.message || e))
  setTimeout(check, 10_000)
  setInterval(check, 2 * 60 * 60_000)
}
