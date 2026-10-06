import { MOCK } from '../config'
import { http, delay } from '../http'
import type { Friend, FriendList, Presence } from '../types'
import type { FriendListDto, FriendDto } from './dto'

// ---- друзья (Discord-style): заявка по нику → принять/отклонить/отменить, удаление ----
// Все мутации бэк отвечает свежим списком — отдельный GET после действия не нужен.

const EMPTY: FriendList = { friends: [], incoming: [], outgoing: [] }
const KNOWN: Presence[] = ['online', 'idle', 'dnd', 'offline']

function mapFriend(d: FriendDto): Friend {
  return {
    userId: d.userId, username: d.username, avatarUrl: d.avatarUrl, since: d.since,
    status: (KNOWN as string[]).includes(d.status) ? (d.status as Presence) : 'online',
  }
}
function mapList(d: FriendListDto): FriendList {
  return { friends: d.friends.map(mapFriend), incoming: d.incoming.map(mapFriend), outgoing: d.outgoing.map(mapFriend) }
}

export async function friends(): Promise<FriendList> {
  if (MOCK) { await delay(120); return EMPTY }
  return mapList(await http<FriendListDto>('/friends'))
}
export async function sendFriendRequest(username: string): Promise<FriendList> {
  if (MOCK) { await delay(200); return EMPTY }
  return mapList(await http<FriendListDto>('/friends/requests', { method: 'POST', body: JSON.stringify({ username }) }))
}
export async function acceptFriend(userId: string): Promise<FriendList> {
  if (MOCK) return EMPTY
  return mapList(await http<FriendListDto>(`/friends/${userId}/accept`, { method: 'POST' }))
}
/** Отклонить входящую / отменить исходящую / удалить из друзей — один и тот же DELETE. */
export async function removeFriend(userId: string): Promise<FriendList> {
  if (MOCK) return EMPTY
  return mapList(await http<FriendListDto>(`/friends/${userId}`, { method: 'DELETE' }))
}

export const friendsApi = { friends, sendFriendRequest, acceptFriend, removeFriend }
