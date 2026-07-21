import { FONT, RADIUS } from '@/theme/themes'

/* Тумблер. До этого был написан инлайном в четырёх местах: три без role="switch",
   два вообще нефокусируемые (обычный <div onClick>). Здесь — один доступный примитив:
   настоящая кнопка, role="switch" + aria-checked, фокус с клавиатуры (класс .ui-switch
   в global.css рисует :focus-visible). */

/** Габариты дорожки; бегунок = height − 2·pad, ход = width − pad − бегунок. */
const SIZES = {
  sm: { w: 38, h: 22, pad: 2, knob: 18 },
  md: { w: 42, h: 24, pad: 3, knob: 18 },
  lg: { w: 46, h: 26, pad: 3, knob: 20 },
} as const

export type SwitchSize = keyof typeof SIZES

export function Switch({
  checked,
  onChange,
  size = 'md',
  label,
  ariaLabel,
  title,
  disabled,
  onColor = 'var(--accent)',
  offColor = 'var(--border-2)',
  style,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  size?: SwitchSize
  /** подпись справа от дорожки: тогда вся строка целиком и есть кнопка-тумблер */
  label?: string
  /** имя для скринридера, когда подпись живёт рядом отдельным блоком */
  ariaLabel?: string
  title?: string
  disabled?: boolean
  onColor?: string
  offColor?: string
  style?: React.CSSProperties
}) {
  const s = SIZES[size]
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel ?? label ?? title}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="ui-switch no-drag"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: label ? 10 : 0,
        flex: 'none',
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        ...style,
      }}
    >
      <span
        style={{
          display: 'block',
          flex: 'none',
          width: s.w,
          height: s.h,
          borderRadius: RADIUS.pill,
          background: checked ? onColor : offColor,
          position: 'relative',
          transition: 'background .15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: s.pad,
            left: checked ? s.w - s.pad - s.knob : s.pad,
            width: s.knob,
            height: s.knob,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left .15s',
          }}
        />
      </span>
      {label && <span style={{ fontSize: FONT.base, color: 'var(--text)' }}>{label}</span>}
    </button>
  )
}
