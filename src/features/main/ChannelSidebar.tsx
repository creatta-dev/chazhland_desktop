import { useEffect, useMemo, useState } from 'react'
import { Hash, Volume2, Play, Plus, MicOff, HeadphoneOff, VolumeX, ChevronDown, Settings, Check, Link, Users, Lock, FolderPlus, Pencil, Trash2 } from 'lucide-react'
import type { Category, Channel, ChannelType, Dm, Member, NotificationLevel, ReadState } from '@/lib/types'
import { voice, type VoiceState } from '@/lib/voice'
import { presence } from '@/lib/presence'
import { friends } from '@/lib/friends'
import { Avatar } from '@/components/Avatar'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { MOCK } from '@/lib/config'
import { formatElapsed } from '@/lib/format'
import { ContextMenu, type ContextMenuItem } from '@/components/ui'
import { ConfirmModal } from '@/features/admin/modals'
import { CreateChannelModal } from './CreateChannelModal'
import { NameModal } from './NameModal'

const TYPE_ICON: Record<string, React.ReactNode> = { TEXT: <Hash size={17} />, VOICE: <Volume2 size={17} />, WATCH: <Play size={16} /> }
// имена групп, которые получили старые серверы при переходе на категории (V26) и новые — от сидера
const DEFAULT_GROUP: Record<string, string> = { TEXT: 'Текстовые', VOICE: 'Голосовые', WATCH: 'Кинотеатр' }
const NONE = '__none__' // ключ группы «без категории» (наверху списка, без заголовка)

// Унифицированный житель голосового канала. rich=true — мы подключены к этому каналу и знаем
// живой стейт из LiveKit (говорит/мьют/громкость); rich=false — только членство из presence.
interface Occupant { userId: string; name: string; avatarUrl: string | null; speaking: boolean; micOn: boolean; deafened: boolean; volume: number; self: boolean; rich: boolean; joinedAt?: string | null }

interface Group { key: string; category: Category | null; list: Channel[] }
type Drag = { kind: 'channel' | 'category'; id: string } | null
type Hint = { kind: 'channel'; group: string; index: number } | { kind: 'category'; index: number } | null

