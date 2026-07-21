import { useEffect, useState } from 'react'
import { Reply, SmilePlus, Pencil, Ban, Download, X, Pin, File as FileIcon, Trash2, Copy, Mail, UserRound, MessageSquare, ChevronLeft, ChevronRight } from 'lucide-react'
import { Avatar, presenceColor } from '@/components/Avatar'
import { RankChip } from '@/components/RankChip'
import { RankBadge } from '@/components/RankBadge'
import { rankColor } from '@/lib/ranks'
import { msgAccentColor, nameGlow, nameStyle } from '@/lib/cosmetics'
import { CosmeticBackground } from '@/components/CosmeticBackground'
import { toast } from '@/lib/toast'
import { useEscape } from '@/lib/useEscape'
import { presence } from '@/lib/presence'
import { PRESENCE_LABEL } from '@/lib/presenceLabels'
import { formatAttachmentSize, formatNumber, formatTime } from '@/lib/format'
import { MOCK } from '@/lib/config'
import { hexA } from '@/theme/themes'
import { ContextMenu, type ContextMenuItem } from '@/components/ui'
import { renderRichText } from '@/lib/markdown'
import { EMOJIS } from '@/lib/emojis'
import type { Attachment, MemberRank, Message as Msg, Presence, ServerRankInfo } from '@/lib/types'

// скачивание через blob: cross-origin download-атрибут Chromium игнорирует (навигация → блок navigation-guard)
async function downloadAttachment(url: string, filename?: string | null) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    const obj = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = obj; a.download = filename || 'file'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(obj), 1500)
  } catch { toast.error('Не удалось скачать файл') }
}

