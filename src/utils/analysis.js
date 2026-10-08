// ─── Analisis terstruktur, transkrip, dan highlight ────────────────────────
// Semua waktu dikendalikan aplikasi (hasil deteksi adegan), bukan dikarang AI:
// AI hanya mengisi teks untuk id adegan/slot yang kita tentukan.
import { PLATFORM_CONFIGS, FOCUS_INSTR, DETAIL_INSTR } from './gemini'
import { videoTargetName } from '../config/platforms'
import { fmtTime, parseTime, fmtStamp } from './media'

export const GLOBAL_FIELDS = [
  { key: 'subject',     label: 'Subject' },
  { key: 'action',      label: 'Action' },
  { key: 'environment', label: 'Environment' },
  { key: 'cameraWork',  label: 'Camera Work' },
  { key: 'timeOfDay',   label: 'Time of Day' },
  { key: 'lighting',    label: 'Lighting' },
  { key: 'style',       label: 'Style' },
  { key: 'sound',       label: 'Sound' },
]

export const SOURCES = {
  observed:  { id: 'Terlihat',  en: 'Observed',      color: 'var(--c-green)', hint: 'Terlihat/terdengar langsung di video' },
  inferred:  { id: 'Perkiraan', en: 'Inferred',      color: 'var(--c-amber)', hint: 'Diperkirakan dari petunjuk visual' },
  suggested: { id: 'Saran AI',  en: 'AI suggestion', color: 'var(--c-violet)', hint: 'Tidak ada di video, ide kreatif AI' },
  edited:    { id: 'Diedit',    en: 'Edited',        color: 'var(--c-blue)', hint: 'Sudah diperiksa/diubah manual' },
}

const SLOT_LEN = 2

// Slot per 2 detik untuk satu adegan
export function planSlots(scene) {
  const slots = []
  const len = scene.end - scene.start
  const n = Math.max(1, Math.round(len / SLOT_LEN))
  for (let k = 0; k < n; k++) {
    slots.push({
      id: `${scene.id}_${k + 1}`,
      start: r2(scene.start + (len * k) / n),
      end: r2(k === n - 1 ? scene.end : scene.start + (len * (k + 1)) / n),
    })
  }
  return slots
}

function langInstruction(lang) {
  return lang === 'id' ? 'Write every text value in Bahasa Indonesia.'
    : lang === 'bi' ? 'Write summaries in Bahasa Indonesia and every prompt-like field (subject, action, environment, camera, lighting, style, sound, slots) in English.'
    : 'Write every text value in English.'
}

function modeInstruction(generateMode) {
  return { precise: 'PRECISION MODE: Exact technical terms, specific values.', creative: 'CREATIVE MODE: Evocative, cinematic language — but keep source labels honest.', think: 'DEEP MODE: Examine every visual detail carefully before answering.' }[generateMode] || ''
}

const span = (a, b) => `${r2(a)}–${r2(b)}s [${fmtTime(a, 0)}–${fmtTime(b, 0)}]`

export function transcriptLines(segments = [], start = 0, end = Infinity) {
  return segments
    .filter(s => s.end > start && s.start < end && s.text.trim())
    .map(s => `[${fmtTime(s.start)}–${fmtTime(s.end)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`)
}