// Левый сайдбар каналов в стиле Discord: группы (категории сервера) → каналы, под голосовыми — кто там сейчас.
// Админ (canManage) перетаскивает группы и каналы (в т.ч. между группами), создаёт/переименовывает/удаляет
// группы. Изменения применяются оптимистично в MainWindow; остальным они приходят сигналом .tree по WS.
export function ChannelSidebar({
  channels, categories, dms, members, readStates, currentId, voiceState, unread, meId, canManage, notifLevels, voiceSince,
  friendsActive, onOpenFriends, onPick, onEditChannel, onMarkRead, onSetNotif, onCreateChannel,
  onCreateCategory, onRenameCategory, onDeleteCategory, onReorderCategories, onLayoutChannels,
}: {
  channels: Channel[]
  categories: Category[]
  dms: Dm[]
  members: Member[]
  readStates: ReadState[]
  currentId: string
  voiceState: VoiceState
  unread: Set<string>
  meId: string
  canManage: boolean // OWNER/ADMIN — правка каналов и групп, перетаскивание
  notifLevels: Map<string, NotificationLevel>
  voiceSince?: Map<string, string> // userId → joinedAt: «сидит в комнате N» (api.voiceSince)
  friendsActive: boolean
  onOpenFriends: () => void
  onPick: (id: string) => void
  onEditChannel: (c: Channel) => void
  onMarkRead: (c: Channel) => void
  onSetNotif: (channelId: string, level: NotificationLevel) => void
  onCreateChannel: (p: { name: string; type: ChannelType; categoryId: string | null }) => Promise<void>
  onCreateCategory: (name: string) => Promise<void>
  onRenameCategory: (id: string, name: string) => Promise<void>
  onDeleteCategory: (id: string) => Promise<void>
  onReorderCategories: (orderedIds: string[]) => void
  onLayoutChannels: (items: { id: string; categoryId: string | null }[]) => void
}) {
  const [, setTick] = useState(0)
  useEffect(() => presence.subscribe(() => setTick((t) => t + 1)), []) // живой ростер голосовых (join/leave по WS)
  useEffect(() => friends.subscribe(() => setTick((t) => t + 1)), []) // бейдж заявок + замки на ЛС
  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 30000); return () => window.clearInterval(t) }, []) // тик таймеров «в комнате»
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [createFor, setCreateFor] = useState<{ categoryId?: string | null } | null>(null) // открыта «Создать канал» (опц. — в группу)
  const [menu, setMenu] = useState<{ c: Channel; x: number; y: number } | null>(null) // ПКМ-меню канала
  const [catMenu, setCatMenu] = useState<{ cat: Category; x: number; y: number } | null>(null) // ПКМ-меню группы
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null) // «+» в шапке: канал / группа
  const [nameModal, setNameModal] = useState<{ mode: 'create' } | { mode: 'rename'; cat: Category } | null>(null)
  const [deleteCat, setDeleteCat] = useState<Category | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [drag, setDrag] = useState<Drag>(null)
  const [hint, setHint] = useState<Hint>(null)

  const memberBy = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
  const rs = useMemo(() => Object.fromEntries(readStates.map((r) => [r.channelId, r])), [readStates])
  const firstVoiceId = useMemo(() => channels.find((c) => c.type === 'VOICE')?.id, [channels])

  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sortedCats = useMemo(() => [...categories].sort(byPos), [categories])
  // группы: «без категории» наверху (без заголовка, как в Discord) + категории сервера по position
  const groups = useMemo<Group[]>(() => {
    const known = new Set(sortedCats.map((c) => c.id))
    return [
      { key: NONE, category: null, list: channels.filter((c) => !c.categoryId || !known.has(c.categoryId)).sort(byPos) },
      ...sortedCats.map((cat) => ({ key: cat.id, category: cat, list: channels.filter((c) => c.categoryId === cat.id).sort(byPos) })),
    ]
  }, [channels, sortedCats])

  // кто сейчас в голосовом: свой подключённый канал → живые участники LiveKit (speaking/мьют/громкость),
  // остальные → членство из presence (бэк знает по LiveKit-вебхукам, но без мьют-стейта). В mock — демо-ростер.
  function occupantsOf(ch: Channel): Occupant[] {
    if (ch.type !== 'VOICE') return []
    if (voiceState.channelId === ch.id && voiceState.participants.length) {
      return voiceState.participants.map((p) => ({
        userId: p.id, name: memberBy.get(p.id)?.username || p.name, avatarUrl: memberBy.get(p.id)?.avatarUrl ?? null,
        speaking: p.speaking, micOn: p.micOn, deafened: p.deafened, volume: p.volume, self: p.id === meId, rich: true,
        joinedAt: voiceSince?.get(p.id) ?? null,
      }))
    }
    const ids = MOCK ? (ch.id === firstVoiceId ? members.filter((m) => m.inVoice).map((m) => m.userId) : []) : presence.voiceMembers(ch.id)
    return ids.map((id) => {
      const m = memberBy.get(id)
      return { userId: id, name: m?.username || 'участник', avatarUrl: m?.avatarUrl ?? null, speaking: false, micOn: true, deafened: false, volume: 1, self: id === meId, rich: false, joinedAt: voiceSince?.get(id) ?? null }
    })
  }

  // куда по умолчанию класть новый канал: группа, где уже есть каналы этого типа, иначе — с «типовым» именем
  function defaultCategoryFor(type: ChannelType): string | null {
    for (const g of groups) if (g.category && g.list.some((c) => c.type === type)) return g.category.id
    const want = DEFAULT_GROUP[type]?.toLowerCase()
    return sortedCats.find((c) => c.name.trim().toLowerCase() === want)?.id ?? null
  }

  // ---------------- drag-n-drop (только canManage) ----------------
  function endDrag() { setDrag(null); setHint(null) }

  function overChannel(e: React.DragEvent, group: string, index: number) {
    if (drag?.kind !== 'channel') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    const after = e.clientY > r.top + r.height / 2
    setHint({ kind: 'channel', group, index: index + (after ? 1 : 0) })
  }
  function overGroupStart(e: React.DragEvent, group: string) { // заголовок группы / пустая зона → в начало группы
    if (drag?.kind !== 'channel') return
    e.preventDefault()
    e.stopPropagation()
    setHint({ kind: 'channel', group, index: 0 })
  }
  function overCategory(e: React.DragEvent, catIndex: number) {
    if (drag?.kind !== 'category') return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const r = e.currentTarget.getBoundingClientRect()
    setHint({ kind: 'category', index: catIndex + (e.clientY > r.top + r.height / 2 ? 1 : 0) })
  }

  function drop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const d = drag, h = hint
    endDrag()
    if (!d || !h) return
    if (d.kind === 'category' && h.kind === 'category') {
      const before = sortedCats.map((c) => c.id)
      const ids = before.slice()
      const from = ids.indexOf(d.id)
      if (from < 0) return
      ids.splice(from, 1)
      ids.splice(h.index > from ? h.index - 1 : h.index, 0, d.id)
      if (ids.join() !== before.join()) onReorderCategories(ids)
      return
    }
    if (d.kind === 'channel' && h.kind === 'channel') {
      const arr = groups.map((g) => ({ key: g.key, catId: g.category?.id ?? null, ids: g.list.map((c) => c.id) }))
      const src = arr.find((g) => g.ids.includes(d.id))
      const dst = arr.find((g) => g.key === h.group)
      if (!src || !dst) return
      const from = src.ids.indexOf(d.id)
      src.ids.splice(from, 1)
      dst.ids.splice(src === dst && h.index > from ? h.index - 1 : h.index, 0, d.id)
      const items = arr.flatMap((g) => g.ids.map((id) => ({ id, categoryId: g.catId })))
      const sig = (xs: { id: string; categoryId: string | null }[]) => xs.map((x) => `${x.id}:${x.categoryId ?? ''}`).join()
      const before = groups.flatMap((g) => g.list.map((c) => ({ id: c.id, categoryId: g.category?.id ?? null })))
      if (sig(items) !== sig(before)) onLayoutChannels(items)
    }
  }

  const Line = () => <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '1px 6px' }} />

  const renderChannel = (c: Channel, group: string, index: number) => (
    <div key={c.id}
      draggable={canManage}
      onDragStart={(e) => { if (!canManage) return; e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.id); setDrag({ kind: 'channel', id: c.id }) }}
      onDragOver={(e) => overChannel(e, group, index)}
      onDrop={drop}
      onDragEnd={endDrag}
      style={{ opacity: drag?.kind === 'channel' && drag.id === c.id ? 0.4 : 1 }}>
      {hint?.kind === 'channel' && hint.group === group && hint.index === index && <Line />}
      <ChannelRow c={c} rs={rs[c.id]} active={c.id === currentId} connected={c.id === voiceState.channelId} unread={unread.has(c.id)} occupants={occupantsOf(c)} onPick={onPick} onMenu={(e) => { e.preventDefault(); setMenu({ c, x: e.clientX, y: e.clientY }) }} />
    </div>
  )

  const menuItems = (c: Channel): ContextMenuItem[] => {
    const items: ContextMenuItem[] = []
    if (canManage) items.push({ label: 'Изменить канал', icon: <Settings size={15} />, onClick: () => onEditChannel(c) })
    if (c.type !== 'VOICE') items.push({ label: 'Отметить прочитанным', icon: <Check size={15} />, onClick: () => onMarkRead(c) })
    items.push({ label: 'Копировать ссылку', icon: <Link size={15} />, onClick: () => navigator.clipboard?.writeText(`chazhland://channel/${c.id}`).then(() => toast.ok('Ссылка скопирована')).catch(() => {}) })
    if (c.type !== 'VOICE') {
      const lvl = notifLevels.get(c.id) ?? 'ALL'
      items.push({ label: 'Уведомления', header: true })
      ;([['ALL', 'Все сообщения'], ['MENTIONS', 'Только упоминания'], ['MUTED', 'Без звука']] as [NotificationLevel, string][]).forEach(([v, l]) =>
        items.push({ label: l, icon: lvl === v ? <Check size={15} /> : <span style={{ width: 15, display: 'inline-block' }} />, onClick: () => onSetNotif(c.id, v) }))
    }
    return items
  }
  const catMenuItems = (cat: Category): ContextMenuItem[] => [
    { label: 'Создать канал здесь', icon: <Plus size={15} />, onClick: () => setCreateFor({ categoryId: cat.id }) },
    { label: 'Переименовать группу', icon: <Pencil size={15} />, onClick: () => setNameModal({ mode: 'rename', cat }) },
    { label: 'Удалить группу', icon: <Trash2 size={15} />, danger: true, onClick: () => setDeleteCat(cat) },
  ]

  const friendList = friends.get()
  const requests = friendList.incoming.length
  const draggingChannel = drag?.kind === 'channel'

  return (
    <aside style={{ width: 250, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
      <div className="drag" style={{ height: 62, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 800, fontSize: 16, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Каналы</div>
        <button className="ib no-drag" title={canManage ? 'Создать канал или группу' : 'Создать канал'} style={{ width: 32, height: 32 }}
          onClick={(e) => {
            if (!canManage) { setCreateFor({}); return }
            const r = e.currentTarget.getBoundingClientRect()
            setAddMenu({ x: r.left, y: r.bottom + 4 })
          }}><Plus size={17} /></button>
      </div>

      <div style={{ overflow: 'auto', flex: 1, padding: '10px 8px 16px' }} onDragOver={(e) => { if (drag) e.preventDefault() }} onDrop={drop}>
        {groups.map((g) => {
          // ---- «без группы»: наверху, без заголовка; пока тащат канал — видна как зона сброса
          if (!g.category) {
            if (g.list.length === 0) {
              return draggingChannel
                ? <DropZone key={g.key} label="Без группы" active={hint?.kind === 'channel' && hint.group === g.key} onDragOver={(e) => overGroupStart(e, g.key)} onDrop={drop} />
                : null
            }
            return (
              <div key={g.key} style={{ marginBottom: 6 }}>
                {g.list.map((c, i) => renderChannel(c, g.key, i))}
                {hint?.kind === 'channel' && hint.group === g.key && hint.index === g.list.length && <Line />}
              </div>
            )
          }
          // ---- категория
          const cat = g.category
          const myIndex = sortedCats.findIndex((c) => c.id === cat.id)
          if (g.list.length === 0 && !canManage) return null // пустые группы видит только тот, кто может их наполнить
          const isCol = collapsed.has(cat.id)
          return (
            <div key={g.key} onDragOver={(e) => overCategory(e, myIndex)} onDrop={drop}
              style={{ marginTop: 10, opacity: drag?.kind === 'category' && drag.id === cat.id ? 0.4 : 1 }}>
              {hint?.kind === 'category' && hint.index === myIndex && <Line />}
              <button
                className="no-drag"
                draggable={canManage}
                onDragStart={(e) => { if (!canManage) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cat.id); setDrag({ kind: 'category', id: cat.id }) }}
                onDragOver={(e) => overGroupStart(e, cat.id)}
                onDragEnd={endDrag}
                onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); return n })}
                onContextMenu={(e) => { if (!canManage) return; e.preventDefault(); setCatMenu({ cat, x: e.clientX, y: e.clientY }) }}
                title={canManage ? 'Перетащите, чтобы изменить порядок · ПКМ — меню группы' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', border: 'none', background: hint?.kind === 'channel' && hint.group === cat.id && hint.index === 0 && draggingChannel ? 'var(--accent-tint)' : 'transparent', borderRadius: 6, color: 'var(--text-3)', cursor: canManage ? 'grab' : 'pointer', padding: '4px 6px 5px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}
              >
                <ChevronDown size={12} style={{ transform: isCol ? 'rotate(-90deg)' : undefined, transition: 'transform .15s', flex: 'none' }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cat.name}</span>
              </button>
              {!isCol && g.list.map((c, i) => renderChannel(c, g.key, i))}
              {!isCol && g.list.length > 0 && hint?.kind === 'channel' && hint.group === g.key && hint.index === g.list.length && <Line />}
              {!isCol && g.list.length === 0 && draggingChannel && (
                <DropZone label="Перетащите канал сюда" active={hint?.kind === 'channel' && hint.group === g.key} onDragOver={(e) => overGroupStart(e, g.key)} onDrop={drop} />
              )}
            </div>
          )
        })}
        {hint?.kind === 'category' && hint.index === sortedCats.length && <Line />}

        <div style={{ marginTop: 16 }}>
          <button className={`chan-row no-drag${friendsActive ? ' active' : ''}`} onClick={onOpenFriends} style={rowStyle(friendsActive)}>
            <span style={{ display: 'flex', flex: 'none', color: friendsActive ? 'var(--accent)' : 'var(--text-3)' }}><Users size={17} /></span>
            <span style={nameStyle(friendsActive, requests > 0)}>Друзья</span>
            {requests > 0 && <span title="Заявки в друзья" style={{ flex: 'none', background: 'var(--danger)', color: '#fff', borderRadius: 30, fontSize: 10, fontWeight: 700, padding: '0 6px', minWidth: 17, textAlign: 'center' }}>{requests}</span>}
          </button>
          {dms.length > 0 && (
            <>
              <div style={{ padding: '10px 6px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', textTransform: 'uppercase' }}>Личные</div>
              {dms.map((d) => {
                const active = d.id === currentId
                const locked = friends.loaded && !friends.isFriend(d.otherUserId)
                return (
                  <button key={d.id} className={`chan-row no-drag${active ? ' active' : ''}`} onClick={() => onPick(d.id)} style={rowStyle(active)}>
                    <Avatar name={d.name} src={d.avatarUrl} size={22} />
                    <span style={nameStyle(active, unread.has(d.id) && !active)}>{d.name}</span>
                    {locked && <span title="Не в друзьях — переписка только для чтения" style={{ display: 'flex', flex: 'none', color: 'var(--text-3)' }}><Lock size={12} /></span>}
                    {unread.has(d.id) && !active && <span style={DOT} />}
                  </button>
                )
              })}
            </>
          )}
        </div>
      </div>

      {createFor && <CreateChannelModal categories={categories} defaultCategoryFor={defaultCategoryFor} initialCategoryId={createFor.categoryId} onCreate={onCreateChannel} onClose={() => setCreateFor(null)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.c)} onClose={() => setMenu(null)} layer="menuTop" />}
      {catMenu && <ContextMenu x={catMenu.x} y={catMenu.y} items={catMenuItems(catMenu.cat)} onClose={() => setCatMenu(null)} layer="menuTop" />}
      {addMenu && <ContextMenu x={addMenu.x} y={addMenu.y} onClose={() => setAddMenu(null)} layer="menuTop" items={[
        { label: 'Создать канал', icon: <Hash size={15} />, onClick: () => setCreateFor({}) },
        { label: 'Создать группу', icon: <FolderPlus size={15} />, onClick: () => setNameModal({ mode: 'create' }) },
      ]} />}
      {nameModal?.mode === 'create' && (
        <NameModal title="Создать группу" label="Название группы" placeholder="например, Игры" confirmLabel="Создать" onSubmit={async (n) => { await onCreateCategory(n); toast.ok('Группа создана') }} onClose={() => setNameModal(null)} />
      )}
      {nameModal?.mode === 'rename' && (
        <NameModal title="Переименовать группу" label="Название группы" initial={nameModal.cat.name} confirmLabel="Сохранить" onSubmit={(n) => onRenameCategory(nameModal.cat.id, n)} onClose={() => setNameModal(null)} />
      )}
      {deleteCat && (
        <ConfirmModal title="Удалить группу" danger confirmLabel="Удалить" busy={deleting}
          message={`Удалить группу «${deleteCat.name}»? Каналы не удалятся — переедут наверх, «без группы».`}
          onConfirm={async () => {
            setDeleting(true)
            try { await onDeleteCategory(deleteCat.id); toast.ok('Группа удалена'); setDeleteCat(null) }
            catch (e) { toast.error(apiError(e, 'Не удалось удалить группу')) }
            finally { setDeleting(false) }
          }}
          onClose={() => setDeleteCat(null)} />
      )}
    </aside>
  )
}

