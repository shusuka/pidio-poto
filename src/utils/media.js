// ─── Utilitas video di browser: durasi, frame, deteksi adegan, format waktu ──

// Buka video dari File dan tunggu metadata-nya. Pemanggil wajib memanggil close().
export async function openVideo(file, { preload = 'auto' } = {}) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = preload
  video.src = url
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve
    video.onerror = () => reject(new Error('Video tidak bisa dibaca browser'))
  })
  return { video, close: () => { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) } }
}

// Rekaman layar / MediaRecorder (webm) sering tidak menyimpan durasi
// (duration = Infinity/0). Trik standar: seek jauh ke depan agar browser
// menghitung durasi sebenarnya.
export async function resolveDuration(video) {
  if (isFinite(video.duration) && video.duration > 0.1) return video.duration
  await new Promise(resolve => {
    const done = () => { clearTimeout(timer); video.ondurationchange = video.onseeked = null; resolve() }
    const timer = setTimeout(done, 4000)
    video.ondurationchange = () => { if (isFinite(video.duration) && video.duration > 0.1) done() }
    video.onseeked = done
    video.currentTime = 1e9
  })
  const d = isFinite(video.duration) && video.duration > 0.1 ? video.duration : 0
  video.currentTime = 0
  return d
}

export function seekTo(video, t) {
  return new Promise(resolve => {
    if (Math.abs(video.currentTime - t) < 0.001 && video.readyState >= 2) return resolve()
    const timer = setTimeout(resolve, 3000)
    video.onseeked = () => { clearTimeout(timer); video.onseeked = null; resolve() }
    video.currentTime = t
  })
}

// Titik waktu merata di dalam rentang-rentang [{start,end}] — kira-kira satu
// frame per `every` detik, minimal satu per rentang, total dibatasi `max`.
export function sampleTimes(ranges, { every = 2, max = 40 } = {}) {
  const total = ranges.reduce((s, r) => s + (r.end - r.start), 0)
  if (!total) return [0]
  const budget = Math.max(ranges.length, Math.min(max, Math.round(total / every)))
  const times = []
  for (const r of ranges) {
    const len = r.end - r.start
    const n = Math.max(1, Math.round((len / total) * budget))
    for (let i = 0; i < n; i++) times.push(r.start + (len * (i + 0.5)) / n)
  }
  return times.slice(0, Math.max(max, ranges.length))
}

// Ambil frame → base64 JPEG. Tanpa `times`: merata di seluruh video.
export async function extractVideoFrames(file, { times, count, maxSide = 768, quality = 0.8 } = {}) {
  const { video, close } = await openVideo(file)
  try {
    const dur = await resolveDuration(video)
    let points = times
    if (!points) {
      if (!dur) points = [0]
      else {
        const n = count || Math.min(20, Math.max(6, Math.round(dur / 2)))
        points = Array.from({ length: n }, (_, i) => (dur * (i + 0.5)) / n)
      }
    }
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    const frames = []
    for (const p of points) {
      const t = dur ? Math.min(Math.max(0, p), dur - 0.05) : 0
      if (dur) await seekTo(video, t)
      else if (video.readyState < 2) await new Promise(r => { video.onloadeddata = r })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ time: t, data: canvas.toDataURL('image/jpeg', quality).split(',')[1] })
      if (!dur) break
    }
    return frames
  } finally {
    close()
  }
}

// ─── Deteksi adegan ─────────────────────────────────────────────────────────
// Bandingkan frame kecil berurutan (histogram warna + selisih piksel). Lonjakan
// besar = pergantian adegan. Adegan panjang dipecah ≤ maxLen detik supaya
// analisis per 2 detik tetap rinci.
export const SENSITIVITY = { low: 0.5, medium: 0.36, high: 0.24 }

