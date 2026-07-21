import { MOCK } from '../config'
import { http, delay } from '../http'
import type { MemberRank, MyRank, RankCatalog } from '../types'
import { MOCK_MEMBER_RANKS, MOCK_MY_RANK, MOCK_RANK_CATALOG, MOCK_USER } from '@/mocks/data'

// --- Ранги (read-only; пусто/нули при выключенной фиче на бэке) ---
export async function rankCatalog(): Promise<RankCatalog> {
  if (MOCK) { await delay(200); return MOCK_RANK_CATALOG }
  return http<RankCatalog>('/ranks/catalog')
}
export async function myRank(): Promise<MyRank> {
  if (MOCK) { await delay(150); return MOCK_MY_RANK }
  return http<MyRank>('/me/rank')
}
export async function memberRanks(serverId: string): Promise<MemberRank[]> {
  if (MOCK) { await delay(150); return MOCK_MEMBER_RANKS[serverId] ?? [] }
  return http<MemberRank[]>(`/servers/${serverId}/members/ranks`)
}
/** Хартбит времени РАЗГОВОРА (active-speaker): накопленные секунды речи в канале → talk-XP. */
export async function talkHeartbeat(channelId: string, deltaSeconds: number): Promise<void> {
  if (MOCK) return
  await http('/voice/talk-heartbeat', { method: 'POST', body: JSON.stringify({ channelId, deltaSeconds }) })
}
/** Поставить загруженную картинку фоном профиля. Возвращает её публичный URL. */
export async function setProfileBackground(objectKey: string): Promise<string> {
  if (MOCK) { await delay(250); const u = 'mock://' + objectKey; MOCK_MY_RANK.profileBackgroundUrl = u; return u }
  const r = await http<{ profileBackgroundUrl: string }>('/me/rank/profile-background', { method: 'PUT', body: JSON.stringify({ objectKey }) })
  return r.profileBackgroundUrl
}
/** Снять загруженный фон профиля. */
export async function clearProfileBackground(): Promise<void> {
  if (MOCK) { await delay(150); MOCK_MY_RANK.profileBackgroundUrl = null; return }
  await http('/me/rank/profile-background', { method: 'DELETE' })
}
/** Надеть/снять косметику в слоте (cosmeticId=null → снять). Возвращает новую карту экипировки. */
export async function equipCosmetic(slot: string, cosmeticId: string | null): Promise<Record<string, string>> {
  if (MOCK) {
    await delay(120)
    const eq = { ...(MOCK_MY_RANK.equipped ?? {}) }
    if (cosmeticId) eq[slot] = cosmeticId; else delete eq[slot]
    MOCK_MY_RANK.equipped = eq
    // отразить на «себе» в списках участников всех серверов, чтобы аватар/ник обновились живьём
    for (const list of Object.values(MOCK_MEMBER_RANKS)) {
      const me = list.find((r) => r.userId === MOCK_USER.id)
      if (me) me.equipped = { ...eq }
    }
    return eq
  }
  // слот бэк выводит из каталога по cosmeticId; для снятия слот идёт в пути
  if (cosmeticId) {
    return http<Record<string, string>>('/me/rank/equip', { method: 'PUT', body: JSON.stringify({ cosmeticId }) })
  }
  return http<Record<string, string>>(`/me/rank/equip/${slot}`, { method: 'DELETE' })
}

export const ranksApi = {
  rankCatalog, myRank, memberRanks, talkHeartbeat,
  setProfileBackground, clearProfileBackground, equipCosmetic,
}