function DropZone({ label, active, onDragOver, onDrop }: { label: string; active: boolean; onDragOver: (e: React.DragEvent) => void; onDrop: (e: React.DragEvent) => void }) {
  return (
    <div onDragOver={onDragOver} onDrop={onDrop}
      style={{ margin: '4px 6px', padding: '9px 10px', borderRadius: 9, border: `1.5px dashed ${active ? 'var(--accent)' : 'var(--border-2)'}`, background: active ? 'var(--accent-tint)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-3)', fontSize: 12, textAlign: 'center' }}>
      {label}
    </div>
  )
}

function ChannelRow({ c, rs, active, connected, unread, occupants, onPick, onMenu }: {
  c: Channel; rs?: ReadState; active: boolean; connected: boolean; unread: boolean; occupants: Occupant[]; onPick: (id: string) => void; onMenu: (e: React.MouseEvent) => void
}) {
  const mentions = rs?.mentionCount ?? 0
  const hl = unread && !active // непрочитанные (но не открытый сейчас) — ярче
  return (
    <div>
      <button className={`chan-row no-drag${active ? ' active' : ''}`} onClick={() => onPick(c.id)} onContextMenu={onMenu} style={rowStyle(active)}>
        <span style={{ display: 'flex', flex: 'none', color: active ? 'var(--accent)' : connected ? 'var(--green)' : 'var(--text-3)' }}>{TYPE_ICON[c.type]}</span>
        <span style={nameStyle(active, hl)}>{c.name}</span>
        {mentions > 0 && !active && <span style={{ flex: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 30, fontSize: 10, fontWeight: 700, padding: '0 6px', minWidth: 17, textAlign: 'center' }}>{mentions}</span>}
        {hl && mentions === 0 && <span style={DOT} />}
        {c.type === 'VOICE' && occupants.length > 0 && <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: connected ? 'var(--green)' : 'var(--text-3)' }}>{occupants.length}</span>}
      </button>
      {c.type === 'VOICE' && occupants.map((o) => <OccupantRow key={o.userId} o={o} />)}
    </div>
  )
}

