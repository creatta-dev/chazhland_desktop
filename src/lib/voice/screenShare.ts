// Качество демонстрации экрана: пресеты и опции захвата/публикации. Чистая функция от настроек —
// сам запуск/остановка демонстрации остаётся в voice.ts (там комната и гонки in-flight операций).
import { ScreenSharePresets, type ScreenShareCaptureOptions, type TrackPublishOptions, type VideoPreset } from 'livekit-client'
import type { ScreenQuality, VoiceSettings } from './types'

const SCREEN_PRESETS: Record<ScreenQuality, VideoPreset> = {
  source: ScreenSharePresets.original,
  q1080: ScreenSharePresets.h1080fps30,
  q720: ScreenSharePresets.h720fps30,
  q360: ScreenSharePresets.h360fps15,
}
export const SCREEN_QUALITY_LABELS: Record<ScreenQuality, string> = {
  source: 'Исходное', q1080: '1080p · 30', q720: '720p · 30', q360: 'Экономно · 360p',
}
export const SCREEN_QUALITY_ORDER: ScreenQuality[] = ['source', 'q1080', 'q720', 'q360']

// опции захвата/публикации демонстрации по текущему качеству; для «Исходного» разрешение не
// ограничиваем (нативное), для остальных — берём из пресета LiveKit
export function screenOpts(settings: Pick<VoiceSettings, 'screenQuality' | 'screenAudio'>): { capture: ScreenShareCaptureOptions; publish: TrackPublishOptions } {
  const preset = SCREEN_PRESETS[settings.screenQuality]
  // системный звук отдаётся через loopback только на Windows (см. main.ts); на macOS getDisplayMedia
  // его не возвращает — не запрашиваем, иначе constraints просят то, что не будет доставлено
  const audio = settings.screenAudio && window.chazh?.platform === 'win32'
  const capture: ScreenShareCaptureOptions = {
    audio,
    contentHint: 'detail',
    ...(settings.screenQuality === 'source' ? {} : { resolution: preset.resolution }),
  }
  return { capture, publish: { videoEncoding: preset.encoding } }
}
