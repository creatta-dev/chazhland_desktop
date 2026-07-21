// Всё env-driven (12-factor). MOCK по умолчанию ВЫКЛЮЧЕН — приложение идёт в живой бэк.
const env = import.meta.env

export const API_BASE: string = (env.VITE_API_BASE as string) || 'http://localhost:8080'
export const WS_URL: string =
  (env.VITE_WS_URL as string) || API_BASE.replace(/^http/, 'ws') + '/ws'

/**
 * mock-режим: данные берутся из src/mocks. Включить — VITE_MOCK=true (для UI-разработки без бэка).
 * Проверка строго на 'true': отсутствие переменной или опечатка НЕ должны уводить сборку в моки —
 * именно так прод-сборки однажды ушли в MOCK (см. комментарий в .env.production).
 */
export const MOCK: boolean = (env.VITE_MOCK as string) === 'true'