// mode 'full'  → analisis global + semua adegan yang diberikan
// mode 'scene' → hanya satu adegan (dipakai tombol "ulang adegan"), dengan konteks global
export function buildStructuredPrompt({
  mode = 'full', lang, promptMode, generateMode, cinematic, motionAnalysis, aiParams,
  focusArea, detailLevel, videoMeta, scenes, clip, transcript, globalContext, framesOnly,
  customTarget, lock,
}) {
  const base = PLATFORM_CONFIGS[promptMode] || PLATFORM_CONFIGS.kling
  const platform = { ...base, name: videoTargetName(promptMode in PLATFORM_CONFIGS ? promptMode : 'kling', customTarget) }
  const sceneList = scenes.map(s => {
    const slots = planSlots(s).map(sl => `    ${sl.id}: ${span(sl.start, sl.end)}`).join('\n')
    return `  ${s.id}: ${span(s.start, s.end)}\n${slots}`
  }).join('\n')

  const lines = transcript?.length
    ? transcriptLines(transcript, Math.min(...scenes.map(s => s.start)), Math.max(...scenes.map(s => s.end)))
    : []

  const F = '{"text": "...", "source": "observed|inferred|suggested"}'
  const sceneShape = `{ "id": "s1", "summary": F, "camera": F, "dialogue": F, "slots": { "s1_1": F, "s1_2": F } }`
  const shape = mode === 'scene'
    ? sceneShape
    : `{\n  "global": { ${GLOBAL_FIELDS.map(f => `"${f.key}": F`).join(', ')} },${aiParams ? '\n  "platformParams": F,' : ''}\n  "scenes": [ ${sceneShape}, ... ]\n}`

  return `You are a world-class AI video prompt engineer for ${platform.name}. You analyze a real video and turn it into precise, reusable generation prompts, while being honest about what is actually in the video.

${videoMeta?.width ? `VIDEO: ${videoMeta.width}x${videoMeta.height}px, ${videoMeta.duration}s, ${videoMeta.orientation}` : ''}
${clip && !framesOnly ? `You receive only the part of the video from ${fmtTime(clip.start, 0)} to ${fmtTime(clip.end, 0)}. All times below are measured from the start of the ORIGINAL video (so ${fmtTime(clip.start, 0)} of the original is 00:00 of the clip you see).` : ''}
${langInstruction(lang)}
${modeInstruction(generateMode)}
Platform style: ${platform.note}
${DETAIL_INSTR[detailLevel] || DETAIL_INSTR.Ultra}
${FOCUS_INSTR[focusArea] || ''}
${cinematic ? 'Use cinematography terms: focal length, depth of field, color LUT, lens type.' : ''}
${motionAnalysis ? 'Describe every motion precisely: speed, direction, easing.' : ''}
${aiParams && mode === 'full' ? `platformParams: suggested ${platform.name} generation settings (start from: ${platform.platformParams}).` : ''}
${lockInstruction(lock)}
${mode === 'scene' && globalContext ? `\nCONTEXT FROM THE EARLIER ANALYSIS OF THE WHOLE VIDEO (keep consistent with it):\n${globalContext}\n` : ''}
${mode === 'scene' ? 'SCENE TO ANALYZE AGAIN' : 'SCENES TO ANALYZE'} (id: time range, then its 2-second slots):
${sceneList}
${lines.length ? `\nSPOKEN DIALOGUE from a human-reviewed transcript (treat as observed, quote it verbatim):\n${lines.join('\n')}\n` : ''}
SOURCE LABELS — every text value is an object F = ${F}:
- observed: clearly visible or audible in the video
- inferred: an estimate from visible cues (e.g. time of day from the light, focal length from depth of field)
- suggested: not present in the video; your creative proposal to complete the prompt
Never label a guess as observed. When something cannot be determined, still fill the field with a fitting value, but label it suggested.

RULES:
- Include every scene id${mode === 'scene' ? '' : ' listed above'} and every slot id exactly once, using exactly those ids.
- Each slot describes what is really on screen during that interval (movement, expression, camera change) — do not repeat the scene summary.
- dialogue: the exact spoken words in that scene; if nobody speaks, use {"text": "", "source": "observed"}.
- Plain text inside strings: no markdown, no asterisks, no bullet symbols.
- Return ONLY valid JSON, no backticks, in this shape:
${shape}`
}

// ─── Validasi hasil AI ─────────────────────────────────────────────────────
function field(v, fallbackSource = 'inferred') {
  if (v == null) return { text: '', source: fallbackSource }
  if (typeof v !== 'object') return { text: String(v).trim(), source: fallbackSource }
  const text = String(v.text ?? v.value ?? '').trim()
  return { text, source: SOURCES[v.source] ? v.source : fallbackSource }
}

