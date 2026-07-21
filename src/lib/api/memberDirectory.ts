import type { Member } from '../types'

/**
 * Справочник участников — модульный кэш для резолва авторов сообщений и записей аудита.
 *
 * КТО НАПОЛНЯЕТ: единственный писатель — `api.members()` (см. api/members.ts):
 *  - в живом режиме полностью ЗАМЕНЯЕТ содержимое (`replaceAll`) списком участников сервера;
 *  - в mock-режиме ДОБАВЛЯЕТ моковых участников (`putAll`), не очищая справочник.
 *
 * КОГДА НАПОЛНЯЕТСЯ: при загрузке экрана сервера, а также лениво — методы, которым нужны имена
 * авторов (messages/olderMessages/contextMessages/searchMessages/pins/audit), сами вызывают
 * `ensureMembersLoaded()` при пустом справочнике. Момент наполнения менять НЕЛЬЗЯ: пока справочник
 * пуст, `mapMessage` подставляет вместо имени автора его id — то есть от этого зависит то,
 * что видит пользователь в ленте.
 *
 * `meId` пишется в `api.me()` и нужен, чтобы пометить «мои» реакции (`mine`).
 */
const memberMap = new Map<string, Member>()
let meId = ''

/** id текущего пользователя (пустая строка, пока `api.me()` не отработал). */
export const getMeId = () => meId
/** Запоминает id текущего пользователя. Вызывается только из `api.me()`. */
export const setMeId = (id: string) => { meId = id }

export const getMember = (id: string) => memberMap.get(id)
/** Имя участника по id; если участник неизвестен — сам id (как и было исторически). */
export const resolveName = (id: string) => memberMap.get(id)?.username ?? id
/** Справочник ещё ни разу не наполнялся — вызывающему стоит дёрнуть `ensureMembersLoaded()`. */
export const isDirectoryEmpty = () => memberMap.size === 0

/** Полная замена справочника (живой режим): состав сервера — источник истины. */
export function replaceAll(members: Member[]) {
  memberMap.clear()
  members.forEach((m) => memberMap.set(m.userId, m))
}
/** Долив без очистки (mock-режим). */
export function putAll(members: Member[]) {
  members.forEach((m) => memberMap.set(m.userId, m))
}
