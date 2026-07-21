import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Shield, Check } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { Avatar } from '@/components/Avatar'
import { PERMISSIONS, PERM_GROUPS, ROLE_COLORS, DEFAULT_ROLE_COLOR } from '@/lib/permissions'
import type { Member, Permission, ServerRole } from '@/lib/types'

interface Draft { name: string; color: string | null; perms: Set<Permission> }

// роли сортируем по убыванию позиции (выше позиция = выше в иерархии), @everyone всегда снизу
function sortRoles(rs: ServerRole[]): ServerRole[] {
  return [...rs].sort((a, b) => (a.isDefault ? 1 : b.isDefault ? -1 : b.position - a.position))
}

export function RolesTab({ serverId }: { serverId?: string }) {
  const [roles, setRoles] = useState<ServerRole[] | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [subtab, setSubtab] = useState<'perms' | 'members'>('perms')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let a = true
    Promise.all([api.roles(serverId), api.members(serverId)]).then(([r, m]) => {
      if (!a) return
      setRoles(r); setMembers(m)
      const first = sortRoles(r)[0]
      if (first) select(first)
    }).catch(() => { if (a) setRoles([]) })
    return () => { a = false }
  }, [serverId])

  const sel = roles?.find((r) => r.id === selId) ?? null
  const ordered = useMemo(() => (roles ? sortRoles(roles) : []), [roles])

  function select(r: ServerRole) {
    setSelId(r.id)
    setDraft({ name: r.name, color: r.color, perms: new Set(r.permissions) })
    setSubtab('perms')
  }
  const dirty = !!sel && !!draft && (
    draft.name !== sel.name || (draft.color ?? '') !== (sel.color ?? '') ||
    draft.perms.size !== sel.permissions.length || sel.permissions.some((p) => !draft.perms.has(p))
  )

  function togglePerm(p: Permission) {
    setDraft((d) => { if (!d) return d; const perms = new Set(d.perms); perms.has(p) ? perms.delete(p) : perms.add(p); return { ...d, perms } })
  }

  async function create() {
    setCreating(true)
    try {
      const r = await api.createRole({ name: 'Новая роль', color: ROLE_COLORS[0], permissions: ['VIEW_CHANNEL', 'SEND_MESSAGES', 'CONNECT'] }, serverId)
      setRoles((rs) => [...(rs ?? []), r]); select(r)
    } catch (e) { toast.error(apiError(e, 'Не удалось создать роль')) }
    finally { setCreating(false) }
  }
  async function save() {
    if (!sel || !draft) return
    setSaving(true)
    try {
      const updated = await api.updateRole(sel.id, { name: draft.name.trim() || sel.name, color: draft.color, permissions: [...draft.perms] })
      setRoles((rs) => rs!.map((r) => (r.id === updated.id ? updated : r)))
      toast.ok('Роль сохранена')
    } catch (e) { toast.error(apiError(e, 'Не удалось сохранить роль — нужно право «Управлять ролями»')) }
    finally { setSaving(false) }
  }
  async function del() {
    if (!sel || sel.isDefault) return
    const id = sel.id
    try {
      await api.deleteRole(id)
      setRoles((rs) => { const next = rs!.filter((r) => r.id !== id); const first = sortRoles(next)[0]; if (first) select(first); else { setSelId(null); setDraft(null) }; return next })
      setMembers((ms) => ms.map((m) => ({ ...m, roleIds: m.roleIds?.filter((x) => x !== id) })))
    } catch (e) { toast.error(apiError(e, 'Не удалось удалить роль')) }
  }
  async function toggleMember(m: Member) {
    if (!sel) return
    const has = !!m.roleIds?.includes(sel.id)
    setMembers((ms) => ms.map((x) => (x.userId === m.userId ? { ...x, roleIds: has ? x.roleIds!.filter((id) => id !== sel.id) : [...(x.roleIds ?? []), sel.id] } : x)))
    try { has ? await api.unassignRole(sel.id, m.userId) : await api.assignRole(sel.id, m.userId) }
    catch (e) {
      toast.error(apiError(e, 'Не удалось изменить назначение роли'))
      setMembers((ms) => ms.map((x) => (x.userId === m.userId ? { ...x, roleIds: has ? [...(x.roleIds ?? []), sel.id] : x.roleIds!.filter((id) => id !== sel.id) } : x)))
    }
  }

  if (!roles) return <div style={{ color: 'var(--text-3)', padding: 20 }}>Загрузка ролей…</div>

  return (
    <div style={{ display: 'flex', gap: 18, animation: 'fadeIn .35s ease', height: '100%' }}>
      {/* список ролей */}
      <div style={{ width: 250, flex: 'none', display: 'flex', flexDirection: 'column' }}>
        <button onClick={create} disabled={creating} className="accent-btn no-drag" style={{ borderRadius: 11, padding: '10px 0', fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 12, opacity: creating ? 0.6 : 1 }}><Plus size={16} /> Создать роль</button>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', flex: 1 }}>
          {ordered.map((r) => {
            const count = members.filter((m) => m.roleIds?.includes(r.id)).length
            const active = r.id === selId
            return (
              <button key={r.id} onClick={() => select(r)} className="no-drag" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', border: 'none', borderBottom: '1px solid var(--surface-2)', background: active ? 'var(--surface-2)' : 'transparent', color: 'var(--text)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ width: 12, height: 12, borderRadius: '50%', flex: 'none', background: r.color || DEFAULT_ROLE_COLOR, boxShadow: active ? `0 0 0 3px ${(r.color || DEFAULT_ROLE_COLOR)}33` : undefined }} />
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: r.isDefault ? 'var(--text-2)' : 'var(--text)' }}>{r.isDefault ? '@everyone' : r.name}</span>
                {!r.isDefault && <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* редактор роли */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!sel || !draft ? (
          <div style={{ color: 'var(--text-3)', padding: 30, textAlign: 'center' }}>Выберите роль слева</div>
        ) : (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
            {/* заголовок: имя + цвет */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {sel.isDefault ? (
                  <div style={{ fontWeight: 800, fontSize: 20 }}>@everyone</div>
                ) : (
                  <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d!, name: e.target.value }))} maxLength={100} className="no-drag" style={{ flex: 1, fontWeight: 700, fontSize: 18, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--border-2)', background: 'var(--win)', color: draft.color || 'var(--text)', outline: 'none' }} />
                )}
                {!sel.isDefault && <button onClick={del} className="no-drag" title="Удалить роль" style={{ width: 38, height: 38, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--win)', color: 'var(--danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><Trash2 size={16} /></button>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {ROLE_COLORS.map((c) => (
                  <button key={c} onClick={() => setDraft((d) => ({ ...d!, color: c }))} className="no-drag" title={c} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: draft.color === c ? '2px solid var(--text)' : '2px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{draft.color === c && <Check size={13} color="#fff" />}</button>
                ))}
                {/* произвольный HEX через нативный пикер; кружок показывает выбранный нестандартный цвет */}
                {(() => {
                  const custom = !!draft.color && !(ROLE_COLORS as readonly string[]).includes(draft.color)
                  return (
                    <label className="no-drag" title="Свой цвет" style={{ width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: custom ? draft.color! : 'var(--win)', border: custom ? '2px solid var(--text)' : '2px dashed var(--border-2)' }}>
                      <input type="color" value={draft.color || DEFAULT_ROLE_COLOR} onChange={(e) => setDraft((d) => ({ ...d!, color: e.target.value }))} style={{ position: 'absolute', inset: -4, width: '150%', height: '150%', opacity: 0, cursor: 'pointer' }} />
                      {custom ? <Check size={13} color="#fff" /> : <Plus size={14} style={{ color: 'var(--text-3)' }} />}
                    </label>
                  )
                })()}
              </div>
            </div>

            {/* под-вкладки */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--win)', border: '1px solid var(--border)', borderRadius: 11, padding: 3, width: 'fit-content' }}>
              <button className={'seg-btn no-drag' + (subtab === 'perms' ? ' on' : '')} onClick={() => setSubtab('perms')} style={{ fontSize: 13, padding: '6px 16px' }}>Права</button>
              {!sel.isDefault && <button className={'seg-btn no-drag' + (subtab === 'members' ? ' on' : '')} onClick={() => setSubtab('members')} style={{ fontSize: 13, padding: '6px 16px' }}>Участники</button>}
            </div>

            {subtab === 'perms' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {PERM_GROUPS.map((g) => {
                  const items = PERMISSIONS.filter((p) => p.group === g)
                  if (!items.length) return null
                  return (
                    <div key={g}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', marginBottom: 8 }}>{g.toUpperCase()}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {items.map((p) => {
                          const admin = p.key === 'ADMINISTRATOR'
                          const on = draft.perms.has(p.key)
                          return (
                            <div key={p.key} onClick={() => togglePerm(p.key)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 11px', borderRadius: 10, cursor: 'pointer', background: admin && on ? 'var(--danger-tint)' : 'transparent' }}>
                              {admin && <Shield size={15} style={{ color: 'var(--danger)', flex: 'none' }} />}
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 13.5, fontWeight: 500, color: admin ? 'var(--danger)' : 'var(--text)' }}>{p.label}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{p.desc}</div>
                              </div>
                              <Switch on={on} danger={admin} />
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 420, overflow: 'auto' }}>
                {members.map((m) => {
                  const has = !!m.roleIds?.includes(sel.id)
                  return (
                    <div key={m.userId} onClick={() => toggleMember(m)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '8px 10px', borderRadius: 10, cursor: 'pointer' }}>
                      <Avatar name={m.username} src={m.avatarUrl} size={32} />
                      <span style={{ flex: 1, fontSize: 13.5, fontWeight: 500 }}>{m.username}</span>
                      <Switch on={has} />
                    </div>
                  )
                })}
              </div>
            )}

            {/* сохранение */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              {dirty && <button onClick={() => select(sel)} className="pill no-drag" style={{ padding: '9px 16px', fontWeight: 600, fontSize: 13 }}>Сбросить</button>}
              <button onClick={save} disabled={!dirty || saving} className="accent-btn no-drag" style={{ borderRadius: 11, padding: '9px 22px', fontWeight: 700, fontSize: 13.5, opacity: !dirty || saving ? 0.5 : 1 }}>{saving ? 'Сохранение…' : 'Сохранить'}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Switch({ on, danger }: { on: boolean; danger?: boolean }) {
  const c = danger ? 'var(--danger)' : 'var(--accent)'
  return (
    <span style={{ width: 40, height: 23, borderRadius: 12, background: on ? c : 'var(--border-2)', position: 'relative', transition: 'background .15s', flex: 'none' }}>
      <span style={{ position: 'absolute', top: 2.5, left: on ? 19 : 2.5, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
    </span>
  )
}