function normalizeScene(raw, scene) {
  const rawSlots = raw?.slots
  const slots = planSlots(scene).map((sl, k) => {
    let v = Array.isArray(rawSlots) ? rawSlots[k] : rawSlots?.[sl.id]
    if (v === undefined && rawSlots && !Array.isArray(rawSlots)) v = Object.values(rawSlots)[k]
    return { ...sl, ...field(v) }
  })
  return {
    id: scene.id, start: scene.start, end: scene.end,
    summary: field(raw?.summary), camera: field(raw?.camera), dialogue: field(raw?.dialogue, 'observed'),
    slots,
  }
}

function findRawScene(list, scene, index) {
  if (!Array.isArray(list)) return undefined
  return list.find(s => s?.id === scene.id) || list[index]
}

export function normalizeAnalysis(raw, scenes, { aiParams, resolution } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('Respons AI bukan JSON yang valid.')
  const rawScenes = raw.scenes || raw.parts
  const data = {
    global: Object.fromEntries(GLOBAL_FIELDS.map(f => [f.key, field(raw.global?.[f.key] ?? raw[f.key])])),
    platformParams: aiParams ? field(raw.platformParams, 'suggested') : null,
    resolution,
    scenes: scenes.map((s, i) => normalizeScene(findRawScene(rawScenes, s, i), s)),
  }
  data.missing = countMissing(data)
  return data
}

export function normalizeScenePatch(raw, scene) {
  const obj = raw?.scenes ? findRawScene(raw.scenes, scene, 0) : raw
  return normalizeScene(obj, scene)
}

export function countMissing(data) {
  let n = 0
  GLOBAL_FIELDS.forEach(f => { if (!data.global[f.key]?.text) n++ })
  data.scenes.forEach(s => {
    if (!s.summary.text) n++
    s.slots.forEach(sl => { if (!sl.text) n++ })
  })
  return n
}

// ─── Teks siap salin dari data terstruktur ──────────────────────────────────
export function analysisToText(data, { markSources = false, lang = 'en' } = {}) {
  if (!data) return ''
  const tag = f => {
    if (!markSources || !f || !['inferred', 'suggested'].includes(f.source)) return ''
    return ` [${lang === 'en' ? SOURCES[f.source].en : SOURCES[f.source].id}]`
  }
  const out = GLOBAL_FIELDS.map(f => `${f.label} : ${data.global[f.key].text}${tag(data.global[f.key])}`)
  if (data.resolution) out.push(`Resolution : ${data.resolution}`)
  if (data.platformParams?.text) out.push(`Platform Params : ${data.platformParams.text}`)
  data.scenes.forEach((s, i) => {
    out.push('', `SCENE ${sceneNo(s, i)} — ${r2(s.start)}s to ${r2(s.end)}s`)
    if (s.summary.text) out.push(`Summary : ${s.summary.text}${tag(s.summary)}`)
    if (s.camera.text) out.push(`Camera : ${s.camera.text}${tag(s.camera)}`)
    if (s.dialogue.text) out.push(`Dialogue : ${s.dialogue.text}${tag(s.dialogue)}`)
    s.slots.forEach(sl => out.push('', `[${r2(sl.start)}s-${r2(sl.end)}s]`, `${sl.text}${tag(sl)}`))
  })
  return out.join('\n')
}

export function analysisContext(data) {
  if (!data) return ''
  return GLOBAL_FIELDS.map(f => `${f.label}: ${data.global[f.key].text}`).join('\n')
}

