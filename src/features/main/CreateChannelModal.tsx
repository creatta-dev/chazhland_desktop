import { useState } from 'react'
import { Hash, Volume2, Play } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Button } from '@/components/ui'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import type { Category, ChannelType } from '@/lib/types'

const TYPES: { type: ChannelType; icon: React.ReactNode; label: string; desc: string }[] = [
  { type: 'TEXT', icon: <Hash size={18} />, label: 'Текстовый', desc: 'переписка' },
  { type: 'VOICE', icon: <Volume2 size={18} />, label: 'Голосовой', desc: 'звонок + экран' },
  { type: 'WATCH', icon: <Play size={18} />, label: 'Кинозал', desc: 'совместный просмотр' },
]

export function CreateChannelModal({ categories, defaultCategoryFor, initialCategoryId, onCreate, onClose }: {
  categories: Category[]
  /** куда по умолчанию класть канал этого типа (категория с такими же каналами / с подходящим именем) */
  defaultCategoryFor: (type: ChannelType) => string | null
  /** открыли из меню конкретной категории — сразу в неё */
  initialCategoryId?: string | null
  onCreate: (p: { name: string; type: ChannelType; categoryId: string | null }) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ChannelType>('TEXT')
  // категорию подбираем по типу, пока пользователь не выбрал её руками
  const [categoryId, setCategoryId] = useState<string | null>(() => initialCategoryId !== undefined ? initialCategoryId : defaultCategoryFor('TEXT'))
  const [categoryTouched, setCategoryTouched] = useState(initialCategoryId !== undefined)
  const [loading, setLoading] = useState(false)

  function pickType(t: ChannelType) {
    setType(t)
    if (!categoryTouched) setCategoryId(defaultCategoryFor(t))
  }

  async function submit() {
    const n = name.trim()
    if (!n) return
    setLoading(true)
    try { await onCreate({ name: n, type, categoryId }); toast.ok('Канал создан'); onClose() } catch (e) { toast.error(apiError(e, 'Не удалось создать канал')) } finally { setLoading(false) }
  }

  const sorted = [...categories].sort((a, b) => a.position - b.position)
  return (
    <Modal title="Создать канал" onClose={onClose}>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Тип</label>
      <div style={{ display: 'flex', gap: 8, margin: '8px 0 16px' }}>
        {TYPES.map((t) => (
          <button key={t.type} onClick={() => pickType(t.type)} className="no-drag" style={{ flex: 1, textAlign: 'left', border: `1.5px solid ${type === t.type ? 'var(--accent)' : 'var(--border)'}`, background: type === t.type ? 'var(--accent-tint)' : 'var(--surface)', borderRadius: 12, padding: '10px 12px', cursor: 'pointer', color: type === t.type ? 'var(--accent)' : 'var(--text)' }}>
            <div style={{ display: 'flex' }}>{t.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{t.label}</div>
            <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{t.desc}</div>
          </button>
        ))}
      </div>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Название</label>
      <div className="field" style={{ padding: '11px 14px', margin: '7px 0 16px' }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="например, общий" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      </div>
      <label style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)' }}>Группа</label>
      <select value={categoryId ?? ''} onChange={(e) => { setCategoryId(e.target.value || null); setCategoryTouched(true) }} className="no-drag"
        style={{ width: '100%', padding: '10px 12px', margin: '7px 0 18px', borderRadius: 11, border: '1px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', font: 'inherit', fontSize: 13.5, cursor: 'pointer' }}>
        <option value="">Без группы (вверху списка)</option>
        {sorted.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} style={{ padding: '10px 16px', fontWeight: 600 }}>Отмена</button>
        <Button disabled={loading || !name.trim()} onClick={submit} style={{ opacity: !name.trim() ? 0.5 : 1 }}>{loading ? 'Создаём…' : 'Создать'}</Button>
      </div>
    </Modal>
  )
}
