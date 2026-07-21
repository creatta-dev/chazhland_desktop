import { API_BASE } from './config'

let accessToken: string | null = null
let refreshToken: string | null = null
let onAuthFail: (() => void) | null = null
let onTokenRefresh: ((access: string) => void) | null = null
let refreshing: Promise<RefreshResult> | null = null

// Исход ротации: ok — обновили; auth-failed — сервер отверг refresh (надо разлогинить);
// network-error — транзиентный сбой (сеть/не-JSON), сессию НЕ трогаем.
type RefreshResult = 'ok' | 'auth-failed' | 'network-error'

const LS_REFRESH = 'chazh.refresh'

export function setTokens(access: string | null, refresh: string | null) {
  accessToken = access
  refreshToken = refresh
}
export function getAccessToken() { return accessToken }
export function setOnAuthFail(cb: () => void) { onAuthFail = cb }
/** Вызывается после ротации access-токена — чтобы переподключить WS с свежим токеном. */
export function setOnTokenRefresh(cb: (access: string) => void) { onTokenRefresh = cb }

// Ротация refresh-токена. Single-flight: параллельные 401 не дёргают /auth/refresh повторно
// (иначе reuse-detection погасит все сессии — см. бриф).
async function doRefresh(): Promise<RefreshResult> {
  if (!refreshToken) return 'auth-failed'
  if (!refreshing) {
    const rt = refreshToken
    refreshing = fetch(API_BASE + '/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }),
    })
      .then(async (r): Promise<RefreshResult> => {
        if (!r.ok) return 'auth-failed' // сервер отверг refresh (401/403/…) — токен невалиден → разлогин
        const t = await r.json()
        // тело без валидных токенов — не пишем 'undefined' в localStorage и не шлём «Bearer undefined»
        if (typeof t?.accessToken !== 'string' || typeof t?.refreshToken !== 'string') return 'auth-failed'
        accessToken = t.accessToken
        refreshToken = t.refreshToken
        localStorage.setItem(LS_REFRESH, t.refreshToken) // refresh одноразовый — сразу заменяем
        onTokenRefresh?.(t.accessToken) // WS переподключается с новым токеном
        return 'ok'
      })
      .catch((): RefreshResult => 'network-error') // сеть упала / не-JSON — транзиентно, сессию не трогаем
      .finally(() => { refreshing = null })
  }
  return refreshing
}

export async function http<T>(path: string, opts: RequestInit = {}, _retried = false): Promise<T> {
  const res = await fetch(API_BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401 && !_retried) {
    const r = await doRefresh()
    if (r === 'ok') return http<T>(path, opts, true)
    if (r === 'auth-failed') { onAuthFail?.(); throw new HttpError(401, 'unauthorized') }
    throw new HttpError(0, 'refresh failed (network)') // транзиентно: НЕ разлогиниваем, отдаём ошибку наверх
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new HttpError(res.status, body)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export class HttpError extends Error {
  constructor(public status: number, public body: string) {
    super(`HTTP ${status}`)
  }
}

// Тело ошибки бэка (com.chazhland.messenger.config.ApiError):
// { status, message, timestamp, fieldErrors? } — fieldErrors есть только у 400 от @Valid.
interface ApiErrorBody { message?: unknown; fieldErrors?: unknown }

/**
 * Человеческий текст ошибки для тоста: реальное сообщение бэка вместо догадки вызывающего.
 * Приоритет — первая ошибка поля (у валидации message = «Validation failed», толку ноль),
 * затем message, затем fallback (не HttpError / пустое или не-JSON тело).
 */
export function apiError(e: unknown, fallback: string): string {
  if (!(e instanceof HttpError) || !e.body) return fallback
  let body: ApiErrorBody
  try { body = JSON.parse(e.body) as ApiErrorBody } catch { return fallback }
  const fe = body?.fieldErrors
  if (fe && typeof fe === 'object') {
    const first = Object.values(fe as Record<string, unknown>).find((v) => typeof v === 'string' && v.trim())
    if (typeof first === 'string') return first
  }
  return typeof body?.message === 'string' && body.message.trim() ? body.message : fallback
}

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))
