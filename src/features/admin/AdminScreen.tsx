import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronDown, Lock, Key, X, UserMinus, ArrowLeftRight, Plus, Volume2, Music, AlertTriangle, Copy, Link2, Check, LogOut, RotateCw } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { formatDateTime } from '@/lib/format'
import { PRESENCE_DOT, PRESENCE_LABEL } from '@/lib/presenceLabels'
import { Avatar, presenceColor } from '@/components/Avatar'
import { Skeleton } from '@/components/Skeleton'
import { Switch } from '@/components/ui'
import { ConfirmModal, ChangeRoleModal, TempPasswordModal } from './modals'
import { RolesTab } from './RolesTab'
import { ChannelAccessTab } from './ChannelAccessTab'
import type { AfkSettings, AuditEntry, InviteCreated, InviteSummary, Member, ServerSummary } from '@/lib/types'

type Tab = 'members' | 'roles' | 'channels' | 'invites' | 'server' | 'audit'
const TAB_LABEL: Record<Tab, string> = { members: 'Участники', roles: 'Роли', channels: 'Каналы', invites: 'Приглашения', server: 'Сервер', audit: 'Аудит' }

export function AdminScreen({ serverId, isHome, onClose, onRenamed, onLeft }: {
  serverId?: string
  isHome: boolean
  onClose: () => void
  onRenamed: (s: ServerSummary) => void
  onLeft: (serverId: string) => void
}) {
  const [tab, setTab] = useState<Tab>('members')
  // аудит и сброс пароля — операции уровня инсталляции (домашний сервер); на остальных серверах прячем
  const tabs: Tab[] = ['members', 'roles', 'channels', 'invites', 'server', ...(isHome ? (['audit'] as Tab[]) : [])]
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
      <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 12, padding: '0 22px', borderBottom: '1px solid var(--border)' }}>
        <button className="ib no-drag" onClick={onClose} title="Назад" style={{ width: 34, height: 30 }}><ChevronLeft size={18} /></button>
        <span style={{ fontWeight: 800, fontSize: 17 }}>Админка</span>
        <div style={{ marginLeft: 'auto', display: 'flex', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 11, padding: 3 }}>
          {tabs.map((t) => (
            <button key={t} className={'seg-btn no-drag' + (tab === t ? ' on' : '')} onClick={() => setTab(t)} style={{ fontSize: 13, padding: '6px 13px' }}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '26px 30px' }}>
        {tab === 'members' && <MembersTab serverId={serverId} isHome={isHome} />}
        {tab === 'roles' && <RolesTab serverId={serverId} />}
        {tab === 'channels' && <ChannelAccessTab serverId={serverId} />}
        {tab === 'invites' && <InvitesTab serverId={serverId} />}
        {tab === 'server' && <ServerTab serverId={serverId} onRenamed={onRenamed} onLeft={onLeft} />}
        {tab === 'audit' && isHome && <AuditTab />}
      </div>
    </div>
  )
}

