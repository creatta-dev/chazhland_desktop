import { useCallback, useEffect, useState } from 'react'
import { Medal, Pin, Lock, AlertTriangle, RotateCw } from 'lucide-react'
import { api } from '@/lib/api'
import { useEscape } from '@/lib/useEscape'
import { Skeleton } from '@/components/Skeleton'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { formatShortDate } from '@/lib/format'
import type { AchievementCard, MyAchievements } from '@/lib/types'
import { SidePanel, SidePanelHeader } from '@/components/ui'

// Боковая панель «Ачивки»: открытые (с закреплением на витрину), не-секретные к получению, счётчик скрытых.
export function AchievementsPanel({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<MyAchievements | null>(null)
  const [error, setError] = useState<string | null>(null) // сбой загрузки: раньше молча оставался вечный скелетон
  const [busy, setBusy] = useState(false)
  useEscape(onClose)

  // общая загрузка: и первый вход, и «Повторить», и синхронизация после неудачного оптимистичного апдейта
  const reload = useCallback(async () => {
    setError(null)
    try { setData(await api.myAchievements()) }
    catch (e) { setError(apiError(e, 'Не удалось загрузить ачивки')) }
  }, [])
  useEffect(() => { let alive = true; api.myAchievements().then((r) => { if (alive) setData(r) }).catch((e) => { if (alive) setError(apiError(e, 'Не удалось загрузить ачивки')) }); return () => { alive = false } }, [])

  async function togglePin(a: AchievementCard) {
    if (busy) return
    setBusy(true)
    // оптимистично
    setData((d) => d ? { ...d, unlocked: d.unlocked.map((x) => x.id === a.id ? { ...x, pinned: !x.pinned } : x) } : d)
    try { await api.pinAchievement(a.id, !a.pinned) }
    catch (e) { toast.error(apiError(e, a.pinned ? 'Не удалось открепить ачивку' : 'Не удалось закрепить ачивку')); await reload() }
    finally { setBusy(false) }
  }

  async function setMode(showAll: boolean) {
    if (busy || !data || data.showAll === showAll) return
    setBusy(true)
    setData((d) => d ? { ...d, showAll } : d)
    try { await api.setAchievementShowcaseMode(showAll) }
    catch (e) { toast.error(apiError(e, 'Не удалось изменить режим витрины')); await reload() }
    finally { setBusy(false) }
  }

  return (
    <SidePanel>
      <SidePanelHeader icon={<Medal size={16} style={{ color: 'var(--accent)' }} />} title="Ачивки" onClose={onClose}>
        {data && <span style={{ fontSize: 12.5, color: 'var(--text-3)', fontWeight: 600 }}>{data.unlockedCount}/{data.total}</span>}
      </SidePanelHeader>

      {/* режим витрины на профиле */}
      {data && (
        <div className="no-drag" style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 600 }}>На профиле:</span>
          {[{ v: true, l: 'Все' }, { v: false, l: 'Закреплённые' }].map((o) => (
            <button key={o.l} onClick={() => setMode(o.v)} className="no-drag" style={{ cursor: 'pointer', borderRadius: 9, padding: '5px 11px', fontSize: 12.5, fontWeight: 700, border: '1px solid ' + (data.showAll === o.v ? 'var(--accent)' : 'var(--border)'), background: data.showAll === o.v ? 'var(--accent-tint)' : 'var(--win)', color: data.showAll === o.v ? 'var(--accent)' : 'var(--text-2)' }}>{o.l}</button>
          ))}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', padding: '28px 8px', color: 'var(--text-2)' }}>
            <AlertTriangle size={22} style={{ color: 'var(--danger)' }} />
            <div style={{ fontSize: 13, lineHeight: 1.45 }}>{error}</div>
            <button className="pill no-drag" onClick={reload} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 14px', fontWeight: 600, fontSize: 12.5 }}><RotateCw size={14} /> Повторить</button>
          </div>
        )}
        {!data && !error && [0, 1, 2, 3].map((i) => <Skeleton key={i} h={56} r={12} />)}
        {data?.unlocked.map((a) => <Row key={a.id} a={a} onPin={() => togglePin(a)} />)}
        {data && data.locked.length > 0 && <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-3)', marginTop: 6 }}>Ещё не открыто</div>}
        {data?.locked.map((a) => <Row key={a.id} a={a} />)}
        {data && data.lockedSecretCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px dashed var(--border-2)', borderRadius: 12, padding: '12px 14px', color: 'var(--text-3)', fontSize: 13 }}>
            <Lock size={16} /> {data.lockedSecretCount} секретных ачивок ждут открытия — выслеживай сам 👀
          </div>
        )}
      </div>
    </SidePanel>
  )
}

function Row({ a, onPin }: { a: AchievementCard; onPin?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', background: 'var(--win)', opacity: a.unlocked ? 1 : 0.55 }}>
      <span style={{ fontSize: 22, flex: 'none', filter: a.unlocked ? 'none' : 'grayscale(1)' }}>{a.emoji}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{a.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.description}{a.unlocked && a.unlockedAt ? ` · ${formatShortDate(a.unlockedAt)}` : ''}</div>
      </div>
      {a.unlocked && onPin && (
        <button className="ib no-drag" onClick={onPin} title={a.pinned ? 'Открепить с витрины' : 'Закрепить на витрину'} style={{ width: 30, height: 30, flex: 'none', background: a.pinned ? 'var(--accent-tint)' : 'var(--surface-2)', color: a.pinned ? 'var(--accent)' : 'var(--text-3)' }}><Pin size={14} /></button>
      )}
    </div>
  )
}