// Строка участника под голосовым каналом: аватар + ник, для своего канала — индикаторы мьюта
// и персональная громкость собеседника (слайдер раскрывается инлайн под строкой).
function OccupantRow({ o }: { o: Occupant }) {
  const [volOpen, setVolOpen] = useState(false)
  const pct = Math.round(o.volume * 100)
  return (
    <div>
      <div className="member-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px 4px 26px' }}>
        <Avatar name={o.name} src={o.avatarUrl} size={22} speaking={o.speaking} />
        <span style={{ fontSize: 13, fontWeight: 500, color: o.speaking ? 'var(--green)' : 'var(--text-2)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {o.name}{o.self && ' (вы)'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, flex: 'none' }}>
          {formatElapsed(o.joinedAt) && <span title="В голосовом без выхода" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' }}>{formatElapsed(o.joinedAt)}</span>}
          {o.rich && o.deafened && <span style={{ color: 'var(--danger)', display: 'flex' }} title="Звук выключен"><HeadphoneOff size={12} /></span>}
          {o.rich && !o.micOn && <span style={{ color: 'var(--danger)', display: 'flex' }} title="Микрофон выключен"><MicOff size={12} /></span>}
          {o.rich && !o.self && (
            <button className="ib no-drag" title="Громкость" onClick={() => setVolOpen((v) => !v)} style={{ width: 22, height: 22, color: volOpen || o.volume !== 1 ? 'var(--accent)' : 'var(--text-3)' }}>
              {o.volume === 0 ? <VolumeX size={12} /> : <Volume2 size={12} />}
            </button>
          )}
        </span>
      </div>
      {volOpen && o.rich && !o.self && (
        <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 6px 26px' }}>
          <input type="range" min={0} max={200} step={5} value={pct} onChange={(e) => voice.setParticipantVolume(o.userId, Number(e.target.value) / 100)} style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-2)', width: 32, textAlign: 'right' }}>{pct}%</span>
        </div>
      )}
    </div>
  )
}

// фон/ховер/активность ведёт класс .chan-row (инлайн-фон у <button> перебил бы :hover) — здесь только раскладка
function rowStyle(active: boolean): React.CSSProperties {
  return { display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left', borderRadius: 9, padding: '7px 9px', marginBottom: 1, color: active ? 'var(--accent)' : 'var(--text-2)' }
}
function nameStyle(active: boolean, hl: boolean): React.CSSProperties {
  return { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 14, fontWeight: active || hl ? 700 : 500, color: active ? 'var(--accent)' : hl ? 'var(--text)' : 'var(--text-2)' }
}
const DOT: React.CSSProperties = { flex: 'none', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }
