// ─── Model timeline + pemutar/perekam berbasis canvas ───────────────────────
// Klip = potongan dari sebuah sumber video: { id, src, in, out } (detik sumber).
// Posisi di timeline dihitung dari urutan klip, jadi tidak ada celah/tumpang tindih.
import { seekTo } from './media'

let seq = 0
export const uid = (p = 'c') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`
const r2 = n => Math.round(n * 100) / 100

export const clipDur = c => Math.max(0, c.out - c.in)
export const totalDuration = clips => clips.reduce((s, c) => s + clipDur(c), 0)

export function clipStarts(clips) {
  const starts = []
  let acc = 0
  for (const c of clips) { starts.push(acc); acc += clipDur(c) }
  return starts
}

export function locate(clips, t) {
  if (!clips.length) return null
  const starts = clipStarts(clips)
  for (let i = 0; i < clips.length; i++) {
    if (t < starts[i] + clipDur(clips[i]) || i === clips.length - 1) {
      const offset = Math.min(clips[i].out, clips[i].in + Math.max(0, t - starts[i]))
      return { index: i, clip: clips[i], start: starts[i], offset }
    }
  }
  return null
}

export function splitAt(clips, t) {
  const loc = locate(clips, t)
  if (!loc) return { clips, id: null }
  const { index, clip, offset } = loc
  if (offset - clip.in < 0.1 || clip.out - offset < 0.1) return { clips, id: null }
  const right = { ...clip, id: uid(), in: r2(offset) }
  const next = [...clips]
  next.splice(index, 1, { ...clip, out: r2(offset) }, right)
  return { clips: next, id: right.id }
}

// Pertahankan hanya bagian klip (dari sumber `src`) yang berada di dalam `ranges`
export function keepRanges(clips, ranges, src = 'main') {
  const out = []
  for (const c of clips) {
    if (c.src !== src) { out.push(c); continue }
    for (const r of ranges) {
      const a = Math.max(c.in, r.start), b = Math.min(c.out, r.end)
      if (b - a >= 0.15) out.push({ ...c, id: uid(), in: r2(a), out: r2(b) })
    }
  }
  return out
}

// Segmen transkrip (waktu sumber) → cue subtitle (waktu timeline)
export function subtitleCues(clips, segments = [], src = 'main') {
  const cues = []
  const starts = clipStarts(clips)
  clips.forEach((c, i) => {
    if (c.src !== src) return
    for (const s of segments) {
      const a = Math.max(c.in, s.start), b = Math.min(c.out, s.end)
      if (b - a > 0.05 && s.text.trim()) cues.push({ start: starts[i] + a - c.in, end: starts[i] + b - c.in, text: s.text })
    }
  })
  return cues
}

// ─── Gambar satu frame ──────────────────────────────────────────────────────
const SIZE = { S: 0.042, M: 0.058, L: 0.08 }

function wrap(ctx, text, maxW) {
  const lines = []
  for (const para of String(text).split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word } else line = test
    }
    lines.push(line)
  }
  return lines
}

function drawCaption(ctx, W, H, text, { pos = 'bottom', size = 'M', box = false }) {
  const fs = Math.round(Math.min(W, H) * (SIZE[size] || SIZE.M) * (W > H ? 1.1 : 1))
  ctx.font = `700 ${fs}px Inter, "Segoe UI", Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, text, W * 0.86)
  const lh = fs * 1.25
  const blockH = lines.length * lh
  const cy = pos === 'top' ? H * 0.12 + blockH / 2 : pos === 'center' ? H / 2 : H * 0.86 - blockH / 2
  lines.forEach((ln, i) => {
    const y = cy - blockH / 2 + lh * (i + 0.5)
    if (box) {
      const w = ctx.measureText(ln).width + fs * 0.6
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(W / 2 - w / 2, y - lh / 2, w, lh)
    } else {
      ctx.lineWidth = Math.max(2, fs * 0.14)
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'
      ctx.lineJoin = 'round'
      ctx.strokeText(ln, W / 2, y)
    }
    ctx.fillStyle = '#fff'
    ctx.fillText(ln, W / 2, y)
  })
}

export function drawFrame(ctx, { W, H, video, fit = 'contain', texts = [], cues = [], t = 0, subtitleSize = 'M' }) {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (video && video.readyState >= 2 && video.videoWidth) {
    const vw = video.videoWidth, vh = video.videoHeight
    const s = fit === 'cover' ? Math.max(W / vw, H / vh) : Math.min(W / vw, H / vh)
    const dw = vw * s, dh = vh * s
    ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh)
  }
  for (const tx of texts) {
    if (t >= tx.start && t < tx.start + tx.dur && tx.text.trim()) drawCaption(ctx, W, H, tx.text, { pos: tx.pos, size: tx.size })
  }
  const cue = cues.find(c => t >= c.start && t < c.end)
  if (cue) drawCaption(ctx, W, H, cue.text, { pos: 'bottom', size: subtitleSize, box: true })
}

