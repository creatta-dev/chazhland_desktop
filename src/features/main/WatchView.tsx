import { useEffect, useRef, useState } from 'react'
import { Film, Link2, Loader2, MonitorPlay, Search, X } from 'lucide-react'
import { api } from '@/lib/api'
import { ws } from '@/lib/ws'
import { toast } from '@/lib/toast'
import { HttpError, apiError } from '@/lib/http'
import { formatWatchSize } from '@/lib/format'
import { sfx } from '@/lib/sfx'
import type { WatchAction, WatchState, WatchSourceKind, WatchSearchResult } from '@/lib/types'

// page-хосты, которые резолвит yt-dlp (зеркалит backend SsrfGuard.link-allowed-hosts) → kind=LINK
function isLinkHost(text: string): boolean {
  try {
    const h = new URL(text).hostname.replace(/^www\./, '').toLowerCase()
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|vk\.com|vkvideo\.ru|rutube\.ru|ok\.ru|dzen\.ru|my\.mail\.ru|vimeo\.com)$/.test(h)
  } catch { return false }
}
function trackLabel(t: MpvTrack): string {
  const parts: string[] = []
  if (t.lang) parts.push(t.lang.toUpperCase())
  if (t.title) parts.push(t.title)
  if (!parts.length && t.codec) parts.push(t.codec)
  if (!parts.length) parts.push(`дорожка ${t.id}`)
  return parts.join(' · ')
}

type Issue = { kind: 'codec' | 'failed' | 'link' | 'nobridge'; msg?: string }
type Player = 'video' | 'mpv' // <video> для mp4/прямых ссылок; mpv (отдельное окно) для MKV/HEVC

