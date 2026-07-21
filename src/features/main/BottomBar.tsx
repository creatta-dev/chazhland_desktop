import { useEffect, useRef, useState } from 'react'
import { Settings, Check, Mic, MicOff, Shield, LogOut, Volume2, VolumeX, Headphones, HeadphoneOff, MonitorUp, ChevronUp, PhoneOff, UserRound, Music, Plus, X } from 'lucide-react'
import { Avatar, presenceColor } from '@/components/Avatar'
import { voice, SCREEN_QUALITY_LABELS, SCREEN_QUALITY_ORDER, type ScreenQuality } from '@/lib/voice'
import { soundboard } from '@/lib/soundboard'
import { nameStyle } from '@/lib/cosmetics'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { PRESENCE_LABEL } from '@/lib/presenceLabels'
import type { SoundClip } from '@/lib/api'
import type { Presence, User } from '@/lib/types'

const STATUS_OPTS: Presence[] = ['online', 'idle', 'dnd']

interface Props {
  user: User
  status: Presence
  onStatus: (s: Presence) => void
  muted: boolean
  onMute: () => void
  deafened: boolean
  onDeaf: () => void
  streamOn: boolean
  onGoLive: () => void
  voiceChannelName: string | null
  reconnecting?: boolean // голосовое соединение потеряно, идёт авто-переподключение
  onAckAll: () => void
  onOpenVoiceSettings: () => void
  onOpenSettings: () => void
  onOpenAdmin: () => void
  canModerate: boolean // админ-панель видна только OWNER/ADMIN
  onLogout: () => void
  onLeaveVoice: () => void
  soundboardDisabled?: boolean // саундпад выключен этому пользователю — прячем кнопку
  equipped?: Record<string, string> // надетая косметика (рамка/свечение/эффект ника) — мой мини-профиль
}

