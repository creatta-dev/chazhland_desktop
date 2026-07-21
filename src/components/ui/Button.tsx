import type { ButtonHTMLAttributes, CSSProperties } from 'react'
import { RADIUS } from '@/theme/themes'

/* «Главная кнопка» диалогов. До этого её базовые стили писали инлайном ~21 раз, и значения
   разъехались (четыре радиуса, три значения прозрачности у disabled). Здесь — один набор:
   класс (.accent-btn / .danger-btn из global.css даёт цвет, ховер и нажатие) + типовая геометрия.
   Нестандартную геометрию конкретного места по-прежнему можно догрузить через style —
   на кнопки со своим flex/шириной/иконкой примитив намеренно не натягивали. */

/** Единая прозрачность выключенной кнопки (было 0.5 / 0.55 / 0.6 вразнобой). */
const DISABLED_OPACITY = 0.55

const SIZES: Record<'sm' | 'md', CSSProperties> = {
  sm: { borderRadius: RADIUS.md, padding: '9px 18px' },  // кнопки внутри вкладок настроек
  md: { borderRadius: RADIUS.md, padding: '10px 18px' }, // кнопки в подвале модалок
}

export function Button({
  variant = 'accent',
  size = 'md',
  className,
  style,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'accent' | 'danger'
  size?: 'sm' | 'md'
}) {
  const cls = `${variant === 'danger' ? 'danger-btn' : 'accent-btn'} no-drag${className ? ' ' + className : ''}`
  return (
    <button
      {...rest}
      disabled={disabled}
      className={cls}
      style={{
        ...SIZES[size],
        fontWeight: 700,
        opacity: disabled ? DISABLED_OPACITY : 1, // перебивается через style, если гасить надо по своему условию
        ...style,
      }}
    />
  )
}
