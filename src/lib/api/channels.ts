import { MOCK } from '../config'
import { http } from '../http'
import type { Channel, ChannelType, NotificationLevel } from '../types'
import type { ChannelDto } from './dto'
import { MOCK_CHANNELS } from '@/mocks/data'

export function mapChannel(d: ChannelDto): Channel {
  return { id: d.id, name: d.name, type: d.type, categoryId: d.categoryId, topic: d.topic, position: d.position, userLimit: d.userLimit, slowModeSeconds: d.slowModeSeconds ?? 0, lastMessageId: d.lastMessageId, system: d.system ?? false }
}

export async function createChannel(p: { name: string; type: ChannelType; categoryId?: string | null; topic?: string | null }, serverId?: string): Promise<Channel> {
  if (MOCK) return { id: 'ch_' + crypto.randomUUID().slice(0, 8), name: p.name, type: p.type, categoryId: p.categoryId ?? null, topic: p.topic ?? null, position: 0, lastMessageId: null }
  const path = serverId ? `/servers/${serverId}/channels` : '/channels'
  const dto = await http<ChannelDto>(path, { method: 'POST', body: JSON.stringify({ name: p.name, type: p.type, categoryId: p.categoryId ?? null, topic: p.topic ?? null }) })
  return mapChannel(dto)
}
// PATCH /channels/{id}. ВАЖНО: categoryId=null на бэке = «без категории», поэтому всегда шлём текущий,
// чтобы правка имени/темы не выкинула канал из его категории.
export async function updateChannel(id: string, p: { name: string; categoryId?: string | null; topic?: string | null; userLimit?: number | null; slowModeSeconds?: number | null }): Promise<Channel> {
  if (MOCK) { const cur = MOCK_CHANNELS.find((c) => c.id === id); return { ...(cur as Channel), name: p.name, categoryId: p.categoryId ?? null, topic: p.topic ?? null, userLimit: p.userLimit ?? null, slowModeSeconds: p.slowModeSeconds ?? 0 } }
  const dto = await http<ChannelDto>(`/channels/${id}`, { method: 'PATCH', body: JSON.stringify(p) })
  return mapChannel(dto)
}
export async function deleteChannel(id: string): Promise<void> {
  if (MOCK) return
  await http(`/channels/${id}`, { method: 'DELETE' })
}

// ---- уведомления по каналам (персональные, синкаются между устройствами) ----
export async function notificationSettings(): Promise<{ channelId: string; level: NotificationLevel }[]> {
  if (MOCK) return []
  return http<{ channelId: string; level: NotificationLevel }[]>('/notification-settings')
}
export async function setChannelNotification(channelId: string, level: NotificationLevel): Promise<void> {
  if (MOCK) return
  await http(`/channels/${channelId}/notification-setting`, { method: 'PUT', body: JSON.stringify({ level }) })
}

export const channelsApi = { createChannel, updateChannel, deleteChannel, notificationSettings, setChannelNotification }
