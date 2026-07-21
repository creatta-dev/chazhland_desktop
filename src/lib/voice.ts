// Фасад голосового модуля: комната LiveKit, микрофон/оглушение, PTT, демонстрация экрана и подписка
// UI на состояние. Отделяемые куски вынесены в src/lib/voice/*: типы, персистентность настроек,
// перечисление устройств, опции демонстрации, реестр входящих аудио-элементов, голосовой гейт,
// монитор «Проверить микрофон». Наружу по-прежнему торчит только `voice` и типы отсюда.
import { Room, RoomEvent, Track, AudioPresets, DisconnectReason, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant, type Participant, type LocalAudioTrack, type AudioCaptureOptions } from 'livekit-client'
import { createMicProcessor, MicProcessor } from './rnnoise'
import { MOCK } from './config'
import { api } from './api'
import { sfx } from './sfx'
import { soundboard } from './soundboard'
import { toast } from './toast'
import { clamp01, type AudioDevice, type ScreenQuality, type ScreenShare, type VoiceMode, type VoiceParticipant, type VoiceSettings, type VoiceState, type VolumeSettings } from './voice/types'
import { loadSettings, loadVolumes, saveSettings as persistSettings, saveVolumes as persistVolumes } from './voice/settings'
import { listDevices as enumerateDevices, requestMicPermission as askMicPermission } from './voice/devices'
import { screenOpts } from './voice/screenShare'
import { RemoteAudioRegistry, type RemoteAudioKind, type RemoteAudioVolumes } from './voice/audioElements'
import { MicGate } from './voice/micGate'
import { MicMonitor } from './voice/micMonitor'

// публичная поверхность модуля не изменилась: UI по-прежнему берёт всё это из '@/lib/voice'
export type { AudioDevice, NoiseSuppressor, ScreenQuality, ScreenShare, VoiceMode, VoiceParticipant, VoiceSettings, VoiceState, VolumeSettings } from './voice/types'
export { MIC_RMS_FULL } from './voice/types'
export { SCREEN_QUALITY_LABELS, SCREEN_QUALITY_ORDER } from './voice/screenShare'

const INITIAL: VoiceState = {
  channelId: null, channelName: null, connecting: false, reconnecting: false,
  micOn: false, deafened: false, screenOn: false, participants: [], screenTrack: null, screenBy: null,
  screens: [], activeScreenId: null,
}
// глобальный хоткей тумблера микрофона (работает вне фокуса окна; true hold-PTT недоступен через globalShortcut)
const MIC_HOTKEY = 'CommandOrControl+Shift+M'
const SB_TRACK_NAME = 'soundboard' // имя публикуемого аудио-трека саундпада (отличаем на приёмнике от голоса)

class Voice {
  private room: Room | null = null
  private remoteAudio = new RemoteAudioRegistry() // входящий звук: голос собеседников, саундпад, звук демонстрации
  private screenTracks = new Map<RemoteTrack, { userId: string; name: string }>()
  private screenIds = new WeakMap<RemoteTrack, string>() // стабильный id на трек (для выбора активной демонстрации)
  private screenIdSeq = 0
  private activeScreenId: string | null = null
  private speaking = new Set<string>()
  private targetId: string | null = null
  private joinSeq = 0
  private screenSeq = 0 // инвалидация in-flight операций демонстрации (стоп/смена качества/комнаты)
  private micBeforeDeaf = true
  private pttHeld = false
  private reconnectAttempts = 0 // счётчик подряд идущих авто-переподключений (сброс при успехе)
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private micChain: Promise<void> = Promise.resolve() // очередь операций с микрофоном (анти-гонка)
  private micProcessor: MicProcessor | null = null // активная мик-цепочка (шумодав + gain); null = без обработки
  // голосовой гейт (порог реагирования микрофона) — замер по клону публикуемого трека
  private gate = new MicGate({ track: () => this.micTrackSource(), threshold: () => this.settings.micThreshold })
  // монитор «Проверить микрофон» (слышу себя) — независимый тракт, от комнаты не зависит
  private monitor = new MicMonitor(() => this.settings)
  private volumes = loadVolumes()
  state: VoiceState = { ...INITIAL }
  settings: VoiceSettings = loadSettings()
  private cbs = new Set<(s: VoiceState) => void>()

