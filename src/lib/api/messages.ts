import { MOCK } from '../config'
import { http, delay } from '../http'
import type { AttachmentInput, Message } from '../types'
import type { MessageDto, Page } from './dto'
import { getMeId, getMember, resolveName } from './memberDirectory'
import { ensureMembersLoaded } from './members'
import { MOCK_MESSAGES, MOCK_USER } from '@/mocks/data'

// Размеры страниц истории сообщений (бэк режет limit до 100 — MessageService.MAX_LIMIT).
const MESSAGE_PAGE = 50       // лента канала и подгрузка более старых
const CONTEXT_HALF_PAGE = 25  // окно вокруг цели: столько же старее + столько же новее
const SEARCH_PAGE = 30        // результаты поиска по каналу

// Имя/аватар автора берутся из справочника участников (api/memberDirectory) — он должен быть
// наполнен ДО маппинга, иначе вместо ника пользователь увидит id автора.
function mapMessage(d: MessageDto, idMap?: Map<string, MessageDto>): Message {
  const author = getMember(d.authorId)
  const reply = d.replyToId && idMap?.get(d.replyToId)
  const meId = getMeId()
  return {
    id: d.id, channelId: d.channelId, authorId: d.authorId, type: d.type,
    authorName: author?.username ?? d.authorId, authorAvatarUrl: author?.avatarUrl ?? null, authorRole: author?.role,
    content: d.content, deleted: d.deleted, editedAt: d.editedAt, pinnedAt: d.pinnedAt, createdAt: d.createdAt, replyToId: d.replyToId,
    replyPreview: reply ? { authorName: resolveName(reply.authorId), content: (reply.content ?? '').slice(0, 60) } : null,
    attachments: (d.attachments ?? []).map((a) => ({ objectKey: a.id, url: a.url, contentType: a.contentType, filename: a.filename, size: a.size, width: a.width, height: a.height, thumbnailUrl: a.thumbnailUrl })),
    reactions: (d.reactions ?? []).map((g) => ({ emoji: g.emoji, count: g.userIds.length, mine: g.userIds.includes(meId) })),
  }
}

export async function messages(channelId: string): Promise<Message[]> {
  if (MOCK) { await delay(200); return MOCK_MESSAGES[channelId] ?? [] }
  await ensureMembersLoaded()
  const page = await http<Page<MessageDto>>(`/channels/${channelId}/messages?limit=${MESSAGE_PAGE}`)
  const items = [...page.items].reverse() // бэк отдаёт newest-first → разворачиваем в хронологию
  const idMap = new Map(items.map((m) => [m.id, m]))
  return items.map((m) => mapMessage(m, idMap))
}

// подгрузка более старых сообщений (курсор before = id самого старого загруженного)
export async function olderMessages(channelId: string, beforeId: string): Promise<Message[]> {
  if (MOCK) { await delay(200); return [] }
  await ensureMembersLoaded()
  const page = await http<Page<MessageDto>>(`/channels/${channelId}/messages?before=${encodeURIComponent(beforeId)}&limit=${MESSAGE_PAGE}`)
  const items = [...page.items].reverse() // newest-first → хронология
  const idMap = new Map(items.map((m) => [m.id, m]))
  return items.map((m) => mapMessage(m, idMap))
}

