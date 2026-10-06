import { useEffect, useMemo, useState } from 'react'
import { Users, UserPlus, Check, X, MessageSquare, UserMinus } from 'lucide-react'
import { friends } from '@/lib/friends'
import { Avatar, presenceColor } from '@/components/Avatar'
import { PRESENCE_DOT, PRESENCE_LABEL } from '@/lib/presenceLabels'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { ConfirmModal } from '@/features/admin/modals'
import type { Friend } from '@/lib/types'

type Tab = 'online' | 'all' | 'pending' | 'add'

// Раздел «Друзья» (как в Discord): Онлайн / Все / Ожидают / Добавить. Личные сообщения доступны ТОЛЬКО
// друзьям, поэтому отсюда же — «Написать». Статусы друзей без общего сервера по WS не приходят, поэтому
// пока раздел открыт, список освежается раз в 30 с (плюс мгновенно — по сигналам заявок).
export function FriendsView({ onOpenDm }: { onOpenDm: (userId: string) => void }) {
  const [, setTick] = useState(0)
  useEffect(() => friends.subscribe(() => setTick((t) => t + 1)), [])
  useEffect(() => {
    void friends.refresh()
    const t = window.setInterval(() => void friends.refresh(), 30000)
    return () => window.clearInterval(t)
  }, [])

  const list = friends.get()
  const [tab, setTab] = useState<Tab>(() => {
    const l = friends.get()
    if (l.incoming.length) return 'pending'
    if (!l.friends.length && !l.outgoing.length) return 'add'
    return 'online'
  })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [removeT, setRemoveT] = useState<Friend | null>(null)

  const online = useMemo(() => list.friends.filter((f) => f.status !== 'offline'), [list])
  const pendingCount = list.incoming.length + list.outgoing.length

  async function act(userId: string, fn: () => Promise<void>, ok: string | null, fail: string) {
    setBusyId(userId)
    try { await fn(); if (ok) toast.ok(ok) } catch (e) { toast.error(apiError(e, fail)) } finally { setBusyId(null) }
  }

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'online', label: 'В сети' },
    { key: 'all', label: 'Все' },
    { key: 'pending', label: 'Ожидают', badge: list.incoming.length },
  ]

  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)', animation: 'fadeIn .26s ease' }}>
      <div style={{ height: 62, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-tint)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Users size={18} /></div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>Друзья</div>
        <div style={{ display: 'flex', gap: 4, marginLeft: 10 }}>
          {tabs.map((t) => (
            <button key={t.key} className={'seg-btn no-drag' + (tab === t.key ? ' on' : '')} onClick={() => setTab(t.key)} style={{ fontSize: 13, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {t.label}
              {!!t.badge && <span style={{ background: 'var(--danger)', color: '#fff', borderRadius: 20, fontSize: 10.5, fontWeight: 700, padding: '0 6px', minWidth: 16, textAlign: 'center' }}>{t.badge}</span>}
            </button>
          ))}
        </div>
        <button onClick={() => setTab('add')} className={tab === 'add' ? 'pill no-drag' : 'accent-btn no-drag'} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 7, borderRadius: 11, padding: '8px 14px', fontWeight: 700, fontSize: 13 }}>
          <UserPlus size={15} /> Добавить в друзья
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '22px 26px' }}>
        {tab === 'add' && <AddFriend onAdded={() => setTab(friends.get().incoming.length ? 'pending' : 'all')} />}

        {tab === 'online' && (
          <Section title={`В сети — ${online.length}`} empty={!friends.loaded ? 'Загрузка…' : list.friends.length ? 'Никого из друзей нет в сети' : 'Друзей пока нет — добавьте кого-нибудь по нику'}>
            {online.map((f) => <FriendRow key={f.userId} f={f} busy={busyId === f.userId} actions={friendActions(f)} />)}
          </Section>
        )}

        {tab === 'all' && (
          <Section title={`Все друзья — ${list.friends.length}`} empty={!friends.loaded ? 'Загрузка…' : 'Друзей пока нет — добавьте кого-нибудь по нику'}>
            {list.friends.map((f) => <FriendRow key={f.userId} f={f} busy={busyId === f.userId} actions={friendActions(f)} />)}
          </Section>
        )}

        {tab === 'pending' && (
          <>
            <Section title={`Входящие — ${list.incoming.length}`} empty={pendingCount ? 'Входящих заявок нет' : 'Заявок нет'}>
              {list.incoming.map((f) => (
                <FriendRow key={f.userId} f={f} busy={busyId === f.userId} subtitle="хочет добавить вас в друзья" actions={[
                  { title: 'Принять', icon: <Check size={16} />, tone: 'green', onClick: () => act(f.userId, () => friends.accept(f.userId), `${f.username} теперь у вас в друзьях`, 'Не удалось принять заявку') },
                  { title: 'Отклонить', icon: <X size={16} />, tone: 'danger', onClick: () => act(f.userId, () => friends.remove(f.userId), null, 'Не удалось отклонить заявку') },
                ]} />
              ))}
            </Section>
            {list.outgoing.length > 0 && (
              <Section title={`Исходящие — ${list.outgoing.length}`}>
                {list.outgoing.map((f) => (
                  <FriendRow key={f.userId} f={f} busy={busyId === f.userId} subtitle="заявка отправлена" actions={[
                    { title: 'Отменить заявку', icon: <X size={16} />, tone: 'danger', onClick: () => act(f.userId, () => friends.remove(f.userId), 'Заявка отменена', 'Не удалось отменить заявку') },
                  ]} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {removeT && (
        <ConfirmModal title="Удалить из друзей" danger confirmLabel="Удалить" busy={busyId === removeT.userId}
          message={`Удалить ${removeT.username} из друзей? Писать друг другу в личные будет нельзя, но история переписки сохранится.`}
          onConfirm={async () => { const f = removeT; await act(f.userId, () => friends.remove(f.userId), `${f.username} удалён из друзей`, 'Не удалось удалить из друзей'); setRemoveT(null) }}
          onClose={() => setRemoveT(null)} />
      )}
    </div>
  )

  function friendActions(f: Friend): RowAction[] {
    return [
      { title: 'Написать', icon: <MessageSquare size={16} />, tone: 'accent', onClick: () => onOpenDm(f.userId) },
      { title: 'Удалить из друзей', icon: <UserMinus size={16} />, tone: 'danger', onClick: () => setRemoveT(f) },
    ]
  }
}

function AddFriend({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      await friends.request(n)
      const nowFriend = friends.get().friends.some((f) => f.username.toLowerCase() === n.toLowerCase())
      toast.ok(nowFriend ? `Вы теперь друзья с ${n}` : `Заявка отправлена: ${n}`) // встречная заявка — сразу друзья
      setName('')
      onAdded()
    } catch (e) { toast.error(apiError(e, 'Не удалось отправить заявку')) } finally { setBusy(false) }
  }
  return (
    <div style={{ maxWidth: 620 }}>
      <div style={{ fontWeight: 800, fontSize: 18 }}>Добавить в друзья</div>
      <div style={{ fontSize: 13.5, color: 'var(--text-3)', marginTop: 6 }}>Введите ник пользователя. Личные сообщения доступны только друзьям — после принятия заявки сможете переписываться.</div>
      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 6px 6px 14px', marginTop: 14 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ник, например vasya" maxLength={32} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} style={{ flex: 1, minWidth: 0 }} />
        <button className="accent-btn no-drag" disabled={busy || !name.trim()} onClick={submit} style={{ borderRadius: 10, padding: '9px 16px', fontWeight: 700, fontSize: 13.5, opacity: busy || !name.trim() ? 0.5 : 1 }}>
          {busy ? 'Отправляем…' : 'Отправить заявку'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, empty, children }: { title: string; empty?: string; children?: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : []
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 8 }}>{title}</div>
      {items.length === 0 && empty ? <div style={{ color: 'var(--text-3)', fontSize: 13.5, padding: '14px 2px' }}>{empty}</div> : children}
    </div>
  )
}

interface RowAction { title: string; icon: React.ReactNode; tone: 'accent' | 'green' | 'danger'; onClick: () => void }
const TONE: Record<RowAction['tone'], string> = { accent: 'var(--accent)', green: 'var(--green)', danger: 'var(--danger)' }

function FriendRow({ f, busy, subtitle, actions }: { f: Friend; busy: boolean; subtitle?: string; actions: RowAction[] }) {
  return (
    <div className="member-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 12, borderTop: '1px solid var(--surface-2)', opacity: busy ? 0.6 : 1 }}>
      <Avatar name={f.username} src={f.avatarUrl} size={38} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.username}</div>
        <div style={{ fontSize: 12.5, color: subtitle ? 'var(--text-3)' : presenceColor(f.status) }}>
          {subtitle ?? `${PRESENCE_DOT[f.status]} ${PRESENCE_LABEL[f.status]}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
        {actions.map((a) => (
          <button key={a.title} title={a.title} disabled={busy} onClick={a.onClick} className="ib no-drag"
            style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--surface-2)', color: TONE[a.tone] }}>
            {a.icon}
          </button>
        ))}
      </div>
    </div>
  )
}
