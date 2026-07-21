import { MOCK } from '../config'
import { http, delay } from '../http'
import type { Member, Presence, Role } from '../types'
import type { MemberDto } from './dto'
import { isDirectoryEmpty, putAll, replaceAll } from './memberDirectory'
import { MOCK_MEMBERS } from '@/mocks/data'

export function mapMember(d: MemberDto): Member {
  return { userId: d.userId, username: d.username, avatarUrl: d.avatarUrl, role: d.role, status: (d.status as Presence) || 'offline', joinedAt: d.joinedAt, soundboardDisabled: d.soundboardDisabled ?? false, roleIds: d.roleIds ?? [], statusMessage: d.statusMessage ?? null }
}

export async function members(serverId?: string): Promise<Member[]> {
  if (MOCK) { await delay(150); putAll(MOCK_MEMBERS); return MOCK_MEMBERS }
  const list = await http<MemberDto[]>(serverId ? `/servers/${serverId}/members` : '/server/members')
  const mapped = list.map(mapMember)
  replaceAll(mapped)
  return mapped
}

/**
 * Ленивая подгрузка справочника участников перед резолвом имён авторов.
 * Ровно то же условие, что было заинлайнено в методах сообщений/аудита: грузим ТОЛЬКО если пусто.
 */
export async function ensureMembersLoaded(): Promise<void> {
  if (isDirectoryEmpty()) await members()
}

export async function kick(userId: string, serverId?: string): Promise<void> {
  if (MOCK) return
  await http(serverId ? `/servers/${serverId}/members/${userId}` : `/members/${userId}`, { method: 'DELETE' })
}
export async function changeRole(userId: string, role: Role, serverId?: string): Promise<void> {
  if (MOCK) return
  await http(serverId ? `/servers/${serverId}/members/${userId}` : `/members/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) })
}

export const membersApi = { members, kick, changeRole }
