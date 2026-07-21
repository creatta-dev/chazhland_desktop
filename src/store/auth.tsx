import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from '@/lib/api'
import { MOCK } from '@/lib/config'
import { setTokens, setOnAuthFail, setOnTokenRefresh, getAccessToken } from '@/lib/http'
import { ws } from '@/lib/ws'
import { voice } from '@/lib/voice'
import type { User } from '@/lib/types'

interface Session { user: User; token: string }

interface AuthCtx {
  session: Session | null
  loading: boolean
  login: (login: string, password: string) => Promise<void>
  register: (p: { email: string; code: string; username: string; password: string }) => Promise<void>
  updateUser: (patch: Partial<User>) => void
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)
const LS_REFRESH = 'chazh.refresh'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(false)

  function clear() {
    localStorage.removeItem(LS_REFRESH)
    setTokens(null, null)
    voice.leave() // освобождаем микрофон/соединение голоса
    ws.disconnect()
    setSession(null)
  }

  useEffect(() => {
    setOnAuthFail(clear) // 401 после неудачного refresh (reuse-detection/кик/смена пароля) → принудительный logout
    setOnTokenRefresh((access) => ws.connect(access)) // после ротации токена — переподключить WS свежим токеном
    const saved = localStorage.getItem(LS_REFRESH)
    if (!saved) return
    setLoading(true)
    setTokens(null, saved) // нет access — первый /users/me словит 401 и обновится по refresh
    api.me()
      .then((user) => {
        const access = getAccessToken()
        if (access) { setSession({ user, token: access }); ws.connect(access); return }
        // нет access после /users/me: в mock бэка нет (токен номинальный); в реальном режиме
        // refresh-токен НЕ годится ни как access, ни как WS-токен → без access работать нельзя.
        if (MOCK) { setSession({ user, token: saved }); return }
        clear()
      })
      .catch(() => clear())
      .finally(() => setLoading(false))
  }, [])

  function apply(access: string, refresh: string, user: User) {
    localStorage.setItem(LS_REFRESH, refresh)
    setTokens(access, refresh)
    setSession({ user, token: access })
    ws.connect(access)
  }

  const value: AuthCtx = {
    session,
    loading,
    async login(login, password) {
      const { token, user } = await api.login(login, password)
      apply(token.accessToken, token.refreshToken, user)
    },
    async register(p) {
      const { token, user } = await api.register(p)
      apply(token.accessToken, token.refreshToken, user)
    },
    updateUser(patch) { setSession((s) => (s ? { ...s, user: { ...s.user, ...patch } } : s)) },
    logout: clear,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
