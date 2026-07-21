import { MOCK } from '../config'
import { http } from '../http'

// ---- присутствие: кто онлайн и кто в каких голосовых каналах ----
export async function presenceSnapshot(serverId?: string): Promise<{ online: { userId: string; status: string }[]; voice: Record<string, string[]> }> {
  if (MOCK) return { online: [], voice: {} }
  return http(serverId ? `/servers/${serverId}/presence` : '/presence')
}

export const presenceApi = { presenceSnapshot }
