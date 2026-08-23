// Движок «Высокое качество»: DeepFilterNet 3 (пакет denoise-voice-clarity). Нейросетевой шумодав, сильнее
// RNNoise на НЕСТАЦИОНАРНОМ шуме — в т.ч. на кликах мыши/клавиш ПОВЕРХ речи (RNNoise такие транзиенты
// пропускает). Полностью клиентский (AudioWorklet + WASM ~18 МБ), MIT, без сервера/лицензии — как RNNoise,
// но заметно тяжелее по CPU. WASM грузим ДИНАМИЧЕСКИ (import()): тяжёлый чанк не попадает в стартовый бандл,
// а тянется только когда пользователь реально выбрал этот движок. VoiceClarityProcessor — TrackProcessor
// LiveKit (name/init/restart/destroy/processedTrack), поэтому вставляется через track.setProcessor(), как
// MicProcessor. compileStreaming над file:// в Electron 33 работает — проверено, кастомная схема не нужна.
import type { Track, AudioProcessorOptions, TrackProcessor } from 'livekit-client'

export type DeepProcessor = TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> & {
  processedTrack?: MediaStreamTrack
  destroy(): Promise<void>
}

// Создаёт DeepFilterNet-процессор. null = движок не поддержан (нет AudioWorklet/streaming-WASM) или пакет
// не загрузился → вызывающий откатывается на RNNoise, чтобы шумодав всё же остался.
export async function createDeepProcessor(): Promise<DeepProcessor | null> {
  try {
    const mod = await import('denoise-voice-clarity')
    if (!mod.isVoiceClaritySupported()) return null
    // enabled: движок сразу активен; остальное — дефолты пакета (attenuationLimitDb 30, presenceGainDb 4).
    return new mod.VoiceClarityProcessor({ enabled: true }) as unknown as DeepProcessor
  } catch { return null }
}
