import { MOCK } from '../config'
import { http } from '../http'
import type { AfkSettings, VoiceMemberSince } from '../types'

// ---- voice (LiveKit) ----
export async function livekitToken(channelId: string): Promise<{ token: string; url: string; room: string }> {
  if (MOCK) return { token: '', url: '', room: channelId }
  return http(`/livekit/token`, { method: 'POST', body: JSON.stringify({ channelId }) })
}

// ---- время в войсе (момент входа текущих участников голоса) ----
export async function voiceSince(serverId: string): Promise<VoiceMemberSince[]> {
  if (MOCK) return []
  return http<VoiceMemberSince[]>(`/servers/${serverId}/voice/since`)
}

// ---- авто-AFK ----
export async function afkSettings(serverId: string): Promise<AfkSettings> {
  if (MOCK) return { enabled: false, timeoutSeconds: 900, afkChannelId: null, afkChannelName: null }
  return http<AfkSettings>(`/servers/${serverId}/afk`)
}
export async function updateAfkSettings(serverId: string, p: { enabled?: boolean; timeoutSeconds?: number }): Promise<AfkSettings> {
  if (MOCK) return { enabled: p.enabled ?? false, timeoutSeconds: p.timeoutSeconds ?? 900, afkChannelId: null, afkChannelName: null }
  return http<AfkSettings>(`/servers/${serverId}/afk`, { method: 'PUT', body: JSON.stringify(p) })
}
/** Лёгкий пинг голосовой активности (active-speaker/анмьют) — сбрасывает таймер авто-AFK. */
export async function voiceActivity(): Promise<void> {
  if (MOCK) return
  await http('/voice/activity', { method: 'POST' })
}

export const voiceApi = { livekitToken, voiceSince, afkSettings, updateAfkSettings, voiceActivity }
