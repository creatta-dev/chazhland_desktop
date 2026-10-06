import { useEffect, useState } from 'react'
import { UserPlus, Check, X, Clock, UserCheck } from 'lucide-react'
import { friends } from '@/lib/friends'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'

// Кнопки дружбы с конкретным человеком — по текущему отношению: добавить / отменить заявку /
// принять-отклонить входящую / «в друзьях». Используются в профиле и на плашке закрытых ЛС.
export function FriendshipActions({ userId, username, showFriendBadge = true }: {
  userId: string
  username: string
  /** показывать ли бейдж «В друзьях», когда уже друзья (на плашке ЛС не нужен) */
  showFriendBadge?: boolean
}) {
  const [, setTick] = useState(0)
  useEffect(() => friends.subscribe(() => setTick((t) => t + 1)), [])
  const [busy, setBusy] = useState(false)
  const rel = friends.relation(userId)

  async function run(fn: () => Promise<void>, ok: string, fail: string) {
    setBusy(true)
    try { await fn(); toast.ok(ok) } catch (e) { toast.error(apiError(e, fail)) } finally { setBusy(false) }
  }

  if (rel === 'friend') {
    return showFriendBadge
      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--green)', fontWeight: 700, fontSize: 13.5 }}><UserCheck size={16} /> В друзьях</span>
      : null
  }
  if (rel === 'incoming') {
    return (
      <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="accent-btn no-drag" disabled={busy} onClick={() => run(() => friends.accept(userId), `${username} теперь у вас в друзьях`, 'Не удалось принять заявку')} style={btn(busy)}>
          <Check size={15} /> Принять заявку
        </button>
        <button className="pill no-drag" disabled={busy} onClick={() => run(() => friends.remove(userId), 'Заявка отклонена', 'Не удалось отклонить заявку')} style={btn(busy)}>
          <X size={15} /> Отклонить
        </button>
      </span>
    )
  }
  if (rel === 'outgoing') {
    return (
      <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-3)', fontWeight: 600, fontSize: 13.5 }}><Clock size={15} /> Заявка отправлена</span>
        <button className="pill no-drag" disabled={busy} onClick={() => run(() => friends.remove(userId), 'Заявка отменена', 'Не удалось отменить заявку')} style={btn(busy)}>
          Отменить
        </button>
      </span>
    )
  }
  return (
    <button className="accent-btn no-drag" disabled={busy} onClick={() => run(() => friends.request(username), `Заявка отправлена: ${username}`, 'Не удалось отправить заявку')} style={btn(busy)}>
      <UserPlus size={15} /> Добавить в друзья
    </button>
  )
}

function btn(busy: boolean): React.CSSProperties {
  return { display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 11, padding: '9px 15px', fontWeight: 700, fontSize: 13.5, opacity: busy ? 0.6 : 1 }
}
