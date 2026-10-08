import { extractVideoFrames, resolveDuration } from './media'
import { VIDEO_PLATFORMS } from '../config/platforms'

// ─── Dispatcher: pilih provider berdasarkan state.provider ───────────────────
// Pemanggil cukup memanggil callAI({ provider, ... }); param lain diteruskan.
// Media bisa dikirim sebagai `mediaFile` (File/Blob — disarankan untuk video)
// atau `mediaData` (base64) + `mimeType`.
// Untuk video, `clip: {start, end}` (detik) membatasi bagian yang dianalisis:
// Gemini memakai videoMetadata, Claude mengambil frame hanya dari rentang itu
// (atau dari `frameTimes` bila diberikan).
export async function callAI({ provider = 'gemini', ...opts }) {
  if (provider === 'claude') return callClaude(opts)
  if (provider === 'vertex') {
    // Project ID opsional (hanya untuk key yang terikat ke project/service account)
    let project = opts.project
    if (project === undefined) { try { project = localStorage.getItem(VERTEX_PROJECT_KEY) || '' } catch { project = '' } }
    return callGemini({ ...opts, vertex: true, project })
  }
  return callGemini(opts)
}

export const VERTEX_PROJECT_KEY = 'videoprompt_vertex_project'
// Vertex tidak punya Files API untuk API key. Video di atas batas ini dikirim
// sebagai rangkaian frame (tanpa audio), sama seperti jalur Claude.
const VERTEX_INLINE_LIMIT = 20 * 1024 * 1024

// Apakah video untuk provider ini akan dikirim sebagai frame diam (tanpa audio)?
export function usesFrames(provider, file) {
  if (provider === 'claude') return true
  return provider === 'vertex' && !!file && file.size > VERTEX_INLINE_LIMIT
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const VERTEX_BASE = 'https://aiplatform.googleapis.com'
const INLINE_LIMIT = 20 * 1024 * 1024      // di atas ini video dicoba lewat Files API
const INLINE_HARD_LIMIT = 100 * 1024 * 1024 // batas inline Gemini

const isGemini3 = (model = '') => /^gemini-3/.test(model)

// ─── Google Gemini API ───────────────────────────────────────────────────────
// Mendukung input video & gambar. Key dikirim lewat header (bukan query URL)
// supaya tidak ikut tercatat di log/riwayat jaringan.
export async function callGemini({
  apiKey, model, prompt, mediaFile, mediaData, mimeType, clip, frameTimes,
  temperature = 0.7, maxTokens = 32768, thinkingMode = false, json = false, onStage,
  vertex = false, project = '',
}) {
  if (!apiKey) throw new Error('API key belum diisi')
  const parts = []
  const mime = mimeType || mediaFile?.type
  let framesNote = ''
  if (mediaFile && vertex && mime?.startsWith('video/') && mediaFile.size > VERTEX_INLINE_LIMIT) {
    onStage?.('frames')
    const frames = await extractVideoFrames(mediaFile, { times: frameTimes || (clip ? sampleClip(clip) : undefined) })
    if (!frames.length) throw new Error('Gagal mengambil frame dari video.')
    frames.forEach(fr => {
      parts.push({ text: `Frame @ ${fr.time.toFixed(1)}s` })
      parts.push({ inline_data: { mime_type: 'image/jpeg', data: fr.data } })
    })
    framesNote = `The video was provided as ${frames.length} still frames (timestamp above each frame, in seconds from the start of the original video) because it is too large to send whole. No audio is available: anything about sound or dialogue must be labeled as inferred or suggested, never observed.

`
  } else if (mediaFile) {
    onStage?.(!vertex && mediaFile.size > INLINE_LIMIT ? 'upload' : 'send')
    const part = vertex
      ? { inline_data: { mime_type: mime, data: await fileToBase64(mediaFile) } }
      : await geminiMediaPart(apiKey, mediaFile, mime)
    if (clip && mime?.startsWith('video/')) {
      part.videoMetadata = { startOffset: `${Math.max(0, clip.start).toFixed(2)}s`, endOffset: `${clip.end.toFixed(2)}s` }
    }
    parts.push(part)
  } else if (mediaData) {
    parts.push({ inline_data: { mime_type: mime, data: mediaData } })
  }
  parts.push({ text: framesNote + prompt })

  // Semua model Gemini saat ini "berpikir", dan token berpikir ikut memakan
  // maxOutputTokens — batas kecil (mis. 2048) membuat output terpotong/kosong.
  const generationConfig = { maxOutputTokens: maxTokens }
  // Gemini 3: Google sangat menyarankan temperature tetap default (1.0);
  // menurunkannya bisa bikin output berulang/looping.
  if (!isGemini3(model)) generationConfig.temperature = temperature
  if (thinkingMode) {
    generationConfig.thinkingConfig = isGemini3(model) ? { thinkingLevel: 'high' } : { thinkingBudget: -1 }
  }
  if (json) generationConfig.responseMimeType = 'application/json'

  onStage?.('generate')
  const url = vertex
    ? `${VERTEX_BASE}/v1/${project.trim() ? `projects/${encodeURIComponent(project.trim())}/locations/global/` : ''}publishers/google/models/${model}:generateContent`
    : `${GEMINI_BASE}/v1beta/models/${model}:generateContent`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  })
  const data = await readJson(res)
  if (data.error) throw new Error(vertex ? vertexError(data.error, res.status) : geminiError(data.error, res.status))

  const block = data.promptFeedback?.blockReason
  if (block) throw new Error(`Permintaan diblokir filter keamanan Google (${block}).`)
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('')
  const tokens = data.usageMetadata?.totalTokenCount || 0
  if (!text) {
    const reason = cand?.finishReason
    throw new Error(reason === 'MAX_TOKENS'
      ? 'Output habis sebelum selesai (MAX_TOKENS). Coba lagi atau matikan Deep Think.'
      : `Model tidak mengembalikan teks${reason ? ` (${reason})` : ''}.`)
  }
  return { text, tokens, truncated: cand?.finishReason === 'MAX_TOKENS' }
}

