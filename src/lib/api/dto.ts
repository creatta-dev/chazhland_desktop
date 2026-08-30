// Сырые DTO бэка (com.chazhland.messenger.web.dto) — внутренний слой api/*.
// Наружу (в компоненты) уходят только доменные типы из '@/lib/types'.
import type { Category, Channel, MessageType, Role } from '../types'

/** Конверт курсорной пагинации бэка. */
export interface Page<T> { items: T[]; nextCursor: string | null; hasMore: boolean }

export interface UserDto { id: string; username: string; avatarUrl: string | null; status?: string; statusMessage?: string | null; role?: Role }
// строка админ-панели «Пользователи»: email приходит только владельцу инсталляции, иначе null (ПДн)
export interface AdminUserDto { id: string; username: string; email: string | null; status: string; createdAt: string }
export interface MemberDto { userId: string; username: string; avatarUrl: string | null; role: Role; status: string; joinedAt: string; soundboardDisabled?: boolean; roleIds?: string[]; statusMessage?: string | null }
export interface ChannelDto { id: string; categoryId: string | null; name: string; type: Channel['type']; topic: string | null; position: number; userLimit: number | null; slowModeSeconds: number; lastMessageId: string | null; system?: boolean }
export interface TreeDto { serverId: string; categories: Category[]; channels: ChannelDto[] }
export interface AttachmentDto { id: string; url: string; contentType: string; size: number | null; filename: string | null; width: number | null; height: number | null; thumbnailUrl: string | null }
export interface ReactionGroupDto { emoji: string; userIds: string[] }
export interface MessageDto {
  id: string; channelId: string; authorId: string; content: string | null; replyToId: string | null
  type?: MessageType
  createdAt: string; editedAt: string | null; deleted: boolean; pinnedAt: string | null
  attachments: AttachmentDto[]; reactions: ReactionGroupDto[]
}
export interface AuditDto { id: string; actorId: string; action: string; targetType: string | null; targetId: string | null; metadata: unknown; createdAt: string }
export interface DmDto { channelId: string; otherUserId: string; otherUsername: string; otherAvatarUrl: string | null; lastMessageId: string | null }
