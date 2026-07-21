// Голосовой гейт (порог реагирования микрофона): замеряем уровень с КЛОНА публикуемого трека, а сам
// трек глушим/открываем через mediaStreamTrack.enabled (дёшево, без пере-согласования).
// Решение «нужен ли гейт сейчас» принимает voice.ts (там комната, режим и состояние микрофона) —
// здесь только сам замер и его жизненный цикл.
import { MIC_RMS_FULL } from './types'

export interface MicGateDeps {
  /** публикуемый трек микрофона (может пропасть при пере-захвате — тогда цикл замера останавливается) */
  track: () => MediaStreamTrack | undefined
  /** порог 0..1, читается на каждом кадре — смена слайдера применяется на лету */
  threshold: () => number
}

export class MicGate {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private measure: MediaStreamTrack | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  private raf: number | null = null
  private holdUntil = 0

  constructor(private deps: MicGateDeps) {}

  start() {
    if (this.raf != null) return // уже работает
    const src = this.deps.track()
    if (!src) return
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      const ctx = new Ctor()
      if (ctx.state === 'suspended') void ctx.resume() // не на user-gesture-стеке (setMode/reconnect) → иначе замер читает нули
      const measure = src.clone() // отдельный трек для замера: гашение публикуемого трека его не глушит
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      ctx.createMediaStreamSource(new MediaStream([measure])).connect(analyser)
      this.ctx = ctx; this.analyser = analyser; this.measure = measure
      this.buf = new Float32Array(analyser.fftSize)
      const HOLD = 250 // мс «дотянуть» после спада уровня — чтобы хвосты слов не обрезались
      const loop = () => {
        const a = this.analyser, buf = this.buf, t = this.deps.track()
        if (!a || !buf || !t) { this.raf = null; return }
        a.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)
        const now = performance.now()
        if (rms >= this.deps.threshold() * MIC_RMS_FULL) this.holdUntil = now + HOLD
        const open = now < this.holdUntil
        if (t.enabled !== open) t.enabled = open
        this.raf = requestAnimationFrame(loop)
      }
      this.raf = requestAnimationFrame(loop)
    } catch { this.stop(true) }
  }

  stop(reopen: boolean) {
    if (this.raf != null) { cancelAnimationFrame(this.raf); this.raf = null }
    if (this.measure) { try { this.measure.stop() } catch { /* */ } this.measure = null }
    if (this.ctx) { try { void this.ctx.close() } catch { /* */ } this.ctx = null }
    this.analyser = null; this.buf = null
    if (reopen) { const t = this.deps.track(); if (t && !t.enabled) t.enabled = true } // вернуть звук, если гейт его приглушил
  }
}
