// ─── Dispatcher: pilih provider berdasarkan state.provider ───────────────────
// Pemanggil cukup memanggil callAI({ provider, ... }); param lain diteruskan.
// Media bisa dikirim sebagai `mediaFile` (File/Blob — disarankan untuk video)
// atau `mediaData` (base64) + `mimeType`.
export async function callAI({ provider = 'gemini', ...opts }) {
  return provider === 'claude' ? callClaude(opts) : callGemini(opts)
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const INLINE_LIMIT = 20 * 1024 * 1024      // di atas ini video dicoba lewat Files API
const INLINE_HARD_LIMIT = 100 * 1024 * 1024 // batas inline Gemini

const isGemini3 = (model = '') => /^gemini-3/.test(model)

// ─── Google Gemini API ───────────────────────────────────────────────────────
// Mendukung input video & gambar. Key dikirim lewat header (bukan query URL)
// supaya tidak ikut tercatat di log/riwayat jaringan.
export async function callGemini({
  apiKey, model, prompt, mediaFile, mediaData, mimeType,
  temperature = 0.7, maxTokens = 32768, thinkingMode = false, json = false,
}) {
  if (!apiKey) throw new Error('API key required')
  const parts = []
  const mime = mimeType || mediaFile?.type
  if (mediaFile) {
    parts.push(await geminiMediaPart(apiKey, mediaFile, mime))
  } else if (mediaData) {
    parts.push({ inline_data: { mime_type: mime, data: mediaData } })
  }
  parts.push({ text: prompt })

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

  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }], generationConfig }),
  })
  const data = await readJson(res)
  if (data.error) throw new Error(data.error.message || `Gemini error ${res.status}`)

  const block = data.promptFeedback?.blockReason
  if (block) throw new Error(`Permintaan diblokir Gemini (${block}).`)
  const cand = data.candidates?.[0]
  const text = (cand?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('')
  const tokens = data.usageMetadata?.totalTokenCount || 0
  if (!text) {
    const reason = cand?.finishReason
    throw new Error(reason === 'MAX_TOKENS'
      ? 'Output habis sebelum selesai (MAX_TOKENS). Coba lagi atau matikan Deep Think.'
      : `Gemini tidak mengembalikan teks${reason ? ` (${reason})` : ''}.`)
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

export async function callClaude({ apiKey, model, prompt, mediaFile, mediaData, mimeType, maxTokens = CLAUDE_MAX_TOKENS }) {
  if (!apiKey) throw new Error('API key required')

  const content = []
  let framesNote = ''
  const mime = mimeType || mediaFile?.type || ''
  if (mediaFile && mime.startsWith('video/')) {
    const frames = await extractVideoFrames(mediaFile)
    if (!frames.length) throw new Error('Gagal mengambil frame dari video.')
    frames.forEach(fr => {
      content.push({ type: 'text', text: `Frame @ ${fr.time.toFixed(1)}s` })
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fr.data } })
    })
    framesNote = `The video was provided as ${frames.length} still frames sampled evenly across its duration (timestamp above each frame). No audio is available, so infer sound/music from the visuals.\n\n`
  } else if (mediaFile || mediaData) {
    if (!mime.startsWith('image/')) throw new Error('Format media tidak didukung Claude.')
    const data = mediaData || await fileToBase64(mediaFile)
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
  }
  content.push({ type: 'text', text: framesNote + prompt })

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

async function readJson(res) {
  const raw = await res.text()
  try { return JSON.parse(raw) } catch {
    return { error: { message: `HTTP ${res.status}: ${raw.slice(0, 200) || res.statusText}` } }
  }
}

