import type { Presence } from './types'

/** Статус присутствия — тот же союз, что и в модели (алиас, чтобы подписи не разъехались с типом). */
export type PresenceStatus = Presence

/**
 * Единые подписи статусов. Раньше словарь жил четырьмя копиями (AdminScreen/BottomBar/Message/
 * MembersRail) под четырьмя именами и уже разошёлся: «отошёл» против «Не активен», «оффлайн»
 * против «не в сети». Канон — вариант из меню выбора статуса (регистр предложения, короткие
 * формулировки), он же читается и как подпись под ником.
 */
export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  online: 'В сети',
  idle: 'Отошёл',
  dnd: 'Не беспокоить',
  offline: 'Не в сети',
}

/**
 * Точка-индикатор для мест, где статус рисуется текстом, а не цветным кружком (список участников
 * в админке). Цвет берётся отдельно — presenceColor() из components/Avatar.
 */
export const PRESENCE_DOT: Record<PresenceStatus, string> = {
  online: '●',
  idle: '●',
  dnd: '●',
  offline: '○',
}
