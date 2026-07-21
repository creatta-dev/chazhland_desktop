// Перечисление аудиоустройств и грант доступа к микрофону — ни от комнаты, ни от настроек не зависят.
import { MOCK } from '../config'
import type { AudioDevice } from './types'

// Разблокировка меток устройств: enumerateDevices даёт пустые label без granted-доступа к
// микрофону. Берём временный аудио-поток и сразу глушим — нужен только грант, не сам звук.
export async function requestMicPermission(): Promise<boolean> {
  if (MOCK || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((t) => t.stop())
    return true
  } catch { return false }
}

export async function listDevices(): Promise<{ inputs: AudioDevice[]; outputs: AudioDevice[] }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) return { inputs: [], outputs: [] }
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    return {
      inputs: devs.filter((d) => d.kind === 'audioinput').map((d) => ({ id: d.deviceId, label: d.label || 'Микрофон' })),
      outputs: devs.filter((d) => d.kind === 'audiooutput').map((d) => ({ id: d.deviceId, label: d.label || 'Устройство вывода' })),
    }
  } catch { return { inputs: [], outputs: [] } }
}
