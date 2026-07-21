import { MOCK } from '../config'
import { http, delay } from '../http'
import type { User } from '../types'
import type { UserDto } from './dto'
import { setMeId } from './memberDirectory'
import { MOCK_USER } from '@/mocks/data'

const toUser = (u: UserDto): User => ({ id: u.id, username: u.username, avatarUrl: u.avatarUrl, statusMessage: u.statusMessage ?? null })

export async function me(_pendingAccess?: string): Promise<User> {
  if (MOCK) { setMeId(MOCK_USER.id); return MOCK_USER }
  const u = await http<UserDto>('/users/me')
  setMeId(u.id)
  return toUser(u)
}

// ---- профиль / настройки аккаунта ----
export async function updateProfile(p: { username?: string; statusMessage?: string }): Promise<User> {
  if (MOCK) { await delay(250); return { ...MOCK_USER, ...p } }
  return toUser(await http<UserDto>('/users/me', { method: 'PATCH', body: JSON.stringify(p) }))
}
export async function setAvatar(objectKey: string): Promise<User> {
  if (MOCK) { await delay(250); return MOCK_USER }
  return toUser(await http<UserDto>('/users/me/avatar', { method: 'PUT', body: JSON.stringify({ objectKey }) }))
}
export async function changePassword(p: { currentPassword: string; newPassword: string }): Promise<void> {
  if (MOCK) { await delay(300); return }
  await http('/users/me/password', { method: 'PUT', body: JSON.stringify(p) })
}
export async function logoutAll(): Promise<void> {
  if (MOCK) return
  await http('/users/me/logout-all', { method: 'POST' })
}

export const usersApi = { me, updateProfile, setAvatar, changePassword, logoutAll }
