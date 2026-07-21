import { MOCK } from '../config'
import { http, delay } from '../http'
import type { WatchSearchResult, WatchSourceRequest, WatchState } from '../types'

// ---- watch-party ----
export async function watchState(channelId: string): Promise<WatchState | null> {
  if (MOCK) return null
  const s = await http<WatchState | undefined>(`/channels/${channelId}/watch`).catch(() => null)
  return s ?? null // 204 (нет источника) → null
}
export async function setWatchSource(channelId: string, req: WatchSourceRequest): Promise<WatchState> {
  const kind = req.kind ?? 'DIRECT'
  if (MOCK) return { url: req.url ?? null, paused: true, positionSeconds: 0, updatedAt: Date.now(), hostId: '', lastActionBy: '', source: { kind, url: req.url ?? null, infoHash: req.infoHash ?? null } }
  return http(`/channels/${channelId}/watch/source`, { method: 'POST', body: JSON.stringify(req) })
}
// поиск торрентов по названию (Prowlarr на бэке); 503 — поиск не настроен/недоступен, 400 — q < 2 символов
export async function searchWatch(channelId: string, q: string): Promise<WatchSearchResult[]> {
  if (MOCK) { await delay(400); return [] }
  return http(`/channels/${channelId}/watch/search?q=${encodeURIComponent(q)}`)
}
export async function stopWatch(channelId: string): Promise<void> {
  if (MOCK) return
  await http(`/channels/${channelId}/watch`, { method: 'DELETE' })
}

export const watchApi = { watchState, setWatchSource, searchWatch, stopWatch }
