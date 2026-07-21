/**
 * Форматтеры дат, чисел и размеров — единственное место, где зашита локаль.
 * Раньше эти же функции лежали копиями в 9 компонентах (три пары совпадали дословно),
 * и 'ru-RU' повторялась около десяти раз.
 *
 * Общее соглашение по датам: невалидная строка возвращается как есть (лучше показать сырой ISO,
 * чем «Invalid Date»), пустое/отсутствующее значение — пустая строка.
 */

/** Локаль всего интерфейса. Приложение русскоязычное, системную локаль намеренно не учитываем. */
export const LOCALE = 'ru-RU'

/** Дата из ISO или null, если строка не парсится. */
function parse(iso?: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return isNaN(d.getTime()) ? null : d
}

/** Время сообщения: «14:37». */
export function formatTime(iso: string): string {
  const d = parse(iso)
  return d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : iso
}

/** Дата + время одной строкой: «7 июл., 14:37» (аудит, поиск, пины, список приглашений). */
export function formatDateTime(iso: string): string {
  const d = parse(iso)
  return d ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : iso
}

/** Время + дата: «14:37, 7 июл.» — порядок ленты аудита (сначала когда, потом какого числа). */
export function formatTimeThenDate(iso: string): string {
  const d = parse(iso)
  return d ? d.toLocaleString(LOCALE, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : iso
}

/** Компактная дата: «07.07.26» (музей цитат, ачивки). Пустой вход → пустая строка. */
export function formatShortDate(iso?: string | null): string {
  if (!iso) return ''
  const d = parse(iso)
  return d ? d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: '2-digit' }) : iso
}

/** День и месяц: «07.07». shiftDays сдвигает дату (границы периода дайджеста — end включительно). */
export function formatDayMonth(iso: string, shiftDays = 0): string {
  const d = parse(iso)
  if (!d) return iso
  if (shiftDays) d.setDate(d.getDate() + shiftDays)
  return d.toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit' })
}

/** Ключ календарного дня для группировки ленты (не для показа). */
export function dayKey(iso: string): string {
  const d = parse(iso)
  return d ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}` : iso
}

/** Разделитель дня в ленте: «Сегодня» / «Вчера» / «7 июля» (год — только если не текущий). */
export function formatDayDivider(iso: string): string {
  const d = parse(iso)
  if (!d) return ''
  const now = new Date()
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  if (same(d, now)) return 'Сегодня'
  const y = new Date(now); y.setDate(now.getDate() - 1)
  if (same(d, y)) return 'Вчера'
  return d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
}

/** Сколько времени прошло с момента: «2ч 15м» / «7м» / «<1м». null, если момента нет. */
export function formatElapsed(since?: string | null): string | null {
  const d = parse(since)
  if (!d) return null
  const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}ч ${m}м`
  if (m > 0) return `${m}м`
  return '<1м'
}

/** Число с разделителями разрядов: «12 345». */
export function formatNumber(n: number): string {
  return n.toLocaleString(LOCALE)
}

/**
 * Размер вложения сообщения: Б / КБ / МБ, пусто при 0 и отсутствии (вызывающий подставляет MIME-тип).
 * Отдельно от formatWatchSize: у вложений другой диапазон и другой фолбэк.
 */
export function formatAttachmentSize(n?: number | null): string {
  if (!n) return ''
  if (n < 1024) return `${n} Б`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} КБ`
  return `${(n / 1024 / 1024).toFixed(1)} МБ`
}

/**
 * Размер раздачи/файла в «Смотреть вместе»: МБ / ГБ, «—» при неизвестном размере.
 * Отдельно от formatAttachmentSize: тут всё крупное и прочерк вместо пустоты в колонке результатов.
 */
export function formatWatchSize(n: number): string {
  if (!n) return '—'
  const gb = n / 1073741824
  return gb >= 1 ? `${gb.toFixed(2)} ГБ` : `${(n / 1048576).toFixed(0)} МБ`
}
