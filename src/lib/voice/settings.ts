// Персистентность голосовых настроек и персональных громкостей собеседников (localStorage).
import type { VoiceSettings } from './types'

const LS = 'chazh.voice'
const LS_VOL = 'chazh.voice.vol' // персональная громкость собеседников: identity -> множитель (0..2)

export const DEFAULTS: VoiceSettings = { inputId: '', outputId: '', noiseSuppression: true, noiseSuppressor: 'rnnoise', echoCancellation: true, autoGain: true, mode: 'voice', pttKey: 'Space', micThreshold: 0, soundboardMuted: false, screenQuality: 'q720', screenAudio: false, masterVolume: 1, soundboardVolume: 1, streamVolume: 1, micVolume: 1 }

export function loadSettings(): VoiceSettings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(LS) || '{}') } } catch { return { ...DEFAULTS } }
}
export function saveSettings(s: VoiceSettings) { localStorage.setItem(LS, JSON.stringify(s)) }

export function loadVolumes(): Map<string, number> {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(LS_VOL) || '{}')) as [string, number][]) } catch { return new Map() }
}
export function saveVolumes(v: Map<string, number>) { localStorage.setItem(LS_VOL, JSON.stringify(Object.fromEntries(v))) }