function escapeRegExp(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
// упоминание текущего пользователя: @everyone/@here или @<его ник> как отдельный токен
function isMentioningMe(content: string, meName?: string): boolean {
  if (/@everyone|@here/u.test(content)) return true
  if (!meName) return false
  return new RegExp(`@${escapeRegExp(meName)}(?![\\p{L}\\p{N}_])`, 'u').test(content)
}

const roleBadge: Record<string, React.CSSProperties> = {
  OWNER: { background: 'var(--accent-tint)', color: 'var(--accent)' },
  ADMIN: { background: 'var(--surface-3)', color: 'var(--text-2)' },
}

interface Props {
  m: Msg
  meId?: string
  meName?: string
  authorName?: string             // имя автора, разрезолвленное на момент рендера из живого списка участников
  authorAvatarUrl?: string | null // (в DTO сообщения их нет — иначе у не-в-списке автора виден UUID/нет аватара)
  nameColor?: string | null       // цвет ника по высшей цветной роли
  topRole?: { name: string; color: string | null } | null // высшая кастомная роль — бейдж
  rank?: MemberRank               // ранг автора — чип у имени
  myServerRank?: ServerRankInfo   // мой прогресс на сервере — XP-бар в своём мини-профиле
  myProfileBgUrl?: string | null  // моя загруженная картинка фона профиля — баннер своего мини-профиля
  grouped?: boolean // часть серии того же автора — без аватара/шапки
  highlight?: boolean // подсветка при переходе из поиска/пинов
  canModerate?: boolean
  onReact?: (emoji: string) => void
  onReply?: (m: Msg) => void
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onOpenDm?: (userId: string) => void  // «Написать в ЛС» из профиля/меню
  onMarkUnread?: () => void            // «Пометить непрочитанным отсюда» (ChatFeed знает предыдущее сообщение)
}

export function Message({ m, meId, meName, authorName: authorNameProp, authorAvatarUrl: authorAvatarProp, nameColor, topRole, rank, myServerRank, myProfileBgUrl, grouped, highlight, canModerate, onReact, onReply, onEdit, onDelete, onPin, onOpenDm, onMarkUnread }: Props) {
  // приоритет — свежий резолв из списка участников; запечённое в сообщении значение (часто UUID) как фолбэк
  const authorName = authorNameProp ?? m.authorName
  const authorAvatarUrl = authorAvatarProp !== undefined ? authorAvatarProp : m.authorAvatarUrl
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const [picker, setPicker] = useState<null | 'top' | 'bottom'>(null)
  const [popEmoji, setPopEmoji] = useState<string | null>(null) // эмодзи, по которому только что кликнули — для pop-анимации
  const [popNonce, setPopNonce] = useState(0)                   // меняем ключ пилюли, чтобы анимация перезапускалась на повторный клик
  const [lightbox, setLightbox] = useState<number | null>(null) // индекс открытой картинки в images
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)       // ПКМ-контекст-меню
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null)  // карточка профиля автора
  const images = m.attachments.filter((a) => a.contentType.startsWith('image/') && !!a.url)
  function lbStep(d: number) { setLightbox((i) => (i === null ? i : (i + d + images.length) % images.length)) }
  useEffect(() => {
    if (lightbox === null) return
    const h = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') lbStep(1); else if (e.key === 'ArrowLeft') lbStep(-1) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, images.length])
  useEscape(() => setLightbox(null), lightbox !== null)
  useEscape(() => setPicker(null), !!picker)
  useEscape(() => setMenu(null), !!menu)
  useEscape(() => setPopover(null), !!popover)

  const mention = !!m.content && isMentioningMe(m.content, meName)
  const isOwn = !!meId && m.authorId === meId

  if (m.deleted) {
    return (
      <div data-mid={m.id} style={{ display: 'flex', gap: 13, padding: '7px 8px', alignItems: 'center', color: 'var(--text-3)', fontStyle: 'italic', fontSize: 13 }}>
        <span style={{ width: 42, display: 'flex', justifyContent: 'center' }}><Ban size={15} /></span>Сообщение удалено
      </div>
    )
  }

  // Системная карточка (дайджест «Чажленд Wrapped» и пр.) — без шапки автора/тулбара, отдельным боксом.
  if (m.type === 'SYSTEM') {
    return (
      <div data-mid={m.id} style={{ padding: '10px 8px', display: 'flex', justifyContent: 'center', animation: 'fadeIn .26s ease' }}>
        <div style={{ maxWidth: 560, width: '100%', background: 'var(--accent-tint)', border: '1px solid var(--accent)', borderRadius: 14, padding: '14px 18px', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', boxShadow: '0 10px 28px -18px var(--shadow)' }}>
          {m.content ? renderRichText(m.content) : 'Системное сообщение'}
          {m.reactions.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
              {m.reactions.map((r) => (
                <div key={r.emoji} onClick={() => onReact?.(r.emoji)} className={'reaction' + (r.mine ? ' mine' : '')} style={{ padding: '3px 11px', fontSize: 13, fontWeight: 600, color: r.mine ? undefined : 'var(--text-2)' }}>{r.emoji} {r.count}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  function startEdit() { setVal(m.content ?? ''); setEditing(true) }
  function saveEdit() {
    const v = val.trim()
    setEditing(false)
    if (v && v !== m.content) onEdit?.(m.id, v)
  }
  function react(emoji: string) { setPopEmoji(emoji); setPopNonce((n) => n + 1); onReact?.(emoji) }
  function pick(emoji: string) { react(emoji); setPicker(null) }

  const menuItems: ContextMenuItem[] = [
    { label: 'Ответить', icon: <Reply size={15} />, onClick: () => onReply?.(m) },
    ...(m.content ? [{ label: 'Копировать текст', icon: <Copy size={15} />, onClick: () => navigator.clipboard?.writeText(m.content!).then(() => toast.ok('Скопировано')).catch(() => {}) }] : []),
    { label: m.pinnedAt ? 'Открепить' : 'Закрепить', icon: <Pin size={15} />, onClick: () => onPin?.(m.id, !m.pinnedAt) },
    { label: 'Пометить непрочитанным', icon: <Mail size={15} />, onClick: () => onMarkUnread?.() },
    { label: 'Профиль автора', icon: <UserRound size={15} />, onClick: () => setPopover(menu) },
    ...(isOwn ? [{ label: 'Изменить', icon: <Pencil size={15} />, onClick: startEdit }] : []),
    ...((isOwn || canModerate) ? [{ label: 'Удалить', icon: <Trash2 size={15} />, danger: true, onClick: () => onDelete?.(m.id) }] : []),
  ]

  return (
    <div
      data-mid={m.id}
      className={mention || highlight ? undefined : 'msg-row'}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onContextMenu={(e) => { if (editing) return; e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
      style={{ display: 'flex', gap: 13, padding: mention ? '9px 8px' : grouped ? '1px 8px' : '7px 8px', borderRadius: 12, position: 'relative', background: highlight ? 'var(--accent-tint)' : mention ? 'var(--accent-tint)' : undefined, boxShadow: highlight ? 'inset 0 0 0 2px var(--accent)' : undefined, transition: 'background .35s, box-shadow .35s' }}
    >
      {mention && <div style={{ position: 'absolute', left: 0, top: 9, bottom: 9, width: 3, borderRadius: 3, background: 'var(--accent)' }} />}
      {/* косметика msgAccent: акцентная полоса у сообщений автора (если не перебита подсветкой упоминания) */}
      {!mention && !highlight && msgAccentColor(rank?.equipped?.msgAccent) && <div style={{ position: 'absolute', left: 0, top: 5, bottom: 5, width: 3, borderRadius: 3, background: msgAccentColor(rank?.equipped?.msgAccent) || undefined }} />}

      {(hover || picker) && !editing && (
        <div style={{ position: 'absolute', top: -12, right: 10, display: 'flex', gap: 2, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: 3, boxShadow: '0 6px 18px -8px var(--shadow)', zIndex: 2 }}>
          <ToolBtn title="Ответить" onClick={() => onReply?.(m)}><Reply size={15} /></ToolBtn>
          <ToolBtn title="Реакция" onClick={() => setPicker((p) => (p === 'top' ? null : 'top'))}><SmilePlus size={15} /></ToolBtn>
          <ToolBtn title={m.pinnedAt ? 'Открепить' : 'Закрепить'} onClick={() => onPin?.(m.id, !m.pinnedAt)}><Pin size={14} style={m.pinnedAt ? { color: 'var(--accent)' } : undefined} /></ToolBtn>
          {isOwn && <ToolBtn title="Изменить" onClick={startEdit}><Pencil size={14} /></ToolBtn>}
          {(isOwn || canModerate) && <ToolBtn title="Удалить" danger onClick={() => onDelete?.(m.id)}><Trash2 size={14} /></ToolBtn>}
        </div>
      )}

      {picker && <EmojiPicker anchor={picker} onPick={pick} onClose={() => setPicker(null)} />}

      {grouped ? (
        <span style={{ width: 42, flex: 'none', fontSize: 10, color: 'var(--text-3)', textAlign: 'right', paddingTop: 3, opacity: hover ? 1 : 0, transition: 'opacity .12s' }}>{formatTime(m.createdAt)}</span>
      ) : (
        <span onClick={(e) => setPopover({ x: e.clientX, y: e.clientY })} style={{ flex: 'none', cursor: 'pointer' }} title="Профиль"><Avatar name={authorName} src={authorAvatarUrl} size={42} frame={rank?.equipped?.frame} glow={rank?.equipped?.glow} /></span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {!grouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 3 }}>
            <span onClick={(e) => setPopover({ x: e.clientX, y: e.clientY })} style={{ fontWeight: 700, fontSize: 14.5, color: nameColor || undefined, cursor: 'pointer', ...(nameStyle(rank?.equipped?.nameEffect) ?? {}), ...(nameGlow(rank?.equipped?.msgAccent) ?? {}) }}>{authorName}</span>
            {m.authorRole && roleBadge[m.authorRole] && (
              <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '1px 7px', ...roleBadge[m.authorRole] }}>{m.authorRole}</span>
            )}
            {topRole && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '1px 7px', background: topRole.color ? hexA(topRole.color, 0.16) : 'var(--surface-3)', color: topRole.color || 'var(--text-2)' }}>{topRole.name}</span>}
            <RankBadge id={rank?.equipped?.badge} size={14} />
            {rank && <RankChip level={rank.level} title={rank.title} compact />}
            <span style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{formatTime(m.createdAt)}</span>
            {m.pinnedAt && <Pin size={11} style={{ color: 'var(--accent)' }} />}
          </div>
        )}
        {m.replyPreview && (
          <div style={{ borderLeft: '2px solid var(--border-2)', paddingLeft: 10, marginBottom: 5, fontSize: 12.5, color: 'var(--text-3)' }}>
            ↳ {m.replyPreview.authorName}: {m.replyPreview.content}
          </div>
        )}

        {editing ? (
          <div>
            <textarea
              autoFocus
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
                else if (e.key === 'Escape') setEditing(false)
              }}
              style={{ width: '100%', minHeight: 40, resize: 'vertical', border: '1px solid var(--accent)', borderRadius: 10, background: 'var(--surface)', color: 'var(--text)', font: 'inherit', fontSize: 14.5, padding: '9px 12px', outline: 'none' }}
            />
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
              Enter — сохранить · <span onClick={() => setEditing(false)} style={{ color: 'var(--accent)', cursor: 'pointer' }}>Esc — отмена</span>
            </div>
          </div>
        ) : (
          m.content && (
            <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {renderRichText(m.content)}
              {m.editedAt && <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 6 }}>(изменено)</span>}
            </div>
          )
        )}

        {m.attachments.map((a, i) => <AttachmentView key={i} a={a} onOpen={() => setLightbox(images.indexOf(a))} />)}
        {lightbox !== null && images[lightbox] && (
          <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40, animation: 'ovIn .2s ease' }}>
            <img src={images[lightbox].url} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 10, objectFit: 'contain' }} />
            {images.length > 1 && (
              <>
                <button className="no-drag" onClick={(e) => { e.stopPropagation(); lbStep(-1) }} title="Назад" style={{ position: 'absolute', left: 24, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronLeft size={22} /></button>
                <button className="no-drag" onClick={(e) => { e.stopPropagation(); lbStep(1) }} title="Вперёд" style={{ position: 'absolute', right: 24, top: '50%', transform: 'translateY(-50%)', width: 44, height: 44, borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ChevronRight size={22} /></button>
                <div style={{ position: 'absolute', bottom: 22, left: '50%', transform: 'translateX(-50%)', color: '#fff', fontSize: 13, fontWeight: 600, background: 'rgba(0,0,0,.5)', borderRadius: 20, padding: '5px 13px' }}>{lightbox + 1} / {images.length}</div>
              </>
            )}
            <button className="no-drag" onClick={() => setLightbox(null)} title="Закрыть" style={{ position: 'absolute', top: 20, right: 24, width: 40, height: 40, borderRadius: 12, border: 'none', background: 'rgba(255,255,255,.15)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={20} /></button>
          </div>
        )}

        {m.reactions.length > 0 && (
          <div style={{ marginTop: 9, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {m.reactions.map((r) => {
              const popped = r.emoji === popEmoji
              return (
                <div key={popped ? `${r.emoji}#${popNonce}` : r.emoji} onClick={() => react(r.emoji)} className={'reaction' + (r.mine ? ' mine' : '')} style={{ padding: '3px 11px', fontSize: 13, fontWeight: 600, color: r.mine ? undefined : 'var(--text-2)', animation: popped ? 'reactionPop .32s cubic-bezier(.34,1.56,.64,1)' : undefined }}>{r.emoji} {r.count}</div>
              )
            })}
            <div className="reaction" onClick={() => setPicker((p) => (p === 'bottom' ? null : 'bottom'))} style={{ justifyContent: 'center', width: 30, height: 26, color: 'var(--text-3)' }} title="Добавить реакцию"><SmilePlus size={15} /></div>
          </div>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
      {popover && <UserPopover m={m} name={authorName} avatarUrl={authorAvatarUrl} nameColor={nameColor} topRole={topRole} rank={rank} myServerRank={myServerRank} bgUrl={isOwn ? myProfileBgUrl : (rank?.profileBackgroundUrl ?? null)} isOwn={isOwn} x={popover.x} y={popover.y} onOpenDm={onOpenDm} onClose={() => setPopover(null)} />}
    </div>
  )
}

/** XP-полоска текущего уровня в своём мини-профиле (по порогам levelStartXp/nextLevelXp из /me/rank). */
function XpBar({ sr }: { sr: ServerRankInfo }) {
  const span = Math.max(1, sr.nextLevelXp - sr.levelStartXp)
  const cur = Math.max(0, sr.xp - sr.levelStartXp)
  const pct = Math.max(0, Math.min(100, (cur / span) * 100))
  const c = rankColor(sr.level)
  return (
    <div style={{ marginTop: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11, color: 'var(--text-3)', marginBottom: 5 }}>
        <span style={{ color: c, fontWeight: 700 }}>ур.{sr.level} · {sr.title}</span>
        <span>{formatNumber(cur)} / {formatNumber(span)} XP</span>
      </div>
      <div style={{ height: 7, borderRadius: 99, background: 'var(--surface-3)', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', background: c, transition: 'width .3s' }} />
      </div>
    </div>
  )
}

function UserPopover({ m, name, avatarUrl, nameColor, topRole, rank, myServerRank, bgUrl, isOwn, x, y, onOpenDm, onClose }: { m: Msg; name: string; avatarUrl?: string | null; nameColor?: string | null; topRole?: { name: string; color: string | null } | null; rank?: MemberRank; myServerRank?: ServerRankInfo; bgUrl?: string | null; isOwn: boolean; x: number; y: number; onOpenDm?: (id: string) => void; onClose: () => void }) {
  const status: Presence = MOCK ? 'online' : presence.statusOf(m.authorId)
  const top = Math.min(y, window.innerHeight - 300)
  const left = Math.min(x, window.innerWidth - 256)
  // баннер: загруженная картинка → canvas/CSS-фон профиля → баннер-косметика → акцентная заливка
  const bannerBgId = rank?.equipped?.profileBg ?? rank?.equipped?.banner
  return (
    <>
      <div onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} style={{ position: 'fixed', inset: 0, zIndex: 50 }} />
      <div style={{ position: 'fixed', left, top, zIndex: 51, width: 240, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 22px 50px -18px var(--shadow)', overflow: 'hidden', animation: 'popIn .14s ease' }}>
        <div style={{ height: 54, position: 'relative', overflow: 'hidden', background: 'var(--accent-tint)' }}><CosmeticBackground id={bgUrl ? null : bannerBgId} imageUrl={bgUrl} /></div>
        <div style={{ padding: '0 16px 16px', marginTop: -28 }}>
          <Avatar name={name} src={avatarUrl} size={64} presence={status} frame={rank?.equipped?.frame} glow={rank?.equipped?.glow} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, fontSize: 17, color: nameColor || undefined, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(nameStyle(rank?.equipped?.nameEffect) ?? {}) }}>{name}</span>
            {m.authorRole && roleBadge[m.authorRole] && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '1px 7px', flex: 'none', ...roleBadge[m.authorRole] }}>{m.authorRole}</span>}
            {topRole && <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 5, padding: '1px 7px', flex: 'none', background: topRole.color ? hexA(topRole.color, 0.16) : 'var(--surface-3)', color: topRole.color || 'var(--text-2)' }}>{topRole.name}</span>}
            <RankBadge id={rank?.equipped?.badge} size={16} />
            {rank && <RankChip level={rank.level} title={rank.title} />}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: presenceColor(status), marginTop: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: presenceColor(status) }} />{PRESENCE_LABEL[status]}
          </div>
          {isOwn && myServerRank && <XpBar sr={myServerRank} />}
          {!isOwn && onOpenDm && (
            <button className="accent-btn no-drag" onClick={() => { onClose(); onOpenDm(m.authorId) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', marginTop: 14, borderRadius: 11, padding: '9px 0', fontWeight: 700, fontSize: 13.5 }}><MessageSquare size={15} /> Написать в ЛС</button>
          )}
        </div>
      </div>
    </>
  )
}

function EmojiPicker({ anchor, onPick, onClose }: { anchor: 'top' | 'bottom'; onPick: (e: string) => void; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
      <div style={{ position: 'absolute', zIndex: 41, width: 280, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 14px 34px -12px var(--shadow)', padding: 7, display: 'grid', gridTemplateColumns: 'repeat(8,1fr)', gap: 1, animation: 'popIn .15s cubic-bezier(.22,.61,.36,1)', transformOrigin: anchor === 'top' ? 'top right' : 'top left', ...(anchor === 'top' ? { top: 18, right: 10 } : { top: '100%', left: 55 }) }}>
      {EMOJIS.map((em) => (
        <button key={em} className="ib no-drag" onClick={() => onPick(em)} style={{ width: 32, height: 32, fontSize: 17, borderRadius: 8 }}>{em}</button>
      ))}
      </div>
    </>
  )
}

function AttachmentView({ a, onOpen }: { a: Attachment; onOpen: () => void }) {
  const isImage = a.contentType.startsWith('image/') && !!a.url
  if (isImage) {
    const maxW = 360, maxH = 300
    let w: number | undefined, h: number | undefined
    if (a.width && a.height) { const s = Math.min(1, maxW / a.width, maxH / a.height); w = Math.round(a.width * s); h = Math.round(a.height * s) }
    return (
      <div style={{ marginTop: 9, position: 'relative', width: w ?? 320, maxWidth: '100%', borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
        <img src={a.url} alt={a.filename ?? ''} onClick={onOpen} style={{ display: 'block', width: '100%', height: h, objectFit: 'cover', cursor: 'zoom-in' }} />
        <button className="no-drag" onClick={(e) => { e.stopPropagation(); downloadAttachment(a.url, a.filename) }} title="Скачать" style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, background: 'rgba(0,0,0,.5)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 'none', cursor: 'pointer' }}><Download size={15} /></button>
      </div>
    )
  }
  return (
    <div onClick={() => downloadAttachment(a.url, a.filename)} className="no-drag" title="Скачать" style={{ marginTop: 9, display: 'flex', alignItems: 'center', gap: 11, width: 320, maxWidth: '100%', cursor: 'pointer', color: 'var(--text)', border: '1px solid var(--border)', background: 'var(--surface-2)', borderRadius: 12, padding: '10px 13px' }}>
      <span style={{ width: 38, height: 38, flex: 'none', borderRadius: 9, background: 'var(--surface-3)', color: 'var(--text-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><FileIcon size={18} /></span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.filename ?? 'файл'}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text-3)' }}>{formatAttachmentSize(a.size) || a.contentType}</span>
      </span>
      <Download size={16} style={{ color: 'var(--text-3)', flex: 'none' }} />
    </div>
  )
}

function ToolBtn({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) {
  return (
    <button className="ib no-drag" onClick={onClick} title={title} style={{ width: 28, height: 26, fontSize: 14, color: danger ? 'var(--danger)' : undefined }}>{children}</button>
  )
}
