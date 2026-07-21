import { useEffect, useMemo, useState } from 'react'
import { Hash, Volume2, Play, Plus, MicOff, HeadphoneOff, VolumeX, ChevronDown, Settings, Check, Link } from 'lucide-react'
import type { Channel, ChannelType, Dm, Member, NotificationLevel, ReadState } from '@/lib/types'
import { voice, type VoiceState } from '@/lib/voice'
import { presence } from '@/lib/presence'
import { Avatar } from '@/components/Avatar'
import { toast } from '@/lib/toast'
import { MOCK } from '@/lib/config'
import { formatElapsed } from '@/lib/format'
import { ContextMenu, type ContextMenuItem } from '@/components/ui'
import { CreateChannelModal } from './CreateChannelModal'

const TYPE_ICON: Record<string, React.ReactNode> = { TEXT: <Hash size={17} />, VOICE: <Volume2 size={17} />, WATCH: <Play size={16} /> }

// Унифицированный житель голосового канала. rich=true — мы подключены к этому каналу и знаем
// живой стейт из LiveKit (говорит/мьют/громкость); rich=false — только членство из presence.
interface Occupant { userId: string; name: string; avatarUrl: string | null; speaking: boolean; micOn: boolean; deafened: boolean; volume: number; self: boolean; rich: boolean; joinedAt?: string | null }

// Левый сайдбар каналов в стиле Discord: категории → каналы, под голосовыми — кто там сейчас.
export function ChannelSidebar({
  channels, dms, members, readStates, currentId, voiceState, unread, meId, canManage, notifLevels, voiceSince, onPick, onEditChannel, onMarkRead, onSetNotif, onCreateChannel,
}: {
  channels: Channel[]
  dms: Dm[]
  members: Member[]
  readStates: ReadState[]
  currentId: string
  voiceState: VoiceState
  unread: Set<string>
  meId: string
  canManage: boolean // OWNER/ADMIN — показываем «Изменить/Удалить канал»
  notifLevels: Map<string, NotificationLevel>
  voiceSince?: Map<string, string> // userId → joinedAt: «сидит в комнате N» (api.voiceSince)
  onPick: (id: string) => void
  onEditChannel: (c: Channel) => void
  onMarkRead: (c: Channel) => void
  onSetNotif: (channelId: string, level: NotificationLevel) => void
  onCreateChannel: (p: { name: string; type: ChannelType }) => Promise<void>
}) {
  const [, setTick] = useState(0)
  useEffect(() => presence.subscribe(() => setTick((t) => t + 1)), []) // живой ростер голосовых (join/leave по WS)
  useEffect(() => { const t = window.setInterval(() => setTick((x) => x + 1), 30000); return () => window.clearInterval(t) }, []) // тик таймеров «в комнате»
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [createOpen, setCreateOpen] = useState(false)
  const [menu, setMenu] = useState<{ c: Channel; x: number; y: number } | null>(null) // ПКМ-контекст-меню канала

  const memberBy = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
  const rs = useMemo(() => Object.fromEntries(readStates.map((r) => [r.channelId, r])), [readStates])
  const firstVoiceId = useMemo(() => channels.find((c) => c.type === 'VOICE')?.id, [channels])

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

  // фиксированная разбивка по ТИПУ канала: текстовые → голосовые → кинотеатр (категории бэка для группировки не используем)
  const byPos = (a: { position: number }, b: { position: number }) => a.position - b.position
  const sections = useMemo(
    () => ([{ key: 'TEXT', title: 'Текстовые' }, { key: 'VOICE', title: 'Голосовые' }, { key: 'WATCH', title: 'Кинотеатр' }] as const)
      .map((s) => ({ ...s, list: channels.filter((c) => c.type === s.key).sort(byPos) })),
    [channels],
  )

  const renderChannel = (c: Channel) => (
    <ChannelRow key={c.id} c={c} rs={rs[c.id]} active={c.id === currentId} connected={c.id === voiceState.channelId} unread={unread.has(c.id)} occupants={occupantsOf(c)} onPick={onPick} onMenu={(e) => { e.preventDefault(); setMenu({ c, x: e.clientX, y: e.clientY }) }} />
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

  return (
    <aside style={{ width: 250, flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--surface)', borderRight: '1px solid var(--border)', overflow: 'hidden' }}>
      <div className="drag" style={{ height: 62, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontWeight: 800, fontSize: 16, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Каналы</div>
        <button className="ib no-drag" onClick={() => setCreateOpen(true)} title="Создать канал" style={{ width: 32, height: 32 }}><Plus size={17} /></button>
      </div>

      <div style={{ overflow: 'auto', flex: 1, padding: '10px 8px 16px' }}>
        {sections.map((s, i) => {
          if (s.list.length === 0) return null
          const isCol = collapsed.has(s.key)
          return (
            <div key={s.key} style={{ marginTop: i === 0 ? 0 : 12 }}>
              <button
                className="no-drag"
                onClick={() => setCollapsed((c) => { const n = new Set(c); n.has(s.key) ? n.delete(s.key) : n.add(s.key); return n })}
                style={{ display: 'flex', alignItems: 'center', gap: 3, width: '100%', border: 'none', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 6px 5px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}
              >
                <ChevronDown size={12} style={{ transform: isCol ? 'rotate(-90deg)' : undefined, transition: 'transform .15s', flex: 'none' }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title}</span>
              </button>
              {!isCol && s.list.map(renderChannel)}
            </div>
          )
        })}

        {dms.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ padding: '4px 6px 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', textTransform: 'uppercase' }}>Личные</div>
            {dms.map((d) => {
              const active = d.id === currentId
              return (
                <button key={d.id} className={`chan-row no-drag${active ? ' active' : ''}`} onClick={() => onPick(d.id)} style={rowStyle(active)}>
                  <Avatar name={d.name} src={d.avatarUrl} size={22} />
                  <span style={nameStyle(active, unread.has(d.id) && !active)}>{d.name}</span>
                  {unread.has(d.id) && !active && <span style={DOT} />}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {createOpen && <CreateChannelModal onCreate={onCreateChannel} onClose={() => setCreateOpen(false)} />}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.c)} onClose={() => setMenu(null)} layer="menuTop" />}
    </aside>
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
