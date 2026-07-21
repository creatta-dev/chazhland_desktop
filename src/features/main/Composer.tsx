import { useEffect, useRef, useState } from 'react'
import { Plus, Smile, Send, X, Type, Bold, Italic, Strikethrough, Code, EyeOff } from 'lucide-react'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { useEscape } from '@/lib/useEscape'
import { EMOJIS } from '@/lib/emojis'
import type { AttachmentInput } from '@/lib/types'
import { Spinner } from '@/components/ui'

interface Pending { id: string; file: File; previewUrl: string; status: 'up' | 'done' | 'err'; out?: AttachmentInput }
const MAX_ATTACH = 10 // лимит бэка
const MAX_LEN = 4000  // @Size(max = 4000) в web/dto/MessageCreateRequest — менять вместе с бэком
const COUNTER_FROM = MAX_LEN - 300 // счётчик показываем только на подходе к лимиту, чтобы не мозолил глаза

export function Composer({ channelName, onSend, onType, replyToName, onCancelReply }: {
  channelName: string
  onSend: (text: string, attachments?: AttachmentInput[]) => Promise<void>
  onType?: () => void
  replyToName?: string | null
  onCancelReply?: () => void
}) {
  const [text, setText] = useState('')
  const [pending, setPending] = useState<Pending[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [fmtOpen, setFmtOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [sending, setSending] = useState(false) // ждём ответ сервера — поле не чистим и не шлём повторно
  const lastTyped = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingRef = useRef<Pending[]>([])
  pendingRef.current = pending
  useEscape(() => setEmojiOpen(false), emojiOpen)
  useEscape(() => setFmtOpen(false), fmtOpen)

  // вставка эмодзи в позицию каретки (или в конец, если фокус потерян)
  function insertEmoji(em: string) {
    const el = inputRef.current
    const s = el?.selectionStart ?? text.length
    const e = el?.selectionEnd ?? text.length
    setText((t) => t.slice(0, s) + em + t.slice(e))
    setEmojiOpen(false)
    requestAnimationFrame(() => { const node = inputRef.current; if (node) { node.focus(); const pos = s + em.length; node.setSelectionRange(pos, pos) } })
  }

  // оборачивание выделения (или вставка маркеров с кареткой внутри) для тулбара форматирования
  function wrapSel(before: string, after: string) {
    const el = inputRef.current
    const s = el?.selectionStart ?? text.length
    const e = el?.selectionEnd ?? text.length
    const sel = text.slice(s, e)
    setText(text.slice(0, s) + before + sel + after + text.slice(e))
    setFmtOpen(false)
    requestAnimationFrame(() => { const n = inputRef.current; if (n) { n.focus(); const pos = sel ? s + before.length + sel.length + after.length : s + before.length; n.setSelectionRange(pos, pos) } })
  }

  // освобождаем objectURL превью при размонтировании
  useEffect(() => () => { pendingRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }, [])

  const uploading = pending.some((p) => p.status === 'up')

  function patch(id: string, upd: Partial<Pending>) {
    setPending((ps) => ps.map((p) => (p.id === id ? { ...p, ...upd } : p)))
  }

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    const room = MAX_ATTACH - pending.length
    const list = Array.from(files).slice(0, Math.max(0, room))
    if (files.length > list.length) toast.info(`Можно прикрепить максимум ${MAX_ATTACH} файлов`)
    for (const file of list) {
      const id = crypto.randomUUID()
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
      setPending((ps) => [...ps, { id, file, previewUrl, status: 'up' }])
      api.uploadFile(file)
        .then((out) => patch(id, { status: 'done', out }))
        .catch((e) => { patch(id, { status: 'err' }); toast.error(apiError(e, `Не удалось загрузить ${file.name}`)) })
    }
  }

  function remove(id: string) {
    setPending((ps) => {
      const p = ps.find((x) => x.id === id)
      if (p?.previewUrl) URL.revokeObjectURL(p.previewUrl)
      return ps.filter((x) => x.id !== id)
    })
  }

  function clearPending() {
    pendingRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
    setPending([])
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (uploading || sending) return // ждём завершения аплоада / предыдущей отправки
    const t = text.trim()
    const atts = pending.filter((p) => p.status === 'done' && p.out).map((p) => p.out!)
    if (!t && atts.length === 0) return
    if (t.length > MAX_LEN) { toast.error(`Слишком длинное сообщение: ${t.length} из ${MAX_LEN} символов`); return }
    const sent = text // чистим ровно то, что ушло: пока летел POST, пользователь мог начать печатать дальше
    setSending(true)
    try {
      await onSend(t, atts.length ? atts : undefined)
      setText((cur) => (cur === sent ? '' : cur)) // очищаем ТОЛЬКО после подтверждения — иначе отвергнутый текст терялся
      clearPending()
    } catch { /* ошибку показал вызывающий; текст и вложения остаются в поле, можно повторить */ }
    finally { setSending(false) }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    setText(e.target.value)
    // throttle: не чаще раза в 3 с (бэк шлёт ephemeral TYPING, без хранения)
    const now = Date.now()
    if (e.target.value && now - lastTyped.current > 3000) { lastTyped.current = now; onType?.() }
  }

  // вставка изображения из буфера (Ctrl+V со скриншотом) — добавляем как вложение с превью
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const files = e.clipboardData?.files
    if (files && files.length) { e.preventDefault(); addFiles(files) }
  }
  // перетаскивание файлов в композер
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    addFiles(e.dataTransfer?.files ?? null)
  }

  return (
    <form
      onSubmit={submit}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false) }}
      onDrop={onDrop}
      style={{ padding: '8px 26px 18px', flex: 'none', position: 'relative' }}
    >
      {dragOver && (
        <div style={{ position: 'absolute', inset: 6, zIndex: 6, borderRadius: 16, border: '2px dashed var(--accent)', background: 'var(--accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontWeight: 700, fontSize: 14, pointerEvents: 'none' }}>
          Отпустите, чтобы прикрепить
        </div>
      )}
      {replyToName && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-2)', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: '10px 10px 0 0', padding: '6px 14px', marginBottom: -1 }}>
          Ответ <b style={{ fontWeight: 600, color: 'var(--text)' }}>{replyToName}</b>
          <button type="button" className="ib no-drag" onClick={onCancelReply} title="Отменить ответ" style={{ marginLeft: 'auto', width: 22, height: 20 }}><X size={13} /></button>
        </div>
      )}

      {pending.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '6px 2px 8px' }}>
          {pending.map((p) => (
            <div key={p.id} style={{ position: 'relative', width: 84, height: 84, borderRadius: 10, overflow: 'hidden', border: `1px solid ${p.status === 'err' ? 'var(--danger)' : 'var(--border)'}`, background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {p.previewUrl
                ? <img src={p.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <span style={{ fontSize: 10, color: 'var(--text-3)', padding: 6, textAlign: 'center', wordBreak: 'break-all', lineHeight: 1.3 }}>{p.file.name}</span>}
              {p.status === 'up' && <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={18} /></div>}
              {p.status === 'err' && <div style={{ position: 'absolute', inset: 0, background: 'var(--danger-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--danger)', fontSize: 10, fontWeight: 700 }}>ошибка</div>}
              <button type="button" className="no-drag" onClick={() => remove(p.id)} title="Убрать" style={{ position: 'absolute', top: 3, right: 3, width: 20, height: 20, borderRadius: 6, border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileRef} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = '' }} />
      <div className="field" style={{ borderRadius: replyToName ? '0 0 16px 16px' : 16, border: '1px solid var(--border)', background: 'var(--surface)', padding: '11px 14px 11px 16px', gap: 12 }}>
        <button type="button" className="ib no-drag" onClick={() => fileRef.current?.click()} style={{ width: 32, height: 32, borderRadius: 9, background: 'var(--surface-2)' }} title="Вложение"><Plus size={18} /></button>
        <input ref={inputRef} value={text} onChange={onChange} onPaste={onPaste} maxLength={MAX_LEN} placeholder={`Написать в #${channelName}…`} style={{ fontSize: 14.5 }} />
        {text.length >= COUNTER_FROM && (
          <span style={{ flex: 'none', fontSize: 11.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: text.length >= MAX_LEN ? 'var(--danger)' : 'var(--text-3)' }} title={`Лимит сообщения — ${MAX_LEN} символов`}>
            {text.length}/{MAX_LEN}
          </span>
        )}
        <span style={{ position: 'relative', display: 'flex' }}>
          <button type="button" className="ib no-drag" onClick={() => setFmtOpen((v) => !v)} style={{ width: 32, height: 32, color: fmtOpen ? 'var(--accent)' : undefined }} title="Форматирование"><Type size={18} /></button>
          {fmtOpen && (
            <>
              <div onClick={() => setFmtOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, zIndex: 41, display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 14px 34px -12px var(--shadow)', padding: 4, animation: 'popIn .15s cubic-bezier(.22,.61,.36,1)', transformOrigin: 'bottom right' }}>
                <FmtBtn title="Жирный" onClick={() => wrapSel('**', '**')}><Bold size={16} /></FmtBtn>
                <FmtBtn title="Курсив" onClick={() => wrapSel('*', '*')}><Italic size={16} /></FmtBtn>
                <FmtBtn title="Зачёркнутый" onClick={() => wrapSel('~~', '~~')}><Strikethrough size={16} /></FmtBtn>
                <FmtBtn title="Моноширинный код" onClick={() => wrapSel('`', '`')}><Code size={16} /></FmtBtn>
                <FmtBtn title="Спойлер" onClick={() => wrapSel('||', '||')}><EyeOff size={16} /></FmtBtn>
              </div>
            </>
          )}
        </span>
        <span style={{ position: 'relative', display: 'flex' }}>
          <button type="button" className="ib no-drag" onClick={() => setEmojiOpen((v) => !v)} style={{ width: 32, height: 32, color: emojiOpen ? 'var(--accent)' : undefined }} title="Эмодзи"><Smile size={18} /></button>
          {emojiOpen && (
            <>
              <div onClick={() => setEmojiOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
              <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', right: 0, zIndex: 41, width: 280, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 14px 34px -12px var(--shadow)', padding: 7, display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 1, animation: 'popIn .15s cubic-bezier(.22,.61,.36,1)', transformOrigin: 'bottom right' }}>
                {EMOJIS.map((em) => (
                  <button key={em} type="button" className="ib no-drag" onClick={() => insertEmoji(em)} style={{ width: 32, height: 32, fontSize: 17, borderRadius: 8 }}>{em}</button>
                ))}
              </div>
            </>
          )}
        </span>
        <button type="submit" disabled={uploading || sending} className="accent-btn" style={{ width: 40, height: 40, borderRadius: 12, boxShadow: '0 4px 12px var(--accent-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: uploading || sending ? 0.6 : 1 }} title={uploading ? 'Загрузка вложений…' : sending ? 'Отправляем…' : 'Отправить'}>{uploading || sending ? <Spinner size={18} /> : <Send size={17} />}</button>
      </div>
    </form>
  )
}

function FmtBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return <button type="button" className="ib no-drag" onClick={onClick} title={title} style={{ width: 32, height: 32, borderRadius: 8 }}>{children}</button>
}
