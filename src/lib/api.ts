// Фасад HTTP-API: единственная точка входа для приложения (`import { api } from '@/lib/api'`).
// Реализации живут в доменных модулях `src/lib/api/*` — здесь только сборка плоского объекта
// (имена и сигнатуры методов менять нельзя: их зовут десятки компонентов) и ре-экспорт типов.
import { achievementsApi } from './api/achievements'
import { adminApi } from './api/admin'
import { authApi } from './api/auth'
import { channelsApi } from './api/channels'
import { digestApi } from './api/digest'
import { dmApi } from './api/dm'
import { mediaApi } from './api/media'
import { membersApi } from './api/members'
import { messagesApi } from './api/messages'
import { museumApi } from './api/museum'
import { presenceApi } from './api/presence'
import { ranksApi } from './api/ranks'
import { readStatesApi } from './api/readStates'
import { rolesApi } from './api/roles'
import { serversApi } from './api/servers'
import { soundboardApi } from './api/soundboard'
import { usersApi } from './api/users'
import { voiceApi } from './api/voice'
import { watchApi } from './api/watch'

// типы, которые компоненты импортируют из '@/lib/api'
export type { AuthResult } from './api/auth'
export type { ServerTree } from './api/servers'
export type { SoundClip } from './api/soundboard'

export const api = {
  ...authApi,          // вход, регистрация, сброс пароля
  ...usersApi,         // профиль и настройки аккаунта
  ...serversApi,       // серверы, инвайты, дерево каналов
  ...channelsApi,      // каналы и уведомления по ним
  ...dmApi,            // личные сообщения
  ...membersApi,       // участники сервера
  ...rolesApi,         // роли и доступ к каналам
  ...messagesApi,      // лента, поиск, пины, реакции
  ...mediaApi,         // presign + загрузка вложений
  ...readStatesApi,    // непрочитанное
  ...presenceApi,      // онлайн/голос
  ...voiceApi,         // LiveKit, время в войсе, авто-AFK
  ...soundboardApi,    // саундпад
  ...watchApi,         // совместный просмотр
  ...ranksApi,         // ранги и косметика
  ...achievementsApi,  // ачивки
  ...museumApi,        // музей цитат
  ...digestApi,        // дайджест «Чажленд Wrapped»
  ...adminApi,         // аудит и админ-действия
}