  constructor() {
    soundboard.setVolume(this.settings.masterVolume * this.settings.soundboardVolume) // громкость своих триггеров
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.onKey(e, true))
      window.addEventListener('keyup', (e) => this.onKey(e, false))
      // PTT по кнопке мыши (боковые/средняя): срабатывает, пока окно в фокусе
      window.addEventListener('mousedown', (e) => this.onMouse(e, true))
      window.addEventListener('mouseup', (e) => this.onMouse(e, false))
      // окно потеряло фокус: оконные keyup/mouseup до нас уже не дойдут — отпускаем зажатый PTT
      window.addEventListener('blur', () => this.onBlur())
      window.chazh?.onToggleMic(() => { void this.toggleMic() }) // глобальный хоткей → тумблер микрофона
    }
  }

  private saveSettings() { persistSettings(this.settings) }
  private saveVolumes() { persistVolumes(this.volumes) }

  subscribe(cb: (s: VoiceState) => void): () => void {
    this.cbs.add(cb); cb(this.state)
    return () => { this.cbs.delete(cb) }
  }
  private set(p: Partial<VoiceState>) { this.state = { ...this.state, ...p }; this.cbs.forEach((c) => c(this.state)) }

  // Активен ли выбранный движок шумодава (при включённом шумоподавлении). Два движка одновременно НЕ
  // включаем: браузерный NS + RNNoise стакаются — браузер курочит сигнал до RNNoise («роботный» голос).
  private rnnoiseActive() { return this.settings.noiseSuppression && this.settings.noiseSuppressor === 'rnnoise' }
  private browserNsActive() { return this.settings.noiseSuppression && this.settings.noiseSuppressor === 'browser' }

  private captureOpts(): AudioCaptureOptions {
    return {
      deviceId: this.settings.inputId || undefined,
      // Браузерный WebRTC-NS включаем ТОЛЬКО когда движок = 'browser'. При движке 'rnnoise' здесь false, а
      // шумодавом заведует RNNoise (MicProcessor, см. refreshMicProcessor) — иначе два шумодава стакаются.
      // Если RNNoise не загрузится (крайне редко в Electron — WASM в бандле), NS не будет — приемлемо.
      // AEC/AGC всегда отдаём браузеру (RNNoise их не делает).
      noiseSuppression: this.browserNsActive(),
      echoCancellation: this.settings.echoCancellation,
      autoGainControl: this.settings.autoGain,
    }
  }

  async join(channelId: string, channelName: string) {
    if (this.targetId === channelId) return
    this.targetId = channelId
    this.clearReconnect() // новый заход отменяет отложенное авто-переподключение к прежнему каналу
    const seq = ++this.joinSeq
    await this.teardownRoom()
    if (this.joinSeq !== seq) return

    if (MOCK) {
      this.set({ channelId, channelName, connecting: false, micOn: this.settings.mode === 'voice', deafened: false, screenOn: false,
        participants: [{ id: 'u_anya', name: 'Аня', speaking: true, micOn: true, deafened: false, volume: 1 }, { id: 'u_me', name: 'Вы', speaking: false, micOn: true, deafened: false, volume: 1 }] })
      return
    }

    // screenTrack/screenBy сбрасываем явно: иначе чужая демонстрация из прошлого канала
    // осталась бы висеть (teardownRoom лишь чистит карту треков, но не трогает state)
    this.set({ channelId, channelName, connecting: true, micOn: false, deafened: false, screenOn: false, participants: [], screenTrack: null, screenBy: null, screens: [], activeScreenId: null })
    try {
      const t = await api.livekitToken(channelId)
      if (this.joinSeq !== seq) return
      // musicHighQuality (≈96 кбит/с mono) + RED: голос собеседника звучит чище и устойчивее к
      // потерям пакетов, в т.ч. когда говорят одновременно; речевой пресет по умолчанию режет качество
      const room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: this.captureOpts(),
        publishDefaults: { audioPreset: AudioPresets.musicHighQuality, red: true, dtx: true } })
      this.room = room
      room
        .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) => this.attach(track, pub, p))
        .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => this.detach(track))
        .on(RoomEvent.ActiveSpeakersChanged, (sp: Participant[]) => { this.speaking = new Set(sp.map((p) => p.identity)); this.refresh() })
        .on(RoomEvent.ParticipantAttributesChanged, () => this.refresh()) // чужой deafen приходит атрибутом
        .on(RoomEvent.ParticipantConnected, () => { sfx.join(); this.refresh() })
        .on(RoomEvent.ParticipantDisconnected, () => { sfx.leave(); this.refresh() })
        .on(RoomEvent.LocalTrackPublished, () => this.refresh())
        // авто-реконнект LiveKit (сетевой блип): показываем баннер, токен переиспользуется самим клиентом
        .on(RoomEvent.Reconnecting, () => { if (this.room === room) this.set({ reconnecting: true }) })
        .on(RoomEvent.Reconnected, () => { if (this.room === room) { this.reconnectAttempts = 0; this.set({ reconnecting: false }) } })
        .on(RoomEvent.MediaDevicesError, (e: Error) => toast.error('Ошибка аудиоустройства: ' + (e?.message || 'нет доступа к микрофону')))
        .on(RoomEvent.Disconnected, (reason?: DisconnectReason) => { if (this.room === room) this.onDisconnected(reason) })
      await room.connect(t.url, t.token)
      if (this.joinSeq !== seq) { room.removeAllListeners(); try { await room.disconnect() } catch { /* */ } return }
      if (this.settings.outputId) await room.switchActiveDevice('audiooutput', this.settings.outputId).catch(() => {})
      const micOn = this.settings.mode === 'voice' // в режиме PTT молчим до нажатия клавиши
      if (micOn) { await room.localParticipant.setMicrophoneEnabled(true, this.captureOpts()); await this.refreshMicProcessor() }
      // саундпад: публикуем отдельный аудио-трек, в который микшируются клипы (слышат все). Публикуем КЛОН —
      // чтобы LiveKit, остановив трек при выходе из канала, не заглушил наш постоянный микшер.
      try {
        const sb = soundboard.outputTrack()
        if (sb && this.joinSeq === seq && this.room === room) {
          await room.localParticipant.publishTrack(sb.clone(), { name: SB_TRACK_NAME, source: Track.Source.Unknown })
        }
      } catch { /* саундпад недоступен — голос работает */ }
      this.reconnectAttempts = 0 // успешно подключились — сбрасываем счётчик переподключений
      this.set({ connecting: false, micOn, reconnecting: false })
      // только если это всё ещё актуальное соединение — иначе Disconnected уже снял хоткей, не возвращаем его
      if (this.joinSeq === seq && this.room === room) window.chazh?.setMicHotkey(MIC_HOTKEY)
      this.refresh()
    } catch {
      if (this.joinSeq === seq) { this.targetId = null; await this.teardownRoom(); this.set({ ...INITIAL }) }
    }
  }

  private attach(track: RemoteTrack, pub: RemoteTrackPublication | undefined, participant: RemoteParticipant) {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach() as HTMLAudioElement
      el.autoplay = true
      if (this.settings.outputId && 'setSinkId' in el) (el as any).setSinkId(this.settings.outputId).catch(() => {})
      document.body.appendChild(el)
      // категория входящего звука: звук чужой демонстрации / саундпад (отдельный трек по имени) / голос
      const kind: RemoteAudioKind = track.source === Track.Source.ScreenShareAudio ? 'screen'
        : pub?.trackName === SB_TRACK_NAME ? 'soundboard' : 'voice'
      this.remoteAudio.add(track, el, kind, participant.identity)
      this.remoteAudio.applyMutes(this.state.deafened, this.settings.soundboardMuted)
      this.remoteAudio.applyVolumes(this.volumeMultipliers())
    } else if (track.kind === Track.Kind.Video && track.source === Track.Source.ScreenShare) {
      this.screenTracks.set(track, { userId: participant.identity, name: participant.name || '' })
      this.syncScreen()
    }
    this.refresh()
  }
  private detach(track: RemoteTrack) {
    track.detach().forEach((el) => el.remove())
    this.remoteAudio.delete(track)
    if (this.screenTracks.delete(track)) this.syncScreen()
    this.refresh()
  }
  private screenKey(track: RemoteTrack): string {
    let id = this.screenIds.get(track)
    if (!id) { id = 's' + (++this.screenIdSeq); this.screenIds.set(track, id) }
    return id
  }
  private syncScreen() {
    const screens: ScreenShare[] = []
    this.screenTracks.forEach((info, track) => screens.push({ id: this.screenKey(track), track, by: info.name || info.userId, userId: info.userId }))
    // активной остаётся та же демонстрация, если она ещё идёт; иначе — первая в списке
    const active = screens.find((s) => s.id === this.activeScreenId) ?? screens[0] ?? null
    this.activeScreenId = active ? active.id : null
    this.set({ screens, screenTrack: active ? active.track : null, screenBy: active ? active.by : null, activeScreenId: this.activeScreenId })
  }
  // переключение между несколькими демонстрациями в канале (UI вызывает по клику на плитку)
  setActiveScreen(id: string) {
    if (!this.screenTracks.size) return
    this.activeScreenId = id
    this.syncScreen()
  }

  private refresh() {
    if (!this.room) return
    const lp = this.room.localParticipant
    const parts: VoiceParticipant[] = [
      // своё «оглушён» знаем напрямую из state (надёжнее, чем читать собственный атрибут)
      { id: lp.identity, name: lp.name || 'Вы', speaking: this.speaking.has(lp.identity), micOn: lp.isMicrophoneEnabled, deafened: this.state.deafened, volume: 1 },
    ]
    this.room.remoteParticipants.forEach((p: RemoteParticipant) =>
      parts.push({ id: p.identity, name: p.name || p.identity, speaking: this.speaking.has(p.identity), micOn: p.isMicrophoneEnabled, deafened: p.attributes?.['deaf'] === '1', volume: this.volumes.get(p.identity) ?? 1 }))
    this.set({ participants: parts })
  }

  // Применение состояния микрофона через очередь: при быстрых повторных нажатиях мьюта раньше
  // накладывались друг на друга await setMicrophoneEnabled → реальное состояние трека рассинхронизировалось
  // с UI («ломался мут»). Теперь операции строго упорядочены, а нет-оп при совпадении состояния пропускается.
  private applyMic(on: boolean): Promise<void> {
    this.micChain = this.micChain.then(async () => {
      if (MOCK || !this.room) return
      const lp = this.room.localParticipant
      if (lp.isMicrophoneEnabled !== on) await lp.setMicrophoneEnabled(on, this.captureOpts()).catch(() => {})
      if (on) await this.refreshMicProcessor()
      this.syncMicGate() // запустить/остановить голосовой гейт под новое состояние микрофона
    })
    return this.micChain
  }

  async toggleMic() {
    const on = !this.state.micOn
    this.set({ micOn: on }) // синхронно: следующее нажатие читает уже новое значение, клики не «склеиваются»
    on ? sfx.micOn() : sfx.micOff()
    await this.applyMic(on)
    this.refresh() // сверяем индикаторы с фактическим состоянием трека после применения очереди
  }
  async toggleDeaf() {
    const d = !this.state.deafened
    let micOn: boolean
    // в PTT микрофон не висит открытым: снятие оглушения НЕ восстанавливает мик (он откроется только
    // на удержание), и сбрасываем зажатие, чтобы un-deafen не оставил микрофон включённым
    if (this.settings.mode === 'ptt') this.pttHeld = false
    if (d) { this.micBeforeDeaf = this.state.micOn; micOn = false }
    else { micOn = this.settings.mode === 'ptt' ? false : this.micBeforeDeaf }
    this.set({ deafened: d, micOn }) // синхронно: UI + собственный deafened, который читает refresh()
    this.applyMutes() // оглушение глушит и голос собеседников, и саундпад, и звук демонстрации
    d ? sfx.deafOn() : sfx.deafOff()
    if (!MOCK && this.room) {
      this.room.localParticipant.setAttributes({ deaf: d ? '1' : '0' }).catch(() => {}) // транслируем остальным
      await this.applyMic(micOn) // оглушение гасит и микрофон — через ту же очередь, что и тумблер мьюта
    }
    this.refresh() // обновить индикаторы своей строки (наушники/микрофон)
  }

  // единая точка мута входящего звука: оглушение глушит всё; саундпад дополнительно — по личной настройке
  private applyMutes() {
    this.remoteAudio.applyMutes(this.state.deafened, this.settings.soundboardMuted)
  }
  setSoundboardMuted(on: boolean) {
    this.settings.soundboardMuted = on
    this.saveSettings()
    this.applyMutes()
  }

  // ---- громкости («что я слышу») ----
  private volumeMultipliers(): RemoteAudioVolumes {
    return {
      master: this.settings.masterVolume,
      soundboard: this.settings.soundboardVolume,
      stream: this.settings.streamVolume,
      user: (userId) => this.volumes.get(userId) ?? 1, // персональная громкость собеседника
    }
  }
  // пересчёт громкости всех управляемых аудио-элементов под текущие настройки (master × категория)
  private applyVolumes() {
    this.remoteAudio.applyVolumes(this.volumeMultipliers())
    soundboard.setVolume(this.settings.masterVolume * this.settings.soundboardVolume) // локальный микшер своих триггеров (может >1)
  }
  getVolumeSettings(): VolumeSettings {
    return { master: this.settings.masterVolume, soundboard: this.settings.soundboardVolume, stream: this.settings.streamVolume, mic: this.settings.micVolume }
  }
  setMasterVolume(v: number) {
    this.settings.masterVolume = clamp01(v); this.saveSettings()
    this.applyVolumes()
  }
  setSoundboardVolume(v: number) {
    this.settings.soundboardVolume = Math.max(0, Math.min(2, v)); this.saveSettings()
    this.applyVolumes()
  }
  setStreamVolume(v: number) {
    this.settings.streamVolume = clamp01(v); this.saveSettings()
    this.applyVolumes()
  }
  async setMicVolume(v: number) {
    this.settings.micVolume = Math.max(0, Math.min(2, v)); this.saveSettings()
    if (this.room && this.state.micOn) await this.refreshMicProcessor() // gain применится на лету (или поднимет процессор)
  }

  async toggleScreen() {
    const on = !this.state.screenOn
    if (MOCK) { on ? sfx.screenOn() : sfx.screenOff(); return this.set({ screenOn: on }) }
    if (!this.room) return
    const room = this.room
    const seq = ++this.screenSeq
    if (!on) {
      try { await room.localParticipant.setScreenShareEnabled(false) } catch { /* */ }
      sfx.screenOff()
      return this.set({ screenOn: false })
    }
    try {
      // ВАЖНО: ждём, пока main выставит shareSystemAudio, ДО getDisplayMedia — иначе обработчик
      // setDisplayMediaRequestHandler прочитает старое значение и не подмешает loopback (баг звука демонстрации)
      await window.chazh?.setShareAudio(this.settings.screenAudio) // системный звук отдаёт main (loopback)
      const { capture, publish } = screenOpts(this.settings)
      await room.localParticipant.setScreenShareEnabled(true, capture, publish)
      // пока выбирали источник, пользователь мог остановить/сменить канал — гасим висящий трек
      if (this.screenSeq !== seq || this.room !== room) {
        try { await room.localParticipant.setScreenShareEnabled(false) } catch { /* */ }
        return
      }
      this.set({ screenOn: true })
      sfx.screenOn()
    } catch { /* пользователь отменил выбор источника */ }
  }

  // перезапуск демонстрации с текущими настройками (смена качества/звука на лету; источник
  // Electron выбирает автоматически, поэтому повторный диалог не всплывает)
  private async restartScreen() {
    if (!this.room || !this.state.screenOn) return
    const room = this.room
    const seq = ++this.screenSeq
    try {
      await room.localParticipant.setScreenShareEnabled(false)
      // если пока перезапускали — остановили демонстрацию / сменили комнату, НЕ возобновляем (приватность)
      if (this.screenSeq !== seq || this.room !== room || !this.state.screenOn) return
      await window.chazh?.setShareAudio(this.settings.screenAudio) // ждём main до getDisplayMedia (loopback не подмешается раньше времени)
      const { capture, publish } = screenOpts(this.settings)
      await room.localParticipant.setScreenShareEnabled(true, capture, publish)
      if (this.screenSeq !== seq || this.room !== room) { // отменили на финальном шаге — гасим трек
        try { await room.localParticipant.setScreenShareEnabled(false) } catch { /* */ }
      }
    } catch { if (this.screenSeq === seq) this.set({ screenOn: false }) }
  }

  getScreenSettings(): { quality: ScreenQuality; audio: boolean } {
    return { quality: this.settings.screenQuality, audio: this.settings.screenAudio }
  }
  async setScreenQuality(q: ScreenQuality) {
    this.settings.screenQuality = q; this.saveSettings()
    await this.restartScreen() // если демонстрация идёт — применяем сразу
  }
  async setScreenAudio(on: boolean) {
    this.settings.screenAudio = on; this.saveSettings()
    await this.restartScreen()
  }

  // ---- настройки ----
  async setInputDevice(id: string) {
    this.settings.inputId = id; this.saveSettings()
    if (this.room) await this.room.switchActiveDevice('audioinput', id || 'default').catch(() => {})
    // LiveKit сам пере-захватит трек и пересоберёт RNNoise, но клон-замер голос-гейта остался на СТАРОМ
    // (уже остановленном) устройстве → при ненулевом пороге новый мик молчал бы. Пересобираем гейт.
    if (this.room && this.state.micOn) { this.gate.stop(false); this.syncMicGate() }
  }

  get micMonitorActive(): boolean { return this.monitor.active }

  // «Проверить микрофон» (слышу себя): отдельный захват → та же обработка, что в звонке (RNNoise по
  // настройке + усиление) → вывод на выбранное устройство. onLevel — живой RMS (0..1 по MIC_RMS_FULL).
  async startMicMonitor(onLevel?: (level: number) => void): Promise<boolean> {
    return this.monitor.start(onLevel)
  }
  stopMicMonitor() { this.monitor.stop() }

  async setOutputDevice(id: string) {
    this.settings.outputId = id; this.saveSettings()
    if (this.room) await this.room.switchActiveDevice('audiooutput', id || 'default').catch(() => {})
    this.remoteAudio.applySink(id || 'default')
  }
  async setProcessing(p: Partial<Pick<VoiceSettings, 'noiseSuppression' | 'noiseSuppressor' | 'echoCancellation' | 'autoGain'>>) {
    Object.assign(this.settings, p); this.saveSettings()
    if (this.room && this.state.micOn) {
      // restartTrack пере-захватывает getUserMedia с новыми constraints. Через mute/unmute это НЕ работало
      // бы: при stopMicTrackOnMute=false трек переиспользуется и новые echoCancellation/AGC игнорируются.
      const track = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined
      if (track) await track.restartTrack(this.captureOpts()).catch(() => {})
      await this.refreshMicProcessor() // вкл./выкл. шумодав вслед за тумблером (gain — сохраняем)
      this.gate.stop(false); this.syncMicGate() // трек пересоздан — пересобираем клон-замер гейта
    }
  }
  async setMode(mode: VoiceMode) {
    this.settings.mode = mode; this.saveSettings()
    this.pttHeld = false // смена режима сбрасывает зажатие: потерянный keyup иначе «залипает»
    if (!this.room) return
    if (mode === 'ptt') { await this.room.localParticipant.setMicrophoneEnabled(false).catch(() => {}); this.set({ micOn: false }) }
    else if (!this.state.deafened) { await this.room.localParticipant.setMicrophoneEnabled(true, this.captureOpts()).catch(() => {}); await this.refreshMicProcessor(); this.set({ micOn: true }) }
    this.syncMicGate() // PTT отключает гейт, голосовая активация — включает (если задан порог)
  }
  setPttKey(code: string) { this.settings.pttKey = code; this.saveSettings() }

  // Мик-цепочка: нейросетевой шумодав RNNoise (давит стук клавиш/мыши) + ручное усиление (gain).
  // RNNoise ПОЛНОСТЬЮ клиентский (Web Audio + WASM), без сервера/лицензии — в отличие от Krisp, которому
  // нужен LiveKit Cloud (на self-host он давал 404). Процессор поднимаем ТОЛЬКО когда он что-то меняет
  // (шумодав вкл ИЛИ громкость ≠ 1) — иначе публикуем сырой трек, как раньше (нулевая регрессия).
  // Изменения применяются на лету (setSuppress / setGain), без перезагрузки WASM.
  private async refreshMicProcessor() {
    if (MOCK || !this.room) return
    const track = this.room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined
    if (!track) return
    const suppress = this.rnnoiseActive() // RNNoise-шумодав активен только при движке 'rnnoise'
    const gain = this.settings.micVolume
    const need = suppress || gain !== 1
    const cur = this.micProcessor && track.getProcessor() === this.micProcessor ? this.micProcessor : null
    if (!need) {
      if (cur) { try { await track.stopProcessor() } catch { /* */ } }
      this.micProcessor = null
      return
    }
    if (cur) { cur.setSuppress(suppress); cur.setGain(gain); return } // живое обновление — без пересоздания
    try {
      const proc = createMicProcessor({ suppress, gain })
      await track.setProcessor(proc)
      this.micProcessor = proc
    } catch { this.micProcessor = null /* RNNoise недоступен → публикуем сырой трек (браузерный NS выключен в captureOpts) */ }
  }

  // ---- голосовой гейт (порог реагирования микрофона) ----
  private micTrackSource(): MediaStreamTrack | undefined {
    return (this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined)?.mediaStreamTrack
  }
  // запустить/остановить гейт под текущее состояние (вызывается из applyMic/setMode/setMicThreshold)
  private syncMicGate() {
    const micOnVoice = !MOCK && !!this.room && this.state.micOn && this.settings.mode === 'voice'
    if (micOnVoice && this.settings.micThreshold > 0) this.gate.start()
    else this.gate.stop(micOnVoice) // микрофон включён, но гейт выкл → вернуть звук; выключен (мьют) → не трогать enabled
  }
  async setMicThreshold(v: number) {
    this.settings.micThreshold = Math.max(0, Math.min(1, v)); this.saveSettings()
    this.syncMicGate() // пересечение 0↔>0 запускает/останавливает гейт; иначе он сам читает новое значение
  }

  // ---- персональная громкость собеседников (на стороне приёмника, у каждого своя) ----
  getParticipantVolume(userId: string): number { return this.volumes.get(userId) ?? 1 }
  setParticipantVolume(userId: string, vol: number) {
    const v = Math.max(0, Math.min(2, vol))
    if (v === 1) this.volumes.delete(userId); else this.volumes.set(userId, v) // 1 = дефолт, не храним
    this.saveVolumes()
    this.applyVolumes() // громкость собеседника = master × персональный множитель
    this.refresh()
  }

  private async onKey(e: KeyboardEvent, down: boolean) {
    if (MOCK || !this.room) return
    if (e.code !== this.settings.pttKey) return
    // отпускание активного зажатия пропускаем ВСЕГДА — даже если режим сменили посреди удержания,
    // иначе потерянный keyup оставит pttHeld=true и микрофон «залипнет»
    if (down) {
      if (this.settings.mode !== 'ptt') return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return // не перехватываем ввод текста
      if (e.repeat) return
    } else if (!this.pttHeld) return // случайный keyup без активного удержания
    e.preventDefault()
    await this.pttApply(down)
  }

  // PTT по кнопке мыши: pttKey вида 'Mouse<button>' (1 — средняя, 2 — правая, 3/4 — боковые)
  private async onMouse(e: MouseEvent, down: boolean) {
    if (MOCK || !this.room) return
    if (this.settings.pttKey !== 'Mouse' + e.button) return
    if (down && this.settings.mode !== 'ptt') return // нажатие ловим только в PTT…
    if (!down && !this.pttHeld) return               // …отпускание — только если что-то зажато
    e.preventDefault() // для боковых кнопок заодно гасим навигацию назад/вперёд
    await this.pttApply(down)
  }

  // общее применение PTT (клавиша/мышь): дребезг гасим pttHeld, микрофон — через ту же очередь, что и мьют
  private async pttApply(down: boolean) {
    if (down === this.pttHeld) return
    this.pttHeld = down
    this.set({ micOn: down })
    await this.applyMic(down)
  }

  // окно потеряло фокус: оконные keyup/mouseup до нас уже не дойдут — принудительно отпускаем
  // активный PTT, иначе при удержании микрофон «залип» бы открытым (или потом не открылся)
  private onBlur() {
    if (!this.pttHeld) return
    this.pttHeld = false
    if (this.settings.mode === 'ptt') { this.set({ micOn: false }); void this.applyMic(false) }
  }

  // ---- устройства (грант доступа и перечисление) ----
  async requestMicPermission(): Promise<boolean> { return askMicPermission() }
  async listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> { return enumerateDevices() }

  private clearReconnect() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  }

  // НЕОЖИДАННЫЙ разрыв: сюда попадаем, только если LiveKit исчерпал собственный авто-реконнект —
  // при leave()/смене канала листенеры снимаются ДО disconnect, поэтому штатный выход сюда не идёт.
  // Чистим комнату и, если канал ещё выбран и причина не терминальная, перезаходим со свежим токеном
  // (с бэкоффом и лимитом подряд-попыток, чтобы не зациклиться при kick/duplicate/room-deleted).
  private onDisconnected(reason?: DisconnectReason) {
    this.gate.stop(false)
    this.room = null
    this.micProcessor = null
    window.chazh?.setMicHotkey(null)
    this.remoteAudio.clear()
    this.screenTracks.clear(); this.activeScreenId = null; this.speaking.clear(); this.pttHeld = false

    const target = this.targetId
    const terminal = reason === DisconnectReason.CLIENT_INITIATED || reason === DisconnectReason.DUPLICATE_IDENTITY
      || reason === DisconnectReason.PARTICIPANT_REMOVED || reason === DisconnectReason.ROOM_DELETED
    if (!MOCK && target && !terminal && this.reconnectAttempts < 3) {
      this.reconnectAttempts++
      const name = this.state.channelName || ''
      this.targetId = null // снимаем guard join(), чтобы перезайти в тот же канал
      this.set({ reconnecting: true, connecting: true, micOn: false, screenOn: false, participants: [], screenTrack: null, screenBy: null, screens: [], activeScreenId: null })
      this.clearReconnect()
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; void this.join(target, name) }, 600 * this.reconnectAttempts)
    } else {
      this.targetId = null
      this.reconnectAttempts = 0
      this.clearReconnect()
      if (reason === DisconnectReason.PARTICIPANT_REMOVED) toast.error('Вас отключили от голосового канала')
      this.set({ ...INITIAL })
    }
  }

  async leave() {
    this.targetId = null
    this.joinSeq++
    this.reconnectAttempts = 0
    this.clearReconnect()
    window.chazh?.setMicHotkey(null)
    await this.teardownRoom()
    this.set({ ...INITIAL })
  }
  private async teardownRoom() {
    this.gate.stop(false)
    this.remoteAudio.clear()
    this.screenTracks.clear()
    this.activeScreenId = null
    this.speaking.clear()
    this.pttHeld = false
    this.micProcessor = null
    const r = this.room
    this.room = null
    if (r) { r.removeAllListeners(); try { await r.disconnect() } catch { /* */ } }
  }
}

export const voice = new Voice()
