import { Client, type IMessage, type StompSubscription } from '@stomp/stompjs'
import { MOCK, WS_URL } from './config'
import type { AchievementEvent, AfkEvent, QuorumEvent, RankEvent, WatchAction, WatchState } from './types'

export interface WsEvent { type: string; channelId?: string; message?: unknown; userId?: string; username?: string; messageId?: string; emoji?: string }
/** Ответ бэка на отказ в @MessageMapping-обработчике (ws/WsError.java): статус + человеческий текст. */
export interface WsErrorEvent { status: number; message: string }
export type WsStatus = 'online' | 'connecting'

interface Spec { topic: string; cb: (body: any) => void; sub: StompSubscription | null }

// STOMP-over-WebSocket клиент. В mock-режиме — no-op, статус всегда online (баннер скрыт).
class Ws {
  private client: Client | null = null
  private specs = new Set<Spec>() // логические подписки — переживают реконнект
  private status: WsStatus = 'online'
  private statusCbs = new Set<(s: WsStatus) => void>()
  private wantConnection = false // нужно ли соединение прямо сейчас (false после намеренного disconnect)

  getStatus() { return this.status }
  onStatus(cb: (s: WsStatus) => void): () => void {
    this.statusCbs.add(cb)
    cb(this.status)
    return () => { this.statusCbs.delete(cb) }
  }
  private setStatus(s: WsStatus) {
    if (s === this.status) return
    this.status = s
    this.statusCbs.forEach((c) => c(s))
  }

  connect(token: string) {
    if (MOCK) { this.setStatus('online'); return }
    this.wantConnection = true
    this.teardownClient()
    this.setStatus('connecting')
    this.client = new Client({
      brokerURL: WS_URL,
      connectHeaders: { Authorization: `Bearer ${token}` },
      reconnectDelay: 3000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        this.setStatus('online')
        this.specs.forEach((s) => this.subscribeSpec(s))
      },
      // статус 'connecting' — только пока соединение реально нужно; иначе после намеренного
      // disconnect() (логаут) баннер «Переподключение…» залипал бы навсегда на экране логина
      onWebSocketClose: () => { if (this.wantConnection) this.setStatus('connecting') },
      onStompError: () => { if (this.wantConnection) this.setStatus('connecting') },
    })
    this.client.activate()
  }

  private subscribeSpec(s: Spec) {
    if (!this.client?.connected) return
    try { s.sub?.unsubscribe() } catch { /* */ } // не плодим дубли (StrictMode/реконнект)
    s.sub = this.client.subscribe(s.topic, (m: IMessage) => {
      try { s.cb(JSON.parse(m.body)) } catch { /* ignore */ }
    })
  }

  private subscribeTopic(topic: string, cb: (body: any) => void): () => void {
    if (MOCK) return () => {}
    const s: Spec = { topic, cb, sub: null }
    this.specs.add(s)
    this.subscribeSpec(s)
    return () => { s.sub?.unsubscribe(); this.specs.delete(s) }
  }

  /** Сообщения канала: /topic/channel.{id} */
  onChannel(channelId: string, cb: (e: WsEvent) => void): () => void {
    return this.subscribeTopic(`/topic/channel.${channelId}`, cb as (b: any) => void)
  }
  /** События рангов сервера: /topic/server.{id}.rank (RANK_UP) */
  onServerRank(serverId: string, cb: (e: RankEvent) => void): () => void {
    return this.subscribeTopic(`/topic/server.${serverId}.rank`, cb as (b: any) => void)
  }
  /** «Кворум» сервера: /topic/server.{id}.quorum (рекорд людей в войсе → тост/эффект) */
  onServerQuorum(serverId: string, cb: (e: QuorumEvent) => void): () => void {
    return this.subscribeTopic(`/topic/server.${serverId}.quorum`, cb as (b: any) => void)
  }
  /** Ачивки сервера: /topic/server.{id}.achievement (открытие ачивки → тост) */
  onServerAchievement(serverId: string, cb: (e: AchievementEvent) => void): () => void {
    return this.subscribeTopic(`/topic/server.${serverId}.achievement`, cb as (b: any) => void)
  }
  /** Авто-AFK сервера: /topic/server.{id}.afk (сигнал «уйди в AFK-канал») */
  onServerAfk(serverId: string, cb: (e: AfkEvent) => void): () => void {
    return this.subscribeTopic(`/topic/server.${serverId}.afk`, cb as (b: any) => void)
  }
  typing(channelId: string) {
    if (MOCK || !this.client?.connected) return
    this.client.publish({ destination: `/app/channel.${channelId}.typing`, body: '{}' })
  }

  /** Watch-party: подписка на /topic/watch.{id} */
  onWatch(channelId: string, cb: (s: WatchState) => void): () => void {
    return this.subscribeTopic(`/topic/watch.${channelId}`, cb as (b: any) => void)
  }
  sendWatchControl(channelId: string, action: WatchAction, positionSeconds: number) {
    if (MOCK || !this.client?.connected) return
    this.client.publish({ destination: `/app/watch.${channelId}.control`, body: JSON.stringify({ action, positionSeconds }) })
  }

  /**
   * Личные ошибки WS-обработчиков: /user/queue/errors (бэк — WsExceptionHandler + @SendToUser).
   * Сюда приходят отказы на watch-control/typing/heartbeat — без подписки 403 «нет прав на управление
   * просмотром» терялся молча: кнопка просто ничего не делала. Адрес — StompDestinations.USER_ERRORS.
   */
  onError(cb: (e: WsErrorEvent) => void): () => void {
    return this.subscribeTopic('/user/queue/errors', cb as (b: any) => void)
  }

  /** Presence КОНКРЕТНОГО сервера: /topic/server.{id}.presence (изоляция между серверами). */
  onServerPresence(serverId: string, cb: (e: any) => void): () => void {
    return this.subscribeTopic(`/topic/server.${serverId}.presence`, cb)
  }
  /** Heartbeat присутствия. status (online|idle|dnd) опционален — без него только продление онлайна. */
  heartbeat(status?: string) {
    if (MOCK || !this.client?.connected) return
    this.client.publish({ destination: '/app/presence.heartbeat', body: JSON.stringify(status ? { status } : {}) })
  }

  private teardownClient() {
    this.specs.forEach((s) => { s.sub = null })
    this.client?.deactivate()
    this.client = null
  }

  disconnect() {
    this.wantConnection = false
    this.specs.clear()
    this.client?.deactivate()
    this.client = null
    this.setStatus('online') // соединение больше не нужно — прячем баннер реконнекта
  }
}

export const ws = new Ws()