// окно сообщений вокруг цели (для перехода из поиска/пинов): before(старее) + after(новее).
// Оба курсора ИСКЛЮЧАЮТ саму цель — её вставляем из готового результата поиска. ULID-id монотонны
// (лексикографически = хронологически).
export async function contextMessages(channelId: string, target: Message): Promise<{ messages: Message[]; hasOlder: boolean }> {
  if (MOCK) return { messages: [target], hasOlder: false }
  await ensureMembersLoaded()
  const [olderPage, newerPage] = await Promise.all([
    http<Page<MessageDto>>(`/channels/${channelId}/messages?before=${encodeURIComponent(target.id)}&limit=${CONTEXT_HALF_PAGE}`),
    http<Page<MessageDto>>(`/channels/${channelId}/messages?after=${encodeURIComponent(target.id)}&limit=${CONTEXT_HALF_PAGE}`),
  ])
  // Не полагаемся на порядок, в котором бэк отдаёт before/after: оставляем строго старее/новее цели,
  // отбрасываем дубли (пересечение страниц) и пересортировываем по id — одной сортировки достаточно
  // для верной хронологии, какой бы порядок ни вернул бэк.
  const older = olderPage.items.filter((m) => m.id < target.id)
  const newer = newerPage.items.filter((m) => m.id > target.id)
  const idMap = new Map([...older, ...newer].map((m) => [m.id, m]))
  const seen = new Set<string>([target.id])
  const windowed: Message[] = [target]
  for (const dto of [...older, ...newer]) {
    if (seen.has(dto.id)) continue
    seen.add(dto.id)
    windowed.push(mapMessage(dto, idMap))
  }
  windowed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  // достроить превью ответов на сообщения внутри окна, включая саму цель (её нет в DTO-idMap)
  const byId = new Map(windowed.map((m) => [m.id, m]))
  const result = windowed.map((m) => {
    if (!m.replyToId || m.replyPreview) return m
    const p = byId.get(m.replyToId)
    return p ? { ...m, replyPreview: { authorName: p.authorName, content: (p.content ?? '').slice(0, 60) } } : m
  })
  return { messages: result, hasOlder: olderPage.hasMore }
}

export async function sendMessage(channelId: string, content: string, replyToId?: string | null, attachments?: AttachmentInput[]): Promise<Message> {
  const clientMessageId = crypto.randomUUID()
  const atts = attachments?.length ? attachments : undefined
  if (MOCK) {
    await delay(120)
    return { id: 'tmp_' + clientMessageId, channelId, authorId: MOCK_USER.id, authorName: MOCK_USER.username, content,
      attachments: (atts ?? []).map((a) => ({ objectKey: a.objectKey, url: '', contentType: 'image/*', filename: a.filename, width: a.width, height: a.height })),
      reactions: [], replyToId: replyToId ?? null, createdAt: new Date().toISOString(), clientMessageId }
  }
  const dto = await http<MessageDto>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content, clientMessageId, replyToId: replyToId ?? null, ...(atts ? { attachments: atts } : {}) }) })
  return mapMessage(dto)
}

export async function editMessage(messageId: string, content: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }) })
}

// поиск по тексту в канале
export async function searchMessages(channelId: string, q: string): Promise<Message[]> {
  if (MOCK) { await delay(150); const s = q.toLowerCase(); return (MOCK_MESSAGES[channelId] ?? []).filter((m) => (m.content ?? '').toLowerCase().includes(s)) }
  await ensureMembersLoaded()
  const page = await http<Page<MessageDto>>(`/channels/${channelId}/messages/search?q=${encodeURIComponent(q)}&limit=${SEARCH_PAGE}`)
  return page.items.map((m) => mapMessage(m))
}
// закреплённые сообщения канала
export async function pins(channelId: string): Promise<Message[]> {
  if (MOCK) return []
  await ensureMembersLoaded()
  const list = await http<MessageDto[]>(`/channels/${channelId}/pins`)
  return list.map((m) => mapMessage(m))
}
export async function pin(messageId: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}/pin`, { method: 'PUT' })
}
export async function unpin(messageId: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}/pin`, { method: 'DELETE' })
}
export async function deleteMessage(messageId: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}`, { method: 'DELETE' })
}

/** маппинг входящего WS-события (raw MessageDto) → UI Message */
export function mapIncoming(raw: unknown): Message {
  return mapMessage(raw as MessageDto)
}

// ---- реакции ----
export async function addReaction(messageId: string, emoji: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) })
}
export async function removeReaction(messageId: string, emoji: string): Promise<void> {
  if (MOCK) return
  await http(`/messages/${messageId}/reactions?emoji=${encodeURIComponent(emoji)}`, { method: 'DELETE' })
}

export const messagesApi = {
  messages, olderMessages, contextMessages, sendMessage, editMessage,
  searchMessages, pins, pin, unpin, deleteMessage, mapIncoming,
  addReaction, removeReaction,
}
