import { app, dialog, Notification, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'

// electron-updater — CommonJS; при ESM ("type":"module") берём autoUpdater из default-экспорта.
const { autoUpdater } = electronUpdater

// Авто-обновление через публичный GitHub-репо (MrrMD/chazhland_desktop → latest.yml в релизе, provider
// зашит в app-update.yml при сборке из build.publish). Работает ТОЛЬКО в упакованной сборке — в dev нет
// app-update.yml, апдейтить нечего. Логика: проверка через 10 с после старта + раз в 2 ч, автоскачивание,
// по готовности — предложение перезапустить (иначе установится при следующем закрытии приложения).
export function setupAutoUpdate(getWin: () => BrowserWindow | null) {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = console as unknown as typeof autoUpdater.logger

  let prompted = false
  autoUpdater.on('update-downloaded', async (info) => {
    if (prompted) return // не спамим диалогом, если проверка сработала повторно
    prompted = true
    try { new Notification({ title: 'chazhland', body: `Обновление ${info.version} загружено` }).show() } catch { /* уведомления недоступны — не критично */ }
    const opts = {
      type: 'info' as const,
      buttons: ['Перезапустить сейчас', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      title: 'Доступно обновление',
      message: `Версия ${info.version} загружена`,
      detail: 'Перезапустить приложение, чтобы установить обновление? Иначе оно применится при следующем закрытии.',
      noLink: true,
    }
    const win = getWin()
    const res = win ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts)
    if (res.response === 0) setImmediate(() => autoUpdater.quitAndInstall())
  })
  autoUpdater.on('error', (err) => console.error('[updater] error:', err?.message || err))

  const check = () => autoUpdater.checkForUpdates().catch((e) => console.error('[updater] check failed:', e?.message || e))
  setTimeout(check, 10_000)
  setInterval(check, 2 * 60 * 60_000)
}