// File yang sudah diunggah disimpan per objek File, jadi Analyze ulang
// tidak mengunggah video yang sama berkali-kali (file Gemini hidup 48 jam).
const uploadedFiles = new WeakMap()

async function geminiMediaPart(apiKey, file, mime) {
  if (file.size > INLINE_LIMIT) {
    try {
      let cached = uploadedFiles.get(file)
      if (!cached || cached.apiKey !== apiKey || Date.now() - cached.at > 40 * 3600e3) {
        const uploaded = await uploadGeminiFile(apiKey, file, mime)
        cached = { apiKey, at: Date.now(), uri: uploaded.uri, mime: uploaded.mimeType || mime }
        uploadedFiles.set(file, cached)
      }
      return { file_data: { mime_type: cached.mime, file_uri: cached.uri } }
    } catch (e) {
      if (file.size > INLINE_HARD_LIMIT) {
        throw new Error(`Upload Files API gagal (${e.message}) dan file >100MB tidak bisa dikirim inline. Kompres/potong videonya.`)
      }
    }
  }
  return { inline_data: { mime_type: mime, data: await fileToBase64(file) } }
}

async function uploadGeminiFile(apiKey, file, mime) {
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mime,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: file.name || 'upload' } }),
  })
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) {
    const err = await readJson(start)
    throw new Error(err.error?.message || 'upload URL tidak tersedia')
  }
  const up = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: file,
  })
  let f = (await readJson(up)).file
  if (!f) throw new Error('respons upload tidak valid')
  // Video perlu diproses dulu sebelum bisa dipakai
  for (let i = 0; f.state === 'PROCESSING' && i < 100; i++) {
    await new Promise(r => setTimeout(r, 3000))
    f = await readJson(await fetch(`${GEMINI_BASE}/v1beta/${f.name}`, { headers: { 'x-goog-api-key': apiKey } }))
  }
  if (f.state !== 'ACTIVE') throw new Error(`file berstatus ${f.state || 'unknown'}`)
  return f
}

// ─── Anthropic Claude Messages API ───────────────────────────────────────────
// Dipanggil langsung dari browser; header `anthropic-dangerous-direct-browser-access`
// diperlukan agar lolos CORS. Claude tidak menerima video, jadi video diubah
// menjadi rangkaian frame (gambar) bertanda waktu.
const CLAUDE_MAX_TOKENS = 16000 // batas aman untuk request non-streaming

