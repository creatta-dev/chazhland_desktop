import { MOCK } from '../config'
import { http } from '../http'

/** звук саундпада (бэк: SoundboardResponse) */
export interface SoundClip { id: string; name: string; url: string }

// ---- саундпад (общий, серверный): загрузил один — слышат все ----
// С serverId → саундпад КОНКРЕТНОГО сервера (ServerScopedController); без него — легаси-роут
// домашнего сервера. В созданном пользователем сервере без serverId будут звуки чужого сервера,
// поэтому вызывающим стоит передавать id активного сервера.
export async function listSoundboard(serverId?: string): Promise<SoundClip[]> {
  if (MOCK) return []
  return http<SoundClip[]>(serverId ? `/servers/${serverId}/soundboard` : '/soundboard')
}
export async function createSoundboard(name: string, objectKey: string, serverId?: string): Promise<SoundClip> {
  if (MOCK) return { id: 'sb_' + crypto.randomUUID().slice(0, 8), name, url: '' }
  return http<SoundClip>(serverId ? `/servers/${serverId}/soundboard` : '/soundboard', { method: 'POST', body: JSON.stringify({ name, objectKey }) })
}
export async function deleteSoundboard(id: string, serverId?: string): Promise<void> {
  if (MOCK) return
  await http(serverId ? `/servers/${serverId}/soundboard/${id}` : `/soundboard/${id}`, { method: 'DELETE' })
}
// включить/выключить саундпад участнику (admin/owner; даже на админов)
export async function setMemberSoundboard(userId: string, disabled: boolean, serverId?: string): Promise<void> {
  if (MOCK) return
  await http(serverId ? `/servers/${serverId}/members/${userId}/soundboard` : `/members/${userId}/soundboard`, { method: 'PUT', body: JSON.stringify({ disabled }) })
}

export const soundboardApi = { listSoundboard, createSoundboard, deleteSoundboard, setMemberSoundboard }
