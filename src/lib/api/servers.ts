import { MOCK } from '../config'
import { http, delay } from '../http'
import type { Category, Channel, InviteCreated, InviteSummary, ServerSummary } from '../types'
import type { ChannelDto, TreeDto } from './dto'
import { mapChannel } from './channels'
import { getMeId } from './memberDirectory'
import { MOCK_CATEGORIES, MOCK_CHANNELS, MOCK_SERVERS, MOCK_USER } from '@/mocks/data'

export interface ServerTree { categories: Category[]; channels: Channel[] }

// ---- серверы (мульти-тенант, гилд-рейл) ----
export async function servers(): Promise<ServerSummary[]> {
  if (MOCK) { await delay(120); return MOCK_SERVERS }
  return http<ServerSummary[]>('/servers')
}
export async function createServer(name: string, iconObjectKey?: string): Promise<ServerSummary> {
  if (MOCK) { await delay(250); return { id: 's_' + crypto.randomUUID().slice(0, 8), name, iconUrl: null, ownerId: getMeId() || MOCK_USER.id, myRole: 'OWNER', memberCount: 1 } }
  return http<ServerSummary>('/servers', { method: 'POST', body: JSON.stringify({ name, iconObjectKey: iconObjectKey ?? null }) })
}
// вступить в сервер по коду инвайта → карточка сервера (добавляем в рейл)
export async function joinServer(code: string): Promise<ServerSummary> {
  if (MOCK) { await delay(250); return MOCK_SERVERS[0] }
  return http<ServerSummary>(`/invites/${encodeURIComponent(code)}`, { method: 'POST' })
}
export async function leaveServer(serverId: string): Promise<void> {
  if (MOCK) return
  await http(`/servers/${serverId}/members/me`, { method: 'DELETE' })
}
export async function renameServer(serverId: string, name: string): Promise<ServerSummary> {
  if (MOCK) { await delay(200); return { ...MOCK_SERVERS[0], id: serverId, name } }
  return http<ServerSummary>(`/servers/${serverId}`, { method: 'PATCH', body: JSON.stringify({ name }) })
}

// ---- инвайты сервера (CREATE_INVITE) ----
export async function listInvites(serverId: string): Promise<InviteSummary[]> {
  if (MOCK) return []
  return http<InviteSummary[]>(`/servers/${serverId}/invites`)
}
export async function createInvite(serverId: string, opts?: { expiresInHours?: number | null; maxUses?: number | null }): Promise<InviteCreated> {
  if (MOCK) { await delay(200); return { code: 'mock-' + crypto.randomUUID().slice(0, 6), expiresAt: null, maxUses: opts?.maxUses ?? null } }
  return http<InviteCreated>(`/servers/${serverId}/invites`, { method: 'POST', body: JSON.stringify({ expiresInHours: opts?.expiresInHours ?? null, maxUses: opts?.maxUses ?? null }) })
}
export async function revokeInvite(serverId: string, inviteId: string): Promise<void> {
  if (MOCK) return
  await http(`/servers/${serverId}/invites/${inviteId}`, { method: 'DELETE' })
}

// дерево сервера: с serverId → серверный роут; без → домашний (легаси для одно-серверного клиента)
export async function serverTree(serverId?: string): Promise<ServerTree> {
  if (MOCK) { await delay(150); return { categories: MOCK_CATEGORIES, channels: MOCK_CHANNELS } }
  if (serverId) {
    const t = await http<{ server: ServerSummary; categories: Category[]; channels: ChannelDto[] }>(`/servers/${serverId}/tree`)
    return { categories: t.categories, channels: t.channels.map(mapChannel) }
  }
  const t = await http<TreeDto>('/server/tree')
  return { categories: t.categories, channels: t.channels.map(mapChannel) }
}

export const serversApi = {
  servers, createServer, joinServer, leaveServer, renameServer,
  listInvites, createInvite, revokeInvite, serverTree,
}
