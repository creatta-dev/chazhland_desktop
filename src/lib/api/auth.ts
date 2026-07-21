import { MOCK } from '../config'
import { http, delay, setTokens } from '../http'
import type { TokenResponse, User } from '../types'
import { me } from './users'
import { MOCK_USER } from '@/mocks/data'

export interface AuthResult { token: TokenResponse; user: User }

const MOCK_TOKEN: TokenResponse = { accessToken: 'mock.access', refreshToken: 'mock.refresh', tokenType: 'Bearer', expiresIn: 900 }

export async function login(login: string, password: string): Promise<AuthResult> {
  if (MOCK) { await delay(450); if (!login.trim()) throw new Error('empty'); return { token: MOCK_TOKEN, user: MOCK_USER } }
  const token = await http<TokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ login, password }) })
  setTokens(token.accessToken, token.refreshToken) // иначе следующий /users/me уйдёт без Authorization → 401
  return { token, user: await me(token.accessToken) }
}

// Шаг 1 регистрации: код на e-mail (открытая регистрация, без инвайтов)
export async function requestEmailCode(email: string): Promise<void> {
  if (MOCK) { await delay(300); return }
  await http('/auth/email-code', { method: 'POST', body: JSON.stringify({ email }) })
}
// Шаг 2: e-mail + 6-значный код + ник + пароль
export async function register(p: { email: string; code: string; username: string; password: string }): Promise<AuthResult> {
  if (MOCK) { await delay(550); return { token: MOCK_TOKEN, user: { ...MOCK_USER, username: p.username } } }
  const token = await http<TokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(p) })
  setTokens(token.accessToken, token.refreshToken)
  return { token, user: await me() }
}

// Сброс пароля по коду на e-mail
export async function requestPasswordReset(email: string): Promise<void> {
  if (MOCK) { await delay(300); return }
  await http('/auth/password-reset/request', { method: 'POST', body: JSON.stringify({ email }) })
}
export async function confirmPasswordReset(p: { email: string; code: string; newPassword: string }): Promise<void> {
  if (MOCK) { await delay(300); return }
  await http('/auth/password-reset/confirm', { method: 'POST', body: JSON.stringify(p) })
}

export const authApi = { login, requestEmailCode, register, requestPasswordReset, confirmPasswordReset }
