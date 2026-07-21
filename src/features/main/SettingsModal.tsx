import { useEffect, useRef, useState } from 'react'
import { Camera, Lock, LogOut, UserRound, Volume2, Bell, Palette, Sparkles, ShieldCheck } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { Avatar } from '@/components/Avatar'
import { api } from '@/lib/api'
import { toast } from '@/lib/toast'
import { apiError } from '@/lib/http'
import { useAuth } from '@/store/auth'
import { useTheme } from '@/theme/ThemeProvider'
import { ACCENTS, type ThemeName } from '@/theme/themes'
import { notifyPrefs } from '@/lib/prefs'
import { msgAccentColor, nameStyle, SLOT_LABELS, SLOT_ORDER } from '@/lib/cosmetics'
import { RankBadge } from '@/components/RankBadge'
import { CosmeticBackground } from '@/components/CosmeticBackground'
import { Button, Spinner, Switch } from '@/components/ui'
import { loadouts, type Loadout } from '@/lib/loadouts'
import { SettingsAudio } from './SettingsAudio'
import type { MyRank, RankCatalog, RankCosmetic } from '@/lib/types'

const lbl: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: 6 }
const fieldS: React.CSSProperties = { padding: '11px 13px', marginBottom: 13 }

export type SettingsTab = 'profile' | 'audio' | 'notifications' | 'appearance' | 'cosmetics' | 'security'
const TABS: { id: SettingsTab; label: string; icon: typeof UserRound }[] = [
  { id: 'profile', label: 'Профиль', icon: UserRound },
  { id: 'audio', label: 'Аудио', icon: Volume2 },
  { id: 'notifications', label: 'Уведомления', icon: Bell },
  { id: 'appearance', label: 'Внешний вид', icon: Palette },
  { id: 'cosmetics', label: 'Косметика', icon: Sparkles },
  { id: 'security', label: 'Безопасность', icon: ShieldCheck },
]