// ─── Transkrip & subtitle ───────────────────────────────────────────────────
export function buildTranscriptPrompt({ duration }) {
  return `Transcribe every spoken word in this video${duration ? ` (duration ${fmtTime(duration)})` : ''} into subtitle segments.

Rules:
- Write the words in the language actually spoken. Do not translate, summarize or fix grammar.
- Timestamps are measured from the start of the video, formatted "MM:SS.s" (e.g. "01:15.4").
- Each segment is one subtitle: at most about 7 seconds and 12 words; split long sentences.
- Segments must not overlap and must follow the order of speech.
- speaker: "Speaker 1", "Speaker 2", ... consistently for the same voice (or a name if it is clearly stated).
- Mark words you cannot make out as (?) instead of guessing.
- Ignore music and sound effects. If there is no speech at all, return an empty segments array.

Return ONLY valid JSON:
{"language": "id", "segments": [{"start": "00:01.2", "end": "00:03.8", "speaker": "Speaker 1", "text": "..."}]}`
}

let segSeq = 0
export const newSegId = () => `t${Date.now().toString(36)}${(segSeq++).toString(36)}`

export function normalizeTranscript(raw, duration) {
  const list = Array.isArray(raw) ? raw : raw?.segments
  if (!Array.isArray(list)) throw new Error('Format transkrip tidak dikenali.')
  const max = duration || Infinity
  const segs = list
    .map(s => {
      const start = Math.min(max, Math.max(0, parseTime(s.start)))
      let end = Math.min(max, parseTime(s.end))
      if (!isFinite(end) || end <= start) end = Math.min(max, start + 2)
      return { id: newSegId(), start: r2(start), end: r2(end), speaker: String(s.speaker || '').trim(), text: String(s.text || '').trim() }
    })
    .filter(s => isFinite(s.start) && s.text)
    .sort((a, b) => a.start - b.start)
  // rapikan tumpang tindih
  for (let i = 1; i < segs.length; i++) {
    if (segs[i].start < segs[i - 1].end) segs[i - 1].end = Math.max(segs[i - 1].start + 0.2, segs[i].start)
  }
  return { language: raw?.language || '', segments: segs }
}

const cueText = s => s.text
export function toSRT(segments) {
  return segments.map((s, i) => `${i + 1}\n${fmtStamp(s.start)} --> ${fmtStamp(s.end)}\n${cueText(s)}\n`).join('\n')
}
export function toVTT(segments) {
  return 'WEBVTT\n\n' + segments.map(s => `${fmtStamp(s.start, '.')} --> ${fmtStamp(s.end, '.')}\n${cueText(s)}\n`).join('\n')
}
export function toPlainTranscript(segments) {
  return segments.map(s => `[${fmtTime(s.start)}] ${s.speaker ? s.speaker + ': ' : ''}${s.text}`).join('\n')
}

// ─── Potong jeda: rentang bicara dari transkrip ─────────────────────────────
export function speechRanges(segments, { pad = 0.25, minGap = 0.6, duration = Infinity } = {}) {
  const ranges = segments
    .filter(s => s.text.trim())
    .map(s => ({ start: Math.max(0, s.start - pad), end: Math.min(duration, s.end + pad) }))
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    if (last && r.start - last.end < minGap) last.end = Math.max(last.end, r.end)
    else merged.push({ ...r })
  }
  return merged.map(r => ({ start: r2(r.start), end: r2(r.end) }))
}

// ─── Highlight / susun klip otomatis ────────────────────────────────────────
export function buildHighlightPrompt({ scenes, analysis, transcript, target, lang, platformName, duration }) {
  const byId = Object.fromEntries((analysis?.scenes || []).map(s => [s.id, s]))
  const list = scenes.map(s => {
    const a = byId[s.id]
    const said = transcriptLines(transcript || [], s.start, s.end).join(' ')
    return `${s.id}: ${span(s.start, s.end)}${a?.summary?.text ? ` — ${a.summary.text}` : ''}${said ? ` | speech: ${said}` : ''}`
  }).join('\n')
  return `You are a short-form video editor for ${platformName}. Build the strongest ~${target}-second edit from the scenes below.

VIDEO DURATION: ${r2(duration)}s
SCENES (id: time range in seconds from the start of the original video — summary | speech):
${list}

Rules:
- Open with the most attention-grabbing moment (the hook), then keep a clear flow and end on a payoff.
- Pick clips inside the listed scene ranges only; you may trim a scene to its best part. Minimum clip length 1s.
- Total length of all clips should be close to ${target}s. Do not cut in the middle of a spoken sentence.
- You may reorder scenes if it makes a better story.
- hook: a short on-screen title for the first seconds (${lang === 'en' ? 'English' : 'Bahasa Indonesia'}), max 6 words.

Return ONLY valid JSON:
{"hook": "...", "clips": [{"sceneId": "s3", "start": 12.0, "end": 15.5, "reason": "..."}]}`
}

