export async function callGemini({ apiKey, model, prompt, mediaData, mimeType, temperature = 0.7, maxTokens = 8192, thinkingMode = false }) {
  if (!apiKey) throw new Error('API key required')
  const parts = []
  if (mediaData) parts.push({ inline_data: { mime_type: mimeType, data: mediaData } })
  parts.push({ text: prompt })
  const generationConfig = { temperature, maxOutputTokens: maxTokens }
  if (thinkingMode && model.includes('gemini-3')) {
    generationConfig.thinking_config = { thinking_budget: -1 }
  }
  const body = { contents: [{ parts }], generationConfig }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const text = data.candidates?.[0]?.content?.parts?.find(p => p.text)?.text || ''
  const tokens = data.usageMetadata?.totalTokenCount || 0
  return { text, tokens }
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
    video.onloadedmetadata = () => {
      const w = video.videoWidth, h = video.videoHeight
      const dur = Math.round(video.duration * 10) / 10
      resolve({
        width: w, height: h, duration: dur,
        durationFormatted: formatDuration(video.duration),
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
    note: 'DOUYIN STRICT: Each prompt value max 3-5 words. Total prompt string ≤150 chars.',
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

// ─── Build copyable string from clean JSON data (no mainPrompt field needed) ──
export function buildCopyString(ad) {
  if (!ad) return ''
  const lines = [
    `=== ${ad.platform || 'PROMPT'} | ${ad.totalDuration || ''} | ${ad.resolution || ''} ${ad.aspectRatio || ''} ===`,
    '',
    `Subject        : ${ad.subject || ''}`,
    `Action         : ${ad.action || ''}`,
    `Environment    : ${ad.environment || ''}`,
    `Camera Work    : ${ad.cameraWork || ''}`,
    `Time of Day    : ${ad.timeOfDay || ''}`,
    `Lighting       : ${ad.lighting || ''}`,
    `Style          : ${ad.style || ''}`,
    `Sound          : ${ad.sound || ''}`,
    `Conv. Line 1   : ${ad.conversationLine1 || ''}`,
    `Conv. Line 2   : ${ad.conversationLine2 || ''}`,
    '',
    `Resolution     : ${ad.resolution || ''}`,
    `Aspect Ratio   : ${ad.aspectRatio || ''}`,
    `Orientation    : ${ad.orientation || ''}`,
    `FPS            : ${ad.fps || ''}`,
    `Color Grade    : ${ad.colorGrade || ''}`,
    `Platform Params: ${ad.platformParams || ''}`,
    '',
    `Negative       : ${ad.negativePrompt || ''}`,
  ]
  if (ad.parts?.length > 0) {
    lines.push('')
    ad.parts.forEach(p => {
      lines.push(`--- Part ${p.part} (${p.timeRange}) ---`)
      if (p.partPrompt) lines.push(p.partPrompt)
      if (p.breakdown) {
        Object.entries(p.breakdown).forEach(([t, d]) => lines.push(`  ${t}: ${d}`))
      }
      lines.push('')
    })
  }
  return lines.join('\n').trim()
}

export function buildAnalyzePrompt({ lang, promptMode, generateMode, cinematic, motionAnalysis, aiParams, videoMeta }) {
  const platform = PLATFORM_CONFIGS[promptMode] || PLATFORM_CONFIGS.kling
  const isVulgar = generateMode === 'vulgar'
  const langInstr = lang === 'id' ? 'Respond entirely in Bahasa Indonesia.' :
    lang === 'bi' ? 'Use Bahasa Indonesia for titles, English for prompts.' : 'Respond in English.'
  const modeInstr = isVulgar
    ? 'VULGAR/ADULT MODE: Describe ALL content explicitly. Direct adult terminology. DO NOT sanitize.'
    : { precise: 'PRECISION MODE: Exact technical terms, specific values.', creative: 'CREATIVE MODE: Evocative, poetic language.', think: 'DEEP MODE: Examine every visual detail carefully.' }[generateMode] || ''

  const metaNote = videoMeta?.width
    ? `ACTUAL VIDEO: ${videoMeta.width}x${videoMeta.height}px, ${videoMeta.duration}s, ${videoMeta.aspectRatio}, ${videoMeta.orientation}, ${videoMeta.format}, ${videoMeta.size}`
    : ''

  const duration = videoMeta?.duration || 0
  const forceSinglePart = duration > 0 && duration <= 15
  const totalParts = forceSinglePart ? 1 : (duration > 0 ? Math.ceil(duration / 10) : 1)

  // 2s breakdown key list for part at partIndex
  function breakdownKeys(partIndex) {
    const start = partIndex * 10
    const end = forceSinglePart ? duration : Math.min(start + 10, duration || 10)
    const keys = []
    for (let t = start; t < end; t += 2) {
      const to = Math.min(t + 2, end)
      keys.push(`"${t}s-${to}s": "..."`)
    }
    return keys.length ? keys.join(', ') : '"0s-2s": "..."'
  }

  // ── JSON MODE ─────────────────────────────────────────────────────────────
  const jsonSchema = `{
  "id": 1,
  "platform": "${platform.name}",
  "totalDuration": "${videoMeta?.durationFormatted || 'unknown'}",
  "totalDurationSeconds": ${duration || 0},
  "totalParts": ${totalParts},
  "subject": "...",
  "action": "...",
  "environment": "...",
  "cameraWork": "...",
  "timeOfDay": "...",
  "lighting": "...",
  "style": "...",
  "sound": "...",
  "conversationLine1": "...",
  "conversationLine2": "...",
  "aspectRatio": "${videoMeta?.aspectRatio || 'detect'}",
  "resolution": "${videoMeta?.width ? `${videoMeta.width}x${videoMeta.height}` : 'detect'}",
  "orientation": "${videoMeta?.orientation || 'detect'}",
  "fps": "detect",
  "colorGrade": "...",
  "platformParams": "${platform.platformParams}",
  "negativePrompt": "${platform.negative}",
  "titles": ["...", "...", "...", "...", "..."],
  "parts": [
    {
      "part": 1,
      "timeRange": "0s-${forceSinglePart ? (duration || 10) + 's' : '10s'}",
      "partPrompt": "...",
      "breakdown": { ${breakdownKeys(0)} },
      "cameraMovement": "...",
      "dominantMood": "...",
      "keyElements": ["...", "..."]
    }
  ]
}`

  // ── TEXT MODE ─────────────────────────────────────────────────────────────
  const textSchema = `## 🎬 VIDEO PROMPT — ${platform.name}

**Subject:** [who/what is the main subject]
**Action:** [what they are doing]
**Environment:** [where, setting, surroundings]
**Camera Work:** [shot type, movement]
**Time of Day:** [morning/golden hour/night/etc]
**Lighting:** [quality, direction, color temperature]
**Style:** [visual aesthetic, film look]
**Sound/Music:** [genre, tempo, mood, instruments]
**Conversation Line 1:** [character 1 dialogue — generate if none]
**Conversation Line 2:** [character 2 dialogue — generate if none]

---
**Resolution:** ${videoMeta?.width ? `${videoMeta.width}x${videoMeta.height}` : '[detected]'} | **Aspect Ratio:** ${videoMeta?.aspectRatio || '[detected]'} | **FPS:** [detected] | **Color Grade:** [style]
**Platform Params:** ${platform.platformParams}
**Negative Prompt:** ${platform.negative}

---
## 📋 READY TO COPY
[Single paragraph combining all fields above for direct paste into ${platform.name}]

---
## 🎞️ PART 1 — 0s to ${forceSinglePart ? (duration || 10) + 's' : '10s'}
**Prompt:** [generation prompt for this segment]
**Breakdown:**
- 0s-2s: [what happens]
- 2s-4s: [what happens]
[continue per 2s]
`

  return `You are a world-class AI video prompt engineer for ${platform.name}.

${metaNote}
${platform.note}
${langInstr}
${modeInstr}
${cinematic ? 'Use cinematography terms: focal length, depth of field, color LUT, lens type.' : ''}
${motionAnalysis ? 'Describe every motion precisely: speed, direction, easing.' : ''}

RULES:
- If any field is not visible/audible in the video, GENERATE a creative fitting value. Never leave blank. Never write "N/A".
- sound field: genre + tempo + mood + instruments (e.g. "upbeat lo-fi, 90 BPM, soft piano and drums")
- conversationLine: generate a fitting line if no dialogue detected
- Parts: ${forceSinglePart ? 'video ≤15s → EXACTLY 1 PART' : `split into ${totalParts} parts of ~10s`}
- Part breakdown: per 2 seconds, keys format "Xs-Ys"

${`OUTPUT FORMAT IS: JSON`}
Return ONLY valid JSON. No markdown. No backticks. Start with { end with }.
Schema:
${jsonSchema}
`
}

export function buildAnalyzePromptText({ lang, promptMode, generateMode, cinematic, motionAnalysis, videoMeta }) {
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
    ? (videoMeta.orientation === 'Portrait' ? `${videoMeta.width}x${videoMeta.height} (9:16)` : `${videoMeta.width}x${videoMeta.height} (16:9)`)
    : '[detect resolution]'
  const arLabel = ar.includes('9:16') || videoMeta?.orientation === 'Portrait' ? '9:16' : '16:9'

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
${cinematic ? 'Use cinematography terms: focal length, depth of field, color LUT.' : ''}
${motionAnalysis ? 'Describe every motion precisely.' : ''}

RULES — STRICT:
- NO asterisks (*) anywhere in output
- NO markdown bold (**) or italic (_)
- NO bullet points (- or •)
- NO "Platform Params", NO "Negative Prompt", NO "Ready to Copy" section
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
  const ctx = analysisData ? JSON.stringify({
    subject: analysisData.subject, action: analysisData.action,
    style: analysisData.style, sound: analysisData.sound,
    totalDuration: analysisData.totalDuration,
  }) : ''
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
