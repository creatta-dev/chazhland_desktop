import { ws, type FriendEvent } from './ws'
import { api } from './api'
import { toast } from './toast'
import { sfx } from './sfx'
import type { Friend, FriendList } from './types'

export type Relation = 'friend' | 'incoming' | 'outgoing' | 'none'

const EMPTY: FriendList = { friends: [], incoming: [], outgoing: [] }

// Друзья: один общий стор на всё приложение (раздел «Друзья», бейдж заявок, гейт ЛС, кнопка в профиле).
// Источник правды — бэк: список перечитывается по сигналу из личного топика /topic/user.{me}.friends
// и после каждого WS-реконнекта (сигналы, пропущенные в обрыве, иначе потерялись бы).
// Мутации бэк отвечает свежим списком — кладём его сразу, без лишнего GET.
class FriendsStore {
  private list: FriendList = EMPTY
  private cbs = new Set<() => void>()
  private offTopic: (() => void) | null = null
  private offStatus: (() => void) | null = null
  private meId: string | null = null
  private epoch = 0 // версия запроса: «обогнавший» ответ старого рефреша не перетирает новый
  loaded = false

  subscribe(cb: () => void): () => void { this.cbs.add(cb); return () => { this.cbs.delete(cb) } }
  private emit() { this.cbs.forEach((c) => c()) }

  get(): FriendList { return this.list }
  isFriend(userId: string): boolean { return this.list.friends.some((f) => f.userId === userId) }
  relation(userId: string): Relation {
    if (this.list.friends.some((f) => f.userId === userId)) return 'friend'
    if (this.list.incoming.some((f) => f.userId === userId)) return 'incoming'
    if (this.list.outgoing.some((f) => f.userId === userId)) return 'outgoing'
    return 'none'
  }
  find(userId: string): Friend | undefined {
    return [...this.list.friends, ...this.list.incoming, ...this.list.outgoing].find((f) => f.userId === userId)
  }

  start(meId: string) {
    if (this.meId === meId && this.offTopic) return
    this.stop()
    this.meId = meId
    this.offTopic = ws.onUserFriends(meId, (e) => this.onEvent(e))
    // onStatus сразу зовёт колбэк текущим статусом → это же и первичная загрузка
    this.offStatus = ws.onStatus((s) => { if (s === 'online') void this.refresh() })
  }
  stop() {
    this.offTopic?.(); this.offTopic = null
    this.offStatus?.(); this.offStatus = null
    this.meId = null
    this.epoch++
    this.list = EMPTY
    this.loaded = false
    this.emit()
  }

  async refresh() {
    const epoch = ++this.epoch
    try {
      const l = await api.friends()
      if (epoch === this.epoch) this.set(l)
    } catch { /* сеть — следующий сигнал или реконнект перечитают */ }
  }
  private set(l: FriendList) { this.epoch++; this.list = l; this.loaded = true; this.emit() }

  private onEvent(e: FriendEvent) {
    if (e.type === 'REQUEST_RECEIVED') { sfx.dm(); toast.info(`${e.username} хочет добавить вас в друзья`) }
    else if (e.type === 'REQUEST_ACCEPTED') toast.ok(`${e.username} теперь у вас в друзьях`)
    void this.refresh()
  }

  // Действия бросают HttpError — показ текста ошибки остаётся вызывающему UI.
  async request(username: string) { this.set(await api.sendFriendRequest(username)) }
  async accept(userId: string) { this.set(await api.acceptFriend(userId)) }
  /** Отклонить / отменить / удалить из друзей. */
  async remove(userId: string) { this.set(await api.removeFriend(userId)) }
}

export const friends = new FriendsStore()