export function normalizeHighlight(raw, scenes, duration) {
  const list = Array.isArray(raw?.clips) ? raw.clips : []
  const byId = Object.fromEntries(scenes.map(s => [s.id, s]))
  const clips = list.map(c => {
    const sc = byId[c.sceneId]
    const lo = sc ? sc.start : 0
    const hi = sc ? sc.end : duration
    let start = parseTime(c.start), end = parseTime(c.end)
    if (!isFinite(start)) start = lo
    if (!isFinite(end)) end = hi
    start = Math.min(Math.max(start, lo), hi)
    end = Math.min(Math.max(end, start), hi)
    return { start: r2(start), end: r2(end), reason: String(c.reason || '') }
  }).filter(c => c.end - c.start >= 0.5)
  if (!clips.length) throw new Error('AI tidak mengembalikan klip yang valid.')
  return { hook: String(raw.hook || '').trim(), clips }
}

// Nomor adegan mengikuti daftar adegan asli (s3 → 3), bukan urutan hasil analisis
export function sceneNo(scene, index) {
  const n = parseInt(String(scene.id).replace(/\D/g, ''), 10)
  return isFinite(n) ? n : index + 1
}

function r2(n) { return Math.round(n * 100) / 100 }

// ─── Kunci konsistensi ──────────────────────────────────────────────────────
export const LOCK_FIELDS = [
  { key: 'character', label: 'Karakter', hint: 'Wajah, rambut, usia, ciri khas' },
  { key: 'product',   label: 'Produk',   hint: 'Bentuk, merek, kemasan, ukuran' },
  { key: 'wardrobe',  label: 'Pakaian',  hint: 'Baju, aksesori, warna pakaian' },
  { key: 'palette',   label: 'Warna',    hint: 'Palet dan color grade' },
  { key: 'style',     label: 'Gaya',     hint: 'Gaya visual, lensa, suasana' },
]

export function lockInstruction(lock) {
  const rows = LOCK_FIELDS.filter(f => lock?.[f.key]?.trim()).map(f => `- ${f.label}: ${lock[f.key].trim()}`)
  if (!rows.length) return ''
  return `CONSISTENCY LOCK (reference descriptions from the user). Whenever one of these elements appears, describe it with exactly these words and never contradict them, in every scene and prompt:
${rows.join('\n')}`
}

// ─── Prompt siap salin per adegan ───────────────────────────────────────────
export function scenePrompt(data, scene, { promptMode, customTarget } = {}) {
  const g = data.global
  const p = PLATFORM_CONFIGS[promptMode] || PLATFORM_CONFIGS.kling
  const parts = [
    scene.summary.text,
    g.subject?.text && `Subject: ${g.subject.text}`,
    g.environment?.text && `Environment: ${g.environment.text}`,
    scene.camera.text && `Camera: ${scene.camera.text}`,
    g.lighting?.text && `Lighting: ${g.lighting.text}`,
    g.style?.text && `Style: ${g.style.text}`,
  ].filter(Boolean)
  const dur = r2(scene.end - scene.start)
  const lines = [`${videoTargetName(promptMode, customTarget)} · ${dur}s`, '', parts.join('. ').replace(/\.\./g, '.')]
  if (scene.slots.length > 1) {
    lines.push('')
    scene.slots.forEach(sl => sl.text && lines.push(`[${r2(sl.start - scene.start)}-${r2(sl.end - scene.start)}s] ${sl.text}`))
  }
  if (scene.dialogue.text) lines.push('', `Dialogue: "${scene.dialogue.text}"`)
  if (g.sound?.text) lines.push(`Sound: ${g.sound.text}`)
  if (data.platformParams?.text) lines.push('', `Params: ${data.platformParams.text}`)
  if (p.negative) lines.push(`Negative: ${p.negative}`)
  return lines.join('\n')
}