export function chunkScenes(duration, maxLen = 10) {
  const n = Math.max(1, Math.ceil((duration || maxLen) / maxLen))
  const len = (duration || maxLen) / n
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`, start: round2(i * len), end: round2(Math.min(duration || maxLen, (i + 1) * len)), thumb: null,
  }))
}

export async function detectScenes(file, { threshold = SENSITIVITY.medium, maxLen = 10, minLen = 1, onProgress, isCancelled } = {}) {
  const { video, close } = await openVideo(file)
  try {
    const dur = await resolveDuration(video)
    if (!dur) return chunkScenes(0, maxLen)
    const step = Math.max(0.5, dur / 300)
    const W = 48, H = 27
    const small = document.createElement('canvas')
    small.width = W; small.height = H
    const sctx = small.getContext('2d', { willReadFrequently: true })
    let prev = null, prevHist = null
    const cuts = [0]
    const total = Math.floor(dur / step)
    for (let i = 0; i <= total; i++) {
      if (isCancelled?.()) return null
      const t = Math.min(dur - 0.05, i * step)
      await seekTo(video, t)
      sctx.drawImage(video, 0, 0, W, H)
      const px = sctx.getImageData(0, 0, W, H).data
      const hist = new Float32Array(24)
      for (let p = 0; p < px.length; p += 4) {
        hist[px[p] >> 5]++
        hist[8 + (px[p + 1] >> 5)]++
        hist[16 + (px[p + 2] >> 5)]++
      }
      const count = px.length / 4
      if (prev) {
        let hd = 0
        for (let b = 0; b < 24; b++) hd += Math.abs(hist[b] - prevHist[b])
        hd /= count * 6 // 0..1
        let pd = 0
        for (let p = 0; p < px.length; p += 4) {
          pd += Math.abs(px[p] - prev[p]) + Math.abs(px[p + 1] - prev[p + 1]) + Math.abs(px[p + 2] - prev[p + 2])
        }
        pd /= count * 3 * 255 // 0..1
        const score = 0.5 * hd + 0.5 * Math.min(1, pd * 2)
        if (score > threshold && t - cuts[cuts.length - 1] >= minLen) cuts.push(round2(t))
      }
      prev = px
      prevHist = hist
      onProgress?.(i / total)
    }

    const scenes = []
    cuts.forEach((start, i) => {
      const end = i + 1 < cuts.length ? cuts[i + 1] : round2(dur)
      const pieces = Math.max(1, Math.ceil((end - start) / maxLen - 0.001))
      const len = (end - start) / pieces
      for (let k = 0; k < pieces; k++) {
        scenes.push({
          id: `s${scenes.length + 1}`,
          start: round2(start + k * len),
          end: round2(k === pieces - 1 ? end : start + (k + 1) * len),
          cut: k === 0, // true = awal adegan baru, false = potongan dari adegan panjang
          thumb: null,
        })
      }
    })

    // Thumbnail sedikit setelah awal tiap adegan
    const thumb = document.createElement('canvas')
    thumb.width = 160
    thumb.height = Math.round((160 * video.videoHeight) / video.videoWidth) || 90
    const tctx = thumb.getContext('2d')
    for (const s of scenes) {
      if (isCancelled?.()) return null
      await seekTo(video, Math.min(s.end - 0.05, s.start + Math.min(0.3, (s.end - s.start) / 2)))
      tctx.drawImage(video, 0, 0, thumb.width, thumb.height)
      s.thumb = thumb.toDataURL('image/jpeg', 0.7)
    }
    return scenes
  } finally {
    close()
  }
}

// ─── Format waktu ───────────────────────────────────────────────────────────
const round2 = n => Math.round(n * 100) / 100

// 75.4 → "01:15.4"
export function fmtTime(sec, decimals = 1) {
  if (!isFinite(sec)) return '--:--'
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  const r = rest.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0')
  return `${String(m).padStart(2, '0')}:${r}`
}

// Terima 12.5, "12.5", "00:12.5", "0:12", "01:02:03.4" → detik
export function parseTime(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN
  if (typeof v !== 'string') return NaN
  const parts = v.trim().replace(',', '.').replace(/s$/, '').split(':').map(Number)
  if (parts.some(isNaN)) return NaN
  return parts.reduce((acc, p) => acc * 60 + p, 0)
}

// 75.4 → "00:01:15,400" (SRT) / "00:01:15.400" (VTT)
export function fmtStamp(sec, sep = ',') {
  const ms = Math.round(Math.max(0, sec) * 1000)
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const pad = (n, l = 2) => String(n).padStart(l, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
