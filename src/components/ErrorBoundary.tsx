import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * Граница ошибок рендера. Без неё исключение в любом компоненте размонтирует всё дерево, а окно
 * frameless-Electron остаётся белым: ни меню, ни кнопки закрытия — приложение приходится убивать.
 *
 * Оборачивать можно и всё приложение, и отдельные панели (label — что именно упало).
 * Ошибки в промисах/обработчиках событий сюда НЕ попадают (это ограничение React) — их по-прежнему
 * ловим try/catch + toast.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // в DevTools остаётся стек компонентов — без него по минифицированной сборке не найти место
    console.error('[ErrorBoundary]', this.props.label ?? 'app', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32, background: 'var(--win)', color: 'var(--text)', textAlign: 'center' }}>
        <div style={{ fontSize: 34 }}>😵</div>
        <div style={{ fontWeight: 800, fontSize: 17 }}>
          {this.props.label ? `Раздел «${this.props.label}» сломался` : 'Что-то пошло не так'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-2)', maxWidth: 460 }}>
          Приложение поймало ошибку рендера и не дало окну уйти в белый экран.
        </div>
        {/* текст ошибки: без него пользователь не сможет ничего сообщить, а мы — воспроизвести */}
        <pre style={{ maxWidth: 520, maxHeight: 160, overflow: 'auto', margin: 0, padding: '10px 13px', fontSize: 11.5, lineHeight: 1.45, textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-3)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 12 }}>
          {error.message || String(error)}
        </pre>
        <button
          className="no-drag"
          onClick={() => location.reload()}
          style={{ marginTop: 4, padding: '9px 18px', fontSize: 13.5, fontWeight: 700, color: '#fff', background: 'var(--accent)', border: 'none', borderRadius: 11, cursor: 'pointer' }}
        >
          Перезагрузить
        </button>
      </div>
    )
  }
}
