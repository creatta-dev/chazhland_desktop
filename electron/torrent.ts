// Торрент-движок в MAIN-процессе: качает раздачу (TCP+DHT) и отдаёт выбранный видеофайл локальным
// HTTP-потоком с Range, который рендерер скармливает <video> (или позже mpv). Торрент крутится ТОЛЬКО
// в клиенте — VPS к этому не причастен. Один активный торрент за раз; кэш — во временной папке ОС,
// вычищается при старте/смене/выходе (destroyStore). Безопасность: входной magnet санитизируется
// (только xt=urn:btih:<hash>, чужие трекеры/web-seed выкинуты), стрим-сервер слушает только 127.0.0.1
// и проверяет неугадываемый токен в пути (timingSafeEqual → иначе 404).
import { ipcMain, type BrowserWindow } from 'electron'
import type { TorrentStartResult } from './ipc-contract'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

type WT = any // webtorrent — динамический ESM-import; типы не тянем (declare module в global.d.ts)

const CACHE_DIR = path.join(os.tmpdir(), 'chazh-wt-cache')
// Доверенные ПУБЛИЧНЫЕ трекеры (наш фиксированный список, НЕ из магнета). Магнет санитизируется
// (его собственные tr= выкинуты — нельзя подсунуть свой), а пиров ищем через эти + DHT. Так находим
// раздающих и для нишевых раздач, не давая злоумышленнику указать трекер для сбора IP зрителей.
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.dler.org:6969/announce',
]
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.mkv', '.avi', '.mov', '.ts', '.wmv', '.flv', '.mpg', '.mpeg', '.ogv'])
const WEB_PLAYABLE_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv']) // что реально играет <video> (без mpv)
const MAX_TOTAL_BYTES = 60 * 1024 ** 3
const MAX_FILES = 5000
const METADATA_TIMEOUT_MS = 60_000
const MIN_FREE_BYTES = 3 * 1024 ** 3

let client: WT | null = null

async function getClient(): Promise<WT> {
  if (client) return client
  // webtorrent — untyped ESM JS-пакет; грузим как any (типов он не везёт, @types нет)
  // @ts-expect-error — у пакета нет деклараций типов
  const mod: any = await import('webtorrent')
  const WebTorrent = mod.default ?? mod
  client = new WebTorrent()
  client.on('error', (e: any) => console.error('[torrent] client error:', e?.message ?? e))
  return client
}

interface Session {
  token: string
  server: http.Server
  torrent: WT
  fileIndex: number
}
let session: Session | null = null

