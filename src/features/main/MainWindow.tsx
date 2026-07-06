import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ServerTree } from '@/lib/api'
import { useAuth } from '@/store/auth'
import { voice, type VoiceState } from '@/lib/voice'
import { talkHeartbeat } from '@/lib/talkHeartbeat'
import { LevelUpCelebration } from '@/components/LevelUpCelebration'
import { presence } from '@/lib/presence'
import type { AchievementEvent, AfkEvent, AttachmentInput, Channel, ChannelType, Dm, Member, MemberRank, Message, MyRank, NotificationLevel, Presence, QuorumEvent, RankEvent, ReadState, ServerRankInfo, ServerRole, ServerSummary } from '@/lib/types'
import { ChatFeed } from './ChatFeed'
import { Composer } from './Composer'
import { MembersRail } from './MembersRail'
import { ChannelSidebar } from './ChannelSidebar'
import { GuildRail } from './GuildRail'
import { ServerActionsModal } from './ServerActionsModal'
import { ChannelSettingsModal } from './ChannelSettingsModal'
import { BottomBar } from './BottomBar'
import { WatchView } from './WatchView'
import { ScreenSharePane } from './ScreenSharePane'
import { ScreenPicker } from './ScreenPicker'
import { SettingsModal, type SettingsTab } from './SettingsModal'
import { ChatPanel } from './ChatPanel'
import { StatsPanel } from './StatsPanel'
import { MuseumPanel } from './MuseumPanel'
import { AchievementsPanel } from './AchievementsPanel'
import { ProfileModal } from './ProfileModal'
import { UpdateModal } from './UpdateModal'
import { AdminScreen } from '@/features/admin/AdminScreen'
import { ws } from '@/lib/ws'
import { toast } from '@/lib/toast'
import { mentionsUser } from '@/lib/mentions'
import { sfx } from '@/lib/sfx'
import { notifyPrefs } from '@/lib/prefs'
import { Search, Pin, Bell, Users, Hash, Volume2, Play, AtSign, BarChart3, Lock, Trophy, Medal } from 'lucide-react'

const TYPE_ICON: Record<ChannelType, React.ReactNode> = { TEXT: <Hash size={18} />, VOICE: <Volume2 size={18} />, WATCH: <Play size={18} />, DM: <AtSign size={18} /> }

// Превью ответа для live-сообщения: бэк шлёт только replyToId, поэтому автора/текст родителя
// берём из уже загруженных сообщений канала (на полной перезагрузке его строит api.mapMessage).
function resolveReplyPreview(m: Message, loaded: Message[]): Message {
  if (!m.replyToId || m.replyPreview) return m
  const parent = loaded.find((x) => x.id === m.replyToId)
  return parent ? { ...m, replyPreview: { authorName: parent.authorName, content: (parent.content ?? '').slice(0, 60) } } : m
}

