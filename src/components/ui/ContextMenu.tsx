import type { ReactNode } from 'react'
import { FONT, RADIUS, Z } from '@/theme/themes'

/* Контекстное меню по правой кнопке. Было написано дважды (меню сообщения и меню канала);
   у меню канала не было кламна по X, и у правого края экрана оно выезжало за окно — здесь
   кламп общий, по обеим осям. */

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  danger?: boolean
  /** заголовок-разделитель: не кликается, рисуется капсом */
  header?: boolean
  onClick?: () => void
}

const MENU_WIDTH = 196
const ITEM_HEIGHT = 36 // оценка для клампа по нижнему краю

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  layer = 'menu',
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
  /** 'menuTop' — для меню, которое должно лечь поверх боковых панелей (меню канала) */
  layer?: 'menu' | 'menuTop'
}) {
  const zBack = layer === 'menuTop' ? Z.menuTop : Z.menu
  const zFront = layer === 'menuTop' ? Z.menuTopOver : Z.menuOver
  const top = Math.min(y, window.innerHeight - (items.length * ITEM_HEIGHT + 24))
  const left = Math.min(x, window.innerWidth - (MENU_WIDTH + 14))
  return (
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} style={{ position: 'fixed', inset: 0, zIndex: zBack }} />
      <div style={{ position: 'fixed', left, top, zIndex: zFront, minWidth: MENU_WIDTH, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: RADIUS.sm, boxShadow: '0 18px 40px -16px var(--shadow)', padding: 5 }}>
        {items.map((it, i) => it.header ? (
          <div key={i} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', textTransform: 'uppercase', padding: '8px 10px 4px', borderTop: i > 0 ? '1px solid var(--border)' : undefined, marginTop: i > 0 ? 4 : 0 }}>{it.label}</div>
        ) : (
          <button key={i} className="chan-row no-drag" onClick={() => { onClose(); it.onClick?.() }} style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', borderRadius: 7, padding: '8px 10px', fontSize: FONT.md, fontWeight: 500, color: it.danger ? 'var(--danger)' : 'var(--text)' }}>
            {it.icon && <span style={{ display: 'flex', color: it.danger ? 'var(--danger)' : 'var(--text-3)' }}>{it.icon}</span>}{it.label}
          </button>
        ))}
      </div>
    </>
  )
}