function MembersTab({ serverId, isHome }: { serverId?: string; isHome: boolean }) {
  const [rows, setRows] = useState<Member[] | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null) // раньше промис был без .catch: unhandled rejection и вечная «Загрузка»
  const [kickT, setKickT] = useState<Member | null>(null)
  const [roleT, setRoleT] = useState<Member | null>(null)
  const [resetT, setResetT] = useState<Member | null>(null)
  const [tempPw, setTempPw] = useState<{ name: string; pw: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const load = useCallback(async () => {
    setLoadErr(null)
    try { setRows(await api.members(serverId)) }
    catch (e) { setLoadErr(apiError(e, 'Не удалось загрузить участников')) }
  }, [serverId])
  useEffect(() => {
    let a = true
    api.members(serverId)
      .then((r) => { if (a) setRows(r) })
      .catch((e) => { if (a) setLoadErr(apiError(e, 'Не удалось загрузить участников')) })
    return () => { a = false }
  }, [serverId])
  async function toggleSb(m: Member) {
    const dis = !m.soundboardDisabled
    setRows((rs) => (rs ? rs.map((x) => (x.userId === m.userId ? { ...x, soundboardDisabled: dis } : x)) : rs))
    try { await api.setMemberSoundboard(m.userId, dis, serverId); toast.ok(dis ? 'Саундпад выключен участнику' : 'Саундпад включён') }
    catch (e) {
      toast.error(apiError(e, 'Не удалось изменить доступ к саундпаду'))
      setRows((rs) => (rs ? rs.map((x) => (x.userId === m.userId ? { ...x, soundboardDisabled: !dis } : x)) : rs))
    }
  }
  if (loadErr) return <LoadError text={loadErr} onRetry={load} />
  if (!rows) return <Loading />
  const cols = '1.7fr 1.1fr .9fr 1fr auto'
  return (
    <div style={{ animation: 'fadeIn .35s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em' }}>Участники</div>
        <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{rows.length} человек</span>
      </div>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)' }}>
          <span>УЧАСТНИК</span><span>РОЛЬ</span><span>СТАТУС</span><span>НА СЕРВЕРЕ С</span><span>ДЕЙСТВИЯ</span>
        </div>
        {rows.map((m) => {
          const isOwner = m.role === 'OWNER'
          return (
            <div key={m.userId} style={{ display: 'grid', gridTemplateColumns: cols, gap: 12, padding: '13px 20px', borderBottom: '1px solid var(--surface-2)', alignItems: 'center', opacity: m.status === 'offline' ? 0.6 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <Avatar name={m.username} src={m.avatarUrl} size={36} />
                <span style={{ fontWeight: 600, fontSize: 14 }}>{m.username}</span>
                {m.inVoice && <span style={{ color: 'var(--green)', display: 'flex' }}><Volume2 size={13} /></span>}
              </div>
              {isOwner
                ? <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--accent-tint)', color: 'var(--accent)', borderRadius: 6, padding: '3px 9px', width: 'fit-content', display: 'inline-flex', alignItems: 'center', gap: 4 }}>OWNER <Lock size={10} /></span>
                : <div onClick={() => setRoleT(m)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border-2)', borderRadius: 9, background: 'var(--win)', padding: '5px 11px', fontSize: 12, width: 'fit-content', cursor: 'pointer' }}>{m.role} <span style={{ color: 'var(--text-3)', display: 'flex' }}><ChevronDown size={13} /></span></div>}
              <span style={{ color: presenceColor(m.status), fontSize: 13 }}>{PRESENCE_DOT[m.status]} {PRESENCE_LABEL[m.status]}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>{m.joinedAt}</span>
              {isOwner
                ? <span style={{ color: 'var(--border-2)', fontSize: 15 }}>——</span>
                : <div style={{ display: 'flex', gap: 7, color: 'var(--text-2)' }}>
                    <span onClick={() => toggleSb(m)} className="ib no-drag" style={{ width: 30, height: 30, color: m.soundboardDisabled ? 'var(--danger)' : 'var(--text-2)' }} title={m.soundboardDisabled ? 'Саундпад выключен — включить' : 'Выключить саундпад участнику'}><Music size={15} /></span>
                    {isHome && <span onClick={() => setResetT(m)} className="ib no-drag" style={{ width: 30, height: 30 }} title="Сбросить пароль"><Key size={15} /></span>}
                    <span onClick={() => setKickT(m)} className="ib no-drag" style={{ width: 30, height: 30, color: 'var(--danger)' }} title="Исключить"><X size={15} /></span>
                  </div>}
            </div>
          )
        })}
      </Card>
      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 9, background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.3)', color: 'var(--danger)', borderRadius: 12, padding: '11px 14px', fontSize: 13, fontWeight: 600, width: 'fit-content' }}>
        <AlertTriangle size={15} /> Нельзя исключить владельца — действия для owner и себя заблокированы
      </div>
      {kickT && <ConfirmModal title="Исключить участника" message={`Исключить ${kickT.username}? Все его сессии завершатся. Действие необратимо.`} confirmLabel="Исключить" danger busy={busy} error={err}
        onConfirm={async () => {
          const id = kickT.userId
          setBusy(true); setErr('')
          try { await api.kick(id, serverId); setRows((rs) => (rs ? rs.filter((x) => x.userId !== id) : rs)); setKickT(null) }
          catch (e) { setErr(apiError(e, 'Не удалось исключить участника. Попробуйте ещё раз.')) }
          finally { setBusy(false) }
        }}
        onClose={() => { setKickT(null); setErr('') }} />}
      {roleT && <ChangeRoleModal member={roleT} busy={busy} error={err}
        onSelect={async (role) => {
          const id = roleT.userId
          setBusy(true); setErr('')
          try { await api.changeRole(id, role, serverId); setRows((rs) => (rs ? rs.map((x) => (x.userId === id ? { ...x, role } : x)) : rs)); setRoleT(null) }
          catch (e) { setErr(apiError(e, 'Не удалось изменить роль. Попробуйте ещё раз.')) }
          finally { setBusy(false) }
        }}
        onClose={() => { setRoleT(null); setErr('') }} />}
      {resetT && <ConfirmModal title="Сбросить пароль" message={`Сбросить пароль ${resetT.username}? Будет выдан одноразовый временный пароль, текущий перестанет работать.`} confirmLabel="Сбросить" busy={busy} error={err}
        onConfirm={async () => {
          const m = resetT
          setBusy(true); setErr('')
          try { const pw = await api.resetMemberPassword(m.userId); setTempPw({ name: m.username, pw }); setResetT(null) }
          catch (e) { setErr(apiError(e, 'Не удалось сбросить пароль. Попробуйте ещё раз.')) }
          finally { setBusy(false) }
        }}
        onClose={() => { setResetT(null); setErr('') }} />}
      {tempPw && <TempPasswordModal username={tempPw.name} password={tempPw.pw} onClose={() => setTempPw(null)} />}
    </div>
  )
}

