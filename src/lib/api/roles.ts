import { MOCK } from '../config'
import { http } from '../http'
import type { ChannelOverwrite, OverwriteTarget, Permission, ServerRole } from '../types'

// ---- кастомные роли ----
export async function roles(serverId?: string): Promise<ServerRole[]> {
  if (MOCK) return []
  return http<ServerRole[]>(serverId ? `/servers/${serverId}/roles` : '/roles')
}
export async function createRole(p: { name: string; color?: string | null; permissions: Permission[] }, serverId?: string): Promise<ServerRole> {
  if (MOCK) return { id: 'r_' + crypto.randomUUID().slice(0, 8), name: p.name, color: p.color ?? null, position: 1, permissions: p.permissions, isDefault: false }
  return http<ServerRole>(serverId ? `/servers/${serverId}/roles` : '/roles', { method: 'POST', body: JSON.stringify(p) })
}
export async function updateRole(id: string, p: { name: string; color?: string | null; permissions: Permission[] }): Promise<ServerRole> {
  if (MOCK) return { id, name: p.name, color: p.color ?? null, position: 1, permissions: p.permissions, isDefault: false }
  return http<ServerRole>(`/roles/${id}`, { method: 'PATCH', body: JSON.stringify(p) })
}
export async function deleteRole(id: string): Promise<void> {
  if (MOCK) return
  await http(`/roles/${id}`, { method: 'DELETE' })
}
export async function assignRole(roleId: string, userId: string): Promise<void> {
  if (MOCK) return
  await http(`/roles/${roleId}/members/${userId}`, { method: 'PUT' })
}
export async function unassignRole(roleId: string, userId: string): Promise<void> {
  if (MOCK) return
  await http(`/roles/${roleId}/members/${userId}`, { method: 'DELETE' })
}

// ---- доступ к каналам (перекрытия прав ролей/участников) ----
export async function channelPermissions(channelId: string): Promise<ChannelOverwrite[]> {
  if (MOCK) return []
  return http<ChannelOverwrite[]>(`/channels/${channelId}/permissions`)
}
export async function setChannelPermission(channelId: string, p: { targetType: OverwriteTarget; targetId: string; allow: Permission[]; deny: Permission[] }): Promise<ChannelOverwrite> {
  if (MOCK) return { id: 'ow_' + crypto.randomUUID().slice(0, 8), ...p }
  return http<ChannelOverwrite>(`/channels/${channelId}/permissions`, { method: 'PUT', body: JSON.stringify(p) })
}
export async function clearChannelPermission(channelId: string, targetType: OverwriteTarget, targetId: string): Promise<void> {
  if (MOCK) return
  await http(`/channels/${channelId}/permissions/${targetType}/${targetId}`, { method: 'DELETE' })
}

export const rolesApi = {
  roles, createRole, updateRole, deleteRole, assignRole, unassignRole,
  channelPermissions, setChannelPermission, clearChannelPermission,
}