function normalizeInfoHash(hash: string | null | undefined): string {
  const t = (hash ?? '').trim()
  if (/^[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase()
  if (/^[A-Za-z2-7]{32}$/.test(t)) return t.toUpperCase()
  throw new Error('invalid infohash')
}

/** Только xt=urn:btih:<hash>; tr/ws/xs/as отбрасываем (SSRF-анонс + утечка IP зрителей). */
function sanitizeMagnet(rawMagnet?: string | null, rawInfoHash?: string | null): string {
  let infoHash: string | null = null
  if (rawMagnet && rawMagnet.trim()) {
    const m = rawMagnet.trim()
    if (m.length > 4096) throw new Error('magnet too long')
    if (!m.toLowerCase().startsWith('magnet:?')) throw new Error('invalid magnet')
    for (const pair of m.slice('magnet:?'.length).split('&')) {
      const eq = pair.indexOf('=')
      if (eq < 0) continue
      if (pair.slice(0, eq).toLowerCase() === 'xt' && !infoHash) {
        const v = pair.slice(eq + 1)
        if (v.toLowerCase().startsWith('urn:btih:')) infoHash = v.slice('urn:btih:'.length)
      }
    }
  }
  if (!infoHash && rawInfoHash && rawInfoHash.trim()) infoHash = rawInfoHash.trim()
  return 'magnet:?xt=urn:btih:' + normalizeInfoHash(infoHash)
}

function pickVideoFile(torrent: WT): number {
  let best = -1
  let bestLen = -1
  torrent.files.forEach((f: any, i: number) => {
    const ext = path.extname(f.name ?? '').toLowerCase()
    if (VIDEO_EXT.has(ext) && f.length > bestLen) { best = i; bestLen = f.length }
  })
  if (best < 0) {
    torrent.files.forEach((f: any, i: number) => { if (f.length > bestLen) { best = i; bestLen = f.length } })
  }
  return best
}

function contentType(name: string): string {
  const ext = path.extname(name).toLowerCase()
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.ogv') return 'video/ogg'
  if (ext === '.mkv') return 'video/x-matroska'
  return 'application/octet-stream'
}

function startStreamServer(file: WT, token: string): Promise<http.Server> {
  const expectedPath = '/' + token + '/stream'
  const expectedBuf = Buffer.from(expectedPath)
  const server = http.createServer((req, res) => {
    const reqPath = (req.url ?? '').split('?')[0]
    const reqBuf = Buffer.from(reqPath)
    // токен-гейт: путь должен точно совпасть (constant-time); иначе голый 404
    if (reqBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(reqBuf, expectedBuf)) {
      res.statusCode = 404
      res.end()
      return
    }
    const total: number = file.length
    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Content-Type', contentType(file.name))
    const range = req.headers.range
    let start = 0
    let end = total - 1
    let status = 200
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range)
      if (m) {
        if (m[1]) start = parseInt(m[1], 10)
        if (m[2]) end = parseInt(m[2], 10)
      }
      if (!Number.isFinite(start) || start < 0) start = 0
      if (!Number.isFinite(end) || end >= total) end = total - 1
      if (start > end) {
        res.statusCode = 416
        res.setHeader('Content-Range', `bytes */${total}`)
        res.end()
        return
      }
      status = 206
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
    }
    res.statusCode = status
    res.setHeader('Content-Length', String(end - start + 1))
    if (req.method === 'HEAD') { res.end(); return }
    const stream = file.createReadStream({ start, end })
    stream.on('error', () => res.destroy())
    res.on('close', () => stream.destroy())
    stream.pipe(res)
  })
  return new Promise((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

async function hasFreeSpace(): Promise<boolean> {
  try {
    const s: any = await fs.promises.statfs(os.tmpdir())
    return s.bsize * s.bavail > MIN_FREE_BYTES
  } catch {
    return true // не смогли узнать — не блокируем
  }
}

function sweepCache(): void {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }) } catch { /* */ }
}

async function destroySession(): Promise<void> {
  const s = session
  session = null
  if (!s) return
  await new Promise<void>((resolve) => { try { s.server.close(() => resolve()) } catch { resolve() } })
  await new Promise<void>((resolve) => {
    let done = false
    const fin = () => { if (!done) { done = true; resolve() } }
    try { s.torrent.destroy({ destroyStore: true }, fin) } catch { fin() }
    setTimeout(fin, 4000)
  })
}

// Тип результата живёт в ipc-contract (единый контракт main ↔ preload ↔ рендерер) — см. импорт вверху.

