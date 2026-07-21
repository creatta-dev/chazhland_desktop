import type { CSSProperties, ReactNode } from 'react'
import { X } from 'lucide-react'
import { FONT, Z } from '@/theme/themes'

/* Оболочка боковой оверлей-панели (Статистика / Музей / Поиск-Пины / Ачивки).
   Была скопирована в четыре файла и разъехалась по ширине (380 против 360) —
   здесь единственное значение. Тело панели каждый экран верстает сам:
   у них разные паддинги, скролл и фильтры, общий body намеренно не навязываем. */

/** Ширина панели: раньше 380 в трёх местах и 360 в поиске — оставили 380. */
const PANEL_WIDTH = 380

export function SidePanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: PANEL_WIDTH,
        maxWidth: '100%',
        zIndex: Z.panel,
        background: 'var(--surface)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-14px 0 40px -22px var(--shadow)',
        display: 'flex',
        flexDirection: 'column',
        animation: 'ovIn .2s ease',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/** Шапка панели: иконка + заголовок + произвольная вставка + крестик. */
export function SidePanelHeader({
  icon,
  title,
  onClose,
  children,
}: {
  icon: ReactNode
  title: string
  onClose: () => void
  children?: ReactNode
}) {
  return (
    <div style={{ height: 52, flex: 'none', display: 'flex', alignItems: 'center', gap: 9, padding: '0 14px', borderBottom: '1px solid var(--border)' }}>
      {icon}
      <span style={{ fontWeight: 700, fontSize: FONT.lg }}>{title}</span>
      {children}
      <button className="ib no-drag" onClick={onClose} title="Закрыть" style={{ marginLeft: 'auto', width: 30, height: 30, flex: 'none', background: 'var(--surface-2)' }}><X size={15} /></button>
    </div>
  )
}
