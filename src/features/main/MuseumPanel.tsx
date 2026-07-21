import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar } from '@/components/Avatar'
import { useEscape } from '@/lib/useEscape'
import { Skeleton } from '@/components/Skeleton'
import { formatShortDate } from '@/lib/format'
import type { QuoteKind, QuoteMuseumEntry } from '@/lib/types'
import { SidePanel, SidePanelHeader } from '@/components/ui'

const FILTERS: { key: QuoteKind | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Всё' },
  { key: 'GOLD', label: '🏆 Золото' },
  { key: 'SHAME', label: '🫠 Стыд' },
]

// Боковая панель «Музей цитат»: галерея «Золотой рамки» (🏆) и «Карточки стыда» (🫠).
export function MuseumPanel({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [kind, setKind] = useState<QuoteKind | 'ALL'>('ALL')
  const [items, setItems] = useState<QuoteMuseumEntry[] | null>(null)
  useEscape(onClose)

  useEffect(() => {
    let alive = true
    setItems(null)
    api.quoteMuseum(serverId || undefined, kind === 'ALL' ? undefined : kind)
      .then((r) => { if (alive) setItems(r) })
      .catch(() => { if (alive) setItems([]) })
    return () => { alive = false }
  }, [serverId, kind])

  return (
    <SidePanel>
      <SidePanelHeader icon={<Trophy size={16} style={{ color: 'var(--accent)' }} />} title="Музей цитат" onClose={onClose} />

      {/* фильтр зала */}
      <div className="no-drag" style={{ flex: 'none', display: 'flex', gap: 7, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setKind(f.key)} className="no-drag" style={{ flex: 1, cursor: 'pointer', borderRadius: 9, padding: '6px 8px', fontSize: 12.5, fontWeight: 700, border: '1px solid ' + (f.key === kind ? 'var(--accent)' : 'var(--border)'), background: f.key === kind ? 'var(--accent-tint)' : 'var(--win)', color: f.key === kind ? 'var(--accent)' : 'var(--text-2)' }}>{f.label}</button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items === null && [0, 1, 2].map((i) => <Skeleton key={i} h={92} r={12} />)}
        {items && items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: '32px 8px' }}>
            Пока пусто. Набери 🏆 или 🫠 на сообщении — и оно войдёт в историю.
          </div>
        )}
        {items?.map((e) => <QuoteCard key={e.id} e={e} />)}
      </div>
    </SidePanel>
  )
}

function QuoteCard({ e }: { e: QuoteMuseumEntry }) {
  const gold = e.kind === 'GOLD'
  return (
    <div style={{ border: '1px solid var(--border)', borderLeft: `3px solid ${gold ? '#e7b53c' : '#b06ad6'}`, borderRadius: 12, padding: '11px 13px', background: 'var(--win)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12.5, fontWeight: 700, color: 'var(--text-2)' }}>
        <span>{gold ? '🏆 Вошло в историю' : '🫠 Карточка стыда'}</span>
        <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontWeight: 600 }}>{e.reactionCount} {e.emoji} · {formatShortDate(e.inductedAt)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Avatar name={e.author.username} src={e.author.avatarUrl} size={22} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{e.author.username}</span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>«{e.excerpt ?? '(вложение)'}»</div>
    </div>
  )
}
