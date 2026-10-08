// Ambil video dari link medsos lewat /api/fetch-video lalu jadikan File biasa
// (sehingga deteksi adegan, frame, dan editor tetap jalan seperti upload lokal).

export const LINK_PLATFORMS = {
  tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', x: 'X / Twitter', youtube: 'YouTube',
}

const PATTERNS = [
  ['tiktok', /(^|\.)(tiktok|douyin)\.com$/],
  ['x', /(^|\.)(x|twitter|fxtwitter|vxtwitter|fixupx)\.com$/],
  ['instagram', /(^|\.)instagram\.com$/],
  ['facebook', /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/],
  ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
]

export function detectLinkPlatform(text) {
  let u
  try { u = new URL(String(text).trim()) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  return PATTERNS.find(([, re]) => re.test(u.hostname.toLowerCase()))?.[0] || null
}

// Ambil URL pertama dari teks tempelan (misal "Lihat video ini https://vt.tiktok.com/xxx/ #fyp")
export function extractUrl(text) {
  return String(text || '').match(/https?:\/\/[^\s<>"']+/)?.[0] || null
}

export async function fetchVideoFromLink(url, { onProgress, signal } = {}) {
  const res = await fetch(`/api/fetch-video?url=${encodeURIComponent(url)}`, { signal })
  if (!res.ok) {
    let msg = `Gagal mengambil video (HTTP ${res.status})`
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  const total = Number(res.headers.get('content-length')) || 0
  const type = res.headers.get('content-type') || 'video/mp4'
  const platform = res.headers.get('x-video-platform') || 'video'
  const title = decodeURIComponent(res.headers.get('x-video-title') || '')

  const reader = res.body.getReader()
  const chunks = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.length
    onProgress?.({ received, total })
  }
  if (!received) throw new Error('Video kosong. Coba link lain.')

  const ext = type.includes('webm') ? 'webm' : type.includes('quicktime') ? 'mov' : 'mp4'
  const base = (title || platform).replace(/[\\/:*?"<>|#\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || platform
  return new File(chunks, `${base}.${ext}`, { type: type.startsWith('video/') ? type : 'video/mp4' })
}
