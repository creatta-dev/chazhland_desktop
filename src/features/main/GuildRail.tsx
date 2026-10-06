import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { ServerSummary } from '@/lib/types'

// Самая левая колонка — серверы (как «гилд-бар» в Discord). Клик переключает сервер; «+» — создать/войти.
// Порядок личный: перетаскиванием каждый расставляет СВОИ серверы как хочет (бэк хранит позицию в членстве).
export function GuildRail({ servers, currentId, badges, onSwitch, onAdd, onReorder }: {
  servers: ServerSummary[]
  currentId: string
  badges?: Map<string, { unread: boolean; mentions: number }>
  onSwitch: (id: string) => void
  onAdd: () => void
  onReorder: (orderedIds: string[]) => void
}) {
  const [dragId, setDragId] = useState<string | null>(null)
  const [insertAt, setInsertAt] = useState<number | null>(null) // индекс вставки 0..n

  function end() { setDragId(null); setInsertAt(null) }
  function drop(e: React.DragEvent) {
    e.preventDefault()
    const id = dragId, at = insertAt
    end()
    if (!id || at === null) return
    const before = servers.map((s) => s.id)
    const ids = before.slice()
    const from = ids.indexOf(id)
    if (from < 0) return
    ids.splice(from, 1)
    ids.splice(at > from ? at - 1 : at, 0, id)
    if (ids.join() !== before.join()) onReorder(ids)
  }

  const Marker = () => <div style={{ width: 40, height: 3, borderRadius: 3, background: 'var(--accent)', flex: 'none', margin: '-5px 0' }} />

  return (
    <div onDragOver={(e) => { if (dragId) e.preventDefault() }} onDrop={drop}
      style={{ width: 72, flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '12px 0', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
      {servers.map((s, i) => (
        <div key={s.id} style={{ display: 'contents' }}>
          {insertAt === i && <Marker />}
          <div
            draggable
            title={s.name}
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); setDragId(s.id) }}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              const r = e.currentTarget.getBoundingClientRect()
              setInsertAt(i + (e.clientY > r.top + r.height / 2 ? 1 : 0))
            }}
            onDrop={drop}
            onDragEnd={end}
            style={{ opacity: dragId === s.id ? 0.35 : 1, transition: 'opacity .12s' }}
          >
            <GuildIcon server={s} active={s.id === currentId} badge={badges?.get(s.id)} onClick={() => onSwitch(s.id)} />
          </div>
        </div>
      ))}
      {insertAt === servers.length && <Marker />}
      <button
        className="no-drag"
        onClick={onAdd}
        title="Добавить сервер"
        style={{ width: 48, height: 48, flex: 'none', borderRadius: 16, border: '1px dashed var(--border)', background: 'var(--surface)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
      >
        <Plus size={22} />
      </button>
    </div>
  )
}

function GuildIcon({ server, active, badge, onClick }: { server: ServerSummary; active: boolean; badge?: { unread: boolean; mentions: number }; onClick: () => void }) {
  const initials = server.name.replace(/\s+/g, ' ').trim().slice(0, 2).toUpperCase() || '·'
  const mentions = badge?.mentions ?? 0
  const showDot = !active && !!badge?.unread && mentions === 0 // непрочитанное без упоминаний — белая пилюля слева
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {showDot && <span style={{ position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)', width: 4, height: 18, borderRadius: 4, background: 'var(--text)' }} />}
      <button
        className="no-drag"
        onClick={onClick}
        style={{
          width: 48, height: 48, flex: 'none', cursor: 'pointer',
          borderRadius: active ? 15 : 24, transition: 'border-radius .18s ease',
          border: 'none', overflow: 'hidden',
          background: active ? 'var(--accent)' : 'var(--surface)',
          color: active ? '#fff' : 'var(--text)',
          boxShadow: active ? '0 0 0 2px var(--accent-tint)' : 'none',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15,
        }}
      >
        {server.iconUrl
          ? <img src={server.iconUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : initials}
      </button>
      {mentions > 0 && (
        <span style={{ position: 'absolute', right: -2, bottom: -2, background: 'var(--accent)', color: '#fff', borderRadius: 30, fontSize: 10, fontWeight: 700, lineHeight: '16px', minWidth: 17, height: 17, padding: '0 4px', textAlign: 'center', border: '2px solid var(--surface-2)' }}>{mentions > 99 ? '99+' : mentions}</span>
      )}
    </div>
  )
}