const AUDIT_ICON: Record<string, { ch: React.ReactNode; bg: string; color: string }> = {
  'member.kick': { ch: <UserMinus size={16} />, bg: 'var(--danger-tint)', color: 'var(--danger)' },
  'member.role-change': { ch: <ArrowLeftRight size={16} />, bg: 'var(--blue-tint)', color: 'var(--blue)' },
  'invite.create': { ch: <Plus size={16} />, bg: 'var(--green-tint)', color: 'var(--green)' },
  'invite.revoke': { ch: <Lock size={16} />, bg: 'var(--surface-2)', color: 'var(--text-2)' },
}

function renderBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((p, i) => (i % 2 ? <b key={i}>{p}</b> : <Fragment key={i}>{p}</Fragment>))
}

function AuditTab() {
  const [rows, setRows] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try { setRows(await api.audit()) }
    catch (e) { setError(apiError(e, 'Не удалось загрузить журнал аудита')); setRows([]) }
  }, [])
  useEffect(() => {
    let a = true
    api.audit().then((r) => { if (a) setRows(r) }).catch((e) => { if (a) { setError(apiError(e, 'Не удалось загрузить журнал аудита')); setRows([]) } })
    return () => { a = false }
  }, [])
  if (error) return <LoadError text={error} onRetry={load} />
  if (!rows) return <Loading />
  if (rows.length === 0) return (
    <div style={{ animation: 'fadeIn .35s ease' }}>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em', marginBottom: 14 }}>Журнал аудита</div>
      <div style={{ color: 'var(--text-3)', fontSize: 13.5, padding: '24px 4px' }}>Записей пока нет</div>
    </div>
  )
  return (
    <div style={{ animation: 'fadeIn .35s ease' }}>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em', marginBottom: 14 }}>Журнал аудита</div>
      <Card>
        {rows.map((a, idx) => {
          const ic = AUDIT_ICON[a.action] ?? { ch: '•', bg: 'var(--surface-2)', color: 'var(--text-2)' }
          return (
            <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '15px 20px', borderBottom: idx < rows.length - 1 ? '1px solid var(--surface-2)' : undefined }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: ic.bg, color: ic.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flex: 'none' }}>{ic.ch}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14 }}>{renderBold(a.text)}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2, fontFamily: 'ui-monospace,monospace' }}>{a.meta}</div>
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{a.createdAt}</span>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>{children}</div>
}

/** Сбой загрузки вкладки: видимая причина (текст с бэка) + повтор — вместо вечных скелетонов. */
function LoadError({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div style={{ animation: 'fadeIn .35s ease', display: 'flex', alignItems: 'center', gap: 11, background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.3)', color: 'var(--danger)', borderRadius: 12, padding: '13px 16px', fontSize: 13.5, fontWeight: 600, width: 'fit-content', maxWidth: '100%' }}>
      <AlertTriangle size={16} style={{ flex: 'none' }} />
      <span style={{ minWidth: 0 }}>{text}</span>
      <button onClick={onRetry} className="pill no-drag" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontWeight: 600, fontSize: 12.5, color: 'var(--text)' }}><RotateCw size={14} /> Повторить</button>
    </div>
  )
}

function Loading() {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', animation: 'fadeIn .3s ease' }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px', borderBottom: i < 4 ? '1px solid var(--surface-2)' : undefined }}>
          <Skeleton w={36} h={36} r={36} style={{ flex: 'none' }} />
          <Skeleton w="22%" h={12} />
          <Skeleton w="14%" h={12} style={{ marginLeft: 'auto' }} />
        </div>
      ))}
    </div>
  )
}

