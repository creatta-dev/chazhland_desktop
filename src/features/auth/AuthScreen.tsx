import { useState } from 'react'
import { Eye, EyeOff, AlertTriangle, Check } from 'lucide-react'
import { useAuth } from '@/store/auth'
import { api } from '@/lib/api'
import { HttpError } from '@/lib/http'
import { Spinner } from '@/components/ui'

function serverMessage(e: HttpError): string | null {
  try {
    const j = JSON.parse(e.body)
    if (j?.fieldErrors && typeof j.fieldErrors === 'object') {
      const parts = Object.entries(j.fieldErrors).map(([f, m]) => `${f}: ${m}`)
      if (parts.length) return parts.join('; ') // показываем, какое поле не прошло валидацию
    }
    return typeof j?.message === 'string' ? j.message : null
  } catch { return null }
}
function errMsg(e: unknown, fallback: string): string {
  if (e instanceof HttpError) {
    if (e.status === 429) return 'Слишком много попыток — подождите ~минуту'
    const sm = serverMessage(e) // реальное сообщение бэка вместо догадок
    if (e.status === 409) return sm || 'Имя пользователя или e-mail уже заняты'
    if (e.status === 400 || e.status === 401) return sm || fallback
    return sm || `Ошибка сервера (${e.status})`
  }
  return 'Не удалось связаться с сервером — проверьте сеть/консоль (DevTools)'
}

type Screen = 'login' | 'register' | 'reset'