async function start(magnet?: string | null, infoHash?: string | null): Promise<TorrentStartResult> {
  try {
    if (!(await hasFreeSpace())) return { ok: false, error: 'Недостаточно места на диске' }
    const clean = sanitizeMagnet(magnet, infoHash)
    await destroySession() // единственный активный торрент
    sweepCache()
    fs.mkdirSync(CACHE_DIR, { recursive: true })
    const c = await getClient()
    const token = crypto.randomBytes(24).toString('hex')

    const torrent: WT = await new Promise((resolve, reject) => {
      let settled = false
      const t = c.add(clean, { path: CACHE_DIR, announce: PUBLIC_TRACKERS }, (tt: WT) => { if (!settled) { settled = true; resolve(tt) } })
      t.on('error', (e: any) => { if (!settled) { settled = true; reject(new Error(e?.message ?? 'torrent error')) } })
      setTimeout(() => {
        if (!settled) { settled = true; try { t.destroy() } catch { /* */ } reject(new Error('Не удалось получить метаданные раздачи')) }
      }, METADATA_TIMEOUT_MS)
    })

    if (torrent.length > MAX_TOTAL_BYTES || torrent.files.length > MAX_FILES) {
      try { torrent.destroy({ destroyStore: true }) } catch { /* */ }
      return { ok: false, error: 'Раздача слишком большая' }
    }
    const fileIndex = pickVideoFile(torrent)
    if (fileIndex < 0) {
      try { torrent.destroy({ destroyStore: true }) } catch { /* */ }
      return { ok: false, error: 'В раздаче нет видеофайла' }
    }
    // качаем только выбранный файл
    torrent.files.forEach((f: any, i: number) => { try { i === fileIndex ? f.select() : f.deselect() } catch { /* */ } })

    const file = torrent.files[fileIndex]
    const server = await startStreamServer(file, token)
    const addr = server.address() as AddressInfo
    if (!addr || addr.address !== '127.0.0.1') {
      try { server.close() } catch { /* */ }
      try { torrent.destroy({ destroyStore: true }) } catch { /* */ }
      return { ok: false, error: 'stream server not loopback' }
    }
    session = { token, server, torrent, fileIndex }
    const ext = path.extname(file.name).toLowerCase()
    return {
      ok: true,
      token,
      streamUrl: `http://127.0.0.1:${addr.port}/${token}/stream`,
      name: file.name,
      length: file.length,
      webPlayable: WEB_PLAYABLE_EXT.has(ext),
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Не удалось запустить торрент' }
  }
}

let progressTimer: ReturnType<typeof setInterval> | null = null

// Сериализуем start/stop: два быстрых переключения источника не должны оставить два торрента/сервера.
let opChain: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn)
  opChain = run.then(() => undefined, () => undefined)
  return run
}

/** Регистрируется ОДИН раз при whenReady (не в createWindow — иначе двойные обработчики). */
export function registerTorrentIpc(getWin: () => BrowserWindow | null): void {
  ipcMain.handle('torrent:start', (_e, p: { magnet?: string; infoHash?: string }) =>
    enqueue(() => start(p?.magnet, p?.infoHash)))
  ipcMain.handle('torrent:stop', (_e, token?: string) =>
    enqueue(async () => { if (session && (!token || token === session.token)) await destroySession(); return { ok: true } }))
  ipcMain.handle('torrent:selftest', async () => {
    try {
      const c = await getClient()
      return { ok: true, nodeVersion: process.versions.node, webtorrent: true, ready: !!c }
    } catch (e: any) {
      return { ok: false, error: e?.message }
    }
  })

  if (!progressTimer) {
    progressTimer = setInterval(() => {
      const s = session
      const w = getWin()
      if (!s || !w || w.isDestroyed()) return
      const t = s.torrent
      w.webContents.send('torrent:progress', {
        token: s.token,
        progress: t.progress ?? 0,
        downloaded: t.downloaded ?? 0,
        length: t.files?.[s.fileIndex]?.length ?? t.length ?? 0,
        downloadSpeed: t.downloadSpeed ?? 0,
        numPeers: t.numPeers ?? 0,
        ready: !!t.ready,
      })
    }, 1000)
  }
}

/** Чистка кэша от орфанов прошлого запуска (краш мог оставить файлы). */
export function sweepTorrentCacheOnStartup(): void {
  sweepCache()
}

/** Полный teardown (выход приложения / краш рендерера). */
export async function teardownTorrent(): Promise<void> {
  if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
  await destroySession()
  if (client) { try { client.destroy() } catch { /* */ } client = null }
}