// ─── Pemutar ────────────────────────────────────────────────────────────────
export class TimelinePlayer {
  constructor(canvas, { onTime, onState, onError } = {}) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.onTime = onTime
    this.onState = onState
    this.onError = onError
    this.videos = new Map() // src id → { el, url, node }
    this.t = 0
    this.playing = false
    this.p = { clips: [], texts: [], cues: [], sources: {}, fit: 'contain', videoVolume: 1, musicVolume: 0.5 }
  }

  setProject(p) {
    this.p = { ...this.p, ...p }
    const { W, H } = p
    if (W && (this.canvas.width !== W || this.canvas.height !== H)) { this.canvas.width = W; this.canvas.height = H }
    // lepas video untuk sumber yang sudah dihapus / berganti file
    for (const [id, v] of this.videos) {
      if (this.p.sources[id]?.url !== v.url) { v.el.pause(); v.el.removeAttribute('src'); v.node?.disconnect(); this.videos.delete(id) }
    }
    if (this.musicUrl !== this.p.music?.url) {
      this.musicEl?.pause()
      this.musicNode?.disconnect()
      this.musicEl = null; this.musicNode = null
      this.musicUrl = this.p.music?.url
    }
    if (this.videoGain) this.videoGain.gain.value = this.p.videoVolume
    if (this.musicGain) this.musicGain.gain.value = this.p.musicVolume
    this.duration = totalDuration(this.p.clips)
    if (this.t > this.duration) this.t = this.duration
    if (!this.playing) this.seek(this.t)
  }

  video(src) {
    let v = this.videos.get(src)
    if (!v) {
      const el = document.createElement('video')
      el.playsInline = true
      el.preload = 'auto'
      el.src = this.p.sources[src]?.url || ''
      v = { el, url: this.p.sources[src]?.url }
      this.videos.set(src, v)
      if (this.audio) this.connect(v)
    }
    return v.el
  }

  music() {
    if (!this.p.music?.url) return null
    if (!this.musicEl) {
      this.musicEl = new Audio(this.p.music.url)
      if (this.audio) this.connectMusic()
    }
    return this.musicEl
  }

  // WebAudio dibuat saat interaksi pertama; semua suara lewat sini supaya
  // volume bisa diatur dan bisa ikut direkam saat ekspor.
  ensureAudio() {
    if (this.audio) { if (this.audio.state === 'suspended') this.audio.resume(); return }
    const AC = window.AudioContext || window.webkitAudioContext
    this.audio = new AC()
    this.recordDest = this.audio.createMediaStreamDestination()
    this.videoGain = this.audio.createGain()
    this.musicGain = this.audio.createGain()
    this.videoGain.gain.value = this.p.videoVolume
    this.musicGain.gain.value = this.p.musicVolume
    for (const g of [this.videoGain, this.musicGain]) { g.connect(this.audio.destination); g.connect(this.recordDest) }
    for (const v of this.videos.values()) this.connect(v)
    if (this.musicEl) this.connectMusic()
  }
  connect(v) {
    if (v.node) return
    v.node = this.audio.createMediaElementSource(v.el)
    v.node.connect(this.videoGain)
  }
  connectMusic() {
    if (this.musicNode) return
    this.musicNode = this.audio.createMediaElementSource(this.musicEl)
    this.musicNode.connect(this.musicGain)
  }

  draw(video) {
    const W = this.p.W || this.canvas.width, H = this.p.H || this.canvas.height
    const target = this.recCtx || this.ctx
    drawFrame(target, { W, H, video, fit: this.p.fit, texts: this.p.texts, cues: this.p.cues, t: this.t, subtitleSize: this.p.subtitleSize })
    // saat merekam, pratinjau di layar hanya salinan dari canvas rekaman
    if (this.recCtx) this.ctx.drawImage(this.recCtx.canvas, 0, 0, this.canvas.width, this.canvas.height)
  }

  async seek(t) {
    const token = (this.seekToken = (this.seekToken || 0) + 1)
    this.t = Math.max(0, Math.min(t, this.duration || 0))
    const loc = locate(this.p.clips, this.t)
    if (!loc) { this.draw(null); this.onTime?.(this.t); return }
    const el = this.video(loc.clip.src)
    if (el.readyState < 1) await new Promise(r => { el.onloadedmetadata = r; setTimeout(r, 3000) })
    await seekTo(el, loc.offset)
    if (token !== this.seekToken) return
    this.draw(el)
    this.onTime?.(this.t)
  }

  async play() {
    if (!this.p.clips.length) return
    this.ensureAudio()
    if (this.t >= this.duration - 0.05) this.t = 0
    this.playing = true
    this.playError = null
    this.onState?.(true)
    const ended = new Promise(resolve => { this.resolveEnd = resolve })
    const m = this.music()
    if (m) { try { m.currentTime = this.t; if (this.t < (m.duration || Infinity)) await m.play() } catch { /* musik gagal tidak menghentikan video */ } }
    await this.startClipAt(this.t)
    // Timer (bukan requestAnimationFrame) supaya tetap jalan saat jendela
    // tidak terlihat — penting untuk ekspor yang direkam real-time.
    clearInterval(this.timer)
    if (this.playing) this.timer = setInterval(() => this.tick(), 1000 / 30)
    return ended
  }

  async startClipAt(t) {
    const loc = locate(this.p.clips, t)
    if (!loc) return
    this.idx = loc.index
    this.clipStart = loc.start
    this.cur = this.video(loc.clip.src)
    for (const v of this.videos.values()) if (v.el !== this.cur) v.el.pause()
    this.switching = true
    await seekTo(this.cur, loc.offset)
    if (this.playing) {
      try { await this.cur.play() } catch (e) {
        // Browser menolak memutar (mis. tanpa interaksi pengguna) — jangan menggantung
        this.switching = false
        this.playError = e
        this.pause()
        this.onError?.(e)
        this.resolveEnd?.()
        this.resolveEnd = null
        return
      }
    }
    this.switching = false
  }

  tick() {
    if (this.switching || !this.cur) return
    const clip = this.p.clips[this.idx]
    if (!clip) return this.finish()
    this.t = this.clipStart + (this.cur.currentTime - clip.in)
    if (this.cur.currentTime >= clip.out - 0.03 || this.cur.ended) {
      if (this.idx + 1 >= this.p.clips.length) { this.t = this.duration; this.draw(this.cur); this.onTime?.(this.t); return this.finish() }
      this.cur.pause()
      this.startClipAt(this.clipStart + clipDur(clip) + 0.001)
      return
    }
    this.draw(this.cur)
    this.onTime?.(this.t)
  }

  finish() {
    this.pause()
    this.resolveEnd?.()
    this.resolveEnd = null
  }

  pause() {
    this.playing = false
    clearInterval(this.timer)
    for (const v of this.videos.values()) v.el.pause()
    this.musicEl?.pause()
    this.onState?.(false)
  }

  // Rekam timeline secara real-time: canvas + audio → MediaRecorder
  async record({ onProgress } = {}) {
    if (!this.p.clips.length) throw new Error('Timeline kosong.')
    if (typeof MediaRecorder === 'undefined' || !this.canvas.captureStream) throw new Error('Browser ini tidak mendukung ekspor video.')
    this.pause()
    this.ensureAudio()
    await this.seek(0)
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      .find(m => MediaRecorder.isTypeSupported(m)) || ''
    // Rekam dari canvas terpisah (tidak ada di halaman): captureStream dari canvas
    // di dalam halaman berhenti mengirim frame bila jendela tidak sedang tampil.
    const rc = document.createElement('canvas')
    rc.width = this.canvas.width
    rc.height = this.canvas.height
    this.recCtx = rc.getContext('2d')
    const stream = new MediaStream([
      ...rc.captureStream(30).getVideoTracks(),
      ...this.recordDest.stream.getAudioTracks(),
    ])
    let rec
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
    } catch (e) {
      this.recCtx = null
      throw e
    }
    const chunks = []
    rec.ondataavailable = e => e.data.size && chunks.push(e.data)
    const stopped = new Promise(r => { rec.onstop = r })
    const prevOnTime = this.onTime
    this.onTime = t => { prevOnTime?.(t); onProgress?.(this.duration ? t / this.duration : 0) }
    this.draw(this.video(this.p.clips[0].src))
    rec.start(500)
    try {
      await this.play()
      if (this.playError) throw new Error('Browser menolak memutar video. Klik tombol ekspor lagi.')
    } finally {
      this.onTime = prevOnTime
      await new Promise(r => setTimeout(r, 200))
      rec.stop()
      await stopped
      this.recCtx = null
      stream.getTracks().filter(t => t.kind === 'video').forEach(t => t.stop())
    }
    const type = (mime || 'video/webm').split(';')[0]
    return { blob: new Blob(chunks, { type }), ext: type === 'video/mp4' ? 'mp4' : 'webm' }
  }

  destroy() {
    this.pause()
    for (const v of this.videos.values()) { v.el.removeAttribute('src'); v.el.load() }
    this.videos.clear()
    this.audio?.close()
  }
}
