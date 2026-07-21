import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { api } from '@/lib/api'
import type { ServerSummary } from '@/lib/types'

// Создать новый сервер или вступить в чужой по коду инвайта. onDone отдаёт карточку — добавить в рейл.
export function ServerActionsModal({ onClose, onDone }: {
  onClose: () => void
  onDone: (s: ServerSummary) => void
}) {
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)

  const value = mode === 'create' ? name : code
  async function submit() {
    const v = value.trim()
    if (!v) return
    setLoading(true)
    try {
      const s = mode === 'create' ? await api.createServer(v) : await api.joinServer(v)
      toast.ok(mode === 'create' ? 'Сервер создан' : `Вы вступили в «${s.name}»`)
      onDone(s)
      onClose()
    } catch (e) {
      toast.error(apiError(e, mode === 'create' ? 'Не удалось создать сервер' : 'Не удалось вступить — проверьте код'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Серверы" onClose={onClose}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['create', 'join'] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className="no-drag" style={{ flex: 1, border: `1.5px solid ${mode === m ? 'var(--accent)' : 'var(--border)'}`, background: mode === m ? 'var(--accent-tint)' : 'var(--surface)', color: mode === m ? 'var(--accent)' : 'var(--text)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
            {m === 'create' ? 'Создать свой' : 'Войти по коду'}
          </button>
        ))}
      </div>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>
        {mode === 'create' ? 'Название сервера' : 'Код приглашения'}
      </label>
      <div className="field" style={{ padding: '11px 14px', margin: '7px 0 18px' }}>
        {mode === 'create'
          ? <input value={name} onChange={(e) => setName(e.target.value)} placeholder="например, Сквад" autoFocus maxLength={100} onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          : <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="вставьте код приглашения" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />}
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} style={{ padding: '10px 16px', fontWeight: 600 }}>Отмена</button>
        <Button disabled={loading || !value.trim()} onClick={submit} style={{ opacity: !value.trim() ? 0.5 : 1 }}>
          {loading ? '…' : mode === 'create' ? 'Создать' : 'Вступить'}
        </Button>
      </div>
    </Modal>
  )
}
