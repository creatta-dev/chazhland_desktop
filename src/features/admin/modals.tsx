import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import type { Member, Role } from '@/lib/types'

export function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose, error, busy }: {
  title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void; error?: string; busy?: boolean
}) {
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose}>
      <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: error ? 14 : 20 }}>{message}</div>
      {error && <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.3)', borderRadius: 10, padding: '9px 12px', marginBottom: 18 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} disabled={busy} style={{ padding: '10px 16px', fontWeight: 600, opacity: busy ? 0.5 : 1 }}>Отмена</button>
        <Button variant={danger ? 'danger' : 'accent'} onClick={onConfirm} disabled={busy}>{busy ? '…' : confirmLabel}</Button>
      </div>
    </Modal>
  )
}

// Показ одноразового временного пароля после админ-сброса — с копированием.
export function TempPasswordModal({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard?.writeText(password).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  return (
    <Modal title={`Пароль сброшен · ${username}`} onClose={onClose}>
      <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 14 }}>Временный пароль показывается один раз. Передайте его участнику лично — после входа пусть сменит в настройках.</div>
      <div className="field" style={{ padding: '10px 13px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <code style={{ flex: 1, fontFamily: 'ui-monospace,monospace', fontSize: 15, color: 'var(--text)', userSelect: 'all', wordBreak: 'break-all' }}>{password}</code>
        <button type="button" className="pill no-drag" onClick={copy} style={{ flex: 'none', padding: '6px 12px', fontWeight: 600, fontSize: 12.5 }}>{copied ? 'Скопировано' : 'Копировать'}</button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="button" onClick={onClose}>Готово</Button>
      </div>
    </Modal>
  )
}

const ROLES: Role[] = ['OWNER', 'ADMIN', 'MEMBER']

export function ChangeRoleModal({ member, onSelect, onClose, error, busy }: { member: Member; onSelect: (r: Role) => void; onClose: () => void; error?: string; busy?: boolean }) {
  const [sel, setSel] = useState<Role>(member.role)
  return (
    <Modal title={`Роль · ${member.username}`} onClose={busy ? () => {} : onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
        {ROLES.map((r) => (
          <button key={r} onClick={() => setSel(r)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1.5px solid ${sel === r ? 'var(--accent)' : 'var(--border)'}`, background: sel === r ? 'var(--accent-tint)' : 'var(--surface)', borderRadius: 12, padding: '12px 14px', cursor: 'pointer', color: sel === r ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 14 }}>
            <span style={{ width: 15, height: 15, borderRadius: '50%', border: `2px solid ${sel === r ? 'var(--accent)' : 'var(--border-2)'}`, background: sel === r ? 'var(--accent)' : 'transparent' }} />
            {r}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>Понизить последнего владельца нельзя — бэкенд отклонит запрос.</div>
      {error && <div style={{ fontSize: 13, color: 'var(--danger)', background: 'var(--danger-tint)', border: '1px solid rgba(224,57,47,.3)', borderRadius: 10, padding: '9px 12px', marginBottom: 14 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} disabled={busy} style={{ padding: '10px 16px', fontWeight: 600, opacity: busy ? 0.5 : 1 }}>Отмена</button>
        <Button disabled={busy || sel === member.role} onClick={() => onSelect(sel)}>{busy ? '…' : 'Сохранить'}</Button>
      </div>
    </Modal>
  )
}