export function WatchView({ channelId }: { channelId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const remote = useRef<WatchState | null>(null)
  const loadedKey = useRef<string | null>(null) // что загружено в активный плеер
  const resolved = useRef<{ key: string; url: string | null; player: Player; link?: boolean } | null>(null)
  const issueRef = useRef<Issue | null>(null)
  const torrentToken = useRef<string | null>(null)
  const applyGen = useRef(0)
  // mpv-состояние
  const mpvPos = useRef(0) // последняя time-pos из mpv
  const mpvSuppressUntil = useRef(0) // подавление эха: пока мы сами рулим mpv, его события не шлём обратно
  const mpvActive = useRef(false)
  const mpvSpeed = useRef(1) // текущая заданная скорость (чтобы не слать set_property повторно)
  const [state, setState] = useState<WatchState | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [issue, setIssue] = useState<Issue | null>(null)
  const [buffering, setBuffering] = useState(false)
  const [dl, setDl] = useState<{ pct: number; peers: number } | null>(null)
  const [mpvMode, setMpvMode] = useState(false) // играем во внешнем окне mpv
  const [tracks, setTracks] = useState<{ audio: MpvTrack[]; sub: MpvTrack[] } | null>(null) // дорожки текущего файла в mpv
  const [aid, setAid] = useState<number | false>(false) // выбранная аудиодорожка
  const [sid, setSid] = useState<number | false>(false) // выбранные субтитры
  const [behind, setBehind] = useState(false) // отстаём от хоста и докачиваем (mpv)
  // поиск по названию (оверлей над кинозалом)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<WatchSearchResult[] | null>(null) // null = ещё не искали
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)

  function effectivePos(s: WatchState) {
    return s.paused ? s.positionSeconds : s.positionSeconds + Math.max(0, (Date.now() - s.updatedAt) / 1000)
  }
  function sourceKey(s: WatchState): string {
    const kind = s.source?.kind ?? 'DIRECT'
    return `${kind}:${s.source?.infoHash ?? s.source?.url ?? s.url ?? ''}`
  }

  async function stopTorrentIfAny() {
    const tok = torrentToken.current
    torrentToken.current = null
    setDl(null)
    if (tok) { try { await window.chazh?.torrentStop(tok) } catch { /* */ } }
  }
  async function stopMpvIfAny() {
    if (mpvActive.current) {
      mpvActive.current = false; setMpvMode(false); mpvSpeed.current = 1
      setTracks(null); setAid(false); setSid(false); setBehind(false)
      try { await window.chazh?.mpvStop() } catch { /* */ }
    }
  }

  // Резолвит источник: url + каким плеером играть (null url = не играем, причина в issueRef).
  async function resolve(s: WatchState): Promise<void> {
    const key = sourceKey(s)
    if (resolved.current?.key === key) return
    const kind: WatchSourceKind = s.source?.kind ?? 'DIRECT'
    if (kind === 'DIRECT') {
      await stopTorrentIfAny(); await stopMpvIfAny()
      issueRef.current = null
      resolved.current = { key, url: s.source?.url ?? s.url, player: 'video' }
      return
    }
    if (kind === 'TORRENT') {
      if (!window.chazh?.torrentStart) { await stopMpvIfAny(); await stopTorrentIfAny(); issueRef.current = { kind: 'nobridge' }; resolved.current = { key, url: null, player: 'video' }; return }
      await stopMpvIfAny(); await stopTorrentIfAny()
      setBuffering(true)
      const res = await window.chazh.torrentStart({ magnet: s.source?.url ?? undefined, infoHash: s.source?.infoHash ?? undefined })
        .catch((e) => ({ ok: false, error: String(e?.message ?? e) } as TorrentStartResult))
      setBuffering(false)
      if (res.ok && res.token && res.streamUrl) {
        torrentToken.current = res.token
        issueRef.current = null
        // mp4/webm → <video>; экзотика (MKV/HEVC) → mpv-окно (если мост доступен)
        const mpvAvailable = typeof window.chazh?.mpvLoad === 'function'
        if (!res.webPlayable && !mpvAvailable) { issueRef.current = { kind: 'codec' }; resolved.current = { key, url: null, player: 'video' }; return }
        resolved.current = { key, url: res.streamUrl, player: res.webPlayable ? 'video' : 'mpv' }
      } else {
        issueRef.current = { kind: 'failed', msg: res.error }
        resolved.current = { key, url: null, player: 'video' }
      }
      return
    }
    // LINK (YouTube/VK/Rutube/…): резолвит mpv+yt-dlp, SSRF-проверка page-URL в main
    const pageUrl = s.source?.url ?? s.url
    if (typeof window.chazh?.mpvLoadLink !== 'function' || !pageUrl) {
      await stopTorrentIfAny(); await stopMpvIfAny()
      issueRef.current = { kind: 'link' } // старый клиент без моста или нет ссылки
      resolved.current = { key, url: null, player: 'video' }
      return
    }
    await stopTorrentIfAny(); await stopMpvIfAny()
    issueRef.current = null
    resolved.current = { key, url: pageUrl, player: 'mpv', link: true }
  }

  async function apply(s: WatchState, opts?: { announce?: boolean }) {
    const gen = ++applyGen.current
    // «showtime» — только когда новый источник прилетел по WS (announce), а не при открытии канала
    if (opts?.announce && s.url && sourceKey(s) !== loadedKey.current) sfx.watchStart()
    remote.current = s
    setState(s)
    if (!s.url) {
      await stopTorrentIfAny(); await stopMpvIfAny()
      resolved.current = null; issueRef.current = null; setIssue(null)
      const v0 = videoRef.current
      if (v0 && loadedKey.current) { v0.pause(); v0.removeAttribute('src'); v0.load() }
      loadedKey.current = null
      return
    }
    await resolve(s)
    if (gen !== applyGen.current) return
    const r = resolved.current
    if (!r) return
    if (r.url == null) { setIssue(issueRef.current); return }
    setIssue(null)

    if (r.player === 'mpv') {
      // ВНЕШНЕЕ окно mpv: грузим при смене источника, дальше гоним паузу/перемотку из состояния
      mpvActive.current = true; setMpvMode(true)
      if (r.key !== loadedKey.current) {
        loadedKey.current = r.key
        mpvSuppressUntil.current = Date.now() + 1500
        const res = r.link
          ? await window.chazh?.mpvLoadLink({ url: r.url, paused: s.paused, start: effectivePos(s) })
          : await window.chazh?.mpvLoad({ url: r.url, paused: s.paused, start: effectivePos(s) })
        if (res && !res.ok) { // SSRF-отказ / битая ссылка
          mpvActive.current = false; setMpvMode(false); loadedKey.current = null
          issueRef.current = { kind: 'failed', msg: res.error }; setIssue(issueRef.current)
        }
        return
      }
      mpvSuppressUntil.current = Date.now() + 800
      await window.chazh?.mpvPause(s.paused)
      const target = effectivePos(s)
      if (Math.abs(mpvPos.current - target) > 1.5) await window.chazh?.mpvSeek(target)
      return
    }

    // встроенный <video>
    const v = videoRef.current
    if (!v) return
    if (r.key !== loadedKey.current) { v.src = r.url; loadedKey.current = r.key }
    const target = effectivePos(s)
    if (Math.abs(v.currentTime - target) > 1.5) { try { v.currentTime = target } catch { /* */ } }
    if (s.paused) { if (!v.paused) v.pause() } else { v.play().catch(() => {}) }
  }

  // отправка действия в комнату; position берём от активного плеера
  function sendControl(action: WatchAction, position: number) {
    const r = remote.current
    if (action === 'PLAY' && r && !r.paused) return
    if (action === 'PAUSE' && r && r.paused) return
    if (action === 'SEEK' && r && Math.abs(position - effectivePos(r)) < 1.5) return
    ws.sendWatchControl(channelId, action, position)
  }
  function sendFromVideo(action: WatchAction) {
    const v = videoRef.current
    if (!v) return
    sendControl(action, v.currentTime)
  }

  useEffect(() => {
    let alive = true
    loadedKey.current = null; resolved.current = null; remote.current = null
    issueRef.current = null; mpvActive.current = false; mpvPos.current = 0
    setIssue(null); setBuffering(false); setMpvMode(false); setState(null)
    api.watchState(channelId).then((s) => { if (alive && s) apply(s) }).catch(() => {})
    const off = ws.onWatch(channelId, (s) => { if (alive) apply(s, { announce: true }) })
    const offProg = window.chazh?.onTorrentProgress?.((p) => {
      if (!alive || !torrentToken.current || p.token !== torrentToken.current) return
      setDl({ pct: Math.round((p.progress ?? 0) * 100), peers: p.numPeers ?? 0 })
    })
    const offMpv = window.chazh?.onMpvEvent?.((e) => {
      if (!alive || !mpvActive.current) return
      if (e.type === 'time-pos') { mpvPos.current = e.value }
      else if (e.type === 'pause') {
        // mpv.ts уже отсеял буферизацию и эхо наших команд; mpvSuppressUntil — вторичная страховка на загрузку
        if (Date.now() < mpvSuppressUntil.current) return
        sendControl(e.value ? 'PAUSE' : 'PLAY', mpvPos.current)
      } else if (e.type === 'buffering') { setBehind(e.value) } // paused-for-cache → «докачиваем…»
      else if (e.type === 'tracks') { setTracks({ audio: e.audio, sub: e.sub }); setAid(e.aid); setSid(e.sid) }
      else if (e.type === 'track-change') { if (e.kind === 'audio') setAid(e.id); else setSid(e.id) }
      else if (e.type === 'spawn-error') { mpvActive.current = false; setMpvMode(false); setIssue({ kind: 'failed', msg: e.error }) }
      else if (e.type === 'exit') { mpvActive.current = false; setMpvMode(false) }
    })
    // дрейф-реконсиляция: <video> — мягкий seek; mpv — бейдж отставания + плавный авто-докат скоростью
    const iv = window.setInterval(() => {
      const r = remote.current
      if (!r || issueRef.current || resolved.current?.url == null) return
      if (resolved.current.player === 'video') {
        const v = videoRef.current
        if (!r.paused && v) {
          const target = effectivePos(r)
          if (Math.abs(v.currentTime - target) > 2.5) { try { v.currentTime = target } catch { /* */ } }
        }
      } else if (resolved.current.player === 'mpv' && mpvActive.current) {
        if (r.paused) {
          if (mpvSpeed.current !== 1) { mpvSpeed.current = 1; window.chazh?.mpvSetSpeed?.(1) }
        } else {
          const diff = effectivePos(r) - mpvPos.current // >0 = отстаём от хоста
          const want = diff > 5 ? 1 : diff > 1.2 ? 1.05 : 1 // далеко позади → ждём докачку, чуть позади → ускоряемся
          if (mpvSpeed.current !== want) { mpvSpeed.current = want; window.chazh?.mpvSetSpeed?.(want) }
          setBehind(diff > 5)
        }
      }
    }, 3000)
    return () => {
      alive = false; off(); offProg?.(); offMpv?.(); window.clearInterval(iv)
      videoRef.current?.pause(); stopTorrentIfAny(); stopMpvIfAny()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId])

  async function loadUrl() {
    const text = urlInput.trim()
    if (!text) return
    setUrlInput('')
    let req: { kind: WatchSourceKind; url?: string; infoHash?: string }
    if (/^magnet:\?/i.test(text)) req = { kind: 'TORRENT', url: text }
    else if (/^[0-9a-fA-F]{40}$/.test(text) || /^[A-Za-z2-7]{32}$/.test(text)) req = { kind: 'TORRENT', infoHash: text }
    else if (isLinkHost(text)) req = { kind: 'LINK', url: text }
    else req = { kind: 'DIRECT', url: text }
    try { await apply(await api.setWatchSource(channelId, req)) } catch (e) { toast.error(apiError(e, 'Не удалось загрузить источник')) }
  }

  async function runSearch() {
    const q = query.trim()
    if (q.length < 2) { setSearchErr('Введите минимум 2 символа'); setResults(null); return }
    setSearching(true); setSearchErr(null); setResults(null)
    try {
      setResults(await api.searchWatch(channelId, q))
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 503) setSearchErr('Поиск временно недоступен — трекеры на сервере не настроены. Можно вставить magnet вручную.')
        else if (e.status === 403) setSearchErr('Нет прав на управление просмотром в этом канале.')
        else setSearchErr(apiError(e, `Ошибка поиска (${e.status})`))
      } else setSearchErr('Не удалось связаться с сервером.')
    } finally { setSearching(false) }
  }

  async function pickResult(r: WatchSearchResult) {
    // infoHash приоритетнее magnet: Prowlarr часто кладёт в magnet проксирующий http://…/download (НЕ magnet:),
    // который бэк отклоняет как «Invalid magnet». Чистый btih-хэш бэк сам превращает в канонический magnet.
    const realMagnet = r.magnet && /^magnet:\?/i.test(r.magnet) ? r.magnet : null
    const req = r.infoHash ? { kind: 'TORRENT' as const, infoHash: r.infoHash }
      : realMagnet ? { kind: 'TORRENT' as const, url: realMagnet } : null
    if (!req) { toast.error('У релиза нет magnet/infoHash'); return }
    setSearchOpen(false)
    try { await apply(await api.setWatchSource(channelId, req)) }
    catch (e) { toast.error(apiError(e, 'Не удалось загрузить источник')) }
  }

  function stop() {
    api.stopWatch(channelId).catch(() => {})
    applyGen.current++
    stopTorrentIfAny(); stopMpvIfAny()
    remote.current = null; resolved.current = null; loadedKey.current = null; issueRef.current = null
    setIssue(null); setBuffering(false); setState(null)
    const v = videoRef.current
    if (v) { v.pause(); v.removeAttribute('src'); v.load() }
  }

  const issueText: Record<Issue['kind'], { title: string; sub: string }> = {
    codec: { title: 'Формат пока не поддерживается', sub: 'mp4-раздачи играются в окне. Для MKV/HEVC нужен mpv — установи его (brew install mpv / winget install mpv) и перезапусти.' },
    failed: { title: 'Не удалось загрузить', sub: (issue?.msg ?? 'Возможно, нет раздающих. Попробуй другую раздачу.') },
    link: { title: 'Ссылка не поддерживается этой версией', sub: 'Обнови клиент — для YouTube/VK нужен встроенный yt-dlp+mpv (установи mpv и yt-dlp).' },
    nobridge: { title: 'Движок не загружен', sub: 'Полностью перезапусти приложение (npm run dev).' },
  }
  const showVideo = !!state?.url && !issue && !buffering && !mpvMode
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: 'var(--win)' }}>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0e0d0c', minHeight: 0, padding: 16, position: 'relative' }}>
        <video
          ref={videoRef}
          controls
          style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 12, background: '#000', display: showVideo ? 'block' : 'none' }}
          onPlay={() => sendFromVideo('PLAY')}
          onPause={() => sendFromVideo('PAUSE')}
          onSeeked={() => sendFromVideo('SEEK')}
          onWaiting={() => setBuffering(true)}
          onPlaying={() => setBuffering(false)}
          onCanPlay={() => setBuffering(false)}
        />
        {!state?.url && (
          <div style={{ textAlign: 'center', color: '#8a847a' }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><Film size={40} /></div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#e9e3d8' }}>Кинозал пуст</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Вставьте ссылку или magnet ниже — все увидят синхронно</div>
          </div>
        )}
        {buffering && state?.url && !issue && (
          <div style={{ textAlign: 'center', color: '#c7c0b5' }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><Loader2 size={34} style={{ animation: 'spin 1s linear infinite' }} /></div>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#e9e3d8' }}>Подключаемся к раздаче…</div>
            {dl && <div style={{ fontSize: 13, marginTop: 4 }}>загружено {dl.pct}% · пиров: {dl.peers}</div>}
          </div>
        )}
        {mpvMode && !issue && (
          <div style={{ textAlign: 'center', color: '#c7c0b5', maxWidth: 440 }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><MonitorPlay size={40} /></div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#e9e3d8' }}>Играем в окне mpv</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>MKV/HEVC открыт во внешнем плеере mpv, синхронно с комнатой. (Встраивание в окно — следующий шаг.)</div>
            {behind
              ? <div style={{ fontSize: 13, marginTop: 9, color: '#e0b43a', display: 'flex', alignItems: 'center', gap: 7, justifyContent: 'center' }}><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />отстаём, докачиваем…{dl ? ` (${dl.pct}%)` : ''}</div>
              : (dl && dl.pct < 100 && <div style={{ fontSize: 12.5, marginTop: 9 }}>загружено {dl.pct}% · пиров: {dl.peers}</div>)}
            {tracks && (tracks.audio.length > 1 || tracks.sub.length > 0) && (
              <div style={{ marginTop: 16, display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
                {tracks.audio.length > 1 && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8a847a', textTransform: 'uppercase' }}>Озвучка</span>
                    <select value={aid === false ? '' : String(aid)} onChange={(e) => { const id = Number(e.target.value); setAid(id); window.chazh?.mpvSetAudio?.(id) }} style={{ background: '#1a1815', color: '#e9e3d8', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', maxWidth: 210 }}>
                      {tracks.audio.map((t) => <option key={t.id} value={t.id}>{trackLabel(t)}</option>)}
                    </select>
                  </label>
                )}
                {tracks.sub.length > 0 && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: '#8a847a', textTransform: 'uppercase' }}>Субтитры</span>
                    <select value={sid === false ? 'off' : String(sid)} onChange={(e) => { const v = e.target.value; const id = v === 'off' ? false : Number(v); setSid(id); window.chazh?.mpvSetSub?.(id) }} style={{ background: '#1a1815', color: '#e9e3d8', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, padding: '6px 8px', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', maxWidth: 210 }}>
                      <option value="off">выкл</option>
                      {tracks.sub.map((t) => <option key={t.id} value={t.id}>{trackLabel(t)}</option>)}
                    </select>
                  </label>
                )}
              </div>
            )}
          </div>
        )}
        {issue && (
          <div style={{ textAlign: 'center', color: '#8a847a', maxWidth: 380 }}>
            <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><Film size={40} /></div>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#e9e3d8' }}>{issueText[issue.kind].title}</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{issueText[issue.kind].sub}</div>
          </div>
        )}
        {showVideo && (
          <div style={{ position: 'absolute', left: 22, top: 22, display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,0,0,.5)', borderRadius: 30, padding: '6px 13px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: state!.paused ? '#e0b43a' : '#2faa6a' }} />
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 600 }}>{state!.paused ? 'на паузе' : 'идёт'} · синхрон</span>
            {dl && dl.pct < 100 && <span style={{ color: '#c7c0b5', fontSize: 12 }}>· {dl.pct}%</span>}
          </div>
        )}
        {searchOpen && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(14,13,12,.97)', display: 'flex', flexDirection: 'column', animation: 'ovIn .2s ease' }}>
            <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
              <div className="field" style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,.06)', borderColor: 'rgba(255,255,255,.14)' }}>
                <span style={{ color: '#c7c0b5', display: 'flex' }}><Search size={15} /></span>
                <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Название фильма…" onKeyDown={(e) => { if (e.key === 'Enter') runSearch() }} style={{ color: '#fff' }} />
              </div>
              <button className="accent-btn no-drag" onClick={runSearch} disabled={searching} style={{ borderRadius: 12, padding: '10px 18px', fontWeight: 700, opacity: searching ? 0.6 : 1 }}>{searching ? 'Ищем…' : 'Найти'}</button>
              <button className="ib no-drag" onClick={() => setSearchOpen(false)} title="Закрыть" style={{ width: 38, height: 38, color: '#c7c0b5' }}><X size={18} /></button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '8px 10px' }}>
              {searching && <div style={{ textAlign: 'center', color: '#c7c0b5', padding: '34px 0' }}><Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} /></div>}
              {!searching && searchErr && <div style={{ textAlign: 'center', color: '#d98a82', padding: '34px 18px', fontSize: 13, lineHeight: 1.5 }}>{searchErr}</div>}
              {!searching && !searchErr && !results && <div style={{ textAlign: 'center', color: '#8a847a', padding: '34px 18px', fontSize: 13 }}>Введите название и нажмите «Найти».</div>}
              {!searching && !searchErr && results && results.length === 0 && <div style={{ textAlign: 'center', color: '#8a847a', padding: '34px 18px', fontSize: 13 }}>Ничего не найдено. Попробуй другое название.</div>}
              {!searching && !searchErr && results?.map((r, i) => (
                <button key={i} className="wresult no-drag" onClick={() => pickResult(r)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', border: 'none', background: 'transparent', color: '#e9e3d8', cursor: 'pointer', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                    <div style={{ fontSize: 11.5, color: '#8a847a', marginTop: 2, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <span>{formatWatchSize(r.sizeBytes)}</span>
                      <span style={{ color: r.seeders > 0 ? '#5cbf86' : '#8a847a' }}>↑ {r.seeders}</span>
                      <span>↓ {r.leechers}</span>
                      <span>{r.indexer}</span>
                    </div>
                  </div>
                  {r.webPlayable
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: '#5cbf86', background: 'rgba(92,191,134,.13)', borderRadius: 6, padding: '2px 8px', flex: 'none' }}>mp4</span>
                    : <span title="нужен mpv" style={{ fontSize: 11, fontWeight: 700, color: '#d9b25a', background: 'rgba(217,178,90,.13)', borderRadius: 6, padding: '2px 8px', flex: 'none', maxWidth: 120, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.codecNote ?? 'mpv'}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div style={{ flex: 'none', display: 'flex', gap: 10, padding: '12px 16px', borderTop: '1px solid var(--border)', alignItems: 'center' }}>
        <button className="pill no-drag" onClick={() => { setSearchOpen(true); setSearchErr(null) }} title="Поиск по названию" style={{ padding: '10px 14px', fontWeight: 600 }}><Search size={15} /> Поиск</button>
        <div className="field" style={{ flex: 1, padding: '10px 14px' }}>
          <span style={{ color: 'var(--text-3)', display: 'flex' }}><Link2 size={15} /></span>
          <input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="ссылка mp4 · magnet · YouTube/VK…" onKeyDown={(e) => { if (e.key === 'Enter') loadUrl() }} />
        </div>
        <button className="accent-btn no-drag" onClick={loadUrl} style={{ borderRadius: 12, padding: '10px 18px', fontWeight: 700 }}>Загрузить</button>
        {state?.url && <button className="pill no-drag" onClick={stop} style={{ padding: '10px 14px', fontWeight: 600 }}>Стоп</button>}
      </div>
    </div>
  )
}
