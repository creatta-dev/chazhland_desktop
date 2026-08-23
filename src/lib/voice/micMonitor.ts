// Монитор «Проверить микрофон» (слышу себя): отдельный захват → та же обработка, что в звонке
// (RNNoise по настройке + усиление) → вывод на выбранное устройство. Собственный тракт, от комнаты
// LiveKit не зависит — поэтому живёт отдельным модулем.
import { type AudioProcessorOptions } from 'livekit-client'
import { createMicProcessor, MicProcessor } from '../rnnoise'
import { createDeepProcessor, type DeepProcessor } from '../deepfilter'
import { MOCK } from '../config'
import { MIC_RMS_FULL, type VoiceSettings } from './types'

export class MicMonitor {
  private stream: MediaStream | null = null
  private proc: MicProcessor | DeepProcessor | null = null
  private el: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private raf: number | null = null

  // настройки читаем «живьём» на каждом обращении — как раньше, когда монитор жил в классе Voice
  constructor(private settings: () => VoiceSettings) {}

  get active(): boolean { return this.stream != null }

  private rnnoiseActive() { const s = this.settings(); return s.noiseSuppression && s.noiseSuppressor === 'rnnoise' }
  private browserNsActive() { const s = this.settings(); return s.noiseSuppression && s.noiseSuppressor === 'browser' }
  private deepfilterActive() { const s = this.settings(); return s.noiseSuppression && s.noiseSuppressor === 'deepfilter' }

  // onLevel — живой RMS (0..1 по MIC_RMS_FULL). Заодно показывает, давит ли шумодав клавиатуру/мышь.
  // Не зависит от того, в звонке ли мы.
  async start(onLevel?: (level: number) => void): Promise<boolean> {
    this.stop()
    if (MOCK) return false
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: this.settings().inputId ? { exact: this.settings().inputId } : undefined,
          echoCancellation: this.settings().echoCancellation,
          autoGainControl: this.settings().autoGain,
          noiseSuppression: this.browserNsActive(), // как в реальном тракте: браузерный NS только при движке 'browser'
        },
      })
      this.stream = stream
      let out = stream.getAudioTracks()[0]
      if (this.deepfilterActive()) {
        try {
          const proc = await createDeepProcessor() // тяжёлый WASM грузится динамически, только для самопроверки этого движка
          if (proc) {
            await proc.init({ track: out } as unknown as AudioProcessorOptions)
            if (proc.processedTrack) { this.proc = proc; out = proc.processedTrack }
          }
        } catch { /* DeepFilterNet не поднялся — слышим сырой мик */ }
      } else if (this.rnnoiseActive() || this.settings().micVolume !== 1) {
        try {
          const proc = createMicProcessor({ suppress: this.rnnoiseActive(), gain: this.settings().micVolume })
          await proc.init({ track: out } as unknown as AudioProcessorOptions) // init читает только opts.track
          if (proc.processedTrack) { this.proc = proc; out = proc.processedTrack }
        } catch { /* RNNoise не поднялся — слышим сырой мик */ }
      }
      const el = new Audio()
      el.srcObject = new MediaStream([out])
      el.autoplay = true
      const outputId = this.settings().outputId
      if (outputId && 'setSinkId' in el) {
        await (el as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(outputId).catch(() => {})
      }
      await el.play().catch(() => {})
      this.el = el
      if (onLevel) {
        const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (Ctor) {
          const ctx = new Ctor(); if (ctx.state === 'suspended') void ctx.resume()
          const analyser = ctx.createAnalyser(); analyser.fftSize = 512
          ctx.createMediaStreamSource(new MediaStream([out])).connect(analyser)
          const buf = new Float32Array(analyser.fftSize)
          const loop = () => {
            analyser.getFloatTimeDomainData(buf)
            let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
            onLevel(Math.min(1, Math.sqrt(sum / buf.length) / MIC_RMS_FULL))
            this.raf = requestAnimationFrame(loop)
          }
          this.ctx = ctx
          this.raf = requestAnimationFrame(loop)
        }
      }
      return true
    } catch { this.stop(); return false }
  }

  stop() {
    if (this.raf != null) { cancelAnimationFrame(this.raf); this.raf = null }
    if (this.el) { try { this.el.pause() } catch { /* */ } this.el.srcObject = null; this.el = null }
    if (this.proc) { const p = this.proc; this.proc = null; void p.destroy().catch(() => {}) }
    if (this.ctx) { try { void this.ctx.close() } catch { /* */ } this.ctx = null }
    if (this.stream) { this.stream.getTracks().forEach((t) => t.stop()); this.stream = null }
  }
}
