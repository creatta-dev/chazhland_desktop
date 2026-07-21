import { MOCK } from '../config'
import { http } from '../http'
import type { ReadState } from '../types'
import { MOCK_READ_STATES } from '@/mocks/data'

// ---- непрочитанное (счётчики каналов, синкаются между устройствами) ----
export function readStates(): Promise<ReadState[]> {
  if (MOCK) return Promise.resolve(MOCK_READ_STATES)
  return http<ReadState[]>('/read-states')
}
export function ackAll(): Promise<ReadState[]> {
  if (MOCK) return Promise.resolve(MOCK_READ_STATES.map((r) => ({ ...r, mentionCount: 0 })))
  return http<ReadState[]>('/read-states/ack-all', { method: 'POST' })
}
export async function markRead(channelId: string, lastReadMessageId: string): Promise<void> {
  if (MOCK) return
  await http(`/channels/${channelId}/read-state`, { method: 'PUT', body: JSON.stringify({ lastReadMessageId }) })
}

export const readStatesApi = { readStates, ackAll, markRead }