export function AuthScreen() {
  const { login, register } = useAuth()
  const [screen, setScreen] = useState<Screen>('login')
  const [loading, setLoading] = useState(false)
  const [busyCode, setBusyCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [showPw, setShowPw] = useState(false)

  // login
  const [loginField, setLoginField] = useState('')
  const [pw, setPw] = useState('')
  // register
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  // reset
  const [zEmail, setZEmail] = useState('')
  const [zCode, setZCode] = useState('')
  const [zPw, setZPw] = useState('')

  function go(s: Screen) { setScreen(s); setError(null); setInfo(null) }

  async function submitLogin(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null)
    try { await login(loginField, pw) }
    catch (err) { setError(errMsg(err, 'Неверные данные. Проверьте логин и пароль.')) }
    finally { setLoading(false) }
  }

  async function sendCode(forEmail: string, kind: 'register' | 'reset') {
    if (!forEmail.trim()) { setError('Укажите e-mail'); return }
    setBusyCode(true); setError(null); setInfo(null)
    try {
      if (kind === 'register') await api.requestEmailCode(forEmail)
      else await api.requestPasswordReset(forEmail)
      setInfo(`Код отправлен на ${forEmail.trim()} (действует 15 минут)`)
    } catch (err) { setError(errMsg(err, 'Не удалось отправить код')) }
    finally { setBusyCode(false) }
  }

  async function submitRegister(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null)
    try { await register({ email, code, username, password: pw }) }
    catch (err) { setError(errMsg(err, 'Неверный или просроченный код')) }
    finally { setLoading(false) }
  }

  async function submitReset(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null)
    try {
      await api.confirmPasswordReset({ email: zEmail, code: zCode, newPassword: zPw })
      go('login'); setInfo('Пароль изменён — войдите с новым паролем')
    } catch (err) { setError(errMsg(err, 'Неверный или просроченный код')) }
    finally { setLoading(false) }
  }

  return (
    <div style={wrap}>
      <Blob style={{ top: -60, left: '8%', background: 'radial-gradient(circle,var(--accent-tint),transparent 70%)' }} />
      <Blob style={{ bottom: -50, right: '10%', background: 'radial-gradient(circle,rgba(124,92,255,.12),transparent 70%)' }} />

      {screen === 'login' && (
        <form onSubmit={submitLogin} style={card(420)}>
          <Head title="С возвращением" sub="Войдите, чтобы продолжить" />
          <Panel>
            <label style={lbl}>Имя пользователя или e-mail</label>
            <div className="field" style={fieldS}><span style={{ color: 'var(--text-3)' }}>@</span><input value={loginField} onChange={(e) => setLoginField(e.target.value)} placeholder="you@chazhland · или ник" autoFocus /></div>
            <label style={lbl}>Пароль</label>
            <div className="field" style={fieldS}><input type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /><span onClick={() => setShowPw((v) => !v)} style={eye}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</span></div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', margin: '6px 0 14px' }}>
              <span onClick={() => go('reset')} style={link}>Забыли пароль?</span>
            </div>
            {info && <InfoBox text={info} />}
            {error && <ErrorBox text={error} />}
            <button type="submit" disabled={loading} className="accent-btn" style={btn}>{loading && <Spinner />}{loading ? 'Вход…' : 'Войти'}</button>
            <Switch text="Нет аккаунта?" action="Создать" onClick={() => go('register')} />
          </Panel>
        </form>
      )}

      {screen === 'register' && (
        <form onSubmit={submitRegister} style={card(440)}>
          <Head title="Создать аккаунт" sub="Регистрация открыта — подтвердите e-mail кодом" />
          <Panel>
            <label style={lbl}>E-mail</label>
            <div style={{ display: 'flex', gap: 8, margin: '7px 0 11px' }}>
              <div className="field" style={{ ...fieldS, flex: 1, margin: 0 }}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoFocus /></div>
              <button type="button" disabled={busyCode} onClick={() => sendCode(email, 'register')} className="pill no-drag" style={{ padding: '0 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{busyCode ? '…' : 'Получить код'}</button>
            </div>
            <label style={lbl}>Код из письма</label>
            <div className="field" style={{ ...fieldS, fontFamily: 'ui-monospace,monospace' }}><input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" style={{ letterSpacing: '.3em' }} /></div>
            <label style={lbl}>Имя пользователя</label>
            <div className="field" style={fieldS}><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ваш ник" /></div>
            <div style={{ fontSize: 11.5, color: 'var(--text-3)', margin: '-4px 0 9px 2px' }}>2–32 символа</div>
            <label style={lbl}>Пароль</label>
            <div className="field" style={fieldS}><input type={showPw ? 'text' : 'password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" /><span onClick={() => setShowPw((v) => !v)} style={eye}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</span></div>
            <Strength pw={pw} />
            {info && <InfoBox text={info} />}
            {error && <ErrorBox text={error} />}
            <button type="submit" disabled={loading || !email || code.length !== 6 || username.trim().length < 2 || pw.length < 8} className="accent-btn" style={{ ...btn, opacity: (!email || code.length !== 6 || username.trim().length < 2 || pw.length < 8) ? 0.55 : 1 }}>{loading && <Spinner />}{loading ? 'Создаём…' : 'Создать аккаунт'}</button>
            <Switch text="Уже есть аккаунт?" action="Войти" onClick={() => go('login')} />
          </Panel>
        </form>
      )}

      {screen === 'reset' && (
        <form onSubmit={submitReset} style={card(420)}>
          <Head title="Сброс пароля" sub="Код придёт на e-mail аккаунта" />
          <Panel>
            <label style={lbl}>E-mail</label>
            <div style={{ display: 'flex', gap: 8, margin: '7px 0 11px' }}>
              <div className="field" style={{ ...fieldS, flex: 1, margin: 0 }}><input type="email" value={zEmail} onChange={(e) => setZEmail(e.target.value)} placeholder="you@example.com" autoFocus /></div>
              <button type="button" disabled={busyCode} onClick={() => sendCode(zEmail, 'reset')} className="pill no-drag" style={{ padding: '0 14px', fontWeight: 600, whiteSpace: 'nowrap' }}>{busyCode ? '…' : 'Получить код'}</button>
            </div>
            <label style={lbl}>Код из письма</label>
            <div className="field" style={{ ...fieldS, fontFamily: 'ui-monospace,monospace' }}><input value={zCode} onChange={(e) => setZCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" inputMode="numeric" style={{ letterSpacing: '.3em' }} /></div>
            <label style={lbl}>Новый пароль</label>
            <div className="field" style={fieldS}><input type={showPw ? 'text' : 'password'} value={zPw} onChange={(e) => setZPw(e.target.value)} placeholder="••••••••" /><span onClick={() => setShowPw((v) => !v)} style={eye}>{showPw ? <EyeOff size={16} /> : <Eye size={16} />}</span></div>
            <Strength pw={zPw} />
            {info && <InfoBox text={info} />}
            {error && <ErrorBox text={error} />}
            <button type="submit" disabled={loading || !zEmail || zCode.length !== 6 || zPw.length < 8} className="accent-btn" style={{ ...btn, opacity: (!zEmail || zCode.length !== 6 || zPw.length < 8) ? 0.55 : 1 }}>{loading && <Spinner />}{loading ? 'Сохраняем…' : 'Сменить пароль'}</button>
            <Switch text="Вспомнили?" action="Войти" onClick={() => go('login')} />
          </Panel>
        </form>
      )}
    </div>
  )
}

const wrap: React.CSSProperties = { position: 'relative', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '30px 20px', background: 'var(--win)' }
const card = (w: number): React.CSSProperties => ({ width: w, maxWidth: '100%', position: 'relative', animation: 'mdIn .4s cubic-bezier(.22,.61,.36,1)' })
const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }
const fieldS: React.CSSProperties = { padding: '12px 14px', margin: '7px 0 12px' }
const btn: React.CSSProperties = { width: '100%', borderRadius: 13, padding: 14, fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, boxShadow: '0 8px 20px var(--accent-tint)' }
const link: React.CSSProperties = { fontSize: 13, color: 'var(--accent)', fontWeight: 600, cursor: 'pointer' }
const eye: React.CSSProperties = { cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-3)' }

function Blob({ style }: { style: React.CSSProperties }) {
  return <div style={{ position: 'absolute', width: 230, height: 230, borderRadius: '50%', pointerEvents: 'none', ...style }} />
}
function Head({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 18 }}>
      <div style={{ width: 58, height: 58, borderRadius: 18, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 26, margin: '0 auto 11px', boxShadow: '0 10px 26px var(--accent-tint)' }}>ch</div>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em' }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>{sub}</div>
    </div>
  )
}
function Panel({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 18, padding: 24, boxShadow: '0 14px 40px -22px var(--shadow)' }}>{children}</div>
}
function Switch({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13.5, color: 'var(--text-2)' }}>{text} <span onClick={onClick} style={link}>{action}</span></div>
}
function Strength({ pw }: { pw: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '0 0 14px' }}>
      <div style={{ flex: 1, display: 'flex', gap: 5 }}>
        {[0, 1, 2, 3].map((i) => <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: pw.length > i * 3 ? (i < 2 ? 'var(--green)' : i < 3 ? 'var(--idle)' : 'var(--green)') : 'var(--surface-3)' }} />)}
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>8–100</span>
    </div>
  )
}
function ErrorBox({ text }: { text: string }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.35)', borderRadius: 12, padding: '11px 13px', marginBottom: 14, fontSize: 13, color: 'var(--danger)', fontWeight: 500 }}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />{text}</div>
}
function InfoBox({ text }: { text: string }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, background: 'var(--green-tint)', border: '1px solid rgba(47,170,106,.35)', borderRadius: 12, padding: '11px 13px', marginBottom: 14, fontSize: 13, color: 'var(--green)', fontWeight: 500 }}><Check size={16} style={{ flexShrink: 0, marginTop: 1 }} />{text}</div>
}
