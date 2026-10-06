import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'

// Модалка «ввести название» — создание/переименование категории (группы каналов).
export function NameModal({ title, label, initial = '', placeholder, confirmLabel, maxLength = 100, onSubmit, onClose }: {
  title: string
  label: string
  initial?: string
  placeholder?: string
  confirmLabel: string
  maxLength?: number
  onSubmit: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(initial)
  const [loading, setLoading] = useState(false)
  const n = name.trim()

  async function submit() {
    if (!n || loading) return
    setLoading(true)
    try { await onSubmit(n); onClose() } catch (e) { toast.error(apiError(e, 'Не удалось сохранить')) } finally { setLoading(false) }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>{label}</label>
      <div className="field" style={{ padding: '11px 14px', margin: '7px 0 18px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} maxLength={maxLength} autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} style={{ padding: '10px 16px', fontWeight: 600 }}>Отмена</button>
        <Button disabled={loading || !n} onClick={submit} style={{ opacity: !n ? 0.5 : 1 }}>{loading ? 'Сохраняем…' : confirmLabel}</Button>
      </div>
    </Modal>
  )
}
