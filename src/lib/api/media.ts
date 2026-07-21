import { MOCK } from '../config'
import { http, delay } from '../http'
import type { AttachmentInput } from '../types'

// размеры картинки (подсказка вёрстке) — читаем до загрузки
function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve({ w: img.naturalWidth, h: img.naturalHeight }) }
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e) }
    img.src = url
  })
}

// presign + прямой PUT в MinIO; возвращает ссылку для отправки сообщения
export async function presign(filename: string, contentType: string, size: number): Promise<{ uploadUrl: string; objectKey: string }> {
  return http('/attachments/presign', { method: 'POST', body: JSON.stringify({ filename, contentType, size }) })
}
export async function uploadFile(file: File): Promise<AttachmentInput> {
  let width: number | undefined, height: number | undefined
  if (file.type.startsWith('image/')) {
    try { const d = await imageSize(file); width = d.w; height = d.h } catch { /* не картинка/битый файл — без размеров */ }
  }
  if (MOCK) { await delay(400); return { objectKey: 'mock/' + file.name, filename: file.name, width, height } }
  const ct = file.type || 'application/octet-stream'
  const { uploadUrl, objectKey } = await presign(file.name, ct, file.size)
  const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': ct } }) // прямой аплоад, без api-обёртки
  if (!put.ok) throw new Error(`upload ${put.status}`)
  return { objectKey, filename: file.name, width, height }
}

export const mediaApi = { presign, uploadFile }