// Rekaman layar / MediaRecorder (webm) sering tidak menyimpan durasi
// (duration = Infinity/0). Trik standar: seek jauh ke depan agar browser
// menghitung durasi sebenarnya.
async function resolveDuration(video) {
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

// Ambil frame merata dari video → base64 JPEG (dipakai jalur Claude).
export async function extractVideoFrames(file, { count, maxSide = 768, quality = 0.8 } = {}) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('Video tidak bisa dibaca browser'))
    })
    const dur = await resolveDuration(video)
    // kira-kira 1 frame per 2 detik, 6-20 frame
    const n = count || Math.min(20, Math.max(6, Math.round(dur / 2)))
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')
    const frames = []
    for (let i = 0; i < n; i++) {
      const t = dur ? Math.min(dur - 0.05, (dur * (i + 0.5)) / n) : 0
      await new Promise(resolve => {
        if (!dur) {
          // durasi tak diketahui: cukup ambil frame pertama
          if (video.readyState >= 2) resolve()
          else video.onloadeddata = resolve
          return
        }
        video.onseeked = resolve
        video.currentTime = Math.max(0, t)
      })
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      frames.push({ time: t, data: canvas.toDataURL('image/jpeg', quality).split(',')[1] })
      if (!dur) break
    }
    return frames
  } finally {
    URL.revokeObjectURL(url)
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

export const PLATFORM_CONFIGS = {
  douyin: {
    name: 'Douyin (抖音)', color: '#f5a623',
    note: 'Douyin: punchy, vertical-first phrasing; strong visual hook in the first 2 seconds; fast trendy pacing.',
    negative: '模糊，低质量，水印，静态，无聊，过曝',
    platformParams: 'ratio:9:16, duration:5-10s, style:viral',
  },
  jimeng: {
    name: 'Jimeng AI (即梦)', color: '#18c98a',
    note: 'Jimeng: scene→subject→action→camera→atmosphere. Include motion_intensity: 低/中/高.',
    negative: '模糊, 低质量, 水印, 噪点, 过曝, 变形',
    platformParams: 'motion_intensity:中, style:cinematic',
  },
  kling: {
    name: 'Kling AI', color: '#9b6bf5',
    note: 'Kling: include motion_strength (0.0-1.0). Negative prompt is critical.',
    negative: 'blurry, distorted faces, bad anatomy, low quality, watermark, text, static, flickering',
    platformParams: 'motion_strength:0.5, duration:5s, cfg_scale:0.5',
  },
  runway: {
    name: 'Runway Gen-3', color: '#f0528a',
    note: 'Runway format: [camera motion] [subject] [action] [environment] [style].',
    negative: 'blurry, bad lighting, overexposed, underexposed, artifacts, watermark',
    platformParams: 'camera_motion:push_in, style:cinematic',
  },
  gemini_ai: {
    name: 'Google Veo (Gemini)', color: '#4f7ef7',
    note: 'Veo: detailed scene + motion_guidance_scale + aspect_ratio required.',
    negative: 'low quality, blurry, artifacts, watermark, text overlay, unrealistic motion',
    platformParams: 'aspect_ratio:16:9, motion_guidance_scale:0.7',
  },
}


const FOCUS_INSTR = {
  motion:  'FOCUS: prioritise motion and camera — movement speed, direction, easing, camera path, cuts.',
  visual:  'FOCUS: prioritise visual style — palette, color grade, lens look, texture, composition.',
  subject: 'FOCUS: prioritise the main subject — appearance, clothing, expression, pose, gestures.',
  mood:    'FOCUS: prioritise mood and atmosphere — emotion, pacing, tension, ambience.',
  env:     'FOCUS: prioritise the environment — location, props, background activity, weather.',
}
const DETAIL_INSTR = {
  Normal: 'DETAIL: concise. One short sentence per field and per interval.',
  High:   'DETAIL: rich. Two to three specific sentences per field and per interval.',
  Ultra:  'DETAIL: exhaustive. Name concrete colors, materials, lens/focal length, light direction, exact movements and timing in every field and interval.',
}

export function buildAnalyzePromptText({ lang, promptMode, generateMode, cinematic, motionAnalysis, aiParams, focusArea, detailLevel, videoMeta }) {
  const platform = PLATFORM_CONFIGS[promptMode] || PLATFORM_CONFIGS.kling
  const isVulgar = generateMode === 'vulgar'
  const langInstr = lang === 'id' ? 'Respond entirely in Bahasa Indonesia.' :
    lang === 'bi' ? 'Use Bahasa Indonesia for titles, English for prompts.' : 'Respond in English.'
  const modeInstr = isVulgar
    ? 'VULGAR/ADULT MODE: Describe ALL content explicitly. DO NOT sanitize.'
    : { precise: 'PRECISION MODE: Exact technical terms.', creative: 'CREATIVE MODE: Evocative, poetic.', think: 'DEEP MODE: Examine every detail carefully.' }[generateMode] || ''

  const duration = videoMeta?.duration || 0
  const forceSinglePart = duration > 0 && duration <= 15
  const totalParts = forceSinglePart ? 1 : (duration > 0 ? Math.ceil(duration / 10) : 1)

  // Detect aspect ratio as 9:16 or 16:9
  const ar = videoMeta?.aspectRatio || ''
  const resolution = videoMeta?.width
    ? `${videoMeta.width}x${videoMeta.height}`
    : '[detect resolution]'
  const arLabel = /^\d+:\d+$/.test(ar) ? ar : (videoMeta?.orientation === 'Portrait' ? '9:16' : '16:9')

  // Build breakdown slots per 2s for a given part
  function breakdownSlots(partIndex) {
    const start = partIndex * 10
    const end = forceSinglePart ? duration : Math.min(start + 10, duration || 10)
    const slots = []
    for (let t = start; t < end; t += 2) {
      const to = Math.min(t + 2, end)
      slots.push(`[${t}s-${to}s]\n...`)
    }
    return slots.join('\n\n')
  }

  // Build part blocks
  const partBlocks = Array.from({ length: totalParts }, (_, i) => {
    const start = i * 10
    const end = forceSinglePart ? duration : Math.min(start + 10, duration || 10)
    return `PART ${i + 1} — ${start}s to ${end}s

${breakdownSlots(i)}`
  }).join('\n\n---\n\n')

  return `You are a world-class AI video prompt engineer for ${platform.name}.

${videoMeta?.width ? `VIDEO: ${videoMeta.width}x${videoMeta.height}, ${duration}s, ${videoMeta.orientation}` : ''}
${langInstr}
${modeInstr}
Platform style: ${platform.note}
${DETAIL_INSTR[detailLevel] || DETAIL_INSTR.Ultra}
${FOCUS_INSTR[focusArea] || ''}
${cinematic ? 'Use cinematography terms: focal length, depth of field, color LUT.' : ''}
${motionAnalysis ? 'Describe every motion precisely: speed, direction, easing.' : ''}
${aiParams ? `End with one extra line "Platform Params : ..." containing suggested ${platform.name} generation settings (start from: ${platform.platformParams}).` : ''}

Before writing, watch the whole video and note what actually changes over time, so every interval describes what is really on screen at that moment rather than repeating the overall summary.

RULES — STRICT:
- NO asterisks (*) anywhere in output
- NO markdown bold (**) or italic (_)
- NO bullet points (- or •)
- NO "Negative Prompt", NO "Ready to Copy" section${aiParams ? '' : ', NO "Platform Params"'}
- NO conversation lines, NO dialogue fields
- Plain text only
- If any field is missing from video, generate a fitting value creatively
- Resolution: always write as ${arLabel} (${resolution})
- Parts: ${forceSinglePart ? 'video ≤15s → 1 PART ONLY' : `${totalParts} parts of ~10s each`}
- Each part: write ACTUAL description per 2-second interval (not placeholder dots)

OUTPUT FORMAT — write EXACTLY like this structure, no extra sections:

Subject : [who/what is the main subject]
Action : [what they are doing]
Environment : [where, setting, surroundings]
Camera Work : [shot type, movement]
Time of Day : [morning/golden hour/night/etc]
Lighting : [quality, direction, color temperature]
Style : [visual aesthetic, film look]
Sound : [genre, tempo, mood, instruments]
Resolution : ${arLabel}

${partBlocks.replace(/\.\.\./g, '[write actual description here]')}
`
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