function InvitesTab({ serverId }: { serverId?: string }) {
  const [rows, setRows] = useState<InviteSummary[] | null>(null)
  const [created, setCreated] = useState<InviteCreated | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadErr, setLoadErr] = useState<string | null>(null) // сбой не выдаём за «приглашений нет»
  const load = useCallback(async () => {
    if (!serverId) { setRows([]); return }
    setLoadErr(null)
    try { setRows(await api.listInvites(serverId)) }
    catch (e) { setLoadErr(apiError(e, 'Не удалось загрузить приглашения')) }
  }, [serverId])
  useEffect(() => {
    let a = true
    if (!serverId) { setRows([]); return }
    api.listInvites(serverId).then((r) => { if (a) setRows(r) }).catch((e) => { if (a) setLoadErr(apiError(e, 'Не удалось загрузить приглашения')) })
    return () => { a = false }
  }, [serverId])
  async function create() {
    if (!serverId) return
    setBusy(true)
    try {
      const inv = await api.createInvite(serverId)
      setCreated(inv)
      api.listInvites(serverId).then(setRows).catch(() => {})
    } catch (e) { toast.error(apiError(e, 'Не удалось создать приглашение — нужно право «Создавать приглашения»')) }
    finally { setBusy(false) }
  }
  async function revoke(id: string) {
    if (!serverId) return
    setRows((rs) => rs?.map((r) => (r.id === id ? { ...r, revoked: true } : r)) ?? rs)
    try { await api.revokeInvite(serverId, id) } catch (e) { toast.error(apiError(e, 'Не удалось отозвать приглашение')); api.listInvites(serverId).then(setRows).catch(() => {}) }
  }
  if (loadErr) return <LoadError text={loadErr} onRetry={load} />
  if (!rows) return <Loading />
  return (
    <div style={{ animation: 'fadeIn .35s ease', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em' }}>Приглашения</div>
        <button onClick={create} disabled={busy} className="accent-btn no-drag" style={{ marginLeft: 'auto', borderRadius: 11, padding: '9px 16px', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8, opacity: busy ? 0.6 : 1 }}><Plus size={16} /> Создать код</button>
      </div>
      {created && <CreatedInvite inv={created} onClose={() => setCreated(null)} />}
      {rows.length === 0 ? (
        <div style={{ color: 'var(--text-3)', fontSize: 13.5, padding: '24px 4px' }}>Активных приглашений нет. Создайте код и поделитесь им — по нему вступят в этот сервер.</div>
      ) : (
        <Card>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: i < rows.length - 1 ? '1px solid var(--surface-2)' : undefined, opacity: r.revoked ? 0.5 : 1 }}>
              <div style={{ width: 36, height: 36, borderRadius: 11, background: r.revoked ? 'var(--surface-2)' : 'var(--green-tint)', color: r.revoked ? 'var(--text-3)' : 'var(--green)', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Link2 size={16} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.revoked ? 'Отозвано' : 'Активно'} · {r.uses}{r.maxUses ? ` / ${r.maxUses}` : ''} использований</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{r.expiresAt ? `действует до ${formatDateTime(r.expiresAt)}` : 'бессрочно'} · создано {formatDateTime(r.createdAt)}</div>
              </div>
              {!r.revoked && <button onClick={() => revoke(r.id)} className="ib no-drag" title="Отозвать" style={{ width: 30, height: 30, color: 'var(--danger)', flex: 'none' }}><X size={15} /></button>}
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}

function CreatedInvite({ inv, onClose }: { inv: InviteCreated; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() { navigator.clipboard?.writeText(inv.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--green-tint)', border: '1px solid rgba(46,160,67,.3)', borderRadius: 12, padding: '12px 16px', marginBottom: 16 }}>
      <Link2 size={18} style={{ color: 'var(--green)', flex: 'none' }} />
      <code style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, fontFamily: 'ui-monospace,monospace', userSelect: 'all', wordBreak: 'break-all' }}>{inv.code}</code>
      <button onClick={copy} className="pill no-drag" style={{ flex: 'none', padding: '7px 13px', fontWeight: 600, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 6 }}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Скопировано' : 'Копировать'}</button>
      <button onClick={onClose} className="ib no-drag" style={{ flex: 'none', width: 28, height: 28 }}><X size={14} /></button>
    </div>
  )
}

function ServerTab({ serverId, onRenamed, onLeft }: { serverId?: string; onRenamed: (s: ServerSummary) => void; onLeft: (id: string) => void }) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [leaving, setLeaving] = useState(false)
  async function save() {
    if (!serverId || !name.trim()) return
    setSaving(true)
    try { const s = await api.renameServer(serverId, name.trim()); onRenamed(s); setName(''); toast.ok('Сервер переименован') }
    catch (e) { toast.error(apiError(e, 'Не удалось переименовать — нужно право «Управлять сервером»')) }
    finally { setSaving(false) }
  }
  return (
    <div style={{ animation: 'fadeIn .35s ease', maxWidth: 560 }}>
      <div style={{ fontWeight: 800, fontSize: 24, letterSpacing: '-.02em', marginBottom: 18 }}>Сервер</div>
      <Card>
        <div style={{ padding: '18px 20px' }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Название сервера</label>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="новое название" maxLength={100} className="no-drag" style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', outline: 'none' }} onKeyDown={(e) => { if (e.key === 'Enter') save() }} />
            <button onClick={save} disabled={saving || !name.trim()} className="accent-btn no-drag" style={{ borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 13.5, opacity: saving || !name.trim() ? 0.5 : 1 }}>Сохранить</button>
          </div>
        </div>
      </Card>
      <div style={{ marginTop: 16 }}>
        <AfkSettingsCard serverId={serverId} />
      </div>
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setLeaveOpen(true)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.3)', color: 'var(--danger)', borderRadius: 12, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}><LogOut size={16} /> Покинуть сервер</button>
      </div>
      {leaveOpen && <ConfirmModal title="Покинуть сервер" message="Вы выйдете из этого сервера и перестанете видеть его каналы. Владелец выйти не может — сначала передайте владение." confirmLabel="Покинуть" danger busy={leaving}
        onConfirm={async () => { if (!serverId) return; setLeaving(true); try { await api.leaveServer(serverId); onLeft(serverId) } catch (e) { toast.error(apiError(e, 'Не удалось выйти (владелец не может покинуть сервер)')); setLeaving(false) } }}
        onClose={() => setLeaveOpen(false)} />}
    </div>
  )
}

// Авто-AFK: тумблер + таймаут неактива (минуты). При включении бэк создаёт голосовой AFK-канал.
function AfkSettingsCard({ serverId }: { serverId?: string }) {
  const [s, setS] = useState<AfkSettings | null>(null)
  const [minutes, setMinutes] = useState(15)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!serverId) return
    let a = true
    api.afkSettings(serverId)
      .then((r) => { if (a) { setS(r); setMinutes(Math.max(1, Math.round(r.timeoutSeconds / 60))) } })
      .catch(() => { /* нет прав/недоступно — карточку не показываем */ })
    return () => { a = false }
  }, [serverId])

  async function apply(p: { enabled?: boolean; timeoutSeconds?: number }) {
    if (!serverId) return
    setSaving(true)
    try {
      const r = await api.updateAfkSettings(serverId, p)
      setS(r); setMinutes(Math.max(1, Math.round(r.timeoutSeconds / 60)))
      toast.ok('Настройки AFK сохранены')
    } catch (e) { toast.error(apiError(e, 'Не удалось сохранить настройки AFK — нужно право «Управлять сервером»')) }
    finally { setSaving(false) }
  }

  if (!s) return null
  return (
    <Card>
      <div style={{ padding: '18px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>😴 Авто-AFK</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 3 }}>Неактивных в голосе уводит в AFK-канал с выключенными микро и звуком</div>
          </div>
          <Switch checked={s.enabled} onChange={(v) => apply({ enabled: v })} size="lg" disabled={saving} title={s.enabled ? 'Выключить' : 'Включить'} ariaLabel="Авто-AFK" />
        </div>
        {s.enabled && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Таймаут неактива (минуты)</label>
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 1))} className="no-drag"
                style={{ width: '100%', marginTop: 8, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', outline: 'none' }} />
              {s.afkChannelName && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 7 }}>Канал: «{s.afkChannelName}» (можно переименовать в списке каналов)</div>}
            </div>
            <button onClick={() => apply({ timeoutSeconds: minutes * 60 })} disabled={saving} className="accent-btn no-drag" style={{ borderRadius: 10, padding: '10px 18px', fontWeight: 700, fontSize: 13.5, opacity: saving ? 0.5 : 1 }}>Сохранить</button>
          </div>
        )}
      </div>
    </Card>
  )
}
