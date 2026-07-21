import { MOCK } from '../config'
import { http } from '../http'
import type { AchievementShowcaseItem, MyAchievements } from '../types'

// ---- Секретные ачивки ----
export async function myAchievements(): Promise<MyAchievements> {
  if (MOCK) return { unlocked: [], locked: [], lockedSecretCount: 0, showAll: true, total: 0, unlockedCount: 0 }
  return http<MyAchievements>('/me/achievements')
}
export async function userAchievements(userId: string): Promise<AchievementShowcaseItem[]> {
  if (MOCK) return []
  return http<AchievementShowcaseItem[]>(`/users/${userId}/achievements/showcase`)
}
export async function pinAchievement(achievementId: string, pinned: boolean): Promise<void> {
  if (MOCK) return
  await http(`/me/achievements/${achievementId}/pin?pinned=${pinned}`, { method: 'POST' })
}
export async function setAchievementShowcaseMode(showAll: boolean): Promise<void> {
  if (MOCK) return
  await http(`/me/achievements/showcase-mode?showAll=${showAll}`, { method: 'PUT' })
}

export const achievementsApi = { myAchievements, userAchievements, pinAchievement, setAchievementShowcaseMode }