export function SettingsModal({ onClose, onEquipChange, onProfileBgChange, initialTab = 'profile' }: { onClose: () => void; onEquipChange?: (equipped: Record<string, string>) => void; onProfileBgChange?: (url: string | null) => void; initialTab?: SettingsTab }) {
  const { session, updateUser, logout } = useAuth()
  const user = session!.user
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const { theme, accent, setTheme, setAccent } = useTheme()
  const [np, setNp] = useState(notifyPrefs.get())
  function updNp(p: Partial<typeof np>) { notifyPrefs.set(p); setNp(notifyPrefs.get()) }
  const [username, setUsername] = useState(user.username)
  const [statusMsg, setStatusMsg] = useState(user.statusMessage ?? '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwBusy, setPwBusy] = useState(false)

  const profileDirty = username.trim() !== user.username || statusMsg.trim() !== (user.statusMessage ?? '')

  async function saveProfile() {
    const u = username.trim()
    if (u.length < 2) { toast.error('Имя — минимум 2 символа'); return }
    setSavingProfile(true)
    try {
      const updated = await api.updateProfile({ username: u, statusMessage: statusMsg.trim() })
      updateUser({ username: updated.username, statusMessage: updated.statusMessage })
      toast.ok('Профиль сохранён')
    } catch (e) { toast.error(apiError(e, 'Не удалось сохранить профиль')) }
    finally { setSavingProfile(false) }
  }

  async function pickAvatar(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Аватар должен быть изображением'); return }
    setAvatarBusy(true)
    try {
      const up = await api.uploadFile(file)
      const updated = await api.setAvatar(up.objectKey)
      updateUser({ avatarUrl: updated.avatarUrl })
      toast.ok('Аватар обновлён')
    } catch (e) { toast.error(apiError(e, 'Не удалось загрузить аватар')) }
    finally { setAvatarBusy(false) }
  }

  async function savePassword() {
    if (newPw.length < 8) { toast.error('Новый пароль — минимум 8 символов'); return }
    if (newPw !== confirmPw) { toast.error('Пароли не совпадают'); return }
    setPwBusy(true)
    try {
      await api.changePassword({ currentPassword: curPw, newPassword: newPw })
      setCurPw(''); setNewPw(''); setConfirmPw('')
      toast.ok('Пароль изменён')
    } catch (e) { toast.error(apiError(e, 'Не удалось сменить пароль — проверьте текущий')) }
    finally { setPwBusy(false) }
  }

  async function doLogoutAll() {
    try { await api.logoutAll(); toast.ok('Все сессии завершены'); logout() } catch (e) { toast.error(apiError(e, 'Не удалось завершить сессии')) }
  }

  return (
    <Modal title="Настройки" onClose={onClose} width={760} height={600} padded={false}>
      <div style={{ display: 'flex', height: '100%' }}>
        {/* левая навигация по разделам */}
        <nav style={{ width: 178, flex: 'none', borderRight: '1px solid var(--border)', background: 'var(--surface)', padding: '12px 10px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button key={t.id} className="no-drag" onClick={() => setTab(t.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', padding: '9px 11px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, background: active ? 'var(--accent-tint)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-2)' }}>
                <t.icon size={16} /> {t.label}
              </button>
            )
          })}
        </nav>

        {/* контент выбранного раздела (прокручивается) */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: 22 }}>
          {tab === 'profile' && (
            <>
              <SectionTitle>Профиль</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginBottom: 16 }}>
                <div style={{ position: 'relative' }}>
                  <Avatar name={user.username} src={user.avatarUrl} size={64} />
                  {avatarBusy && <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner size={20} /></div>}
                </div>
                <div>
                  <button type="button" className="pill no-drag" onClick={() => fileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontWeight: 600, fontSize: 13 }}><Camera size={15} /> Изменить аватар</button>
                  <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 6 }}>PNG, JPG или GIF (анимированный) — лучше квадрат</div>
                </div>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { pickAvatar(e.target.files?.[0]); e.target.value = '' }} />
              </div>
              <label style={lbl}>Имя пользователя</label>
              {/* maxLength — как @Size(max = 32) в web/dto/ProfileUpdateRequest: иначе правка отлетала 400-й уже после клика */}
              <div className="field" style={fieldS}><input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ваш ник" maxLength={32} /></div>
              <label style={lbl}>О себе / статус</label>
              <div className="field" style={fieldS}><input value={statusMsg} onChange={(e) => setStatusMsg(e.target.value)} placeholder="например, на удалёнке" maxLength={255} /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button type="button" size="sm" disabled={!profileDirty || savingProfile} onClick={saveProfile}>{savingProfile ? 'Сохранение…' : 'Сохранить'}</Button>
              </div>
            </>
          )}

          {tab === 'audio' && (<><SectionTitle>Аудио</SectionTitle><SettingsAudio /></>)}

          {tab === 'notifications' && (
            <>
              <SectionTitle>Уведомления</SectionTitle>
              <ToggleRow label="Десктоп-уведомления" hint="всплывающие окна о сообщениях" on={np.desktop} onChange={(v) => updNp({ desktop: v })} />
              <ToggleRow label="Звуки уведомлений" hint="пинг при упоминании, ЛС и реакции" on={np.sounds} onChange={(v) => updNp({ sounds: v })} />
              <ToggleRow label="Тихо в режиме «Не беспокоить»" hint="без всплывашек и звука при статусе dnd" on={np.respectDnd} onChange={(v) => updNp({ respectDnd: v })} />
            </>
          )}

          {tab === 'appearance' && (
            <>
              <SectionTitle>Внешний вид</SectionTitle>
              <label style={lbl}>Тема</label>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {(['light', 'dark'] as ThemeName[]).map((t) => (
                  <button key={t} type="button" onClick={() => setTheme(t)} className="no-drag" style={{ flex: 1, padding: '10px 0', borderRadius: 11, border: `1.5px solid ${theme === t ? 'var(--accent)' : 'var(--border)'}`, background: theme === t ? 'var(--accent-tint)' : 'var(--surface)', color: theme === t ? 'var(--accent)' : 'var(--text)', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>{t === 'light' ? 'Светлая' : 'Тёмная'}</button>
                ))}
              </div>
              <label style={lbl}>Акцент</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {ACCENTS.map((c) => {
                  const sel = accent.toLowerCase() === c.toLowerCase()
                  return <button key={c} type="button" onClick={() => setAccent(c)} aria-label={`акцент ${c}`} className="no-drag" style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: 'none', cursor: 'pointer', outline: sel ? '2px solid var(--text)' : '1px solid var(--border-2)', outlineOffset: 2 }} />
                })}
              </div>
            </>
          )}

          {tab === 'cosmetics' && (
            <>
              <SectionTitle>Награды · косметика</SectionTitle>
              <CosmeticsSection meId={user.id} meName={username.trim() || user.username} meAvatar={user.avatarUrl} onEquipChange={onEquipChange} onProfileBgChange={onProfileBgChange} />
            </>
          )}

          {tab === 'security' && (
            <>
              <SectionTitle>Безопасность</SectionTitle>
              <label style={lbl}>Текущий пароль</label>
              <div className="field" style={fieldS}><input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} placeholder="••••••••" /></div>
              <label style={lbl}>Новый пароль</label>
              <div className="field" style={fieldS}><input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="минимум 8 символов" /></div>
              <label style={lbl}>Повторите новый пароль</label>
              <div className="field" style={fieldS}><input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" /></div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                <Button type="button" size="sm" disabled={pwBusy || !curPw || !newPw || !confirmPw} onClick={savePassword}>{pwBusy ? 'Смена…' : 'Сменить пароль'}</Button>
              </div>
              <div style={{ height: 1, background: 'var(--border)', margin: '18px 0' }} />
              <button type="button" className="danger-btn no-drag" onClick={doLogoutAll} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 11, padding: '10px 16px', fontWeight: 600, fontSize: 13 }}><LogOut size={15} /> Выйти со всех устройств</button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function CosmeticsSection({ meId, meName, meAvatar, onEquipChange, onProfileBgChange }: { meId: string; meName: string; meAvatar: string | null; onEquipChange?: (equipped: Record<string, string>) => void; onProfileBgChange?: (url: string | null) => void }) {
  const [catalog, setCatalog] = useState<RankCatalog | null>(null)
  const [mine, setMine] = useState<MyRank | null>(null)
  const [equipped, setEquipped] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null) // cosmeticId/slot в процессе
  const [bgUrl, setBgUrl] = useState<string | null>(null) // загруженный фон профиля
  const [bgBusy, setBgBusy] = useState(false)
  const bgFileRef = useRef<HTMLInputElement>(null)
  const [presets, setPresets] = useState<Loadout[]>(() => loadouts.list(meId)) // пресеты-образы

  useEffect(() => {
    let alive = true
    Promise.all([api.rankCatalog(), api.myRank()])
      .then(([c, m]) => { if (!alive) return; setCatalog(c); setMine(m); setEquipped({ ...(m.equipped ?? {}) }); setBgUrl(m.profileBackgroundUrl ?? null) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  function saveLoadout() {
    if (!Object.keys(equipped).length) { toast.error('Сначала надень косметику'); return }
    setPresets(loadouts.save(meId, `Образ ${presets.length + 1}`, equipped))
    toast.ok('Образ сохранён')
  }
  function deleteLoadout(id: string) { setPresets(loadouts.remove(meId, id)) }
  async function applyLoadout(lo: Loadout) {
    setBusy('loadout')
    setEquipped({ ...lo.equipped }) // оптимистично весь образ сразу
    let saved = { ...equipped } // аккумулятор реально применённого на сервере (для отката к факту)
    try {
      for (const slot of SLOT_ORDER) {
        const want = lo.equipped[slot] ?? null
        if ((saved[slot] ?? null) !== want) saved = await api.equipCosmetic(slot, want)
      }
      setEquipped(saved); onEquipChange?.(saved)
      toast.ok(`Образ «${lo.name}» применён`)
    } catch {
      // часть слотов могла уже примениться — синхронизируемся с фактическим состоянием, а не откатываем всё
      setEquipped(saved); onEquipChange?.(saved)
      toast.error('Образ применён частично')
    } finally { setBusy(null) }
  }

  async function pickBg(file?: File) {
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Фон должен быть изображением'); return }
    setBgBusy(true)
    try {
      const up = await api.uploadFile(file)
      const url = await api.setProfileBackground(up.objectKey)
      setBgUrl(url); onProfileBgChange?.(url)
      toast.ok('Фон профиля обновлён')
    } catch (e) { toast.error(apiError(e, 'Не удалось загрузить фон')) }
    finally { setBgBusy(false) }
  }
  async function removeBg() {
    setBgBusy(true)
    try { await api.clearProfileBackground(); setBgUrl(null); onProfileBgChange?.(null); toast.ok('Фон профиля снят') }
    catch (e) { toast.error(apiError(e, 'Не удалось снять фон')) }
    finally { setBgBusy(false) }
  }

  async function equip(slot: string, cosmeticId: string | null) {
    const key = cosmeticId ?? `none:${slot}`
    const prev = equipped // состояние ИМЕННО перед этим вызовом (не снимок монтирования)
    setBusy(key)
    const next = { ...equipped }
    if (cosmeticId) next[slot] = cosmeticId; else delete next[slot]
    setEquipped(next) // оптимистично
    try {
      const saved = await api.equipCosmetic(slot, cosmeticId)
      setEquipped(saved)
      onEquipChange?.(saved)
    } catch (e) {
      setEquipped(prev) // откат только этого изменения — прежние удачные экипировки сохраняются
      onEquipChange?.(prev) // держим родителя (рейл/чат/мини-профиль) в синхроне с откатом
      toast.error(apiError(e, 'Не удалось применить косметику'))
    } finally { setBusy(null) }
  }

  if (!catalog || !mine) {
    return <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>{[0, 1, 2].map((i) => <div key={i} style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--surface-2)', animation: 'live 1.4s ease-in-out infinite' }} />)}</div>
  }

  const unlocked = new Set(mine.unlockedCosmeticIds)
  const slots = SLOT_ORDER.filter((s) => catalog.cosmetics.some((c) => c.slot === s))
  const unlockedCount = catalog.cosmetics.filter((c) => unlocked.has(c.id)).length
  // загружаемые (userUpload) косметики фона профиля: открыта ли хоть одна (иначе — на каком уровне откроется)
  const uploadCosmetics = catalog.cosmetics.filter((c) => c.slot === 'profileBg' && c.kind === 'userUpload')
  const canUploadBg = uploadCosmetics.some((c) => unlocked.has(c.id))
  const uploadAtLevel = uploadCosmetics.length ? Math.min(...uploadCosmetics.map((c) => c.unlockLevel)) : null
  const hasBg = !!bgUrl || !!equipped.profileBg

  return (
    <div>
      {/* живое превью-карточка: фон профиля + аватар с рамкой/свечением + ник с эффектом + пик-титул */}
      <div style={{ position: 'relative', overflow: 'hidden', marginBottom: 14, borderRadius: 14, border: '1px solid var(--border)' }}>
        {hasBg && <CosmeticBackground id={bgUrl ? null : equipped.profileBg} imageUrl={bgUrl} />}
        {hasBg && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(0deg, rgba(0,0,0,.6), rgba(0,0,0,.28))' }} />}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', background: hasBg ? 'transparent' : 'var(--surface-2)' }}>
          <Avatar name={meName} src={meAvatar} size={56} frame={equipped.frame} glow={equipped.glow} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2, ...(nameStyle(equipped.nameEffect) ?? { color: hasBg ? '#fff' : 'var(--text)' }) }}>{meName}</div>
            <div style={{ fontSize: 12, color: hasBg ? 'rgba(255,255,255,.85)' : 'var(--text-3)', marginTop: 3 }}>пик: ур.{mine.peakLevel}{mine.peakTitle ? ` · ${mine.peakTitle}` : ''} · открыто {unlockedCount} из {catalog.cosmetics.length}</div>
          </div>
        </div>
      </div>

      {/* пресеты-образы: сохранить текущую экипировку и переключаться в один клик */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)' }}>Образы</div>
          <button type="button" className="no-drag" disabled={busy === 'loadout'} onClick={saveLoadout} style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>+ Сохранить текущий</button>
        </div>
        {presets.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>Сохрани комбо косметики и переключай образы в один клик.</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {presets.map((lo) => (
              <div key={lo.id} style={{ position: 'relative' }}>
                <button type="button" className="no-drag" disabled={busy === 'loadout'} onClick={() => applyLoadout(lo)} title={`Применить «${lo.name}»`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px 6px 6px', borderRadius: 11, border: '1.5px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}>
                  <Avatar name={meName} src={meAvatar} size={26} frame={lo.equipped.frame} glow={lo.equipped.glow} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>{lo.name}</span>
                </button>
                <button type="button" className="no-drag" title="Удалить образ" onClick={() => deleteLoadout(lo.id)} style={{ position: 'absolute', top: -5, right: -5, width: 18, height: 18, borderRadius: '50%', border: 'none', background: 'var(--danger)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, lineHeight: 1 }}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* загрузка своей картинки на фон профиля (верхняя косметика) */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>Свой фон профиля</div>
        {canUploadBg ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button type="button" className="pill no-drag" disabled={bgBusy} onClick={() => bgFileRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', fontWeight: 600, fontSize: 13, opacity: bgBusy ? 0.6 : 1 }}><Camera size={15} /> {bgBusy ? 'Загрузка…' : (bgUrl ? 'Заменить картинку' : 'Загрузить картинку')}</button>
            {bgUrl && <button type="button" className="no-drag" disabled={bgBusy} onClick={removeBg} style={{ fontSize: 12.5, color: 'var(--danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Снять</button>}
            <input ref={bgFileRef} type="file" accept="image/*" hidden onChange={(e) => { pickBg(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--text-3)', display: 'flex', alignItems: 'center', gap: 6 }}><Lock size={12} /> Откроется на ур.{uploadAtLevel ?? '—'} — своя картинка/анимация на фон профиля</div>
        )}
      </div>

      {slots.map((slot) => {
        const items = catalog.cosmetics.filter((c) => c.slot === slot).sort((a, b) => a.unlockLevel - b.unlockLevel)
        return (
          <div key={slot} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-2)', marginBottom: 8 }}>{SLOT_LABELS[slot] ?? slot}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <NoneCard active={!equipped[slot]} busy={busy === `none:${slot}` || busy === 'loadout'} onClick={() => equip(slot, null)} />
              {items.map((c) => (
                <CosmeticCard key={c.id} c={c} meName={meName} meAvatar={meAvatar}
                  locked={!unlocked.has(c.id)} active={equipped[slot] === c.id} busy={busy === c.id || busy === 'loadout'}
                  onClick={() => unlocked.has(c.id) && equip(slot, c.id)} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

const CARD = 72
function cardShell(active: boolean, locked?: boolean): React.CSSProperties {
  return {
    width: CARD, flex: 'none', borderRadius: 13, padding: 7, cursor: locked ? 'not-allowed' : 'pointer', position: 'relative',
    border: `1.5px solid ${active ? 'var(--accent)' : 'var(--border)'}`, background: active ? 'var(--accent-tint)' : 'var(--surface)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, opacity: locked ? 0.5 : 1, transition: 'border-color .15s, background .15s',
  }
}

function NoneCard({ active, busy, onClick }: { active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="no-drag" onClick={onClick} disabled={busy} style={{ ...cardShell(active), justifyContent: 'center' }} title="Снять">
      <div style={{ width: 40, height: 40, borderRadius: '50%', border: '1.5px dashed var(--border-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 18 }}>∅</div>
      <span style={{ fontSize: 10.5, color: 'var(--text-3)', fontWeight: 600 }}>без</span>
    </button>
  )
}

function CosmeticCard({ c, meName, meAvatar, locked, active, busy, onClick }: { c: RankCosmetic; meName: string; meAvatar: string | null; locked: boolean; active: boolean; busy: boolean; onClick: () => void }) {
  return (
    <button type="button" className="no-drag" onClick={onClick} disabled={locked || busy} style={cardShell(active, locked)} title={c.name + (locked ? ` · откроется на ур.${c.unlockLevel}` : '')}>
      <CosmeticSwatch c={c} meName={meName} meAvatar={meAvatar} />
      <span style={{ fontSize: 10, color: active ? 'var(--accent)' : 'var(--text-3)', fontWeight: 600, lineHeight: 1.15, textAlign: 'center', maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name.replace(/^[^—]*— /, '')}</span>
      {locked && <span style={{ position: 'absolute', top: 5, right: 5, display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, color: 'var(--text-3)', background: 'var(--surface-3)', borderRadius: 6, padding: '1px 4px' }}><Lock size={9} />{c.unlockLevel}</span>}
    </button>
  )
}

/** Мини-витрина одной косметики: рамка/свечение — на аватаре, эффект ника — текстом, прочее — плашкой. */
function CosmeticSwatch({ c, meName, meAvatar }: { c: RankCosmetic; meName: string; meAvatar: string | null }) {
  if (c.slot === 'frame') return <Avatar name={meName} src={meAvatar} size={40} frame={c.id} />
  if (c.slot === 'glow') return <Avatar name={meName} src={meAvatar} size={40} glow={c.id} />
  if (c.slot === 'nameEffect') return <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 22, ...(nameStyle(c.id) ?? { color: 'var(--text)' }) }}>Аб</div>
  if (c.slot === 'profileBg') return <div style={{ width: 40, height: 40, borderRadius: 9, overflow: 'hidden', position: 'relative', background: '#2a2540' }}><CosmeticBackground id={c.id} /></div>
  if (c.slot === 'badge') return <div style={{ width: 40, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><RankBadge id={c.id} size={26} /></div>
  if (c.slot === 'banner') return <div style={{ width: 40, height: 40, borderRadius: 9, overflow: 'hidden', position: 'relative', background: '#2a2540' }}><CosmeticBackground id={c.id} /></div>
  if (c.slot === 'msgAccent') return <div style={{ width: 40, height: 40, borderRadius: 9, background: 'var(--surface-3)', boxShadow: `inset 3px 0 0 ${msgAccentColor(c.id) || 'var(--accent)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 800, color: 'var(--text-3)' }}>≡</div>
  // прочее — обобщённая градиентная плашка
  return <div style={{ width: 40, height: 40, borderRadius: 9, background: 'linear-gradient(135deg,var(--accent),#13b886)', opacity: 0.85 }} />
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'var(--text-3)', marginBottom: 12 }}>{children}</div>
}

function ToggleRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)' }}>{hint}</div>}
      </div>
      <Switch checked={on} onChange={onChange} ariaLabel={label} offColor="var(--surface-3)" />
    </div>
  )
}
