import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { callAI, parseJsonResponse, buildInsightPrompt, extractVideoMetadata } from '../utils/gemini'
import { VIDEO_PLATFORMS, videoTargetName } from '../config/platforms'
import { detectScenes, chunkScenes, sampleTimes, SENSITIVITY, extractVideoFrames, fmtTime, downloadBlob } from '../utils/media'
import {
  buildStructuredPrompt, normalizeAnalysis, normalizeScenePatch, analysisToText,
  analysisContext, countMissing, toVTT, lockInstruction, buildRevisePrompt, buildAdaptPrompt, mergeRevised,
} from '../utils/analysis'
import { addHistory } from '../utils/db'
import { buildProductionPackage } from '../utils/package'
import { loadKey, DEFAULT_MODEL } from '../hooks/useStore'
import MobileLayout from './MobileLayout'
import SceneStrip from './SceneStrip'
import AnalysisEditor from './AnalysisEditor'
import TranscriptPanel from './TranscriptPanel'
import LockCard from './LockCard'
import BatchQueue from './BatchQueue'
import {
  GlassCard, Btn, PrimaryBtn, ActionBtn, OutputBox, Chip, SelField, Seg, Toggle, Spin, Note, Icon, CardLabel,
  pressable, CC, tint, inputStyle, copyText, downloadText,
} from './ui'

const PLATFORM_IDS = Object.keys(VIDEO_PLATFORMS)
const GEN_MODES = [
  { value: 'precise',  label: 'Presisi', title: 'Istilah teknis dan nilai yang spesifik' },
  { value: 'creative', label: 'Kreatif', title: 'Bahasa sinematik yang lebih hidup' },
  { value: 'think',    label: 'Teliti',  title: 'AI berpikir lebih lama. Lebih lambat dan lebih mahal' },
]
const DETAIL_LEVELS = [
  { value: 'Normal', label: 'Ringkas' }, { value: 'High', label: 'Rinci' }, { value: 'Ultra', label: 'Sangat rinci' },
]
const FOCUS_AREAS = [
  { value: 'all', label: 'Semua elemen' }, { value: 'motion', label: 'Gerakan & kamera' },
  { value: 'visual', label: 'Gaya visual' }, { value: 'subject', label: 'Subjek utama' },
  { value: 'mood', label: 'Suasana' }, { value: 'env', label: 'Lingkungan' },
]
const LANGS = [{ value: 'en', label: 'English' }, { value: 'id', label: 'Indonesia' }, { value: 'bi', label: 'Campuran' }]
const GOALS = [
  { id: 'camera',    title: 'Meniru gerakan kamera', desc: 'Fokus ke gerak kamera, lensa, dan tempo tiap adegan.' },
  { id: 'product',   title: 'Prompt iklan produk',   desc: 'Fokus ke produk/subjek, dengan kunci konsistensi.' },
  { id: 'subtitle',  title: 'Ambil subtitle',        desc: 'Transkrip bertimestamp, koreksi, unduh SRT/VTT.' },
  { id: 'highlight', title: 'Susun highlight',       desc: 'AI memilih momen terbaik lalu menyusunnya di Editor.' },
  { id: 'image',     title: 'Prompt dari gambar',    desc: 'Unggah atau tempel screenshot di tab Prompt gambar.' },
  { id: 'variations', title: 'Variasi dari prompt',  desc: 'Tulis satu prompt, dapatkan beberapa versi berbeda.' },
]
const STAGES = {
  read: 'Membaca video', upload: 'Mengunggah ke Gemini', send: 'Mengirim video', frames: 'Mengambil frame',
  generate: 'AI menganalisis adegan', build: 'Menyusun prompt',
}

// Deteksi adegan tetap berjalan walau tab ditinggal; token mencegah hasil
// deteksi video lama menimpa video baru.
let detectToken = 0

