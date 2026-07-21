import { MOCK } from '../config'
import { http, delay } from '../http'
import type { Dm } from '../types'
import type { DmDto } from './dto'
import { getMember } from './memberDirectory'

// ---- личные сообщения (DM = скрытый канал type=DM) ----
export async function openDm(userId: string): Promise<Dm> {
  if (MOCK) { await delay(150); return { id: 'dm_' + userId, name: getMember(userId)?.username ?? 'Личные', avatarUrl: getMember(userId)?.avatarUrl ?? null, otherUserId: userId } }
  const d = await http<DmDto>(`/dm/${userId}`, { method: 'POST' })
  return { id: d.channelId, name: d.otherUsername, avatarUrl: d.otherAvatarUrl, otherUserId: d.otherUserId }
}
export async function listDms(): Promise<Dm[]> {
  if (MOCK) return []
  const list = await http<DmDto[]>('/dm')
  return list.map((d) => ({ id: d.channelId, name: d.otherUsername, avatarUrl: d.otherAvatarUrl, otherUserId: d.otherUserId }))
}

export const dmApi = { openDm, listDms }
