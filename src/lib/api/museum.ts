import { MOCK } from '../config'
import { http } from '../http'
import type { QuoteKind, QuoteMuseumEntry } from '../types'

// ---- Музей цитат (🏆 Золотая рамка / 🫠 Карточка стыда) ----
export async function quoteMuseum(serverId?: string, kind?: QuoteKind): Promise<QuoteMuseumEntry[]> {
  if (MOCK) return []
  const q = kind ? `?kind=${kind}` : ''
  return http<QuoteMuseumEntry[]>(serverId ? `/servers/${serverId}/quote-museum${q}` : `/server/quote-museum${q}`)
}

export const museumApi = { quoteMuseum }