export default function AnalyzeTab({ state, set, showToast, isMobile, focusKey }) {
  const fileRef = useRef(null)
  const videoRef = useRef(null)
  const [subTab, setSubTab]       = useState('prompt')
  const [clipCount, setClipCount] = useState(3)
  const [storyType, setStoryType] = useState('viral')
  const [storyTitle, setStoryTitle] = useState('')
  const [isGenStory, setIsGenStory]     = useState(false)
  const [isGenInsight, setIsGenInsight] = useState(false)
  const [copied, setCopied]       = useState({})
  const [busyScene, setBusyScene] = useState(null)
  const [stage, setStage]         = useState(null)   // { steps: [...], current }
  const [lastError, setLastError] = useState(null)
  const [compare, setCompare]     = useState(null)   // { provider, model, data, text } | 'busy'
  const [adaptTo, setAdaptTo]     = useState('')
  const [adapting, setAdapting]   = useState(false)
  const [reviseText, setReviseText] = useState('')
  const [revising, setRevising]   = useState(null)   // 'all' | scene id
  const [framing, setFraming]     = useState(null)
  const [pkg, setPkg]             = useState(null)   // label tahap paket
  const [query, setQuery]         = useState('')

  const promptMode = VIDEO_PLATFORMS[state.promptMode] ? state.promptMode : 'kling'
  const target = videoTargetName(promptMode, state.customTarget)
  const insightData = state.insight
  const storyOutput = state.story

  // ── Buka entri riwayat ──
  useEffect(() => {
    const r = state.restore
    if (!r || !['analyze', 'adapt', 'batch', 'insight', 'story'].includes(r.kind)) return
    if (r.kind === 'insight') { set({ insight: r.data, restore: null }); setSubTab('detail') }
    else if (r.kind === 'story') { set({ story: r.text, restore: null }); setSubTab('story') }
    else {
      set({ analysisData: r.data, analysisText: r.text, promptMode: r.promptMode || promptMode, restore: null })
      setSubTab('prompt')
      if (!state.videoFile) showToast('Hasil dibuka dari riwayat. Unggah videonya lagi kalau ingin analisis ulang per adegan.')
    }
  }, [state.restore])

  // Subtitle transkrip langsung tampil di pemutar video
  const vttUrl = useMemo(() => (
    state.subtitleOnVideo && state.transcript?.length
      ? URL.createObjectURL(new Blob([toVTT(state.transcript)], { type: 'text/vtt' }))
      : null
  ), [state.transcript, state.subtitleOnVideo])
  useEffect(() => () => { if (vttUrl) URL.revokeObjectURL(vttUrl) }, [vttUrl])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('video/')) loadVideo(file)
    else showToast('Yang bisa dianalisis hanya file video', true)
  }, [state.videoUrl])

  // preset = { scenes, analysisData } dipakai saat meninjau hasil antrean
  async function loadVideo(file, preset) {
    if (!file) return
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl)
    const url = URL.createObjectURL(file)
    const meta = preset?.meta || await extractVideoMetadata(file)
    setLastError(null); setCompare(null)
    set({
      videoFile: file, videoUrl: url, videoMeta: meta,
      analysisData: preset?.data || null, analysisText: preset?.text || null,
      scenes: preset?.scenes || chunkScenes(meta.duration), selectedScenes: [], transcript: [], insight: null,
    })
    if (!preset) runDetection(file, meta.duration, state.sceneSensitivity)
    if (state.goal === 'subtitle') setSubTab('transcript')
  }

  async function runDetection(file, duration, sensitivity = 'medium') {
    const token = ++detectToken
    set({ scenesStatus: { state: 'detecting', progress: 0 } })
    let last = 0
    try {
      const scenes = await detectScenes(file, {
        threshold: SENSITIVITY[sensitivity] ?? SENSITIVITY.medium,
        isCancelled: () => token !== detectToken,
        onProgress: p => { if (p - last >= 0.04) { last = p; set({ scenesStatus: { state: 'detecting', progress: p * 0.9 } }) } },
      })
      if (token !== detectToken || !scenes) return
      set({ scenes, selectedScenes: [], scenesStatus: { state: 'done', progress: 1 } })
    } catch {
      if (token === detectToken) set({ scenes: chunkScenes(duration), scenesStatus: { state: 'done', progress: 1 } })
    }
  }

  function clearVideo() {
    detectToken++
    setLastError(null); setCompare(null)
    set({ videoFile: null, videoUrl: null, videoMeta: null, analysisData: null, analysisText: null, scenes: [], selectedScenes: [], transcript: [], scenesStatus: null, insight: null })
  }

  function seekVideo(t) {
    const v = videoRef.current
    if (!v) return showToast('Unggah videonya dulu untuk memutar adegan', true)
    v.currentTime = t
    v.play().catch(() => {})
    if (isMobile) v.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const needKey = () => { showToast('Isi API key dulu', true); focusKey?.(); return false }

  const promptOpts = (provider = state.provider) => ({
    lang: state.lang || 'en', promptMode, customTarget: state.customTarget, lock: state.lock,
    generateMode: state.generateMode || 'precise',
    cinematic: state.toggleCinematic, motionAnalysis: state.toggleMotion,
    aiParams: state.toggleAiParams, focusArea: state.focusArea || 'all',
    detailLevel: state.detailLevel || 'High', transcript: state.transcript, framesOnly: provider === 'claude',
  })
  const callOpts = (file, provider = state.provider, apiKey = state.apiKey, model = state.model) => ({
    provider, apiKey, model,
    mediaFile: file, mimeType: file.type || 'video/mp4',
    temperature: state.generateMode === 'creative' ? 0.95 : parseFloat(state.temperature) || 0.7,
    maxTokens: parseInt(state.maxTokens) || 32768,
    thinkingMode: state.generateMode === 'think', json: true,
  })
  const resolutionLabel = meta => meta?.width ? `${meta.aspectRatio} (${meta.width}x${meta.height})` : ''

  function setAnalysis(data, extra = {}) {
    set({ analysisData: data, analysisText: analysisToText(data, { markSources: state.markSources, lang: state.lang }), ...extra })
  }

  // Satu analisis lengkap untuk satu file. Dipakai tombol utama, pembanding, dan antrean.
  async function analyzeFile({ file, meta, scenes, picked, provider, apiKey, model, onStage }) {
    const all = scenes?.length ? scenes : chunkScenes(meta?.duration)
    const use = picked?.length ? picked : all
    const clip = use.length < all.length ? { start: Math.min(...use.map(sc => sc.start)), end: Math.max(...use.map(sc => sc.end)) } : null
    const prompt = buildStructuredPrompt({ ...promptOpts(provider), videoMeta: meta, scenes: use, clip })
    const { text, tokens, truncated } = await callAI({
      ...callOpts(file, provider, apiKey, model), prompt, clip, onStage,
      frameTimes: sampleTimes(use, { every: 2, max: 40 }),
    })
    onStage?.('build')
    const parsed = parseJsonResponse(text)
    if (!parsed) {
      throw new Error(truncated
        ? 'Output terlalu panjang dan terpotong. Pilih lebih sedikit adegan atau turunkan tingkat detail.'
        : 'Respons AI bukan JSON yang valid. Coba lagi.')
    }
    const data = normalizeAnalysis(parsed, use, { aiParams: state.toggleAiParams, resolution: resolutionLabel(meta) })
    return { data, tokens, count: use.length }
  }

  async function analyzeVideo() {
    if (!state.videoFile) { showToast('Unggah video dulu', true); return fileRef.current?.click() }
    if (!state.apiKey) return needKey()
    const all = state.scenes?.length ? state.scenes : chunkScenes(state.videoMeta?.duration)
    const picked = state.selectedScenes?.length ? all.filter(sc => state.selectedScenes.includes(sc.id)) : all
    const sendStep = state.provider === 'claude' ? 'frames' : state.videoFile.size > 20 * 1048576 ? 'upload' : 'send'
    const steps = ['read', sendStep, 'generate', 'build']
    setStage({ steps, current: 'read' })
    setLastError(null); setCompare(null)
    set({ isAnalyzing: true, insight: null })
    setSubTab('prompt')
    try {
      const { data, tokens, count } = await analyzeFile({
        file: state.videoFile, meta: state.videoMeta, scenes: all, picked,
        provider: state.provider, apiKey: state.apiKey, model: state.model,
        onStage: st => setStage(s => s && ({ ...s, current: steps.includes(st) ? st : s.current })),
      })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      setAnalysis(data)
      saveHistory('analyze', data)
      showToast(data.missing ? `Selesai, tapi ${data.missing} bagian kosong. Periksa hasilnya` : `Analisis ${count} adegan selesai`, !!data.missing)
    } catch (e) {
      setLastError(e.message)
      showToast('Gagal: ' + e.message, true)
    }
    setStage(null)
    set({ isAnalyzing: false })
  }

  function saveHistory(kind, data, extra = {}) {
    addHistory({
      kind, title: state.videoMeta?.name || 'Video', platform: target, promptMode,
      text: analysisToText(data, { lang: state.lang }), data,
      thumb: state.scenes?.find(sc => sc.thumb)?.thumb || null, ...extra,
    })
  }

  async function regenScene(id) {
    const data = state.analysisData
    const t = data?.scenes.find(sc => sc.id === id)
    if (!t) return
    if (!state.videoFile) return showToast('Unggah videonya lagi untuk analisis ulang adegan', true)
    if (!state.apiKey) return needKey()
    const scene = { id: t.id, start: t.start, end: t.end }
    setBusyScene(id)
    try {
      const prompt = buildStructuredPrompt({ ...promptOpts(), videoMeta: state.videoMeta, mode: 'scene', scenes: [scene], clip: scene, globalContext: analysisContext(data) })
      const { text, tokens } = await callAI({ ...callOpts(state.videoFile), prompt, clip: scene, frameTimes: sampleTimes([scene], { every: 1.5, max: 12 }) })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons AI bukan JSON yang valid.')
      const patch = normalizeScenePatch(parsed, scene)
      const next = { ...state.analysisData, scenes: state.analysisData.scenes.map(sc => sc.id === id ? patch : sc) }
      next.missing = countMissing(next)
      setAnalysis(next, { totalTokens: state.totalTokens + tokens })
      showToast('Adegan diperbarui')
    } catch (e) { showToast('Gagal: ' + e.message, true) }
    setBusyScene(null)
  }

  // ── Revisi terarah (tanpa kirim ulang video) ──
  async function revise(sceneId, instruction) {
    if (!state.apiKey) return needKey()
    setRevising(sceneId || 'all')
    try {
      const prompt = buildRevisePrompt({ data: state.analysisData, instruction, sceneId, lang: state.lang, lock: state.lock })
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, json: true, temperature: 0.4 })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons AI bukan JSON yang valid.')
      const next = mergeRevised(state.analysisData, parsed, sceneId)
      setAnalysis(next, { totalTokens: state.totalTokens + tokens })
      showToast(sceneId ? 'Adegan direvisi' : 'Hasil direvisi')
      setRevising(null)
      return true
    } catch (e) { showToast('Gagal: ' + e.message, true) }
    setRevising(null)
    return false
  }

  // ── Adaptasi ke platform lain (pakai ulang analisis, tanpa video) ──
  async function adaptPlatform() {
    if (!adaptTo || adaptTo === promptMode) return
    if (!state.apiKey) return needKey()
    setAdapting(true)
    try {
      const prompt = buildAdaptPrompt({ data: state.analysisData, promptMode: adaptTo, customTarget: '', lang: state.lang, aiParams: state.toggleAiParams })
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, json: true, temperature: 0.4 })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons AI bukan JSON yang valid.')
      const next = mergeRevised(state.analysisData, parsed)
      setAnalysis(next, { totalTokens: state.totalTokens + tokens, promptMode: adaptTo, customTarget: '' })
      addHistory({ kind: 'adapt', title: state.videoMeta?.name || 'Video', platform: VIDEO_PLATFORMS[adaptTo].name, promptMode: adaptTo, text: analysisToText(next, { lang: state.lang }), data: next, thumb: state.scenes?.find(sc => sc.thumb)?.thumb || null })
      showToast(`Disesuaikan untuk ${VIDEO_PLATFORMS[adaptTo].name}`)
      setAdaptTo('')
    } catch (e) { showToast('Gagal: ' + e.message, true) }
    setAdapting(false)
  }

  // ── Bandingkan dengan provider lain ──
  const otherProvider = state.provider === 'gemini' ? 'claude' : 'gemini'
  const otherName = otherProvider === 'claude' ? 'Claude' : 'Gemini'
  async function compareModels() {
    const key = loadKey(otherProvider)
    if (!key) return showToast(`Simpan API key ${otherName} dulu: pilih ${otherName} di header, isi key, lalu kembali`, true)
    if (!state.videoFile) return showToast('Unggah videonya lagi untuk membandingkan', true)
    setCompare('busy')
    try {
      const all = state.scenes?.length ? state.scenes : chunkScenes(state.videoMeta?.duration)
      const picked = state.analysisData.scenes.map(s => all.find(a => a.id === s.id) || s)
      const model = DEFAULT_MODEL[otherProvider]
      const { data, tokens } = await analyzeFile({ file: state.videoFile, meta: state.videoMeta, scenes: picked, provider: otherProvider, apiKey: key, model })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      setCompare({ provider: otherProvider, model, data, text: analysisToText(data, { lang: state.lang }) })
    } catch (e) { setCompare(null); showToast('Gagal: ' + e.message, true) }
  }

  // ── Kirim ke tab lain ──
  const actions = {
    copied,
    copy: (text, key) => copyText(text, showToast).then(ok => { if (ok) { setCopied(p => ({ ...p, [key]: true })); setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 1800) } }),
    revising,
    revise,
    framing,
    toVariation: text => { set({ variationBase: text, activeTab: 'realistic' }); showToast('Prompt dikirim ke tab Variasi') },
    toEditor: scenes => { set({ pendingClips: scenes.map(s => ({ start: s.start, end: s.end })), activeTab: 'editor' }); showToast(`${scenes.length} adegan ditambahkan ke Editor`) },
    toImage: async s => {
      if (!state.videoFile) return showToast('Unggah videonya lagi untuk mengambil frame', true)
      setFraming(s.id)
      try {
        const [fr] = await extractVideoFrames(state.videoFile, { times: [(s.start + s.end) / 2], maxSide: 1536, quality: 0.9 })
        set({ pendingImage: { base64: fr.data, mime: 'image/jpeg', name: `adegan-${s.id}.jpg` }, activeTab: 'swap' })
        showToast('Frame dikirim ke Prompt gambar')
      } catch (e) { showToast('Gagal mengambil frame: ' + e.message, true) }
      setFraming(null)
    },
  }

  // ── Insight & cerita ──
  async function generateInsight() {
    if (!state.analysisText) return showToast('Analisis video dulu', true)
    if (!state.apiKey) return needKey()
    setIsGenInsight(true)
    try {
      const prompt = buildInsightPrompt({ analysisData: { mainPrompt: state.analysisText }, platform: promptMode, lang: state.lang || 'en', videoMeta: state.videoMeta })
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: 0.8, json: true })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons insight tidak bisa dibaca')
      set(prev => ({ insight: parsed, totalTokens: prev.totalTokens + tokens }))
      addHistory({ kind: 'insight', title: state.videoMeta?.name || 'Video', platform: target, text: (parsed.viralTitles || []).join(' · '), data: parsed })
      showToast('Insight siap')
    } catch (e) { showToast('Gagal: ' + e.message, true) }
    setIsGenInsight(false)
  }

  async function generateNewStory() {
    if (!state.analysisText) return showToast('Analisis video dulu', true)
    if (!state.apiKey) return needKey()
    const title = storyTitle.trim() || 'Untitled'
    setIsGenStory(true)
    try {
      const langInstr = state.lang === 'id' ? 'Write narration and titles in Bahasa Indonesia; scene prompts in English.'
        : state.lang === 'bi' ? 'Write narration in Bahasa Indonesia, scene prompts in English.' : 'Write everything in English.'
      const prompt = `You are a short-form video director and AI video prompt engineer for ${target}.

<video_analysis>
${state.analysisText}
</video_analysis>

Create a NEW ${storyType}-style video story titled "${title}", told in exactly ${clipCount} clips, that keeps the look, subject and atmosphere of the analyzed video but tells a fresh story.
${langInstr}
${lockInstruction(state.lock)}

The story needs a hook in clip 1, rising tension or curiosity in the middle, and a satisfying payoff or twist in the final clip. Keep the same character appearance, wardrobe, location style and color grade in every clip so the clips cut together seamlessly.

Plain text only, no asterisks or markdown. For each clip use exactly:

CLIP N [start-end s]
Scene Prompt : a complete, ready-to-paste ${target} prompt (subject, action, environment, camera, lighting, style)
Narration : voice-over or on-screen text
Camera : shot type and movement
Sound : music and sound effects
Transition : how it cuts to the next clip`
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: 0.85 })
      set(prev => ({ story: text, totalTokens: prev.totalTokens + tokens }))
      addHistory({ kind: 'story', title, platform: target, text })
      showToast('Cerita baru siap')
    } catch (e) { showToast('Gagal: ' + e.message, true) }
    setIsGenStory(false)
  }

  // ── Paket produksi ──
  async function downloadPackage() {
    if (!state.analysisData) return
    setPkg('Menyiapkan')
    try {
      const blob = await buildProductionPackage({
        data: state.analysisData, videoFile: state.videoFile, videoMeta: state.videoMeta, transcript: state.transcript,
        promptMode, customTarget: state.customTarget, lang: state.lang, insight: state.insight, story: state.story,
        onProgress: setPkg,
      })
      const base = (state.videoMeta?.name || 'video').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40)
      downloadBlob(blob, `paket-produksi-${base}.zip`)
      showToast(`Paket produksi diunduh (${(blob.size / 1048576).toFixed(1)} MB)`)
    } catch (e) { showToast('Gagal membuat paket: ' + e.message, true) }
    setPkg(null)
  }

  // ── Pencarian di video (analisis + transkrip) ──
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length < 2) return []
    const out = []
    ;(state.transcript || []).forEach(s => { if (s.text.toLowerCase().includes(q)) out.push({ t: s.start, kind: 'Ucapan', text: s.text }) })
    ;(state.analysisData?.scenes || []).forEach(s => {
      ;[['Ringkasan', s.summary], ['Kamera', s.camera], ['Dialog', s.dialogue]].forEach(([k, f]) => { if (f.text.toLowerCase().includes(q)) out.push({ t: s.start, kind: k, text: f.text }) })
      s.slots.forEach(sl => { if (sl.text.toLowerCase().includes(q)) out.push({ t: sl.start, kind: 'Detail', text: sl.text }) })
    })
    return out.sort((a, b) => a.t - b.t).slice(0, 40)
  }, [query, state.transcript, state.analysisData])

  // ── Perkiraan token sebelum analisis ──
  const estimate = useMemo(() => {
    const all = state.scenes?.length ? state.scenes : []
    const picked = state.selectedScenes?.length ? all.filter(sc => state.selectedScenes.includes(sc.id)) : all
    const secs = picked.reduce((s, sc) => s + (sc.end - sc.start), 0) || state.videoMeta?.duration || 0
    if (!secs) return null
    const promptTok = 2500
    let input
    if (state.provider === 'claude') {
      const frames = Math.min(40, Math.max(picked.length || 1, Math.round(secs / 2)))
      const w = state.videoMeta?.width || 1280, h = state.videoMeta?.height || 720
      const sc = Math.min(1, 768 / Math.max(w, h))
      input = frames * Math.round((w * sc * h * sc) / 750) + promptTok
    } else input = Math.round(secs * 300) + promptTok
    const output = picked.length * (state.detailLevel === 'Ultra' ? 900 : state.detailLevel === 'Normal' ? 350 : 600) + 800
    return { input, output, secs }
  }, [state.scenes, state.selectedScenes, state.videoMeta, state.provider, state.detailLevel])

  function pickGoal(g) {
    const patch = { goal: g }
    if (g === 'camera') Object.assign(patch, { focusArea: 'motion', toggleMotion: true, toggleCinematic: true })
    if (g === 'product') Object.assign(patch, { focusArea: 'subject', generateMode: 'creative', advanced: true })
    if (g === 'image') Object.assign(patch, { activeTab: 'swap' })
    if (g === 'variations') Object.assign(patch, { activeTab: 'realistic' })
    set(patch)
    if (g === 'subtitle' && state.provider === 'claude') showToast('Subtitle butuh Gemini karena Claude tidak bisa mendengar audio. Ganti provider di header.', true)
    if (['camera', 'product', 'subtitle', 'highlight'].includes(g)) fileRef.current?.click()
  }

  const fileInput = <input type="file" ref={fileRef} accept="video/*" style={{ display: 'none' }} onChange={e => { loadVideo(e.target.files[0]); e.target.value = '' }} />
  const hasVideo = !!state.videoUrl

  // ── Panel kiri ──
  const leftPanel = (
    <>
      <Seg value={state.advanced ? 'adv' : 'quick'} onChange={v => set({ advanced: v === 'adv' })} label="Mode pengaturan" options={[
        { value: 'quick', label: 'Cepat', title: 'Hanya pengaturan utama' },
        { value: 'adv', label: 'Lanjutan', title: 'Semua pengaturan, kunci konsistensi, dan antrean' },
      ]} />

      {hasVideo ? (
        <GlassCard color={CC[0]} label="Video">
          {!isMobile && (
            <div onDragOver={e => e.preventDefault()} onDrop={handleDrop} style={{ borderRadius: 7, overflow: 'hidden', background: '#000' }}>
              <video ref={videoRef} src={state.videoUrl} controls style={{ width: '100%', display: 'block', maxHeight: 360 }}>
                {vttUrl && <track key={vttUrl} kind="subtitles" src={vttUrl} srcLang={state.transcriptLang || 'id'} label="Transkrip" default />}
              </video>
            </div>
          )}
          {state.videoMeta && (
            <div style={{ marginTop: isMobile ? 0 : 8, display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
              <Chip value={state.videoMeta.durationFormatted} />
              {state.videoMeta.width && <Chip value={`${state.videoMeta.width}×${state.videoMeta.height}`} />}
              {state.videoMeta.width && <Chip value={state.videoMeta.aspectRatio} />}
              <Chip value={`${state.videoMeta.format} · ${state.videoMeta.size}`} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
            <Btn small onClick={() => fileRef.current?.click()}>Ganti video</Btn>
            <Btn small onClick={clearVideo} color="var(--danger)" title="Lepas video dan hasilnya">Lepas</Btn>
          </div>
        </GlassCard>
      ) : state.analysisData ? (
        <UploadBox onPick={() => fileRef.current?.click()} onDrop={handleDrop} compact />
      ) : null}

      <SceneStrip
        scenes={state.scenes}
        status={state.scenesStatus}
        selected={state.selectedScenes || []}
        sensitivity={state.sceneSensitivity || 'medium'}
        onToggle={id => set(prev => ({ selectedScenes: prev.selectedScenes.includes(id) ? prev.selectedScenes.filter(x => x !== id) : [...prev.selectedScenes, id] }))}
        onSelectAll={() => set(prev => ({ selectedScenes: prev.scenes.map(sc => sc.id) }))}
        onClear={() => set({ selectedScenes: [] })}
        onSensitivity={lvl => { set({ sceneSensitivity: lvl }); if (state.videoFile) runDetection(state.videoFile, state.videoMeta?.duration, lvl) }}
        onSeek={seekVideo}
        showSensitivity={state.advanced}
      />

      <GlassCard color={CC[3]} label="Platform tujuan">
        <PlatformPicker value={promptMode} onChange={id => set({ promptMode: id })} />
        {state.advanced && (
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
            Model/versi target (opsional)
            <input value={state.customTarget || ''} onChange={e => set({ customTarget: e.target.value })}
              placeholder="mis. Seedance 2.5, Kling 3.0, Wan 3.0" style={{ ...inputStyle, width: '100%', marginTop: 4 }} />
          </label>
        )}
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Bahasa hasil</div>
          <Seg value={state.lang || 'en'} onChange={v => set({ lang: v })} options={LANGS} label="Bahasa hasil" />
        </div>
      </GlassCard>

      {state.advanced && (
        <>
          <GlassCard color={CC[1]} label="Cara analisis">
            <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Gaya</div>
            <Seg value={state.generateMode || 'precise'} onChange={v => set({ generateMode: v })} options={GEN_MODES} label="Gaya analisis" />
            <div style={{ fontSize: 12, color: 'var(--text3)', margin: '8px 0 4px' }}>Tingkat detail</div>
            <Seg value={state.detailLevel || 'High'} onChange={v => set({ detailLevel: v })} options={DETAIL_LEVELS} label="Tingkat detail" />
            <div style={{ fontSize: 12, color: 'var(--text3)', margin: '8px 0 4px' }}>Fokus</div>
            <SelField value={state.focusArea || 'all'} onChange={v => set({ focusArea: v })} options={FOCUS_AREAS} label="Fokus analisis" />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
              <Toggle on={state.toggleCinematic} onClick={() => set({ toggleCinematic: !state.toggleCinematic })} title="Pakai istilah sinematografi: lensa, depth of field, color grade">Istilah sinematik</Toggle>
              <Toggle on={state.toggleMotion} onClick={() => set({ toggleMotion: !state.toggleMotion })} title="Jelaskan kecepatan, arah, dan easing setiap gerakan">Detail gerakan</Toggle>
              <Toggle on={state.toggleAiParams} onClick={() => set({ toggleAiParams: !state.toggleAiParams })} title="Sarankan parameter generator untuk platform tujuan">Parameter platform</Toggle>
              <Toggle on={state.markSources} color="var(--c-amber)" title="Tambahkan tanda [perkiraan] / [saran AI] di teks salinan" onClick={() => {
                const markSources = !state.markSources
                set({ markSources, analysisText: state.analysisData ? analysisToText(state.analysisData, { markSources, lang: state.lang }) : state.analysisText })
              }}>Tandai perkiraan di teks</Toggle>
            </div>
          </GlassCard>

          <LockCard lock={state.lock} set={set} />

          <BatchQueue
            disabled={!state.apiKey}
            platformName={target}
            showToast={showToast}
            runOne={async file => {
              const meta = await extractVideoMetadata(file)
              let scenes
              try { scenes = await detectScenes(file, { threshold: SENSITIVITY[state.sceneSensitivity] ?? SENSITIVITY.medium }) } catch { scenes = null }
              scenes = scenes?.length ? scenes : chunkScenes(meta.duration)
              const { data, tokens } = await analyzeFile({ file, meta, scenes, provider: state.provider, apiKey: state.apiKey, model: state.model })
              set(prev => ({ totalTokens: prev.totalTokens + tokens }))
              const text = analysisToText(data, { lang: state.lang })
              addHistory({ kind: 'batch', title: file.name, platform: target, promptMode, text, data, thumb: scenes.find(s => s.thumb)?.thumb || null })
              return { data, text, meta, scenes }
            }}
            onReview={it => { loadVideo(it.file, { meta: it.meta, scenes: it.scenes, data: it.data, text: it.text }); setSubTab('prompt') }}
          />
        </>
      )}
    </>
  )

  const analyzeBtn = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {estimate && !isMobile && (
        <div className="num" style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.45 }} title="Perkiraan kasar. Tarif per token tergantung model yang dipilih.">
          Perkiraan ±{fmtK(estimate.input)} token masuk, ±{fmtK(estimate.output)} keluar{state.generateMode === 'think' ? ' + token berpikir' : ''} · {Math.round(estimate.secs)} dtk video
        </div>
      )}
      <PrimaryBtn onClick={analyzeVideo} disabled={state.isAnalyzing}>
        {state.isAnalyzing ? <><Spin /> Menganalisis…</> : state.selectedScenes?.length ? `Analisis ${state.selectedScenes.length} adegan` : 'Analisis video'}
      </PrimaryBtn>
    </div>
  )

  // ── Panel kanan ──
  const showStart = !hasVideo && !state.analysisData
  const SUBTABS = [['prompt', 'Prompt & adegan'], ['transcript', 'Transkrip'], ['detail', 'Insight'], ['story', 'Cerita baru']]

  const rightPanel = showStart ? (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 24 }}>
      <StartScreen onPick={() => fileRef.current?.click()} onDrop={handleDrop} onGoal={pickGoal} goal={state.goal} isMobile={isMobile} />
    </div>
  ) : (
    <>
      <div role="tablist" aria-label="Hasil" style={{ display: 'flex', padding: isMobile ? '6px 12px 0' : '8px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto', gap: 2 }}>
        {SUBTABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={subTab === id} onClick={() => setSubTab(id)} style={{
            padding: '8px 12px', fontSize: 13, fontWeight: 600, border: 'none',
            background: 'none', color: subTab === id ? 'var(--text)' : 'var(--text3)',
            boxShadow: subTab === id ? 'inset 0 -2px 0 var(--accent)' : 'none',
            cursor: 'pointer', whiteSpace: 'nowrap',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isMobile && hasVideo && (
          <div style={{ borderRadius: 8, overflow: 'hidden', background: '#000' }}>
            <video ref={videoRef} src={state.videoUrl} controls playsInline style={{ width: '100%', display: 'block', maxHeight: '45vh' }}>
              {vttUrl && <track key={vttUrl} kind="subtitles" src={vttUrl} srcLang={state.transcriptLang || 'id'} label="Transkrip" default />}
            </video>
          </div>
        )}
        {state.goal && hasVideo && <GoalHint goal={state.goal} set={set} setSubTab={setSubTab} hasAnalysis={!!state.analysisData} onClose={() => set({ goal: null })} />}

        {subTab === 'prompt' && (
          <>
            {stage && <Stages stage={stage} />}
            {lastError && !stage && (
              <Note tone="error">
                Analisis gagal: {lastError}
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Btn small onClick={analyzeVideo}>Coba lagi</Btn> <span style={{ fontSize: 11 }}>Video dan pengaturan tetap tersimpan.</span></div>
              </Note>
            )}

            {!state.analysisData && !stage && !lastError && (
              <Note>
                Video siap. {state.scenes?.length ? `Terdeteksi ${state.scenes.length} adegan. ` : ''}Pilih adegan tertentu di panel {isMobile ? 'Pengaturan video' : 'kiri'} kalau tidak ingin semuanya, lalu tekan <strong>{state.selectedScenes?.length ? `Analisis ${state.selectedScenes.length} adegan` : 'Analisis video'}</strong>.
              </Note>
            )}

            {state.analysisData && !state.isAnalyzing && (
              <>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="num" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', marginRight: 'auto' }}>
                    {target} · {state.analysisData.scenes.length} adegan
                  </span>
                  <ActionBtn copied={copied.all} onClick={() => actions.copy(state.analysisText, 'all')}>Salin semua</ActionBtn>
                  <ActionBtn onClick={() => downloadText(state.analysisText || '', 'prompt.txt')} title="Unduh teks prompt (.txt)">Unduh .txt</ActionBtn>
                  <ActionBtn onClick={downloadPackage} disabled={!!pkg} title="ZIP berisi prompt per adegan, storyboard, frame, daftar shot, dan subtitle">
                    {pkg ? <><Spin /> {pkg}…</> : 'Paket produksi (ZIP)'}
                  </ActionBtn>
                </div>

                {/* Langkah berikutnya */}
                <GlassCard color={CC[0]} label="Lanjutkan dengan hasil ini">
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Btn small onClick={() => actions.toVariation(state.analysisText)}>Buat variasi</Btn>
                    <Btn small onClick={() => actions.toEditor(state.analysisData.scenes)} disabled={!hasVideo}>Semua adegan ke Editor</Btn>
                    <Btn small onClick={compareModels} disabled={compare === 'busy' || !hasVideo} title={`Jalankan analisis yang sama dengan ${otherName} (${DEFAULT_MODEL[otherProvider]})`}>
                      {compare === 'busy' ? <><Spin /> Menjalankan {otherName}…</> : `Bandingkan dengan ${otherName}`}
                    </Btn>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Ubah ke platform lain tanpa analisis ulang:</span>
                    <SelField value={adaptTo} onChange={setAdaptTo} label="Platform hasil adaptasi" style={{ minWidth: 150 }}
                      options={[{ value: '', label: 'Pilih platform' }, ...PLATFORM_IDS.filter(id => id !== promptMode).map(id => ({ value: id, label: VIDEO_PLATFORMS[id].name }))]} />
                    <Btn small onClick={adaptPlatform} disabled={!adaptTo || adapting}>{adapting ? <><Spin /> Menyesuaikan…</> : 'Sesuaikan'}</Btn>
                  </div>
                  <form onSubmit={e => { e.preventDefault(); if (reviseText.trim()) revise(null, reviseText.trim()).then(ok => ok && setReviseText('')) }}
                    style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    <input value={reviseText} onChange={e => setReviseText(e.target.value)} aria-label="Instruksi revisi seluruh hasil"
                      placeholder="Revisi semua adegan, mis. pertahankan objek, ubah latar jadi studio" style={{ ...inputStyle, flex: '1 1 240px' }} />
                    <Btn type="submit" small disabled={!reviseText.trim() || !!revising}>{revising === 'all' ? <><Spin /> Merevisi…</> : 'Revisi semua'}</Btn>
                  </form>
                </GlassCard>

                {compare && compare !== 'busy' && (
                  <GlassCard color={CC[1]} label={`Perbandingan: ${state.provider === 'claude' ? 'Claude' : 'Gemini'} dan ${otherName}`}
                    right={<Btn small onClick={() => setCompare(null)}>Tutup</Btn>}>
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                      <div>
                        <CardLabel style={{ marginBottom: 4 }}>Sekarang ({state.model})</CardLabel>
                        <OutputBox content={state.analysisText} minH={160} style={{ maxHeight: 340, fontSize: 12 }} />
                      </div>
                      <div>
                        <CardLabel style={{ marginBottom: 4 }}>{otherName} ({compare.model})</CardLabel>
                        <OutputBox content={compare.text} minH={160} style={{ maxHeight: 340, fontSize: 12 }} />
                        <Btn small style={{ marginTop: 6 }} onClick={() => { setAnalysis(compare.data); saveHistory('analyze', compare.data, { platform: `${target} · ${otherName}` }); setCompare(null); showToast(`Memakai hasil ${otherName}`) }}>Pakai hasil {otherName}</Btn>
                      </div>
                    </div>
                  </GlassCard>
                )}

                <div>
                  <input value={query} onChange={e => setQuery(e.target.value)} type="search" aria-label="Cari di video"
                    placeholder="Cari di video, mis. saat produk ditampilkan, tertawa, close-up" style={{ ...inputStyle, width: '100%', fontSize: 13 }} />
                  {query.trim().length >= 2 && (
                    <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 220, overflowY: 'auto' }}>
                      {!results.length && <div style={{ fontSize: 12, color: 'var(--text3)' }}>Tidak ditemukan di hasil analisis{state.transcript?.length ? ' maupun transkrip' : ' (transkrip belum dibuat)'}.</div>}
                      {results.map((r, i) => (
                        <button key={i} type="button" onClick={() => seekVideo(r.t)} style={{ display: 'flex', gap: 8, alignItems: 'baseline', textAlign: 'left', padding: '5px 8px', background: tint('var(--paper)', 70), border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', fontSize: 12, minWidth: 0 }}>
                          <span className="num" style={{ fontFamily: 'var(--mono)', color: 'var(--accent)', flexShrink: 0 }}>{fmtTime(r.t, 0)}</span>
                          <span style={{ color: 'var(--text3)', flexShrink: 0 }}>{r.kind}</span>
                          <span style={{ color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{r.text}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <AnalysisEditor
                  data={state.analysisData}
                  thumbs={Object.fromEntries((state.scenes || []).filter(sc => sc.thumb).map(sc => [sc.id, sc.thumb]))}
                  onChange={data => setAnalysis(data)}
                  onRegenScene={regenScene}
                  busyScene={busyScene}
                  onSeek={seekVideo}
                  platform={{ promptMode, customTarget: state.customTarget }}
                  actions={actions}
                />

                <details>
                  <summary style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Teks lengkap ({(state.analysisText?.length || 0).toLocaleString('id-ID')} karakter)</summary>
                  <OutputBox content={state.analysisText} minH={160} style={{ maxHeight: 420, marginTop: 6 }} />
                </details>
              </>
            )}
          </>
        )}

        {subTab === 'transcript' && (
          <TranscriptPanel state={state} set={set} showToast={showToast} videoRef={videoRef} />
        )}

        {subTab === 'detail' && (
          !state.analysisText
            ? <Note>Jalankan analisis dulu. Insight dibuat dari hasil analisis, bukan dari data tren platform.</Note>
            : <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>Judul, caption, hashtag, dan musik untuk {target}</span>
                  <Btn onClick={generateInsight} disabled={isGenInsight} active color="var(--accent)">
                    {isGenInsight ? <><Spin /> Membuat…</> : insightData ? 'Buat ulang insight' : 'Buat insight'}
                  </Btn>
                </div>
                {insightData
                  ? <InsightPanel data={insightData} copy={actions.copy} copied={copied} />
                  : <Note>Hasilnya: 5 judul dengan gaya berbeda, caption pendek/sedang/panjang, hashtag, saran jam posting, rekomendasi musik, dan versi untuk TikTok, Instagram, YouTube, X.</Note>}
              </>
        )}

        {subTab === 'story' && (
          <>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ flex: '2 1 200px', fontSize: 12, color: 'var(--text3)' }}>
                Judul cerita
                <input value={storyTitle} placeholder="Judul video baru" onChange={e => setStoryTitle(e.target.value)} style={{ ...inputStyle, width: '100%', marginTop: 4, fontSize: 13 }} />
              </label>
              <div style={{ flex: '1 1 140px' }}>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Jenis</div>
                <SelField value={storyType} onChange={setStoryType} label="Jenis cerita" options={[
                  { value: 'viral', label: 'Viral' }, { value: 'cinematic', label: 'Sinematik' }, { value: 'documentary', label: 'Dokumenter' }, { value: 'emotional', label: 'Emosional' },
                ]} />
              </div>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>Jumlah klip</div>
                <Seg value={clipCount} onChange={setClipCount} label="Jumlah klip" options={[2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} />
              </div>
            </div>
            <PrimaryBtn onClick={generateNewStory} disabled={isGenStory || !state.analysisText}>
              {isGenStory ? <><Spin /> Menulis cerita…</> : 'Tulis cerita baru dari video ini'}
            </PrimaryBtn>
            {!state.analysisText && <Note>Cerita baru memakai tampilan, subjek, dan suasana dari hasil analisis. Jalankan analisis dulu.</Note>}
            {storyOutput && (
              <GlassCard color={CC[1]} label="Cerita baru">
                <OutputBox content={storyOutput} minH={180} />
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <ActionBtn copied={copied.story} onClick={() => actions.copy(storyOutput, 'story')}>Salin</ActionBtn>
                  <ActionBtn onClick={() => downloadText(storyOutput, 'cerita.txt')}>Unduh .txt</ActionBtn>
                  <ActionBtn onClick={() => actions.toVariation(storyOutput)}>Kirim ke Variasi</ActionBtn>
                </div>
              </GlassCard>
            )}
          </>
        )}
      </div>
    </>
  )

  return (
    <>
      {fileInput}
      <MobileLayout
        isMobile={isMobile}
        leftPanel={leftPanel}
        rightPanel={rightPanel}
        analyzeBtn={showStart && isMobile ? null : analyzeBtn}
        drawerLabel="Pengaturan video"
      />
    </>
  )
}

const fmtK = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} rb` : String(n)

function PlatformPicker({ value, onChange }) {
  const groups = {}
  Object.entries(VIDEO_PLATFORMS).forEach(([id, p]) => { (groups[p.group] ||= []).push([id, p]) })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {Object.entries(groups).map(([g, list]) => (
        <div key={g} role="radiogroup" aria-label={`Platform ${g}`} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text3)', width: 56 }}>{g}</span>
          {list.map(([id, p]) => {
            const on = value === id
            return (
              <button key={id} type="button" role="radio" aria-checked={on} onClick={() => onChange(id)} style={{
                padding: '5px 9px', fontSize: 12, fontWeight: 600,
                background: on ? tint('var(--c-violet)', 10) : tint('var(--paper)', 60),
                border: `1px solid ${on ? 'var(--c-violet)' : tint('var(--tint)', 18)}`,
                color: on ? 'var(--c-violet)' : 'var(--text2)', borderRadius: 6, cursor: 'pointer',
              }}>{p.name}</button>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function UploadBox({ onPick, onDrop, compact }) {
  const [over, setOver] = useState(false)
  return (
    <div {...pressable(onPick)} aria-label="Pilih file video"
      onDragOver={e => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={e => { setOver(false); onDrop(e) }}
      style={{
        borderRadius: 'var(--radius)', border: `1.5px dashed ${over ? 'var(--accent)' : 'var(--border2)'}`,
        background: over ? tint('var(--accent)', 6) : 'var(--paper)', cursor: 'pointer',
        padding: compact ? '16px 12px' : '34px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      }}>
      <Icon name="upload" size={compact ? 22 : 30} style={{ color: 'var(--accent)' }} />
      <div style={{ fontSize: compact ? 13 : 16, fontWeight: 650, color: 'var(--text)' }}>Unggah video</div>
      <div style={{ fontSize: 12, color: 'var(--text3)' }}>Klik atau seret file ke sini · MP4, MOV, WEBM</div>
    </div>
  )
}

function StartScreen({ onPick, onDrop, onGoal, goal, isMobile }) {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.2, color: 'var(--text)', textWrap: 'balance' }}>
          Ubah video referensi jadi prompt yang siap dipakai
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text2)', marginTop: 6, maxWidth: '60ch', lineHeight: 1.6 }}>
          Unggah video, aplikasi memotongnya per adegan, lalu AI menulis prompt untuk tiap adegan. Setiap bagian diberi label: terlihat di video, perkiraan, atau saran AI.
        </p>
      </div>
      <UploadBox onPick={onPick} onDrop={onDrop} />
      <div>
        <h2 style={{ fontSize: 15, fontWeight: 650, color: 'var(--text)', marginBottom: 8 }}>Apa yang ingin kamu buat?</h2>
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {GOALS.map(g => {
            const on = goal === g.id
            return (
              <button key={g.id} type="button" onClick={() => onGoal(g.id)} aria-pressed={on} style={{
                textAlign: 'left', padding: '11px 12px', borderRadius: 'var(--radius)', cursor: 'pointer',
                background: on ? tint('var(--accent)', 8) : 'var(--paper)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              }}>
                <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text)' }}>{g.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 3, lineHeight: 1.5 }}>{g.desc}</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function GoalHint({ goal, set, setSubTab, hasAnalysis, onClose }) {
  const text = {
    camera: hasAnalysis ? 'Gerakan kamera ada di kolom Kamera dan detail per 2 detik di tiap adegan.' : 'Fokus diatur ke gerakan & kamera. Tekan Analisis video.',
    product: 'Isi Kunci konsistensi (produk, warna) di panel pengaturan supaya setiap adegan memakai deskripsi produk yang sama.',
    subtitle: 'Buka tab Transkrip, buat transkrip, koreksi bila perlu, lalu unduh SRT atau VTT.',
    highlight: 'Analisis atau transkrip membuat highlight lebih akurat. Setelah itu buka Editor dan pilih Susun highlight otomatis.',
  }[goal]
  if (!text) return null
  return (
    <Note>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 200 }}>{text}</span>
        {goal === 'subtitle' && <Btn small onClick={() => setSubTab('transcript')}>Buka Transkrip</Btn>}
        {goal === 'highlight' && <Btn small onClick={() => set({ activeTab: 'editor' })}>Buka Editor</Btn>}
        <Btn small onClick={onClose} aria-label="Tutup petunjuk">Tutup</Btn>
      </div>
    </Note>
  )
}

function Stages({ stage }) {
  const idx = stage.steps.indexOf(stage.current)
  return (
    <ol aria-live="polite" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14 }}>
      {stage.steps.map((st, i) => {
        const s = i < idx ? 'done' : i === idx ? 'now' : 'next'
        return (
          <li key={st} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: s === 'next' ? 'var(--text3)' : 'var(--text)', fontWeight: s === 'now' ? 650 : 400 }}>
            <span aria-hidden style={{ width: 18, textAlign: 'center', color: s === 'done' ? 'var(--c-green)' : 'var(--accent)' }}>{s === 'done' ? '✓' : s === 'now' ? <Spin /> : '·'}</span>
            {STAGES[st]}
            {s === 'now' && st === 'generate' && <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400 }}>biasanya 20–90 detik</span>}
          </li>
        )
      })}
    </ol>
  )
}

// ─── Insight ──────────────────────────────────────────────────────────────────
function Row({ children }) {
  return <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7 }}>{children}</div>
}
function Sub({ children }) {
  return <div style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600, marginBottom: 4 }}>{children}</div>
}

function InsightPanel({ data, copy, copied }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Note tone="warn">
        Semua isi Insight adalah saran AI dari isi video, bukan data tren atau statistik platform.
        Jam posting, potensi viral, dan sound "trending" belum dicek ke TikTok, Instagram, atau YouTube.
      </Note>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <ActionBtn copied={copied.insight} onClick={() => copy(JSON.stringify(data, null, 2), 'insight')}>Salin semua (JSON)</ActionBtn>
        <ActionBtn onClick={() => downloadText(JSON.stringify(data, null, 2), 'insight.json', 'application/json')}>Unduh JSON</ActionBtn>
      </div>

      {data.viralTitles?.length > 0 && (
        <GlassCard color={CC[0]} label="Judul" right={<ActionBtn small copied={copied.vtAll} onClick={() => copy(data.viralTitles.map((t, i) => `${i + 1}. ${t}`).join('\n'), 'vtAll')}>Salin semua</ActionBtn>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.viralTitles.map((t, i) => (
              <Row key={i}>
                <span className="num" style={{ fontSize: 12, fontFamily: 'var(--mono)', color: 'var(--text3)', minWidth: 16 }}>{i + 1}</span>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, lineHeight: 1.5 }}>{t}</span>
                <ActionBtn small copied={copied['vt' + i]} onClick={() => copy(t, 'vt' + i)}>Salin</ActionBtn>
              </Row>
            ))}
          </div>
        </GlassCard>
      )}
      {data.titles?.length > 0 && (
        <GlassCard color={CC[0]} label="Judul per gaya">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.titles.map((t, i) => (
              <Row key={i}>
                <span style={{ fontSize: 11, color: 'var(--text2)', background: tint('var(--tint)', 10), padding: '2px 6px', borderRadius: 4, fontWeight: 650, whiteSpace: 'nowrap', marginTop: 1 }}>{t.style}</span>
                <span style={{ fontSize: 13, color: 'var(--text)', flex: 1 }}>{t.text}</span>
                <ActionBtn small copied={copied['title' + i]} onClick={() => copy(t.text, 'title' + i)}>Salin</ActionBtn>
              </Row>
            ))}
          </div>
        </GlassCard>
      )}
      {data.descriptions && (
        <GlassCard color={CC[1]} label="Caption">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[['short', 'Pendek'], ['medium', 'Sedang'], ['long', 'Panjang']].map(([key, label]) => data.descriptions[key] && (
              <div key={key} style={{ background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Sub>{label}</Sub>
                  <ActionBtn small copied={copied['desc' + key]} onClick={() => copy(data.descriptions[key], 'desc' + key)}>Salin</ActionBtn>
                </div>
                <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{data.descriptions[key]}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
      {data.hashtags && (
        <GlassCard color={CC[3]} label="Hashtag">
          {[['niche', 'Niche'], ['broad', 'Umum'], ['trending', 'Populer (saran AI)'], ['branded', 'Merek']].map(([key, label]) => data.hashtags[key]?.length > 0 && (
            <div key={key} style={{ marginBottom: 8 }}>
              <Sub>{label}</Sub>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {data.hashtags[key].map((tag, j) => (
                  <button type="button" key={j} title="Salin hashtag" onClick={() => copy(tag, 'htag' + key + j)} style={{ fontSize: 12, color: 'var(--text2)', background: tint('var(--paper)', 70), border: '1px solid var(--border2)', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }}>{tag}</button>
                ))}
                <ActionBtn small copied={copied['htags' + key]} onClick={() => copy(data.hashtags[key].join(' '), 'htags' + key)}>Salin semua</ActionBtn>
              </div>
            </div>
          ))}
        </GlassCard>
      )}
      {data.postingStrategy && (
        <GlassCard color={CC[2]} label="Strategi posting (perkiraan AI)">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {[['Saran jam posting', data.postingStrategy.bestTime], ['Frekuensi', data.postingStrategy.frequency], ['Pilar konten', data.postingStrategy.contentPillar], ['Perkiraan potensi viral', data.postingStrategy.viralPotential]].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} style={{ background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px' }}>
                <Sub>{k}</Sub>
                <div style={{ fontSize: 13, color: 'var(--text)' }}>{String(v)}</div>
              </div>
            ))}
          </div>
          {data.postingStrategy.viralReason && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text2)' }}>Alasan: {data.postingStrategy.viralReason}</div>}
        </GlassCard>
      )}
      {data.soundtrack && (
        <GlassCard color={CC[1]} label="Musik latar">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[['Genre', data.soundtrack.genre], ['Mood', data.soundtrack.mood], ['Tempo', data.soundtrack.tempo]].filter(([, v]) => v).map(([k, v]) => (
                <div key={k} style={{ background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7, padding: '6px 12px' }}>
                  <Sub>{k}</Sub>
                  <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 600 }}>{String(v)}</div>
                </div>
              ))}
            </div>
            {data.soundtrack.instruments && <div><Sub>Instrumen / elemen</Sub><div style={{ fontSize: 13 }}>{data.soundtrack.instruments}</div></div>}
            {data.soundtrack.references?.length > 0 && (
              <div>
                <Sub>Referensi artis / lagu (saran AI, cek lisensi)</Sub>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {data.soundtrack.references.map((r, i) => <span key={i} style={{ fontSize: 12, color: 'var(--text2)', border: '1px solid var(--border2)', borderRadius: 6, padding: '3px 9px' }}>{r}</span>)}
                </div>
              </div>
            )}
            {data.soundtrack.tiktokSound && (
              <Row>
                <div style={{ flex: 1 }}><Sub>Saran sound TikTok (belum dicek tren)</Sub><div style={{ fontSize: 13 }}>{data.soundtrack.tiktokSound}</div></div>
                <ActionBtn small copied={copied.tiktokSound} onClick={() => copy(data.soundtrack.tiktokSound, 'tiktokSound')}>Salin</ActionBtn>
              </Row>
            )}
            {data.soundtrack.royaltyFree && (
              <Row>
                <div style={{ flex: 1 }}><Sub>Kata kunci musik bebas royalti</Sub><div style={{ fontSize: 13 }}>{data.soundtrack.royaltyFree}</div></div>
                <ActionBtn small copied={copied.rfSound} onClick={() => copy(data.soundtrack.royaltyFree, 'rfSound')}>Salin</ActionBtn>
              </Row>
            )}
          </div>
        </GlassCard>
      )}
      {data.crossPlatform && (
        <GlassCard color={CC[5]} label="Versi per platform">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[['tiktok', 'TikTok'], ['instagram', 'Instagram'], ['youtube', 'YouTube'], ['twitter', 'X / Twitter']].map(([key, label]) => data.crossPlatform[key] && (
              <Row key={key}>
                <div style={{ flex: 1 }}><Sub>{label}</Sub><div style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{data.crossPlatform[key]}</div></div>
                <ActionBtn small copied={copied['cp' + key]} onClick={() => copy(data.crossPlatform[key], 'cp' + key)}>Salin</ActionBtn>
              </Row>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  )
}