export async function callClaude({ apiKey, model, prompt, mediaFile, mediaData, mimeType, clip, frameTimes, maxTokens = CLAUDE_MAX_TOKENS, onStage }) {
  if (!apiKey) throw new Error('API key belum diisi')

  const content = []
  let framesNote = ''
  const mime = mimeType || mediaFile?.type || ''
  if (mediaFile && mime.startsWith('video/')) {
    onStage?.('frames')
    const times = frameTimes || (clip ? sampleClip(clip) : undefined)
    const frames = await extractVideoFrames(mediaFile, { times })
    if (!frames.length) throw new Error('Gagal mengambil frame dari video.')
    frames.forEach(fr => {
      content.push({ type: 'text', text: `Frame @ ${fr.time.toFixed(1)}s` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fr.data } })
    })
    framesNote = `The video was provided as ${frames.length} still frames (timestamp above each frame, in seconds from the start of the original video). No audio is available: anything about sound or dialogue must be labeled as inferred or suggested, never observed.\n\n`
  } else if (mediaFile || mediaData) {
    if (!mime.startsWith('image/')) throw new Error('Format media tidak didukung Claude.')
    const data = mediaData || await fileToBase64(mediaFile)
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
  }
  content.push({ type: 'text', text: framesNote + prompt })
  onStage?.('generate')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: Math.min(maxTokens, CLAUDE_MAX_TOKENS),
      messages: [{ role: 'user', content }],
    }),
  })
  const data = await readJson(res)
  if (data.type === 'error' || data.error) throw new Error(data.error?.message || `Claude API error ${res.status}`)
  const tokens = data.usage ? (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0) : 0
  if (data.stop_reason === 'refusal') {
    throw new Error(`Claude menolak permintaan ini${data.stop_details?.explanation ? `: ${data.stop_details.explanation}` : '.'}`)
  }
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  if (!text) throw new Error('Claude tidak mengembalikan teks.')
  return { text, tokens, truncated: data.stop_reason === 'max_tokens' }
}

function sampleClip({ start, end }) {
  const n = Math.min(20, Math.max(3, Math.round((end - start) / 2)))
  return Array.from({ length: n }, (_, i) => start + ((end - start) * (i + 0.5)) / n)
}

function geminiError(err, status) {
  const msg = err.message || `Gemini error ${status}`
  // Key Google Cloud yang dibatasi ke Vertex AI ditolak oleh Gemini API
  if (/generativelanguage.*are blocked|API_KEY_SERVICE_BLOCKED/i.test(msg + JSON.stringify(err.details || ''))) {
    return 'Key ini tidak diizinkan untuk Gemini API (biasanya key Vertex AI / Google Cloud). Pilih provider "Vertex AI" di header, lalu tempel key yang sama di sana.'
  }
  return msg
}

// Pesan error Vertex yang paling sering, diterjemahkan ke langkah perbaikan
function vertexError(err, status) {
  const msg = err.message || `Vertex AI error ${status}`
  if (status === 401 || /API key not valid/i.test(msg)) return 'API key Vertex tidak valid. Pakai key dari Google Cloud (APIs & Services > Credentials) yang diizinkan untuk Vertex AI API.'
  if (status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(msg)) return 'Vertex AI API belum diaktifkan di project ini. Aktifkan "Vertex AI API" di Google Cloud Console, tunggu beberapa menit, lalu coba lagi.'
  if (status === 403 && /billing/i.test(msg)) return 'Billing project Google Cloud belum aktif. Aktifkan billing (kredit juga dihitung di sini), lalu coba lagi.'
  if (status === 404) return `Model tidak ditemukan di Vertex AI (${msg}). Coba model lain, atau isi Project ID bila key Anda terikat ke project.`
  if (status === 400 && /size|too large|exceeds/i.test(msg)) return 'Video terlalu besar untuk Vertex. Pilih lebih sedikit adegan atau kompres videonya.'
  return msg
}

async function readJson(res) {
  const raw = await res.text()
  try { return JSON.parse(raw) } catch {
    return { error: { message: `HTTP ${res.status}: ${raw.slice(0, 200) || res.statusText}` } }
  }
}

export async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function parseJsonResponse(text) {
  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const start = clean.indexOf('{')
    const end = clean.lastIndexOf('}')
    if (start === -1 || end === -1) return null
    return JSON.parse(clean.slice(start, end + 1))
  } catch { return null }
}

export async function extractVideoMetadata(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    const url = URL.createObjectURL(file)
    video.muted = true
    video.onloadedmetadata = async () => {
      const w = video.videoWidth, h = video.videoHeight
      const rawDur = await resolveDuration(video)
      const dur = Math.round(rawDur * 10) / 10
      resolve({
        width: w, height: h, duration: dur,
        durationFormatted: rawDur ? formatDuration(rawDur) : 'unknown',
        aspectRatio: getAspectRatio(w, h),
        orientation: w > h ? 'Landscape' : w < h ? 'Portrait' : 'Square',
        name: file.name,
        size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
        format: file.name.split('.').pop().toUpperCase(),
        mimeType: file.type || 'video/mp4',
      })
      URL.revokeObjectURL(url)
    }
    video.onerror = () => resolve({
      name: file.name, size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
      format: file.name.split('.').pop().toUpperCase(), mimeType: file.type || 'video/mp4',
      width: null, height: null, duration: null, durationFormatted: 'unknown',
      aspectRatio: 'unknown', orientation: 'unknown',
    })
    video.src = url
  })
}

