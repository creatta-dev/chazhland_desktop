import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import { Message } from './Message'
import { Skeleton } from '@/components/Skeleton'
import { roleColor, highestRole } from '@/lib/roles'
import { dayKey, formatDayDivider } from '@/lib/format'
import type { Member, MemberRank, Message as Msg, ReadState, ServerRankInfo, ServerRole } from '@/lib/types'

const GROUP_GAP_MS = 5 * 60 * 1000 // серия одного автора рвётся после 5 минут паузы

function pluralNew(n: number): string {
  const a = n % 100, b = n % 10
  if (a > 10 && a < 20) return 'новых сообщений'
  if (b === 1) return 'новое сообщение'
  if (b >= 2 && b <= 4) return 'новых сообщения'
  return 'новых сообщений'
}

export function ChatFeed({ messages, readState, membersById, roles, ranks, myServerRank, myProfileBgUrl, onReact, meId, meName, canModerate, onReply, onEdit, onDelete, onPin, onOpenDm, onMarkUnread, onLoadOlder, hasMore, loadingOlder, loading, targetId, onTargetConsumed, detached, onJumpToPresent }: {
  messages: Msg[]
  readState?: ReadState
  membersById?: Map<string, Member> // для резолва имени/аватара автора по authorId на момент рендера
  roles?: ServerRole[] // кастомные роли — для цвета ника/бейджа автора
  ranks?: Map<string, MemberRank> // ранг-чип у автора
  myServerRank?: ServerRankInfo // мой прогресс на сервере (XP-бар в своём мини-профиле)
  myProfileBgUrl?: string | null // моя загруженная картинка фона профиля (баннер своего мини-профиля)
  onReact?: (messageId: string, emoji: string) => void
  meId?: string
  meName?: string
  canModerate?: boolean
  onReply?: (m: Msg) => void
  onEdit?: (id: string, content: string) => void
  onDelete?: (id: string) => void
  onPin?: (id: string, pinned: boolean) => void
  onOpenDm?: (userId: string) => void
  onMarkUnread?: (beforeMessageId: string | null) => void
  onLoadOlder?: () => void
  hasMore?: boolean
  loadingOlder?: boolean
  loading?: boolean
  targetId?: string | null // сообщение, к которому надо проскроллить (переход из поиска/пинов)
  onTargetConsumed?: () => void
  detached?: boolean // лента показывает историческое окно — показываем кнопку «к последним»
  onJumpToPresent?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<{ h: number; t: number } | null>(null)
  const targetRef = useRef<string | null>(null)
  targetRef.current = targetId ?? null
  const scrolledFor = useRef<string | null>(null)
  const onConsumeRef = useRef(onTargetConsumed)
  onConsumeRef.current = onTargetConsumed
  const atBottomRef = useRef(true) // был ли пользователь у низа ленты перед новым сообщением
  const [showJump, setShowJump] = useState(false) // прокрутил вверх — показать кнопку «вниз»
  const [newCount, setNewCount] = useState(0)      // сколько новых сообщений пришло, пока листал вверх
  const lastId = messages[messages.length - 1]?.id
  function scrollToBottom() { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; atBottomRef.current = true; setShowJump(false); setNewCount(0) }
  // новое последнее сообщение/смена канала: если пользователь у низа — доскроллить; если листает вверх —
  // НЕ дёргать ленту, а копить счётчик и показать кнопку «вниз». (Не при подгрузке старых и не при переходе к цели.)
  useEffect(() => {
    if (anchorRef.current || targetRef.current) return
    if (atBottomRef.current) { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight }
    else { setNewCount((c) => c + 1); setShowJump(true) }
  }, [lastId])
  // переход к сообщению: ждём, пока узел появится в DOM (окно контекста уже загружено), скроллим к центру.
  // Зависит от messages (узел может отрендериться на следующий тик), но скроллим один раз на цель.
  useEffect(() => {
    if (!targetId) { scrolledFor.current = null; return }
    if (scrolledFor.current === targetId) return
    const el = scrollRef.current?.querySelector(`[data-mid="${CSS.escape(targetId)}"]`) as HTMLElement | null
    if (!el) return // ещё не отрендерен — повторим, когда messages обновятся
    scrolledFor.current = targetId
    el.scrollIntoView({ block: 'center' })
  }, [targetId, messages])
  // снятие подсветки — ОТДЕЛЬНЫЙ таймер, завязанный только на targetId, чтобы перерисовки
  // (новые messages / новый onTargetConsumed) не отменяли и не теряли его
  useEffect(() => {
    if (!targetId) return
    const t = setTimeout(() => onConsumeRef.current?.(), 1800)
    return () => clearTimeout(t)
  }, [targetId])
  // при добавлении старых сообщений сверху — сохраняем видимую позицию
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && anchorRef.current) {
      el.scrollTop = el.scrollHeight - anchorRef.current.h + anchorRef.current.t
      anchorRef.current = null
    }
  }, [messages])
  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    atBottomRef.current = atBottom
    if (atBottom) { if (showJump) setShowJump(false); if (newCount) setNewCount(0) }
    else if (!showJump && !detached) setShowJump(true) // прокрутил вверх вручную
    if (hasMore && !loadingOlder && el.scrollTop < 80) { anchorRef.current = { h: el.scrollHeight, t: el.scrollTop }; onLoadOlder?.() }
  }

  // индекс первого непрочитанного (после lastReadMessageId)
  let firstUnread = -1
  if (readState?.lastReadMessageId) {
    const idx = messages.findIndex((m) => m.id === readState.lastReadMessageId)
    if (idx >= 0 && idx < messages.length - 1) firstUnread = idx + 1
  }

  return (
    <div ref={scrollRef} onScroll={onScroll} style={{ flex: 1, overflow: 'auto', padding: '20px 26px 8px', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {loading && messages.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 6 }}>
          {[60, 80, 45, 70, 55].map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 13, padding: '4px 0' }}>
              <Skeleton w={42} h={42} r={42} style={{ flex: 'none' }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <Skeleton w={120} h={11} />
                <Skeleton w={`${w}%`} h={13} />
              </div>
            </div>
          ))}
        </div>
      )}
      {loadingOlder && <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 12, padding: '6px 0' }}>Загрузка…</div>}
      {!hasMore && !loading && messages.length > 0 && <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 11.5, padding: '8px 0 6px' }}>Начало канала</div>}
      {!loading && messages.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13, padding: '40px 0' }}>
          В канале пока нет сообщений — напишите первым.
        </div>
      )}
      {messages.map((m, i) => {
        const prev = messages[i - 1]
        const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
        const isUnread = i === firstUnread
        const grouped = !newDay && !isUnread && !!prev && prev.authorId === m.authorId && !prev.deleted && !m.deleted &&
          new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_GAP_MS
        const author = membersById?.get(m.authorId)
        const rl = roles ?? []
        const nameColor = roleColor(author?.roleIds, rl)
        const top = highestRole(author?.roleIds, rl)
        return (
          <Fragment key={m.id}>
            {newDay && <Divider label={formatDayDivider(m.createdAt)} />}
            {isUnread && <UnreadDivider />}
            <Message m={m} authorName={author?.username} authorAvatarUrl={author ? author.avatarUrl : undefined} nameColor={nameColor} topRole={top ? { name: top.name, color: top.color } : null} rank={ranks?.get(m.authorId)} myServerRank={myServerRank} myProfileBgUrl={myProfileBgUrl} grouped={grouped} highlight={m.id === targetId} meId={meId} meName={meName} canModerate={canModerate} onReact={(emoji) => onReact?.(m.id, emoji)} onReply={onReply} onEdit={onEdit} onDelete={onDelete} onPin={onPin} onOpenDm={onOpenDm} onMarkUnread={() => onMarkUnread?.(prev ? prev.id : null)} />
          </Fragment>
        )
      })}
      {showJump && !detached && (
        <button onClick={scrollToBottom} className="no-drag" style={{ position: 'sticky', bottom: 8, alignSelf: 'center', marginTop: 6, display: 'flex', alignItems: 'center', gap: 7, background: newCount > 0 ? 'var(--accent)' : 'var(--surface-3)', color: newCount > 0 ? '#fff' : 'var(--text)', border: newCount > 0 ? 'none' : '1px solid var(--border)', borderRadius: 30, padding: '7px 15px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 22px -8px var(--shadow)' }}>
          {newCount > 0 ? `${newCount} ${pluralNew(newCount)}` : 'Вниз'} <ArrowDown size={15} />
        </button>
      )}
      {detached && (
        <button onClick={onJumpToPresent} className="no-drag" style={{ position: 'sticky', bottom: 8, alignSelf: 'center', marginTop: 6, display: 'flex', alignItems: 'center', gap: 7, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 30, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 22px -6px var(--accent)' }}>
          К последним сообщениям <ArrowDown size={15} />
        </button>
      )}
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, margin: '6px 0 14px' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-3)' }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
    </div>
  )
}

function UnreadDivider() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '10px 0' }}>
      <div style={{ flex: 1, height: 1, background: 'var(--accent)' }} />
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', color: 'var(--accent)' }}>НОВЫЕ СООБЩЕНИЯ</span>
      <div style={{ flex: 1, height: 1, background: 'var(--accent)' }} />
    </div>
  )
}