export function BottomBar(p: Props) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div style={{ height: 74, flex: 'none', background: 'var(--surface)', borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', padding: '0 18px', gap: 12 }}>
      {/* left */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifySelf: 'start', position: 'relative' }}>
        <button className="pill no-drag" onClick={() => setMenuOpen((v) => !v)} title="Настройки" style={{ width: 46, height: 46, justifyContent: 'center', color: 'var(--text-2)' }}><Settings size={18} /></button>
        {menuOpen && (
          <Popover onClose={() => setMenuOpen(false)} style={{ left: 0 }}>
            <MenuItem label="Прочитать всё" icon={<Check size={15} />} onClick={() => { setMenuOpen(false); p.onAckAll() }} />
            <MenuItem label="Профиль" icon={<UserRound size={15} />} onClick={() => { setMenuOpen(false); p.onOpenSettings() }} />
            <MenuItem label="Настройки голоса" icon={<Mic size={15} />} onClick={() => { setMenuOpen(false); p.onOpenVoiceSettings() }} />
            {p.canModerate && <MenuItem label="Админ-панель" icon={<Shield size={15} />} onClick={() => { setMenuOpen(false); p.onOpenAdmin() }} />}
            <MenuItem label="Выйти" icon={<LogOut size={15} />} danger onClick={() => { setMenuOpen(false); p.onLogout() }} />
          </Popover>
        )}
      </div>

      {/* center profile + status switcher */}
      <div style={{ justifySelf: 'center', position: 'relative' }}>
        <button onClick={() => setStatusOpen((v) => !v)} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 11, background: 'var(--win)', border: '1px solid var(--border)', borderRadius: 15, padding: '7px 18px 7px 9px', cursor: 'pointer', color: 'var(--text)' }}>
          <Avatar name={p.user.username} src={p.user.avatarUrl} size={40} presence={p.status} frame={p.equipped?.frame} glow={p.equipped?.glow} />
          <div style={{ lineHeight: 1.2, textAlign: 'left', minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, ...(nameStyle(p.equipped?.nameEffect) ?? {}) }}>{p.user.username}</div>
            {(() => {
              // приоритет: переподключение → в голосовом → статус «о себе» → пресенс-метка (онлайн/отошёл/dnd)
              const reconn = !!p.reconnecting && !!p.voiceChannelName
              const custom = !p.voiceChannelName && !!p.user.statusMessage?.trim()
              const text = reconn ? 'переподключение…' : (p.voiceChannelName ? `в эфире · ${p.voiceChannelName}` : (p.user.statusMessage?.trim() || PRESENCE_LABEL[p.status]))
              return (
                <div style={{ fontSize: 11.5, color: reconn ? '#e8a33d' : (custom ? 'var(--text-3)' : presenceColor(p.status)), display: 'flex', alignItems: 'center', gap: 5, maxWidth: 168 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: presenceColor(p.status), flex: 'none' }} />
                  <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
                </div>
              )
            })()}
          </div>
        </button>
        {statusOpen && (
          <Popover onClose={() => setStatusOpen(false)} style={{ left: '50%', transform: 'translateX(-50%)' }}>
            {STATUS_OPTS.map((s) => (
              <MenuItem key={s} label={PRESENCE_LABEL[s]} dot={presenceColor(s)} onClick={() => { setStatusOpen(false); p.onStatus(s) }} active={s === p.status} />
            ))}
          </Popover>
        )}
      </div>

      {/* right voice controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifySelf: 'end' }}>
        {p.voiceChannelName ? (
          <>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: p.reconnecting ? '#e8a33d' : 'var(--green)', fontSize: 13, fontWeight: 600, padding: '0 6px' }}><Volume2 size={15} /> {p.reconnecting ? 'переподключение…' : p.voiceChannelName}</span>
            <VoiceButton active={p.muted} onClick={p.onMute} title={p.muted ? 'Включить микрофон' : 'Выключить микрофон'} vol={{ title: 'ГРОМКОСТЬ МИКРОФОНА', max: 200, get: () => Math.round(voice.getVolumeSettings().mic * 100), set: (v) => voice.setMicVolume(v / 100) }}>{p.muted ? <MicOff size={18} /> : <Mic size={18} />}</VoiceButton>
            <VoiceButton active={p.deafened} onClick={p.onDeaf} title={p.deafened ? 'Включить звук' : 'Заглушить звук'} vol={{ title: 'ОБЩАЯ ГРОМКОСТЬ', max: 100, get: () => Math.round(voice.getVolumeSettings().master * 100), set: (v) => voice.setMasterVolume(v / 100) }}>{p.deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}</VoiceButton>
            <SoundboardControl disabled={p.soundboardDisabled} />
            <ScreenShareControls streamOn={p.streamOn} onGoLive={p.onGoLive} />
            <button onClick={p.onLeaveVoice} className="danger-btn no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 13, padding: '0 17px', height: 46, fontWeight: 700, fontSize: 13.5, boxShadow: '0 4px 12px rgba(224,57,47,.25)' }}><PhoneOff size={16} /> Выйти</button>
          </>
        ) : (
          <span style={{ fontSize: 12.5, color: 'var(--text-3)' }}>не в звонке</span>
        )}
      </div>
    </div>
  )
}

function VBtn({ active, onClick, onContextMenu, title, children }: { active?: boolean; onClick: () => void; onContextMenu?: (e: React.MouseEvent) => void; title: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} onContextMenu={onContextMenu} title={title} className="no-drag" style={{ width: 46, height: 46, borderRadius: 13, fontSize: 18, cursor: 'pointer', border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-tint)' : 'var(--win)', color: active ? 'var(--accent)' : 'var(--text-2)' }}>{children}</button>
  )
}

// Кнопка голосовой панели с громкостью по ПКМ: ЛКМ — действие (мьют/оглушение), ПКМ — поповер со слайдером.
function VoiceButton({ active, onClick, title, children, vol }: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode; vol: { title: string; max: number; get: () => number; set: (v: number) => void } }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <VBtn active={active} onClick={onClick} onContextMenu={(e) => { e.preventDefault(); setOpen((v) => !v) }} title={`${title} · ПКМ — громкость`}>{children}</VBtn>
      {open && <VolumePopover title={vol.title} value={vol.get()} max={vol.max} onChange={vol.set} onClose={() => setOpen(false)} />}
    </div>
  )
}

// Поповер-слайдер громкости (проценты). Локальный стейт ведёт ползунок, наружу шлём через onChange.
function VolumePopover({ title, value, max = 100, onChange, onClose }: { title: string; value: number; max?: number; onChange: (v: number) => void; onClose: () => void }) {
  const [pct, setPct] = useState(value)
  function change(v: number) { setPct(v); onChange(v) }
  return (
    <Popover onClose={onClose} style={{ right: 0, minWidth: 210 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', padding: '5px 9px 7px' }}>{title}</div>
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 11px 9px' }}>
        <input type="range" min={0} max={max} step={5} value={pct} onChange={(e) => change(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', width: 40, textAlign: 'right' }}>{pct}%</span>
      </div>
    </Popover>
  )
}

// Демонстрация экрана: основная кнопка (старт/стоп) + поповер выбора качества и трансляции звука.
function ScreenShareControls({ streamOn, onGoLive }: { streamOn: boolean; onGoLive: () => void }) {
  const [open, setOpen] = useState(false)
  const [s, setS] = useState(() => voice.getScreenSettings())
  const tone = streamOn ? 'var(--accent)' : 'var(--text-2)'
  const bg = streamOn ? 'var(--accent-tint)' : 'var(--win)'
  function setQuality(q: ScreenQuality) { voice.setScreenQuality(q); setS((p) => ({ ...p, quality: q })) }
  function toggleAudio() { const a = !s.audio; voice.setScreenAudio(a); setS((p) => ({ ...p, audio: a })) }
  return (
    <div style={{ display: 'flex', alignItems: 'center', position: 'relative' }}>
      <button onClick={onGoLive} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 9, border: `1px solid ${streamOn ? 'var(--accent)' : 'var(--border)'}`, borderRight: 'none', background: bg, color: tone, borderRadius: '13px 0 0 13px', padding: '0 14px', height: 46, fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
        <MonitorUp size={16} /> {streamOn ? 'В эфире' : 'Демонстрация'}
      </button>
      <button onClick={() => setOpen((v) => !v)} title="Качество и звук" className="no-drag" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${streamOn ? 'var(--accent)' : 'var(--border)'}`, background: bg, color: tone, borderRadius: '0 13px 13px 0', width: 34, height: 46, cursor: 'pointer' }}>
        <ChevronUp size={15} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform .15s' }} />
      </button>
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ right: 0, minWidth: 234 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', padding: '5px 9px 6px' }}>КАЧЕСТВО ДЕМОНСТРАЦИИ</div>
          {SCREEN_QUALITY_ORDER.map((q) => (
            <MenuItem key={q} label={SCREEN_QUALITY_LABELS[q]} icon={s.quality === q ? <Check size={15} /> : <span style={{ width: 15, display: 'inline-block' }} />} active={s.quality === q} onClick={() => setQuality(q)} />
          ))}
          <div style={{ height: 1, background: 'var(--border)', margin: '5px 6px' }} />
          <MenuItem label={s.audio ? 'Звук включён' : 'Транслировать звук'} icon={s.audio ? <Volume2 size={15} /> : <VolumeX size={15} />} active={s.audio} onClick={toggleAudio} />
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', padding: '2px 11px 6px', lineHeight: 1.35 }}>{streamOn ? 'Изменения применяются сразу' : 'Системный звук — только Windows'}</div>
        </Popover>
      )}
    </div>
  )
}

// Саундпад: общий список звуков сервера (плитки). Клик — проиграть (слышат все), крестик — удалить,
// «+» — загрузить файл и задать имя. Если саундпад выключен этому пользователю — кнопки нет вовсе.
function SoundboardControl({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [volOpen, setVolOpen] = useState(false)
  const [clips, setClips] = useState<SoundClip[]>(() => soundboard.list())
  const [pending, setPending] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => soundboard.subscribe(setClips), [])
  if (disabled) return null

  function pick(file?: File) {
    if (!file) return
    setPending(file); setName(file.name.replace(/\.[^.]+$/, '').slice(0, 64))
  }
  async function confirmAdd() {
    if (!pending) return
    setBusy(true)
    try { await soundboard.add(pending, name); setPending(null); setName('') }
    catch (e) { toast.error(apiError(e, 'Не удалось добавить звук')) }
    finally { setBusy(false) }
  }
  async function del(id: string) {
    try { await soundboard.remove(id) } catch (e) { toast.error(apiError(e, 'Не удалось удалить звук')) }
  }

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <VBtn active={open} onClick={() => setOpen((v) => !v)} onContextMenu={(e) => { e.preventDefault(); setVolOpen((v) => !v) }} title="Саундпад · ПКМ — громкость"><Music size={18} /></VBtn>
      {volOpen && <VolumePopover title="ГРОМКОСТЬ САУНДПАДА" value={Math.round(voice.getVolumeSettings().soundboard * 100)} max={200} onChange={(v) => voice.setSoundboardVolume(v / 100)} onClose={() => setVolOpen(false)} />}
      {open && (
        <Popover onClose={() => setOpen(false)} style={{ right: 0, minWidth: 268 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', color: 'var(--text-3)', padding: '5px 9px 8px' }}>САУНДПАД</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 7, padding: '0 5px 4px', maxHeight: 240, overflow: 'auto' }}>
            {clips.map((c) => (
              <div key={c.id} style={{ position: 'relative' }}>
                <button onClick={() => soundboard.play(c)} className="no-drag" title={`Проиграть: ${c.name}`} style={{ width: '100%', height: 52, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface-2)', color: 'var(--text)', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '4px 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</button>
                <button onClick={() => del(c.id)} className="no-drag" title="Удалить" style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={11} /></button>
              </div>
            ))}
            <button onClick={() => fileRef.current?.click()} className="no-drag" title="Добавить звук" style={{ height: 52, borderRadius: 10, border: '1.5px dashed var(--border-2)', background: 'transparent', color: 'var(--text-3)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Plus size={18} /></button>
          </div>
          {pending && (
            <div style={{ padding: '6px 6px 2px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя звука" maxLength={64} autoFocus className="no-drag" style={{ padding: '7px 10px', borderRadius: 9, border: '1px solid var(--border-2)', background: 'var(--win)', color: 'var(--text)', font: 'inherit', fontSize: 13, outline: 'none' }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={confirmAdd} disabled={busy} className="accent-btn no-drag" style={{ flex: 1, borderRadius: 9, padding: '7px 0', fontWeight: 700, fontSize: 12.5, opacity: busy ? 0.6 : 1 }}>{busy ? 'Загрузка…' : 'Добавить'}</button>
                <button onClick={() => { setPending(null); setName('') }} className="pill no-drag" style={{ padding: '7px 12px', fontWeight: 600, fontSize: 12.5 }}>Отмена</button>
              </div>
            </div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--text-3)', padding: '4px 11px 4px', lineHeight: 1.35 }}>Звук слышат все в канале. Форматы: mp3, ogg.</div>
          <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
        </Popover>
      )}
    </div>
  )
}

function Popover({ children, style, onClose }: { children: React.ReactNode; style?: React.CSSProperties; onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 30 }} />
      <div style={{ position: 'absolute', bottom: 'calc(100% + 8px)', zIndex: 31, minWidth: 200, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 18px 40px -16px var(--shadow)', padding: 6, ...style }}>
        {children}
      </div>
    </>
  )
}

function MenuItem({ label, icon, dot, danger, active, onClick }: { label: string; icon?: React.ReactNode; dot?: string; danger?: boolean; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', border: 'none', background: active ? 'var(--surface-2)' : 'transparent', color: danger ? 'var(--danger)' : 'var(--text)', borderRadius: 8, padding: '9px 11px', cursor: 'pointer', fontSize: 13.5, fontWeight: 500 }}>
      {dot && <span style={{ width: 10, height: 10, borderRadius: '50%', background: dot }} />}
      {icon && <span style={{ display: 'flex' }}>{icon}</span>}
      {label}
    </button>
  )
}