function formatDuration(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60)
  return m > 0 ? `${m}m ${sec}s` : `${Math.round(s * 10) / 10}s`
}

function getAspectRatio(w, h) {
  if (!w || !h) return 'Unknown'
  const gcd = (a, b) => b === 0 ? a : gcd(b, a % b)
  const d = gcd(w, h)
  const known = { '16:9': 1.778, '9:16': 0.5625, '1:1': 1.0, '4:3': 1.333, '3:4': 0.75, '21:9': 2.333, '4:5': 0.8 }
  const ratio = w / h
  let closest = `${w/d}:${h/d}`, minDiff = Infinity
  for (const [label, val] of Object.entries(known)) {
    const diff = Math.abs(ratio - val)
    if (diff < minDiff) { minDiff = diff; closest = label }
  }
  return closest
}

// Daftar platform pindah ke config/platforms.js; nama lama tetap diekspor.
export const PLATFORM_CONFIGS = VIDEO_PLATFORMS

export const FOCUS_INSTR = {
  motion:  'FOCUS: prioritise motion and camera — movement speed, direction, easing, camera path, cuts.',
  visual:  'FOCUS: prioritise visual style — palette, color grade, lens look, texture, composition.',
  subject: 'FOCUS: prioritise the main subject — appearance, clothing, expression, pose, gestures.',
  mood:    'FOCUS: prioritise mood and atmosphere — emotion, pacing, tension, ambience.',
  env:     'FOCUS: prioritise the environment — location, props, background activity, weather.',
}
export const DETAIL_INSTR = {
  Normal: 'DETAIL: concise. One short sentence per field and per interval.',
  High:   'DETAIL: rich. Two to three specific sentences per field and per interval.',
  Ultra:  'DETAIL: exhaustive. Name concrete colors, materials, lens/focal length, light direction, exact movements and timing in every field and interval.',
}

export function buildInsightPrompt({ analysisData, platform, lang, videoMeta }) {
  const pd = PLATFORM_CONFIGS[platform] || PLATFORM_CONFIGS.kling
  const langInstr = lang === 'id' ? 'Respond in Bahasa Indonesia.' :
    lang === 'bi' ? 'Mix Bahasa Indonesia and English.' : 'Respond in English.'
  // analysisData berisi { mainPrompt: <hasil Analyze> } — kirim utuh sebagai konteks
  const ctx = analysisData?.mainPrompt
    ? `
<video_analysis>
${analysisData.mainPrompt}
</video_analysis>`
    : ''
  const metaNote = videoMeta ? `Video: ${videoMeta.width}x${videoMeta.height}, ${videoMeta.durationFormatted}, ${videoMeta.orientation}` : ''

  return `You are a social media content strategist.

${metaNote}
Platform: ${pd.name}
Context: ${ctx}
${langInstr}

DO NOT re-analyze video. Provide ONLY fresh marketing insights.
Return ONLY valid JSON starting with {

{
  "id": 1,
  "platform": "${pd.name}",
  "postingStrategy": {
    "bestTime": "...", "frequency": "...", "contentPillar": "...",
    "viralPotential": "Low/Medium/High/Viral", "viralReason": "..."
  },
  "viralTitles": [
    "...",
    "...",
    "...",
    "...",
    "..."
  ],
  "titles": [
    {"style": "Viral Hook", "text": "...", "charCount": 0},
    {"style": "Question", "text": "...", "charCount": 0},
    {"style": "Emotional", "text": "...", "charCount": 0},
    {"style": "Informative", "text": "...", "charCount": 0},
    {"style": "Trending", "text": "...", "charCount": 0}
  ],
  "descriptions": {
    "short": "...", "medium": "...", "long": "..."
  },
  "hashtags": {
    "niche": ["#tag1","#tag2","#tag3","#tag4","#tag5"],
    "broad": ["#tag1","#tag2","#tag3"],
    "trending": ["#tag1","#tag2","#tag3"],
    "branded": ["#tag1","#tag2"]
  },
  "audienceInsight": {
    "targetAudience": "...", "ageRange": "...",
    "interests": ["...","...","..."], "emotionalTrigger": "..."
  },
  "soundtrack": {
    "genre": "...", "mood": "...", "tempo": "...", "instruments": "...",
    "references": ["...","...","..."],
    "tiktokSound": "...",
    "royaltyFree": "search keyword for Epidemic Sound / Artlist"
  },
  "contentOptimization": {
    "strongPoints": ["..."], "suggestions": ["..."], "hooks": ["...","...","..."]
  },
  "crossPlatform": {
    "tiktok": "...", "instagram": "...", "youtube": "...", "twitter": "..."
  }
}`
}
