// Типы и общие константы голосового модуля. Лежат отдельно, чтобы подмодули (устройства, мик-монитор,
// голосовой гейт, реестр аудио-элементов) не импортировали фасад src/lib/voice.ts и не было циклов.
import type { RemoteTrack } from 'livekit-client'

export interface VoiceParticipant { id: string; name: string; speaking: boolean; micOn: boolean; deafened: boolean; volume: number }
export interface ScreenShare { id: string; track: RemoteTrack; by: string; userId: string }
export type VoiceMode = 'voice' | 'ptt'

// Качество демонстрации экрана: пресеты LiveKit + «Исходное» (нативное разрешение, высокий битрейт).
export type ScreenQuality = 'source' | 'q1080' | 'q720' | 'q360'

// верхняя граница шкалы уровня микрофона (RMS): громкая речь ≈0.15..0.3. Слайдер порога 0..1 и
// индикатор уровня используют один масштаб, чтобы метка и полоска совпадали визуально.
export const MIC_RMS_FULL = 0.3

/** движок шумоподавления, когда оно включено: RNNoise (клиентский нейросетевой) или встроенный браузерный WebRTC-NS */
export type NoiseSuppressor = 'rnnoise' | 'browser'

export interface VoiceSettings {
  inputId: string   // '' = устройство по умолчанию
  outputId: string  // '' = по умолчанию
  noiseSuppression: boolean          // мастер: шумоподавление вкл/выкл
  noiseSuppressor: NoiseSuppressor   // какой движок использовать, когда шумоподавление включено
  echoCancellation: boolean
  autoGain: boolean
  mode: VoiceMode
  pttKey: string    // KeyboardEvent.code, напр. 'Space'
  micThreshold: number         // 0..1, порог голосовой активации; 0 = гейт выключен
  soundboardMuted: boolean     // приглушить саундпад ОТ ДРУГИХ лично у себя
  screenQuality: ScreenQuality // качество демонстрации экрана
  screenAudio: boolean         // транслировать системный звук при демонстрации
  // громкости (множители, 1 = по умолчанию). master — на ВСЕ входящие; остальные — на свою категорию
  masterVolume: number     // 0..1 — общая громкость всего, что слышу (ПКМ по наушникам)
  soundboardVolume: number // 0..2 — громкость саундпада у меня (ПКМ по саундпаду)
  streamVolume: number     // 0..1 — громкость звука просматриваемой демонстрации
  micVolume: number        // 0..2 — усиление моего микрофона (как «Input Volume»)
}
export interface VoiceState {
  channelId: string | null
  channelName: string | null
  connecting: boolean
  reconnecting: boolean // связь с голосовым сервером потеряна, идёт авто-переподключение
  micOn: boolean
  deafened: boolean
  screenOn: boolean
  participants: VoiceParticipant[]
  screenTrack: RemoteTrack | null   // активная (показываемая) демонстрация
  screenBy: string | null
  screens: ScreenShare[]            // все идущие демонстрации в канале (для переключения)
  activeScreenId: string | null
}
export interface AudioDevice { id: string; label: string }
export interface VolumeSettings { master: number; soundboard: number; stream: number; mic: number }

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
