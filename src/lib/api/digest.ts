import { MOCK } from '../config'
import { http } from '../http'
import type { DigestFull, DigestSummary } from '../types'

// ---- дайджест «Чажленд Wrapped» ----
export async function digests(serverId?: string): Promise<DigestSummary[]> {
  if (MOCK) return []
  return http<DigestSummary[]>(serverId ? `/servers/${serverId}/digests` : '/server/digests')
}
export async function digest(id: string, serverId?: string): Promise<DigestFull> {
  return http<DigestFull>(serverId ? `/servers/${serverId}/digests/${id}` : `/digests/${id}`)
}

export const digestApi = { digests, digest }
