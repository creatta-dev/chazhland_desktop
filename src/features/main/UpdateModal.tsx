import { Modal } from '@/components/Modal'
import { renderRichText } from '@/lib/markdown'

// electron-updater отдаёт releaseNotes как HTML (GitHub рендерит markdown тела релиза) → превращаем в
// читаемый текст: списки → «•», блочные теги → перенос строки, снимаем остальные теги и декодируем энтити.
const ENT: Record<string, string> = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&nbsp;': ' ', '&laquo;': '«', '&raquo;': '»', '&mdash;': '—', '&ndash;': '–', '&hellip;': '…',
}
function htmlToText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\s*\/\s*li\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(h[1-6]|p|div|ul|ol|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENT[m.toLowerCase()] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Окно «Что нового»: показывается, когда апдейтер скачал новую версию. notes — HTML тела GitHub-релиза. */
export function UpdateModal({ version, notes, onClose }: { version: string; notes?: string; onClose: () => void }) {
  const text = notes ? htmlToText(notes) : ''
  return (
    <Modal title={`Что нового — v${version}`} onClose={onClose} width={520}>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto', color: 'var(--text)' }}>
        {text ? renderRichText(text) : 'Новая версия загружена и готова к установке.'}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="pill no-drag" onClick={onClose} style={{ padding: '9px 16px', fontWeight: 600 }}>Позже</button>
        <button className="accent-btn no-drag" onClick={() => { window.chazh?.restartToUpdate(); onClose() }} style={{ padding: '9px 16px', fontWeight: 700, borderRadius: 10 }}>Перезапустить сейчас</button>
      </div>
    </Modal>
  )
}