// Bagian adegan yang masih perkiraan / saran AI dan belum diperiksa
export function sceneReview(scene) {
  const out = []
  const check = (label, f) => { if (f?.text && (f.source === 'inferred' || f.source === 'suggested')) out.push({ label, source: f.source }) }
  check('Ringkasan', scene.summary); check('Kamera', scene.camera); check('Dialog', scene.dialogue)
  scene.slots.forEach(sl => check(`${fmtTime(sl.start, 0)}–${fmtTime(sl.end, 0)}`, sl))
  return out
}

// ─── Revisi & adaptasi tanpa mengirim ulang video ───────────────────────────
const SOURCE_RULE = `Every text value stays an object {"text": "...", "source": "observed|inferred|suggested|edited"}.
- Keep the text AND source of every value you do not need to change.
- A value you rewrite only for wording or platform format keeps its original source.
- A value whose content changes because of the user's request becomes "suggested" (it is no longer what the video shows).`

export function buildRevisePrompt({ data, instruction, sceneId, lang, lock }) {
  const target = sceneId ? data.scenes.find(s => s.id === sceneId) : data
  return `You edit an existing structured video analysis used to write AI video prompts.

USER REQUEST: "${instruction}"
${lock ? lockInstruction(lock) : ''}
${langInstruction(lang)}

Apply the request and change nothing else. Do not invent new scenes, ids or slots, and keep every id exactly as given.
${SOURCE_RULE}
Plain text inside strings, no markdown. Return ONLY the edited JSON in exactly the same shape:
${JSON.stringify(stripForAI(target))}`
}

export function buildAdaptPrompt({ data, promptMode, customTarget, lang, aiParams }) {
  const p = PLATFORM_CONFIGS[promptMode] || PLATFORM_CONFIGS.kling
  return `You rewrite an existing structured video analysis for a different AI video generator: ${videoTargetName(promptMode, customTarget)}.
Platform style: ${p.note}
${aiParams ? `Also rewrite "platformParams" as suggested settings for this platform (start from: ${p.platformParams}).` : ''}
${langInstruction(lang)}

Keep the meaning, the scene ids and slot ids. Only adapt wording, order and terminology to what this platform understands best, and drop settings it does not support.
${SOURCE_RULE}
Plain text inside strings, no markdown. Return ONLY the JSON in exactly the same shape:
${JSON.stringify(stripForAI(data))}`
}

function stripForAI(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const { missing, resolution, ...rest } = obj
  if (rest.scenes) rest.scenes = rest.scenes.map(s => ({ ...s, slots: Object.fromEntries(s.slots.map(sl => [sl.id, { text: sl.text, source: sl.source }])) }))
  if (rest.slots) rest.slots = Object.fromEntries(rest.slots.map(sl => [sl.id, { text: sl.text, source: sl.source }]))
  return rest
}

// Hasil revisi/adaptasi kembali ke bentuk data aplikasi (waktu dari aplikasi, bukan AI)
export function mergeRevised(data, raw, sceneId) {
  if (sceneId) {
    const scene = data.scenes.find(s => s.id === sceneId)
    const patch = normalizeScenePatch(raw, scene)
    const next = { ...data, scenes: data.scenes.map(s => s.id === sceneId ? patch : s) }
    next.missing = countMissing(next)
    return next
  }
  const next = normalizeAnalysis({ ...raw, platformParams: raw.platformParams ?? data.platformParams }, data.scenes, { aiParams: !!data.platformParams || !!raw.platformParams, resolution: data.resolution })
  return next
}