export function MainWindow() {
  const { session, logout } = useAuth()
  const user = session!.user

  const [tree, setTree] = useState<ServerTree>({ categories: [], channels: [] })
  const [dms, setDms] = useState<Dm[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [roles, setRoles] = useState<ServerRole[]>([]) // кастомные роли сервера (для цветных ников/бейджей)
  const [update, setUpdate] = useState<{ version: string; notes?: string } | null>(null) // окно «Что нового» при готовом обновлении
  const [memberRanks, setMemberRanks] = useState<Map<string, MemberRank>>(new Map()) // ранг-чипы у ников
  const [myRank, setMyRank] = useState<MyRank | null>(null) // мой прогресс (пик + пер-сервер с порогами XP)
  const [celebrate, setCelebrate] = useState<{ level: number; unlocked: number; nonce: number } | null>(null) // момент апа уровня
  const dismissCelebrate = useCallback(() => setCelebrate(null), []) // стабильный onDone — таймер не сбрасывается на каждом ре-рендере
  const [readStates, setReadStates] = useState<ReadState[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [currentId, setCurrentId] = useState('')

  const [servers, setServers] = useState<ServerSummary[]>([])
  const [currentServerId, setCurrentServerId] = useState('')
  const [serverActionsOpen, setServerActionsOpen] = useState(false)
  const currentServerIdRef = useRef(currentServerId)
  useEffect(() => { currentServerIdRef.current = currentServerId }, [currentServerId])

  const [view, setView] = useState<'chat' | 'admin'>('chat')
  const [membersExpanded, setMembersExpanded] = useState(true)
  const [status, setStatus] = useState<Presence>(() => (localStorage.getItem('chazh.status') as Presence) || 'online')
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [vs, setVs] = useState<VoiceState>(voice.state)
  const [screenFull, setScreenFull] = useState(false)
  const [screenCollapsed, setScreenCollapsed] = useState(false) // чужая демонстрация свёрнута (показываем чип в шапке)
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null) // открытый раздел центра настроек (null = закрыт)
  const [screenPickerOpen, setScreenPickerOpen] = useState(false)
  const [channelEdit, setChannelEdit] = useState<Channel | null>(null) // открытая модалка настроек канала
  const [typing, setTyping] = useState<{ id: string; name: string }[]>([])
  const typingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const [panel, setPanel] = useState<null | 'search' | 'pins' | 'stats' | 'museum' | 'achievements'>(null)
  const [profileMember, setProfileMember] = useState<Member | null>(null)
  const [voiceSince, setVoiceSince] = useState<Map<string, string>>(new Map())
  const [pinsVersion, setPinsVersion] = useState(0)
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null) // переход к сообщению из поиска/пинов
  const [detached, setDetached] = useState(false) // лента показывает историческое окно (не «хвост») — live-сообщения не дописываем
  const [hasMore, setHasMore] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [unread, setUnread] = useState<Set<string>>(new Set()) // каналы с непрочитанными (кроме открытого)
  const [notifLevels, setNotifLevels] = useState<Map<string, NotificationLevel>>(new Map()) // персональный уровень уведомлений по каналу
  // каналы ВСЕХ серверов (не только открытого) — для фоновых подписок и бейджей серверов в рейле.
  // read-states/notif-settings и так глобальны по channelId, поэтому переносить нужно ТОЛЬКО дерево каналов.
  const [serverChannels, setServerChannels] = useState<Map<string, Channel[]>>(new Map())
  const channelToServer = useMemo(() => {
    const m = new Map<string, string>()
    serverChannels.forEach((chs, sid) => chs.forEach((c) => m.set(c.id, sid)))
    return m
  }, [serverChannels])

  useEffect(() => voice.subscribe(setVs), [])
  // восстановленный статус (dnd/idle) — в presence ДО первого heartbeat, чтобы другие сразу видели его, а не «online»
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { presence.start(); presence.setStatus(status); return () => presence.stop() }, [])
  useEffect(() => { if (!vs.screenTrack && screenFull) setScreenFull(false) }, [vs.screenTrack, screenFull])
  useEffect(() => { if (!vs.screenTrack && screenCollapsed) setScreenCollapsed(false) }, [vs.screenTrack, screenCollapsed])

  // сменили свой аватар (в настройках) → освежаем список участников, чтобы новый аватар появился
  // в рейле, голосовом и у автора новых сообщений (memberMap пере-наполняется в api.members()).
  // Первый рендер пропускаем — участники и так грузятся в маунт-эффекте ниже.
  const avatarRef = useRef(user.avatarUrl)
  useEffect(() => {
    if (avatarRef.current === user.avatarUrl) return
    avatarRef.current = user.avatarUrl
    setMembers((ms) => ms.map((m) => (m.userId === user.id ? { ...m, avatarUrl: user.avatarUrl } : m))) // мгновенно
    api.members(currentServerIdRef.current).then(setMembers).catch(() => {}) // авторитетно (+ обновляет кэш авторов сообщений)
  }, [user.avatarUrl, user.id])

  const membersById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members])
  // мой прогресс на текущем сервере (для XP-бара в своём мини-профиле)
  const myServerRank = useMemo<ServerRankInfo | undefined>(() => myRank?.servers.find((s) => s.serverId === currentServerId) ?? myRank?.servers[0], [myRank, currentServerId])

  // автор сообщения, которого нет в списке участников (только зашёл / список устарел) → освежаем участников,
  // чтобы вместо длинного UUID показать ник. На каждого неизвестного — одна попытка (иначе цикл для вышедших).
  const refetchedAuthorsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const unknown = messages.find((m) => m.authorId && !membersById.has(m.authorId) && !refetchedAuthorsRef.current.has(m.authorId))
    if (!unknown) return
    refetchedAuthorsRef.current.add(unknown.authorId)
    api.members(currentServerIdRef.current).then(setMembers).catch(() => {})
  }, [messages, membersById])

  // актуальный канал для асинхронных колбэков (откат реакции и т.п.), чтобы не затирать чужую ленту
  const currentIdRef = useRef(currentId)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  const detachedRef = useRef(detached) // для WS-обработчика: в отсоединённом окне не дописываем live
  useEffect(() => { detachedRef.current = detached }, [detached])
  // свежие tree/dms/user для фоновых обработчиков уведомлений (имена каналов/диалогов, ник)
  const treeRef = useRef(tree); useEffect(() => { treeRef.current = tree }, [tree])
  const serverChannelsRef = useRef(serverChannels); useEffect(() => { serverChannelsRef.current = serverChannels }, [serverChannels]) // имена каналов ВСЕХ серверов для фоновых уведомлений
  const dmsRef = useRef(dms); useEffect(() => { dmsRef.current = dms }, [dms])
  const userRef = useRef(user); useEffect(() => { userRef.current = user }, [user])
  const statusRef = useRef(status); useEffect(() => { statusRef.current = status }, [status]) // для DND-гейта в фоновых WS-колбэках
  const notifLevelsRef = useRef(notifLevels); notifLevelsRef.current = notifLevels // свежие уровни уведомлений для фонового хэндлера
  const autoIdleRef = useRef(false) // авто-idle активен → вернём online при активности (если не сменили статус вручную)
  const messagesRef = useRef(messages); messagesRef.current = messages // свежие сообщения для WS-колбэков (звук реакции)

  // серверо-независимое — один раз: список серверов (рейл), DM, прочитанность, уровни уведомлений
  useEffect(() => {
    api.servers().then((list) => {
      setServers(list)
      setCurrentServerId((cur) => (cur && list.some((s) => s.id === cur) ? cur : (list[0]?.id ?? '')))
      // деревья ВСЕХ серверов → фоновые подписки на их каналы и бейджи в гилд-рейле (один промах сервера не валит остальные)
      Promise.all(list.map((s) => api.serverTree(s.id).then((t) => [s.id, t.channels] as const).catch(() => [s.id, [] as Channel[]] as const)))
        .then((pairs) => setServerChannels(new Map(pairs)))
        .catch(() => {})
    }).catch(() => {})
    api.readStates().then(setReadStates).catch(() => {})
    api.listDms().then(setDms).catch(() => {})
    api.notificationSettings().then((list) => setNotifLevels(new Map(list.map((s) => [s.channelId, s.level])))).catch(() => {})
  }, [])

  // контекст выбранного сервера — перезагрузка дерева/участников/ролей + presence при переключении
  useEffect(() => {
    presence.setServer(currentServerId || null) // presence только этого сервера (сброс при выходе из последнего)
    if (!currentServerId) return
    let alive = true
    setMembersLoaded(false)
    setMemberRanks(new Map())
    api.serverTree(currentServerId).then((t) => {
      if (!alive) return
      setTree(t)
      setServerChannels((m) => { const n = new Map(m); n.set(currentServerId, t.channels); return n }) // держим карту серверов свежей
      // первый открытый канал — первый текстовый (или любой) этого сервера
      setCurrentId((cur) => (cur && t.channels.some((c) => c.id === cur) ? cur : (t.channels.find((c) => c.type === 'TEXT')?.id ?? t.channels[0]?.id ?? '')))
    }).catch(() => {})
    api.members(currentServerId).then((ms) => { if (alive) setMembers(ms) }).catch(() => {}).finally(() => { if (alive) setMembersLoaded(true) })
    api.roles(currentServerId).then((r) => { if (alive) setRoles(r) }).catch(() => {})
    api.memberRanks(currentServerId).then((rs) => { if (alive) setMemberRanks(new Map(rs.map((r) => [r.userId, r]))) }).catch(() => {})
    api.myRank().then((r) => { if (alive) setMyRank(r) }).catch(() => {})
    return () => { alive = false }
  }, [currentServerId])

  // считаем время РЕЧИ в голосе и шлём talk-хартбит (talk-XP); серверный кап режет накрутку
  useEffect(() => { talkHeartbeat.start(user.id); return () => talkHeartbeat.stop() }, [user.id])

  // RANK_UP по WS: свой апгрейд → праздничный тост; любой апгрейд на этом сервере → обновить чипы
  useEffect(() => {
    if (!currentServerId) return
    let alive = true
    const off = ws.onServerRank(currentServerId, (e: RankEvent) => {
      if (e.type !== 'RANK_UP') return
      if (e.userId === user.id) {
        sfx.mention()
        setCelebrate({ level: e.level ?? 0, unlocked: e.unlocked?.length ?? 0, nonce: Date.now() }) // конфетти + карточка
        api.myRank().then((r) => { if (alive) setMyRank(r) }).catch(() => {})
      }
      // guard: пользователь мог сменить сервер, пока летел refetch — не затирать чипы чужого сервера
      api.memberRanks(currentServerId).then((rs) => { if (alive) setMemberRanks(new Map(rs.map((r) => [r.userId, r]))) }).catch(() => {})
    })
    // «Кворум»: рекорд людей в войсе — серверный хайп-момент (тост всем участникам)
    const offQuorum = ws.onServerQuorum(currentServerId, (e: QuorumEvent) => {
      if (e.legendary) {
        sfx.mention()
        toast.info(`🌟 ЛЕГЕНДАРНЫЙ СОЗЫВ! Весь Чажленд в «${e.channelName}» — ${e.count}!`)
      } else {
        toast.info(`🔥 КВОРУМ! В «${e.channelName}» собралось ${e.count} — новый рекорд!`)
      }
    })
    // Ачивки: своё открытие — праздничный тост (публичная карточка летит в #info отдельно)
    const offAch = ws.onServerAchievement(currentServerId, (e: AchievementEvent) => {
      if (e.userId === user.id) {
        sfx.mention()
        toast.info(`🎉 Открыта ачивка ${e.emoji} «${e.name}»!`)
      }
    })
    // Авто-AFK: сервер просит увести МЕНЯ в AFK-канал — переходим туда с выключенными микро и звуком.
    // Серверный force-mute микрофона уже применён; здесь выполняем сам переход (LiveKit не двигает серверно).
    const offAfk = ws.onServerAfk(currentServerId, (e: AfkEvent) => {
      if (e.userId !== user.id) return
      if (!voice.state.channelId || voice.state.channelId === e.afkChannelId) return // не в войсе / уже в AFK
      const name = tree.channels.find((c) => c.id === e.afkChannelId)?.name ?? 'AFK'
      void (async () => {
        try {
          await voice.join(e.afkChannelId, name)
          if (!voice.state.deafened) await voice.toggleDeaf() // выключить и микрофон, и звук
          toast.info('😴 Ты ушёл в AFK — микрофон и звук выключены')
        } catch { /* переход не удался — не критично */ }
      })()
    })
    return () => { alive = false; off(); offQuorum(); offAch(); offAfk() }
  }, [currentServerId, user.id])

  // «Время в войсе»: joinedAt текущих участников голоса сервера (для таймера «в комнате N»). Лёгкий поллинг.
  useEffect(() => {
    if (!currentServerId) { setVoiceSince(new Map()); return }
    let alive = true
    const load = () => api.voiceSince(currentServerId)
      .then((r) => { if (alive) setVoiceSince(new Map(r.filter((x) => x.joinedAt).map((x) => [x.userId, x.joinedAt as string]))) })
      .catch(() => {})
    load()
    const t = window.setInterval(load, 15000)
    return () => { alive = false; window.clearInterval(t) }
  }, [currentServerId])

  useEffect(() => {
    if (!currentId) return
    let alive = true
    setLoadingOlder(false)
    setLoadingMessages(true)
    setMessages([]) // чистим прошлый канал, чтобы показать скелетоны, а не чужую ленту
    setHasMore(false) // сброс пагинации прошлого канала (иначе мог залипнуть стейт hasMore/«Загрузка»)
    setDetached(false) // новый канал грузится с «хвоста» — окно снова живое
    setUnread((u) => { if (!u.has(currentId)) return u; const n = new Set(u); n.delete(currentId); return n }) // открыли — прочитано
    // mentionCount гасим СРАЗУ (синхронно), а не после загрузки — иначе фоновое упоминание,
    // прилетевшее между открытием канала и ответом API, было бы затёрто и потеряно
    setReadStates((rs) => rs.map((r) => (r.channelId === currentId ? { ...r, mentionCount: 0 } : r)))
    api.messages(currentId).then((ms) => {
      if (!alive) return // защита от гонки при быстром переключении каналов
      setMessages(ms)
      setHasMore(ms.length >= 50) // полная страница → возможно есть более старые
      const last = ms[ms.length - 1]
      if (last) {
        api.markRead(currentId, last.id).catch(() => {})
        setReadStates((rs) => rs.map((r) => (r.channelId === currentId ? { ...r, lastReadMessageId: last.id } : r)))
      }
    }).catch(() => {}).finally(() => { if (alive) setLoadingMessages(false) })
    return () => { alive = false }
  }, [currentId])

  // live-сообщения по WS для текущего канала (no-op в mock-режиме)
  useEffect(() => {
    if (!currentId) return
    const off = ws.onChannel(currentId, (e) => {
      // эфемерный TYPING — показываем «печатает…», авто-сброс через 6 с
      if (e.type === 'TYPING') {
        const uid = e.userId, name = e.username
        if (!uid || uid === user.id) return
        setTyping((t) => (t.some((x) => x.id === uid) ? t : [...t, { id: uid, name: name || 'кто-то' }]))
        const timers = typingTimers.current
        const prev = timers.get(uid); if (prev) clearTimeout(prev)
        timers.set(uid, setTimeout(() => { timers.delete(uid); setTyping((t) => t.filter((x) => x.id !== uid)) }, 6000))
        return
      }
      // Реакции прилетают без message — обновляем агрегат по messageId+emoji (см. DESIGN_BRIEF).
      if (e.type === 'REACTION_ADDED' || e.type === 'REACTION_REMOVED') {
        const mid = e.messageId, emoji = e.emoji
        if (!mid || !emoji || e.userId === user.id) return // своё уже учтено оптимистично (см. react())
        const add = e.type === 'REACTION_ADDED'
        const np = notifyPrefs.get()
        if (add && np.sounds && !(np.respectDnd && statusRef.current === 'dnd') && messagesRef.current.find((x) => x.id === mid)?.authorId === user.id) sfx.reaction() // отреагировали на твоё сообщение
        setMessages((ms) => ms.map((m) => {
          if (m.id !== mid) return m
          const rs = m.reactions.slice()
          const i = rs.findIndex((r) => r.emoji === emoji)
          if (add) {
            if (i >= 0) rs[i] = { ...rs[i], count: rs[i].count + 1 }
            else rs.push({ emoji, count: 1, mine: false })
          } else if (i >= 0) {
            const c = rs[i].count - 1
            if (c <= 0) rs.splice(i, 1); else rs[i] = { ...rs[i], count: c }
          }
          return { ...m, reactions: rs }
        }))
        return
      }
      // закрепление/открепление — обновляем pinnedAt и просим панель пинов перезагрузиться
      if (e.type === 'MESSAGE_PINNED' || e.type === 'MESSAGE_UNPINNED') {
        const mid = e.messageId ?? (e.message ? api.mapIncoming(e.message).id : undefined)
        const pinned = e.type === 'MESSAGE_PINNED'
        if (mid) setMessages((ms) => ms.map((m) => (m.id === mid ? { ...m, pinnedAt: pinned ? new Date().toISOString() : null } : m)))
        setPinsVersion((v) => v + 1)
        return
      }
      if (!e.message) return
      const m = api.mapIncoming(e.message)
      if (m.channelId !== currentId) return
      // в отсоединённом окне (после перехода к старому сообщению) новые сообщения НЕ дописываем —
      // иначе они «приклеятся» к окну через скрытый разрыв истории; правки/удаления существующих — можно.
      // Но упоминание учитываем (бейдж), чтобы не потерять его: сбросится, когда вернёмся к «хвосту».
      if (e.type === 'MESSAGE_CREATED' && detachedRef.current) {
        if (m.authorId !== userRef.current.id && mentionsUser(m.content, userRef.current.username)) {
          const np = notifyPrefs.get()
          if (np.sounds && !(np.respectDnd && statusRef.current === 'dnd')) sfx.mention() // упомянули, пока листаем историю
          setReadStates((rs) => rs.map((r) => (r.channelId === currentId ? { ...r, mentionCount: r.mentionCount + 1 } : r)))
        }
        return
      }
      setMessages((ms) => {
        const i = ms.findIndex((x) => x.id === m.id)
        const mm = resolveReplyPreview(m, ms) // живое превью ответа из уже загруженных сообщений
        if (e.type === 'MESSAGE_CREATED') return i >= 0 ? ms : [...ms, mm]
        if (i >= 0) { const c = ms.slice(); c[i] = mm; return c }
        return ms
      })
      if (e.type === 'MESSAGE_CREATED') {
        api.markRead(currentId, m.id).catch(() => {})
        setReadStates((rs) => rs.map((r) => (r.channelId === currentId ? { ...r, lastReadMessageId: m.id, mentionCount: 0 } : r)))
        // автор прислал сообщение — он больше не «печатает»
        const tm = typingTimers.current.get(m.authorId); if (tm) { clearTimeout(tm); typingTimers.current.delete(m.authorId) }
        setTyping((t) => t.filter((x) => x.id !== m.authorId))
      }
    })
    return () => {
      off()
      typingTimers.current.forEach((t) => clearTimeout(t))
      typingTimers.current.clear()
      setTyping([]) // сбрасываем индикатор при смене канала
    }
  }, [currentId])

  // фоновая подписка на ВСЕ текстовые каналы ВСЕХ серверов + DM — непрочитанные/уведомления вне открытого
  // канала и в других серверах. У бэка нет user-topic'а, поэтому слушаем каждый /topic/channel.{id}
  // (подписка авторизуется по членству в сервере канала — AccessGuard.requireChannelAccess).
  const bgIds = useMemo(() => {
    const ids = new Set<string>()
    serverChannels.forEach((chs) => chs.forEach((c) => { if (c.type !== 'VOICE') ids.add(c.id) }))
    dms.forEach((d) => ids.add(d.id))
    return [...ids]
  }, [serverChannels, dms])
  const bgKey = bgIds.join(',')
  useEffect(() => {
    if (bgIds.length === 0) return
    const offs = bgIds.map((id) => ws.onChannel(id, (e) => {
      if (e.type !== 'MESSAGE_CREATED' || e.channelId === currentIdRef.current) return // открытый канал ведёт основной хэндлер
      const raw = e.message; if (!raw) return
      const m = api.mapIncoming(raw)
      if (m.authorId === userRef.current.id) return // своё
      const level = notifLevelsRef.current.get(id) ?? 'ALL'
      if (level === 'MUTED') return // канал заглушён — ни бейджа, ни звука, ни всплывашки
      const isDm = dmsRef.current.some((d) => d.id === id)
      const isMention = isDm || mentionsUser(m.content, userRef.current.username)
      if (level === 'ALL' || isMention) setUnread((u) => (u.has(id) ? u : new Set(u).add(id))) // MENTIONS: точка только на упоминание/ЛС
      if (isMention) {
        const np = notifyPrefs.get()
        const quiet = np.respectDnd && statusRef.current === 'dnd' // «Не беспокоить» → тихо
        if (np.sounds && !quiet) (isDm ? sfx.dm() : sfx.mention()) // фоновый канал/ЛС — звук-пинг
        setReadStates((rs) => {
          // бейдж непрочитанного ведём всегда — DND/тумблер глушат только звук и всплывашку, не счётчик
          const i = rs.findIndex((r) => r.channelId === id)
          if (i >= 0) return rs.map((r, j) => (j === i ? { ...r, mentionCount: r.mentionCount + 1 } : r))
          return [...rs, { channelId: id, lastReadMessageId: null, mentionCount: 1 }]
        })
        if (np.desktop && !quiet) {
          // имя канала ищем по ВСЕМ серверам (сообщение могло прийти не из открытого), не только treeRef
          const findChanName = () => { for (const chs of serverChannelsRef.current.values()) { const c = chs.find((x) => x.id === id); if (c) return c.name } return 'канал' }
          const name = isDm ? (dmsRef.current.find((d) => d.id === id)?.name ?? m.authorName) : findChanName()
          const body = m.content || (m.attachments.length ? 'вложение' : 'новое сообщение')
          window.chazh?.notify({ title: isDm ? m.authorName : `${m.authorName} · #${name}`, body, channelId: id })
        }
      }
    }))
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgKey])

  // клик по нативному уведомлению — фокус окна обеспечивает main; здесь открываем нужный канал
  useEffect(() => {
    if (!window.chazh?.onNotificationClick) return
    return window.chazh.onNotificationClick(({ channelId }) => { setCurrentId(channelId); setView('chat'); setPanel(null) })
  }, [])

  // авто-обновление: показываем окно «Что нового», когда апдейтер скачал новую версию.
  // Подписка + разовый запрос буфера (если событие пришло до монтирования окна).
  useEffect(() => {
    if (!window.chazh?.onUpdateDownloaded) return
    window.chazh.getPendingUpdate?.().then((p) => { if (p) setUpdate({ version: p.version, notes: p.releaseNotes }) }).catch(() => {})
    return window.chazh.onUpdateDownloaded((p) => setUpdate({ version: p.version, notes: p.releaseNotes }))
  }, [])

  // авто-idle по простою системы (main опрашивает powerMonitor): online→idle и обратно;
  // ручной статус (dnd/idle) не трогаем — авто-переход только из online, возврат только из авто-idle
  function applyPresence(st: Presence) { setStatus(st); presence.setStatus(st) }
  useEffect(() => {
    if (!window.chazh?.onIdleChange) return
    return window.chazh.onIdleChange(({ idle }) => {
      if (idle) { if (statusRef.current === 'online') { autoIdleRef.current = true; applyPresence('idle') } }
      else if (autoIdleRef.current) { autoIdleRef.current = false; applyPresence('online') }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const channel = useMemo<Channel | undefined>(() => {
    const c = tree.channels.find((x) => x.id === currentId)
    if (c) return c
    const dm = dms.find((d) => d.id === currentId) // DM-каналы скрыты из дерева — собираем синтетический Channel
    return dm ? { id: dm.id, name: dm.name, type: 'DM', categoryId: null, topic: null, position: 0 } : undefined
  }, [tree, dms, currentId])
  const readState = readStates.find((r) => r.channelId === currentId)
  const myRole = members.find((m) => m.userId === user.id)?.role
  const canModerate = myRole === 'OWNER' || myRole === 'ADMIN'
  const unreadTotal = readStates.reduce((a, r) => a + r.mentionCount, 0)
  // агрегаты по серверам для бейджей рейла: точка = есть непрочитанный канал; число = сумма упоминаний.
  // read-states/unread глобальны по channelId; DM (serverId=null) в channelToServer нет → в рейле не учитываются.
  const serverBadges = useMemo(() => {
    const map = new Map<string, { unread: boolean; mentions: number }>()
    const bump = (sid: string, mentions: number, hasUnread: boolean) => {
      const cur = map.get(sid) ?? { unread: false, mentions: 0 }
      map.set(sid, { unread: cur.unread || hasUnread, mentions: cur.mentions + mentions })
    }
    unread.forEach((cid) => { const sid = channelToServer.get(cid); if (sid) bump(sid, 0, true) })
    readStates.forEach((r) => { if (r.mentionCount > 0) { const sid = channelToServer.get(r.channelId); if (sid) bump(sid, r.mentionCount, true) } })
    return map
  }, [unread, readStates, channelToServer])
  // имя того, чья демонстрация активна (для чипа «развернуть») — ник из участников, не UUID из токена
  const activeShare = vs.screens.find((s) => s.id === vs.activeScreenId)
  const screenSharerName = (activeShare && (membersById.get(activeShare.userId)?.username || activeShare.by)) || vs.screenBy || 'кто-то'
  const isWatch = channel?.type === 'WATCH'
  useEffect(() => { window.chazh?.setBadge(unreadTotal) }, [unreadTotal]) // бейдж в доке/таскбаре
  // если права модератора пропали (понизили роль), пока открыта админ-панель — выкидываем в чат
  useEffect(() => { if (view === 'admin' && !canModerate) setView('chat') }, [view, canModerate])

  function send(text: string, attachments?: AttachmentInput[]) {
    if (!currentId) return // не отправляем без выбранного канала (иначе /channels//messages → 401)
    if (!text && !(attachments && attachments.length)) return
    // дедуп по id: WS-эхо MESSAGE_CREATED могло прийти раньше ответа POST и уже добавить сообщение
    const ch = currentId
    api.sendMessage(ch, text, replyTo?.id, attachments)
      .then((m) => {
        if (currentIdRef.current !== ch) return // канал сменился, пока шёл POST — не дописываем в чужую ленту
        // если читали историю (detached) — не дописываем в окно через скрытый разрыв, а возвращаемся
        // к «хвосту»: jumpToPresent перезагрузит ленту, где наше уже сохранённое сообщение будет внизу
        if (detachedRef.current) { jumpToPresent(); return }
        setMessages((ms) => (ms.some((x) => x.id === m.id) ? ms : [...ms, resolveReplyPreview(m, ms)]))
      })
      .catch(() => toast.error('Не удалось отправить сообщение'))
    setReplyTo(null)
  }
  function editMsg(id: string, content: string) {
    const ch = currentId
    const prev = messages.find((m) => m.id === id) // снимок ДО правки — для отката при отказе API
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, content, editedAt: new Date().toISOString() } : m)))
    api.editMessage(id, content).catch(() => {
      if (prev) setMessages((ms) => (currentIdRef.current === ch ? ms.map((m) => (m.id === id ? prev : m)) : ms))
      toast.error('Не удалось изменить сообщение')
    })
  }
  function deleteMsg(id: string) {
    const ch = currentId
    const prev = messages.find((m) => m.id === id) // снимок ДО удаления — иначе фантомное «удалено» при отказе API
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, deleted: true, content: null } : m)))
    api.deleteMessage(id).catch(() => {
      if (prev) setMessages((ms) => (currentIdRef.current === ch ? ms.map((m) => (m.id === id ? prev : m)) : ms))
      toast.error('Не удалось удалить сообщение')
    })
  }
  function react(messageId: string, emoji: string) {
    const mine = !!messages.find((m) => m.id === messageId)?.reactions.find((r) => r.emoji === emoji)?.mine
    setMessages((ms) => ms.map((m) => {
      if (m.id !== messageId) return m
      const rs = m.reactions.slice()
      const i = rs.findIndex((r) => r.emoji === emoji)
      if (mine) {
        if (i >= 0) { const c = rs[i].count - 1; if (c <= 0) rs.splice(i, 1); else rs[i] = { ...rs[i], count: c, mine: false } }
      } else if (i >= 0) {
        rs[i] = { ...rs[i], count: rs[i].count + 1, mine: true }
      } else {
        rs.push({ emoji, count: 1, mine: true })
      }
      return { ...m, reactions: rs }
    }))
    const ch = currentId
    ;(mine ? api.removeReaction(messageId, emoji) : api.addReaction(messageId, emoji))
      .catch(() => {
        // откат оптимистичного апдейта: перезагружаем ленту, но только если канал ещё открыт
        api.messages(ch).then((ms) => { if (currentIdRef.current === ch) { setMessages(ms); setDetached(false) } }).catch(() => {})
      })
  }
  function ackAll() {
    api.ackAll().then(setReadStates).catch(() => {})
  }
  // отметить ОДИН канал прочитанным (из контекст-меню): берём последний id из дерева, гасим бейджи
  function markReadChannel(c: Channel) {
    setUnread((u) => { if (!u.has(c.id)) return u; const n = new Set(u); n.delete(c.id); return n })
    setReadStates((rs) => rs.map((r) => (r.channelId === c.id ? { ...r, lastReadMessageId: c.lastMessageId ?? r.lastReadMessageId, mentionCount: 0 } : r)))
    if (c.lastMessageId) api.markRead(c.id, c.lastMessageId).catch(() => {})
  }
  function setChannelNotif(channelId: string, level: NotificationLevel) {
    setNotifLevels((m) => new Map(m).set(channelId, level)) // оптимистично
    api.setChannelNotification(channelId, level).catch(() => toast.error('Не удалось изменить уведомления'))
  }
  // «пометить непрочитанным отсюда»: ставим lastRead на сообщение ПЕРЕД выбранным (null = с начала канала)
  function markChannelUnreadFrom(beforeMessageId: string | null) {
    const ch = currentIdRef.current
    setReadStates((rs) => rs.map((r) => (r.channelId === ch ? { ...r, lastReadMessageId: beforeMessageId } : r)))
    setUnread((u) => (u.has(ch) ? u : new Set(u).add(ch)))
    if (beforeMessageId) api.markRead(ch, beforeMessageId).catch(() => {})
  }
  async function saveChannel(patch: { name: string; categoryId?: string | null; topic?: string | null; userLimit?: number | null; slowModeSeconds?: number | null }) {
    if (!channelEdit) return
    await api.updateChannel(channelEdit.id, patch)
    const sid = currentServerIdRef.current
    const t = await api.serverTree(sid)
    setTree(t)
    setServerChannels((m) => { const n = new Map(m); n.set(sid, t.channels); return n }) // карта серверов в синхроне (имя канала в уведомлениях/рейле)
  }
  async function deleteChannelNow() {
    if (!channelEdit) return
    const id = channelEdit.id
    await api.deleteChannel(id)
    const sid = currentServerIdRef.current
    const t = await api.serverTree(sid)
    setTree(t)
    setServerChannels((m) => { const n = new Map(m); n.set(sid, t.channels); return n }) // убрать удалённый канал из фоновых подписок/карты
    if (currentIdRef.current === id) setCurrentId(t.channels.find((c) => c.type === 'TEXT')?.id ?? t.channels[0]?.id ?? '')
  }
  function loadOlder() {
    const first = messages[0]
    if (!first || loadingOlder || !hasMore) return
    const ch = currentId
    setLoadingOlder(true)
    api.olderMessages(ch, first.id).then((older) => {
      if (currentIdRef.current !== ch) return
      if (older.length === 0) { setHasMore(false); return }
      setMessages((ms) => {
        const seen = new Set(ms.map((m) => m.id))
        return [...older.filter((m) => !seen.has(m.id)), ...ms] // дедуп на стыке страниц
      })
      if (older.length < 50) setHasMore(false)
    }).catch(() => {}).finally(() => { if (currentIdRef.current === ch) setLoadingOlder(false) })
  }
  function pinMsg(id: string, pinned: boolean) {
    const ch = currentId
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, pinnedAt: pinned ? new Date().toISOString() : null } : m)))
    ;(pinned ? api.pin(id) : api.unpin(id))
      .then(() => setPinsVersion((v) => v + 1))
      .catch(() => {
        toast.error(pinned ? 'Не удалось закрепить' : 'Не удалось открепить')
        api.messages(ch).then((ms) => { if (currentIdRef.current === ch) { setMessages(ms); setDetached(false) } }).catch(() => {})
      })
  }

  // переход к сообщению из поиска/пинов: грузим окно контекста вокруг него и подсвечиваем.
  // Поиск/пины всегда в текущем канале, поэтому канал не переключаем.
  async function jumpTo(m: Message) {
    const ch = m.channelId
    setPanel(null)
    if (ch !== currentIdRef.current) return // подстраховка: панель открыта только для текущего канала
    if (messages.some((x) => x.id === m.id)) { setJumpTargetId(m.id); return } // уже в ленте — просто скроллим
    try {
      const ctx = await api.contextMessages(ch, m)
      if (currentIdRef.current !== ch) return
      setLoadingMessages(false)
      setMessages(ctx.messages)
      setHasMore(ctx.hasOlder) // есть ли что грузить вверх (точный флаг, а не «всегда true»)
      setDetached(true)        // окно историческое — live-сообщения копятся, покажем кнопку «к последним»
      setJumpTargetId(m.id)
    } catch { toast.error('Не удалось перейти к сообщению') }
  }

  // вернуться к «хвосту» канала после исторического перехода: грузим последние сообщения
  function jumpToPresent() {
    const ch = currentIdRef.current
    setLoadingMessages(true)
    api.messages(ch).then((ms) => {
      if (currentIdRef.current !== ch) return
      setMessages(ms)
      setHasMore(ms.length >= 50)
      setDetached(false)
      const last = ms[ms.length - 1]
      if (last) {
        api.markRead(ch, last.id).catch(() => {})
        setReadStates((rs) => rs.map((r) => (r.channelId === ch ? { ...r, lastReadMessageId: last.id, mentionCount: 0 } : r)))
      }
    }).catch(() => {}).finally(() => { if (currentIdRef.current === ch) setLoadingMessages(false) })
  }

  function pickChannel(id: string) {
    const ch = tree.channels.find((c) => c.id === id)
    if (ch?.type === 'VOICE') {
      voice.join(id, ch.name) // в голосовой — заходим, не меняя открытый текст/watch-канал
    } else {
      setCurrentId(id)
      setView('chat')
    }
  }

  async function openDm(userId: string) {
    if (!userId || userId === user.id) return
    try {
      const dm = await api.openDm(userId)
      setDms((d) => (d.some((x) => x.id === dm.id) ? d : [...d, dm]))
      setCurrentId(dm.id)
      setView('chat')
      setPanel(null)
    } catch { toast.error('Не удалось открыть личные сообщения') }
  }

  function switchServer(id: string) {
    if (id === currentServerId) return
    setCurrentServerId(id)
    setCurrentId('')   // канал прошлого сервера сбрасываем — новый выберется при загрузке его дерева
    setMessages([])
    setView('chat')
    setPanel(null)
  }
  function onServerJoined(s: ServerSummary) {
    setServers((list) => (list.some((x) => x.id === s.id) ? list.map((x) => (x.id === s.id ? s : x)) : [...list, s]))
    // подтянуть дерево нового сервера → его каналы сразу под фоновой подпиской (не ждать переоткрытия)
    api.serverTree(s.id).then((t) => setServerChannels((m) => { const n = new Map(m); n.set(s.id, t.channels); return n })).catch(() => {})
    switchServer(s.id)
  }
  function onServerRenamed(s: ServerSummary) {
    setServers((list) => list.map((x) => (x.id === s.id ? s : x)))
  }
  function onServerLeft(id: string) {
    const remaining = servers.filter((x) => x.id !== id)
    setServers(remaining)
    setServerChannels((m) => { const n = new Map(m); n.delete(id); return n }) // отписаться от каналов покинутого сервера (bgKey пересоберётся)
    const home = remaining[0]
    if (home) switchServer(home.id)
    else { setCurrentServerId(''); setView('chat') }
  }

  async function createChannel(p: { name: string; type: ChannelType }) {
    const sid = currentServerIdRef.current
    const ch = await api.createChannel(p, sid)
    const t = await api.serverTree(sid)
    setTree(t)
    setServerChannels((m) => { const n = new Map(m); n.set(sid, t.channels); return n }) // новый канал сразу в фоновой подписке
    if (ch.type !== 'VOICE') { setCurrentId(ch.id); setView('chat') } // сразу открыть новый канал
  }

  return (
    <div style={{ position: 'relative', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <GuildRail servers={servers} currentId={currentServerId} badges={serverBadges} onSwitch={switchServer} onAdd={() => setServerActionsOpen(true)} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {view === 'admin' && canModerate ? (
        <AdminScreen serverId={currentServerId} isHome={servers.length > 0 && currentServerId === servers[0]?.id} onClose={() => setView('chat')} onRenamed={onServerRenamed} onLeft={onServerLeft} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          <ChannelSidebar
            channels={tree.channels}
            dms={dms}
            members={members}
            readStates={readStates}
            currentId={currentId}
            voiceState={vs}
            unread={unread}
            meId={user.id}
            canManage={canModerate}
            notifLevels={notifLevels}
            voiceSince={voiceSince}
            onPick={pickChannel}
            onEditChannel={setChannelEdit}
            onMarkRead={markReadChannel}
            onSetNotif={setChannelNotif}
            onCreateChannel={createChannel}
          />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
          {/* header */}
          <div style={{ height: 62, flex: 'none', display: 'flex', alignItems: 'center', gap: 13, padding: '0 22px', borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'var(--accent-tint)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, flex: 'none' }}>
              {channel ? TYPE_ICON[channel.type] : <Hash size={18} />}
            </div>
            <div style={{ lineHeight: 1.25, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{channel?.name ?? '—'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{channel?.topic ?? (isWatch ? 'совместный просмотр' : channel?.type === 'DM' ? 'личные сообщения' : 'без темы')}</div>
            </div>
            {vs.screenOn && (
              <div style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--accent-tint)', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 30, padding: '5px 13px', fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e0392f', animation: 'live 1.6s infinite' }} />Вы в эфире · демонстрация
              </div>
            )}
            {vs.screenTrack && screenCollapsed && (
              <button onClick={() => setScreenCollapsed(false)} className="no-drag" title="Развернуть демонстрацию" style={{ marginLeft: 10, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 30, padding: '5px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e0392f', animation: 'live 1.6s infinite' }} />{screenSharerName} · развернуть демонстрацию
              </button>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <button className="ib no-drag" onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))} style={{ width: 38, height: 38, ...(panel === 'search' ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}) }} title="Поиск"><Search size={16} /></button>
              <button className="ib no-drag" onClick={() => setPanel((p) => (p === 'pins' ? null : 'pins'))} style={{ width: 38, height: 38, ...(panel === 'pins' ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}) }} title="Закреплённые"><Pin size={16} /></button>
              <button className="ib no-drag" onClick={() => setPanel((p) => (p === 'stats' ? null : 'stats'))} style={{ width: 38, height: 38, ...(panel === 'stats' ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}) }} title="Статистика · Wrapped"><BarChart3 size={16} /></button>
              <button className="ib no-drag" onClick={() => setPanel((p) => (p === 'museum' ? null : 'museum'))} style={{ width: 38, height: 38, ...(panel === 'museum' ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}) }} title="Музей цитат"><Trophy size={16} /></button>
              <button className="ib no-drag" onClick={() => setPanel((p) => (p === 'achievements' ? null : 'achievements'))} style={{ width: 38, height: 38, ...(panel === 'achievements' ? { background: 'var(--accent-tint)', color: 'var(--accent)' } : {}) }} title="Ачивки"><Medal size={16} /></button>
              <button className="ib no-drag" style={{ width: 38, height: 38 }} title="Уведомления"><Bell size={16} /></button>
              <button className="ib no-drag" onClick={() => setMembersExpanded((v) => !v)} style={{ width: 38, height: 38, background: 'var(--accent-tint)', color: 'var(--accent)' }} title="Участники"><Users size={16} /></button>
            </div>
          </div>

          {/* body */}
          <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
            {vs.screenTrack && !screenCollapsed && <ScreenSharePane full={screenFull} onToggleFull={() => setScreenFull((f) => !f)} onCollapse={() => { setScreenCollapsed(true); setScreenFull(false) }} screens={vs.screens} onSelect={(id) => voice.setActiveScreen(id)} nameOf={(uid) => membersById.get(uid)?.username} />}
            {!screenFull && (isWatch ? (
              <div key={`w:${currentId}`} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', animation: 'fadeIn .26s ease' }}>
                <WatchView channelId={currentId} />
              </div>
            ) : (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
                {/* key={currentId} — перезапускает fadeIn при смене канала; Composer вне обёртки, чтобы сохранить черновик */}
                <div key={currentId} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', animation: 'fadeIn .26s ease' }}>
                  <ChatFeed messages={messages} readState={readState} membersById={membersById} roles={roles} ranks={memberRanks} myServerRank={myServerRank} myProfileBgUrl={myRank?.profileBackgroundUrl ?? null} onReact={react} meId={user.id} meName={user.username} canModerate={canModerate} onReply={setReplyTo} onEdit={editMsg} onDelete={deleteMsg} onPin={pinMsg} onOpenDm={openDm} onMarkUnread={markChannelUnreadFrom} onLoadOlder={loadOlder} hasMore={hasMore} loadingOlder={loadingOlder} loading={loadingMessages} targetId={jumpTargetId} onTargetConsumed={() => setJumpTargetId(null)} detached={detached} onJumpToPresent={jumpToPresent} />
                </div>
                <TypingIndicator names={typing.map((t) => t.name)} />
                {channel?.system ? (
                  <div style={{ flex: 'none', padding: '15px 18px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, color: 'var(--text-3)', fontSize: 13, borderTop: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <Lock size={15} /> Системный канал — писать может только система
                  </div>
                ) : (
                  <Composer channelName={channel?.name ?? ''} onSend={send} onType={() => ws.typing(currentId)} replyToName={replyTo?.authorName} onCancelReply={() => setReplyTo(null)} />
                )}
              </div>
            ))}
            {!screenFull && <MembersRail members={members} roles={roles} ranks={memberRanks} loading={!membersLoaded} expanded={membersExpanded} onToggle={() => setMembersExpanded((v) => !v)} meId={user.id} onOpenDm={openDm} onOpenProfile={setProfileMember} />}
            {panel === 'stats' && <StatsPanel serverId={currentServerId} onClose={() => setPanel(null)} />}
            {panel === 'museum' && <MuseumPanel serverId={currentServerId} onClose={() => setPanel(null)} />}
            {panel === 'achievements' && <AchievementsPanel onClose={() => setPanel(null)} />}
            {(panel === 'search' || panel === 'pins') && currentId && (
              <ChatPanel mode={panel} channelId={currentId} channelName={channel?.name ?? ''} pinsVersion={pinsVersion} onClose={() => setPanel(null)} onUnpin={(id) => pinMsg(id, false)} onJump={jumpTo} />
            )}
          </div>
          </div>
        </div>
      )}
        </div>
      </div>

      <BottomBar
        user={user}
        status={status}
        onStatus={(st) => { applyPresence(st); localStorage.setItem('chazh.status', st); autoIdleRef.current = false }}
        muted={!vs.micOn}
        onMute={() => voice.toggleMic()}
        deafened={vs.deafened}
        onDeaf={() => voice.toggleDeaf()}
        streamOn={vs.screenOn}
        onGoLive={() => { if (vs.screenOn) voice.toggleScreen(); else if (window.chazh?.getScreenSources) setScreenPickerOpen(true); else voice.toggleScreen() }}
        voiceChannelName={vs.channelName}
        reconnecting={vs.reconnecting}
        onAckAll={ackAll}
        onOpenVoiceSettings={() => setSettingsTab('audio')}
        onOpenSettings={() => setSettingsTab('profile')}
        onOpenAdmin={() => { if (canModerate) setView('admin') }}
        canModerate={canModerate}
        onLogout={logout}
        onLeaveVoice={() => voice.leave()}
        soundboardDisabled={membersById.get(user.id)?.soundboardDisabled}
        equipped={myRank?.equipped}
      />

      {profileMember && <ProfileModal member={profileMember} rank={memberRanks.get(profileMember.userId)} self={profileMember.userId === user.id} onClose={() => setProfileMember(null)} onOpenDm={openDm} />}

      {celebrate && <LevelUpCelebration key={celebrate.nonce} level={celebrate.level} unlocked={celebrate.unlocked} onDone={dismissCelebrate} />}
      {settingsTab && <SettingsModal initialTab={settingsTab} onClose={() => setSettingsTab(null)} onEquipChange={(eq) => {
        setMyRank((r) => (r ? { ...r, equipped: eq } : r))
        // обновить мою экипировку в списке участников, чтобы рамка/свечение/ник обновились живьём
        setMemberRanks((prev) => {
          const me = prev.get(user.id); if (!me) return prev
          const next = new Map(prev); next.set(user.id, { ...me, equipped: eq }); return next
        })
      }} onProfileBgChange={(url) => setMyRank((r) => (r ? { ...r, profileBackgroundUrl: url } : r))} />}
      {screenPickerOpen && <ScreenPicker onClose={() => setScreenPickerOpen(false)} onPick={async (id) => { setScreenPickerOpen(false); await window.chazh?.pickScreenSource(id); voice.toggleScreen() }} />}
      {channelEdit && <ChannelSettingsModal channel={channelEdit} onClose={() => setChannelEdit(null)} onSaved={saveChannel} onDeleted={deleteChannelNow} />}
      {serverActionsOpen && <ServerActionsModal onClose={() => setServerActionsOpen(false)} onDone={onServerJoined} />}
      {update && <UpdateModal version={update.version} notes={update.notes} onClose={() => setUpdate(null)} />}
    </div>
  )
}

function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null
  const text = names.length === 1 ? `${names[0]} печатает…`
    : names.length === 2 ? `${names[0]} и ${names[1]} печатают…`
    : 'Несколько человек печатают…'
  return (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '0 28px 4px', height: 18, fontSize: 12, color: 'var(--text-3)' }}>
      <span style={{ display: 'inline-flex', gap: 3 }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--text-3)', animation: 'live 1.2s infinite', animationDelay: `${i * 0.18}s` }} />
        ))}
      </span>
      {text}
    </div>
  )
}
