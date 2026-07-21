import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import type { Channel } from '@/lib/types'

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }
const fieldS: React.CSSProperties = { padding: '11px 13px', marginBottom: 14 }

const SLOW = [0, 5, 10, 15, 30, 60, 300, 900, 3600, 21600] // пресеты медленного режима (бэк: 0..21600)
function slowLabel(s: number): string {
  if (s === 0) return 'Выключен'
  if (s < 60) return `${s} сек`
  if (s < 3600) return `${Math.round(s / 60)} мин`
  return `${Math.round(s / 3600)} ч`
}

export function ChannelSettingsModal({ channel, onClose, onSaved, onDeleted }: {
  channel: Channel
  onClose: () => void
  onSaved: (patch: { name: string; categoryId?: string | null; topic?: string | null; userLimit?: number | null; slowModeSeconds?: number | null }) => Promise<void>
  onDeleted: () => Promise<void>
}) {
  const isVoice = channel.type === 'VOICE'
  const isText = channel.type === 'TEXT'
  const [name, setName] = useState(channel.name)
  const [topic, setTopic] = useState(channel.topic ?? '')
  const [userLimit, setUserLimit] = useState(channel.userLimit ?? 0)
  const [slow, setSlow] = useState(channel.slowModeSeconds ?? 0)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const slowOpts = SLOW.includes(slow) ? SLOW : [...SLOW, slow].sort((a, b) => a - b)

  async function save() {
    const n = name.trim()
    if (!n) { toast.error('Имя канала не может быть пустым'); return }
    setBusy(true)
    try {
      await onSaved({
        name: n,
        categoryId: channel.categoryId, // сохраняем категорию (на бэке null = «без категории»)
        topic: isVoice ? (channel.topic ?? null) : (topic.trim() || null),
        userLimit: isVoice ? (userLimit > 0 ? userLimit : null) : (channel.userLimit ?? null),
        slowModeSeconds: isText ? slow : (channel.slowModeSeconds ?? 0),
      })
      onClose()
    } catch (e) { toast.error(apiError(e, 'Не удалось сохранить канал')); setBusy(false) }
  }
  async function del() {
    setBusy(true)
    try { await onDeleted(); onClose() } catch (e) { toast.error(apiError(e, 'Не удалось удалить канал')); setBusy(false) }
  }

  return (
    <Modal title={`Настройки канала · ${channel.name}`} onClose={busy ? () => {} : onClose} width={460}>
      <label style={lbl}>Название</label>
      <div className="field" style={fieldS}><input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="название канала" autoFocus /></div>

      {!isVoice && (
        <>
          <label style={lbl}>Тема канала</label>
          <div className="field" style={fieldS}><input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={1024} placeholder="о чём этот канал" /></div>
        </>
      )}

      {isVoice && (
        <>
          <label style={lbl}>Лимит участников (0 — без лимита)</label>
          <div className="field" style={fieldS}><input type="number" min={0} max={99} value={userLimit} onChange={(e) => setUserLimit(Math.max(0, Math.min(99, Number(e.target.value) || 0)))} /></div>
        </>
      )}

      {isText && (
        <>
          <label style={lbl}>Медленный режим</label>
          <select value={slow} onChange={(e) => setSlow(Number(e.target.value))} className="no-drag" style={{ width: '100%', padding: '11px 13px', marginBottom: 14, borderRadius: 12, border: '1.5px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', font: 'inherit', fontSize: 14, outline: 'none', cursor: 'pointer' }}>
            {slowOpts.map((s) => <option key={s} value={s}>{slowLabel(s)}</option>)}
          </select>
        </>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <Button type="button" size="sm" disabled={busy} onClick={save}>{busy ? 'Сохранение…' : 'Сохранить'}</Button>
      </div>

      <div style={{ height: 1, background: 'var(--border)', margin: '16px 0' }} />
      {!confirmDel ? (
        <button type="button" className="no-drag" onClick={() => setConfirmDel(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--danger)', background: 'var(--danger-tint)', color: 'var(--danger)', borderRadius: 11, padding: '9px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}><Trash2 size={15} /> Удалить канал</button>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text-2)', flex: 1, minWidth: 150 }}>Удалить «{channel.name}» со всей историей? Необратимо.</span>
          <button type="button" className="danger-btn no-drag" disabled={busy} onClick={del} style={{ borderRadius: 11, padding: '8px 14px', fontWeight: 700, opacity: busy ? 0.6 : 1 }}>Удалить</button>
          <button type="button" className="pill no-drag" disabled={busy} onClick={() => setConfirmDel(false)} style={{ padding: '8px 14px', fontWeight: 600 }}>Отмена</button>
        </div>
      )}
    </Modal>
  )
}
