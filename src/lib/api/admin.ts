import { MOCK } from '../config'
import { formatTimeThenDate } from '../format'
import { http, delay } from '../http'
import type { AuditEntry } from '../types'
import type { AdminUserDto, AuditDto, Page } from './dto'
import { resolveName } from './memberDirectory'
import { ensureMembersLoaded } from './members'
import { MOCK_AUDIT } from '@/mocks/data'

function auditText(d: AuditDto): string {
  const actor = resolveName(d.actorId)
  const tgt = d.targetId ? resolveName(d.targetId) : ''
  switch (d.action) {
    case 'member.kick': return `**${actor}** исключил **${tgt}**`
    case 'member.role-change': return `**${actor}** изменил роль **${tgt}**`
    case 'invite.create': return `**${actor}** создал приглашение`
    case 'invite.revoke': return `**${actor}** отозвал приглашение`
    case 'user.reset-password': return `**${actor}** сбросил пароль **${tgt}**`
    default: return `**${actor}** · ${d.action}`
  }
}

export async function audit(): Promise<AuditEntry[]> {
  if (MOCK) { await delay(150); return MOCK_AUDIT }
  // бэк отдаёт конверт курсорной пагинации Page<T>{items,nextCursor,hasMore}, а не плоский массив
  const page = await http<Page<AuditDto>>('/admin/audit')
  await ensureMembersLoaded()
  return page.items.map((d) => ({
    id: d.id, action: d.action, actorName: resolveName(d.actorId), text: auditText(d),
    meta: `${d.action}${d.targetType ? ' · ' + d.targetType : ''}${d.targetId ? ':' + d.targetId : ''}`,
    createdAt: formatTimeThenDate(d.createdAt),
  }))
}

// админ сбрасывает пароль участнику → бэк возвращает одноразовый временный пароль (показать один раз)
export async function resetMemberPassword(userId: string): Promise<string> {
  if (MOCK) return 'Tmp-' + userId.slice(0, 4) + '-9F3kQ'
  const r = await http<{ temporaryPassword: string }>(`/admin/users/${userId}/reset-password`, { method: 'POST' })
  return r.temporaryPassword
}

// Список пользователей инсталляции для админ-панели (страница курсорной пагинации). Фильтры опциональны:
// q — поиск по логину/почте; fromMs/toMs — диапазон дат регистрации (epoch-мс); cursor — из nextCursor.
export interface AdminUsersFilter { q?: string; fromMs?: number; toMs?: number; cursor?: string; limit?: number }

export async function adminUsers(f: AdminUsersFilter = {}): Promise<Page<AdminUserDto>> {
  if (MOCK) { await delay(150); return { items: [], nextCursor: null, hasMore: false } }
  const qs = new URLSearchParams()
  if (f.q) qs.set('q', f.q)
  if (f.fromMs != null) qs.set('fromMs', String(f.fromMs))
  if (f.toMs != null) qs.set('toMs', String(f.toMs))
  if (f.cursor) qs.set('cursor', f.cursor)
  if (f.limit != null) qs.set('limit', String(f.limit))
  const q = qs.toString()
  return http<Page<AdminUserDto>>('/admin/users' + (q ? '?' + q : ''))
}

export const adminApi = { audit, resetMemberPassword, adminUsers }
