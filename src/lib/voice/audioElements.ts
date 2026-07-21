// Единый реестр входящих аудио-элементов (раньше их было три параллельных: голос / саундпад / звук
// демонстрации). Все три хранили одно и то же — <audio> на удалённый трек, — различались лишь
// правилом громкости и мута, поэтому категория стала полем записи, а правила — местом здесь.
import type { RemoteTrack } from 'livekit-client'
import { clamp01 } from './types'

/** категория входящего звука: голос собеседника / саундпад / звук чужой демонстрации */
export type RemoteAudioKind = 'voice' | 'soundboard' | 'screen'
interface Entry { el: HTMLAudioElement; kind: RemoteAudioKind; userId: string }

/** множители громкости: master — на всё входящее, остальные — на свою категорию */
export interface RemoteAudioVolumes {
  master: number
  soundboard: number
  stream: number
  user: (userId: string) => number // персональная громкость собеседника
}

export class RemoteAudioRegistry {
  private els = new Map<RemoteTrack, Entry>()

  add(track: RemoteTrack, el: HTMLAudioElement, kind: RemoteAudioKind, userId: string) {
    this.els.set(track, { el, kind, userId })
  }
  delete(track: RemoteTrack) { this.els.delete(track) }

  // оглушение глушит всё; саундпад дополнительно — по личной настройке
  applyMutes(deafened: boolean, soundboardMuted: boolean) {
    this.els.forEach(({ el, kind }) => { el.muted = deafened || (kind === 'soundboard' && soundboardMuted) })
  }

  // громкость = master × множитель категории (для голоса — персональный множитель собеседника)
  applyVolumes(v: RemoteAudioVolumes) {
    this.els.forEach(({ el, kind, userId }) => {
      const k = kind === 'soundboard' ? v.soundboard : kind === 'screen' ? v.stream : v.user(userId)
      el.volume = clamp01(v.master * k)
    })
  }

  // перевод всех элементов на выбранное устройство вывода
  applySink(id: string) {
    this.els.forEach(({ el }) => { if ('setSinkId' in el) (el as any).setSinkId(id).catch(() => {}) })
  }

  // выход из канала/разрыв: убираем элементы из DOM и забываем их
  clear() {
    this.els.forEach(({ el }) => el.remove())
    this.els.clear()
  }
}
