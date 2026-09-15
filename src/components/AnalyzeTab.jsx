import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import {
  callAI, parseJsonResponse,
  buildInsightPrompt,
  extractVideoMetadata, PLATFORM_CONFIGS
} from '../utils/gemini'
import { detectScenes, chunkScenes, sampleTimes, SENSITIVITY } from '../utils/media'
import {
  buildStructuredPrompt, normalizeAnalysis, normalizeScenePatch, analysisToText,
  analysisContext, countMissing, toVTT,
} from '../utils/analysis'
import MobileLayout from './MobileLayout'
import SceneStrip from './SceneStrip'
import AnalysisEditor from './AnalysisEditor'
import TranscriptPanel from './TranscriptPanel'
import { pressable } from './ui'

const PLATFORMS = Object.entries(PLATFORM_CONFIGS).map(([id, cfg]) => ({
  id, label: cfg.name.split(' ')[0], fullName: cfg.name, color: cfg.color, bg: `${cfg.color}1a`
}))

const GEN_MODES = [
  { id: 'precise',  label: '🎯 Precise',    desc: 'Technical exact' },
  { id: 'creative', label: '✨ Creative',   desc: 'Evocative style' },
  { id: 'think',    label: '🧠 Deep Think', desc: 'Extended reasoning' },
  { id: 'vulgar',   label: '🔞 Vulgar',     desc: 'Adult/explicit', danger: true },
]
const DETAIL_LEVELS = ['Normal', 'High', 'Ultra']
const FOCUS_AREAS = [
  { value: 'all', label: 'All Elements' }, { value: 'motion', label: 'Motion & Camera' },
  { value: 'visual', label: 'Visual Style' }, { value: 'subject', label: 'Subject Focus' },
  { value: 'mood', label: 'Mood & Atmosphere' }, { value: 'env', label: 'Environment' },
]
const CC = [
  { bg: 'rgba(79,126,247,0.08)',  border: 'rgba(79,126,247,0.2)',  accent: '#0a47e2' },
  { bg: 'rgba(155,107,245,0.08)', border: 'rgba(155,107,245,0.2)', accent: '#661cf0' },
  { bg: 'rgba(24,201,138,0.08)',  border: 'rgba(24,201,138,0.2)',  accent: '#0c6747' },
  { bg: 'rgba(245,166,35,0.08)',  border: 'rgba(245,166,35,0.2)',  accent: '#7e5106' },
  { bg: 'rgba(240,82,138,0.08)',  border: 'rgba(240,82,138,0.2)',  accent: '#ac0f47' },
  { bg: 'rgba(255,120,60,0.08)',  border: 'rgba(255,120,60,0.2)',  accent: '#a23200' },
]

// Deteksi adegan tetap berjalan walau tab ditinggal; token mencegah hasil
// deteksi video lama menimpa video baru.
let detectToken = 0

export default function AnalyzeTab({ state, set, showToast, isMobile }) {
  const fileRef = useRef(null)
  const videoRef = useRef(null)
  const [subTab, setSubTab]         = useState('prompt')
  const [clipCount, setClipCount]   = useState(3)
  const [storyType, setStoryType]   = useState('viral')
  const [selectedTitle, setSelectedTitle] = useState('')
  const [storyOutput, setStoryOutput]     = useState('')
  const [isGenStory, setIsGenStory]       = useState(false)
  const [insightData, setInsightData]     = useState(null)
  const [isGenInsight, setIsGenInsight]   = useState(false)
  const [copied, setCopied]               = useState({})
  const [busyScene, setBusyScene]         = useState(null)

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('video/')) loadVideo(file)
  }, [state.videoUrl])

  // Subtitle transkrip langsung tampil di pemutar video
  const vttUrl = useMemo(() => (
    state.subtitleOnVideo && state.transcript?.length
      ? URL.createObjectURL(new Blob([toVTT(state.transcript)], { type: 'text/vtt' }))
      : null
  ), [state.transcript, state.subtitleOnVideo])
  useEffect(() => () => { if (vttUrl) URL.revokeObjectURL(vttUrl) }, [vttUrl])

  async function loadVideo(file) {
    if (!file) return
    if (state.videoUrl) URL.revokeObjectURL(state.videoUrl)
    const url = URL.createObjectURL(file)
    const meta = await extractVideoMetadata(file)
    set({
      videoFile: file, videoUrl: url, videoMeta: meta, analysisData: null, analysisText: null,
      scenes: chunkScenes(meta.duration), selectedScenes: [], transcript: [],
    })
    runDetection(file, meta.duration, state.sceneSensitivity)
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
    set({ videoFile: null, videoUrl: null, videoMeta: null, analysisData: null, analysisText: null, scenes: [], selectedScenes: [], transcript: [], scenesStatus: null })
  }

  function seekVideo(t) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = t
    v.play().catch(() => {})
  }

  const promptOpts = () => ({
    lang: state.lang || 'en', promptMode: state.promptMode || 'douyin',
    generateMode: state.generateMode || 'precise',
    cinematic: state.toggleCinematic, motionAnalysis: state.toggleMotion,
    aiParams: state.toggleAiParams, focusArea: state.focusArea || 'all',
    detailLevel: state.detailLevel || 'Ultra', videoMeta: state.videoMeta,
    transcript: state.transcript, framesOnly: state.provider === 'claude',
  })
  const callOpts = () => ({
    provider: state.provider, apiKey: state.apiKey, model: state.model,
    mediaFile: state.videoFile, mimeType: state.videoFile.type || 'video/mp4',
    temperature: state.generateMode === 'creative' ? 0.95 : parseFloat(state.temperature) || 0.7,
    maxTokens: parseInt(state.maxTokens) || 32768,
    thinkingMode: state.generateMode === 'think', json: true,
  })
  const resolutionLabel = () => state.videoMeta?.width ? `${state.videoMeta.aspectRatio} (${state.videoMeta.width}x${state.videoMeta.height})` : ''

  function setAnalysis(data, extra = {}) {
    set({ analysisData: data, analysisText: analysisToText(data, { markSources: state.markSources, lang: state.lang }), ...extra })
  }

  async function analyzeVideo() {
    if (!state.videoFile) return showToast('Upload video dulu!', true)
    if (!state.apiKey)    return showToast('Masukkan API key!', true)
    const all = state.scenes?.length ? state.scenes : chunkScenes(state.videoMeta?.duration)
    const picked = state.selectedScenes?.length ? all.filter(sc => state.selectedScenes.includes(sc.id)) : all
    const clip = picked.length < all.length
      ? { start: Math.min(...picked.map(sc => sc.start)), end: Math.max(...picked.map(sc => sc.end)) }
      : null
    set({ isAnalyzing: true })
    setInsightData(null)
    try {
      const prompt = buildStructuredPrompt({ ...promptOpts(), scenes: picked, clip })
      const { text, tokens, truncated } = await callAI({
        ...callOpts(), prompt, clip,
        frameTimes: sampleTimes(picked, { every: 2, max: 40 }),
      })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      const parsed = parseJsonResponse(text)
      if (!parsed) {
        throw new Error(truncated
          ? 'Output terlalu panjang dan terpotong. Pilih lebih sedikit adegan atau turunkan Detail Level.'
          : 'Respons AI bukan JSON yang valid. Coba lagi.')
      }
      const data = normalizeAnalysis(parsed, picked, { aiParams: state.toggleAiParams, resolution: resolutionLabel() })
      setAnalysis(data)
      showToast(data.missing ? `Selesai, tapi ${data.missing} bagian kosong. Cek hasilnya` : `Analisis ${picked.length} adegan selesai! ✓`, !!data.missing)
    } catch (e) { showToast('Error: ' + e.message, true) }
    set({ isAnalyzing: false })
  }

  async function regenScene(id) {
    const data = state.analysisData
    const target = data?.scenes.find(sc => sc.id === id)
    if (!target || !state.videoFile) return
    if (!state.apiKey) return showToast('Masukkan API key!', true)
    const scene = { id: target.id, start: target.start, end: target.end }
    setBusyScene(id)
    try {
      const prompt = buildStructuredPrompt({ ...promptOpts(), mode: 'scene', scenes: [scene], clip: scene, globalContext: analysisContext(data) })
      const { text, tokens } = await callAI({ ...callOpts(), prompt, clip: scene, frameTimes: sampleTimes([scene], { every: 1.5, max: 12 }) })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons AI bukan JSON yang valid.')
      const patch = normalizeScenePatch(parsed, scene)
      const next = { ...state.analysisData, scenes: state.analysisData.scenes.map(sc => sc.id === id ? patch : sc) }
      next.missing = countMissing(next)
      setAnalysis(next, { totalTokens: state.totalTokens + tokens })
      showToast('Adegan diperbarui ✓')
    } catch (e) { showToast('Error: ' + e.message, true) }
    setBusyScene(null)
  }

  const thumbs = useMemo(() => Object.fromEntries((state.scenes || []).filter(sc => sc.thumb).map(sc => [sc.id, sc.thumb])), [state.scenes])

  async function generateInsight() {
    if (!state.analysisText) return showToast('Analyze video dulu!', true)
    if (!state.apiKey)       return showToast('Masukkan API key!', true)
    setIsGenInsight(true)
    try {
      const prompt = buildInsightPrompt({
        analysisData: { mainPrompt: state.analysisText },
        platform: state.promptMode || 'douyin',
        lang: state.lang || 'en',
        videoMeta: state.videoMeta,
      })
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: 0.8, json: true })
      const parsed = parseJsonResponse(text)
      if (parsed) {
        setInsightData(parsed)
        set(prev => ({ totalTokens: prev.totalTokens + tokens }))
        showToast('Insight berhasil! ✓')
      } else { showToast('Gagal parse insight', true) }
    } catch (e) { showToast('Error: ' + e.message, true) }
    setIsGenInsight(false)
  }

  async function generateNewStory() {
    if (!state.analysisText) return showToast('Analyze video dulu!', true)
    if (!state.apiKey) return showToast('Masukkan API key!', true)
    const title = selectedTitle.trim() || 'Untitled'
    const type  = storyType
    setIsGenStory(true)
    try {
      const platformName = PLATFORM_CONFIGS[state.promptMode]?.name || state.promptMode
      const langInstr = state.lang === 'id' ? 'Write narration and titles in Bahasa Indonesia; scene prompts in English.'
        : state.lang === 'bi' ? 'Write narration in Bahasa Indonesia, scene prompts in English.' : 'Write everything in English.'
      const prompt = `You are a short-form video director and AI video prompt engineer for ${platformName}.

<video_analysis>
${state.analysisText}
</video_analysis>

Create a NEW ${type}-style video story titled "${title}", told in exactly ${clipCount} clips, that keeps the look, subject and atmosphere of the analyzed video but tells a fresh story.
${langInstr}

The story needs a hook in clip 1, rising tension or curiosity in the middle, and a satisfying payoff or twist in the final clip. Keep the same character appearance, wardrobe, location style and color grade in every clip so the clips cut together seamlessly.

Plain text only, no asterisks or markdown. For each clip use exactly:

CLIP N [start-end s]
Scene Prompt : a complete, ready-to-paste ${platformName} prompt (subject, action, environment, camera, lighting, style)
Narration : voice-over or on-screen text
Camera : shot type and movement
Sound : music and sound effects
Transition : how it cuts to the next clip`
      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: 0.85 })
      setStoryOutput(text)
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      showToast('Story berhasil!')
    } catch (e) { showToast('Error: ' + e.message, true) }
    setIsGenStory(false)
  }

  function copy(text, key) {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(p => ({ ...p, [key]: true }))
      setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 2000)
      showToast('Disalin!')
    })
  }
  function exportTxt(content, name) {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
    a.download = name; a.click()
  }

  const curPlatform = PLATFORMS.find(p => p.id === (state.promptMode || 'douyin'))
  const isVulgar = state.generateMode === 'vulgar'

  // ── Left panel JSX ──
  const leftPanel = (
    <>
      <GlassCard color={CC[0]} label="Video Input">
        <div {...(state.videoUrl ? {} : { ...pressable(() => fileRef.current?.click()), 'aria-label': 'Pilih file video' })}
          onDragOver={e => e.preventDefault()} onDrop={handleDrop}
          style={{ borderRadius:10, overflow:'hidden', cursor:state.videoUrl?'default':'pointer', border:`1.5px dashed ${state.videoUrl?'#0c6747':'rgba(100,120,220,0.25)'}`, background:'rgba(255,255,255,0.5)', minHeight:state.videoUrl?'auto':90, display:'flex', alignItems:'center', justifyContent:'center' }}>
          {state.videoUrl
            ? <video ref={videoRef} src={state.videoUrl} controls style={{ width:'100%', display:'block', maxHeight:360, background:'#000' }}>
                {vttUrl && <track key={vttUrl} kind="subtitles" src={vttUrl} srcLang={state.transcriptLang || 'id'} label="Transkrip" default />}
              </video>
            : <div style={{ textAlign:'center', padding:16 }}>
                <div style={{ fontSize:22, opacity:0.4 }}>🎬</div>
                <div style={{ fontSize:11, color:'var(--text2)', marginTop:4 }}>Drop video or click</div>
                <div style={{ fontSize:10, color:'var(--text3)', marginTop:2 }}>MP4 · MOV · AVI · WEBM</div>
              </div>
          }
        </div>
        <input type="file" ref={fileRef} accept="video/*" style={{ display:'none' }} onChange={e => loadVideo(e.target.files[0])} />
        {state.videoMeta && (
          <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:5 }}>
            <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
              <Chip label="Fmt"  value={state.videoMeta.format}            color="#0c6747" />
              <Chip label="Size" value={state.videoMeta.size}              color="#7e5106" />
              <Chip label="Dur"  value={state.videoMeta.durationFormatted} color="#0a47e2" />
              <button onClick={clearVideo}
                style={{ marginLeft:'auto', fontSize:10, background:'rgba(232,48,74,0.08)', border:'1px solid rgba(232,48,74,0.25)', color:'var(--danger)', borderRadius:6, padding:'3px 8px', cursor:'pointer' }}>✕</button>
            </div>
            {state.videoMeta.width && (
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                <Chip label="Res"   value={`${state.videoMeta.width}×${state.videoMeta.height}`} color="#661cf0" />
                <Chip label="Ratio" value={state.videoMeta.aspectRatio} color="#ac0f47" />
                <Chip value={state.videoMeta.orientation} color="#a23200" />
              </div>
            )}
          </div>
        )}
      </GlassCard>

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
      />

      <GlassCard color={CC[3]} label="Platform">
        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => set({ promptMode:p.id })} style={{
              padding:'5px 11px', fontSize:11, fontWeight:600,
              background:(state.promptMode||'douyin')===p.id ? p.bg : 'rgba(255,255,255,0.5)',
              border:`1.5px solid ${(state.promptMode||'douyin')===p.id ? p.color : 'rgba(100,120,220,0.15)'}`,
              color:(state.promptMode||'douyin')===p.id ? p.color : 'var(--text2)',
              borderRadius:8, cursor:'pointer',
            }}>{p.label}</button>
          ))}
        </div>
      </GlassCard>

      <GlassCard color={CC[1]} label="Generate Mode">
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {GEN_MODES.map(m => (
            <button key={m.id} onClick={() => set({ generateMode:m.id })} style={{
              padding:'7px 10px', fontSize:11, fontWeight:500, textAlign:'left',
              background:(state.generateMode||'precise')===m.id ? (m.danger?'rgba(232,48,74,0.12)':'rgba(155,107,245,0.12)') : 'rgba(255,255,255,0.45)',
              border:`1.5px solid ${(state.generateMode||'precise')===m.id ? (m.danger?'#ae1329':'#661cf0') : 'rgba(100,120,220,0.15)'}`,
              color:(state.generateMode||'precise')===m.id ? (m.danger?'#ae1329':'#661cf0') : 'var(--text2)',
              borderRadius:9, cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center',
            }}>
              <span>{m.label}</span>
              <span style={{ fontSize: 11, color:'var(--text3)', fontWeight:400 }}>{m.desc}</span>
            </button>
          ))}
        </div>
        {isVulgar && <div style={{ marginTop:6, padding:'5px 8px', background:'rgba(232,48,74,0.08)', border:'1px solid rgba(232,48,74,0.2)', borderRadius:6, fontSize:10, color:'#ae1329' }}>🔞 Mode aktif: output tidak disensor</div>}
      </GlassCard>

      <GlassCard color={CC[4]} label="Detail Level">
        <div style={{ display:'flex', gap:5 }}>
          {DETAIL_LEVELS.map(d => (
            <button key={d} onClick={() => set({ detailLevel:d })} style={{
              flex:1, padding:'5px 0', fontSize:11, fontWeight:600,
              background:(state.detailLevel||'Ultra')===d ? 'rgba(240,82,138,0.12)' : 'rgba(255,255,255,0.45)',
              border:`1.5px solid ${(state.detailLevel||'Ultra')===d ? '#ac0f47' : 'rgba(100,120,220,0.15)'}`,
              color:(state.detailLevel||'Ultra')===d ? '#ac0f47' : 'var(--text2)',
              borderRadius:8, cursor:'pointer',
            }}>{d}</button>
          ))}
        </div>
      </GlassCard>

      <GlassCard color={CC[5]} label="Settings">
        <div style={{ marginBottom:8 }}>
          <div style={{ fontSize:10, color:'var(--text3)', marginBottom:4 }}>Focus Area</div>
          <SelField value={state.focusArea||'all'} onChange={v => set({ focusArea:v })} options={FOCUS_AREAS} />
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginBottom:8 }}>
          {[['toggleCinematic','Cinematic'],['toggleMotion','Motion'],['toggleAiParams','AI Params']].map(([key,label]) => (
            <button key={key} onClick={() => set({ [key]:!state[key] })} style={{
              padding:'3px 9px', fontSize:10, fontWeight:500,
              background:state[key]?'rgba(24,201,138,0.12)':'rgba(255,255,255,0.45)',
              border:`1px solid ${state[key]?'#0c6747':'rgba(100,120,220,0.15)'}`,
              color:state[key]?'#0c6747':'var(--text3)', borderRadius:20, cursor:'pointer',
            }}>{state[key]?'✓ ':''}{label}</button>
          ))}
          <button onClick={() => {
            const markSources = !state.markSources
            set({ markSources, analysisText: state.analysisData ? analysisToText(state.analysisData, { markSources, lang: state.lang }) : state.analysisText })
          }} title="Tambahkan tanda [perkiraan] / [saran AI] di teks salinan" style={{
            padding:'3px 9px', fontSize:10, fontWeight:500,
            background:state.markSources?'rgba(245,166,35,0.12)':'rgba(255,255,255,0.45)',
            border:`1px solid ${state.markSources?'#7e5106':'rgba(100,120,220,0.15)'}`,
            color:state.markSources?'#7e5106':'var(--text3)', borderRadius:20, cursor:'pointer',
          }}>{state.markSources?'✓ ':''}Tandai perkiraan</button>
        </div>
        <div style={{ display:'flex', gap:5 }}>
          {[['en','EN'],['id','ID'],['bi','Bilingual']].map(([id,label]) => (
            <button key={id} onClick={() => set({ lang:id })} style={{
              flex:1, padding:'4px 0', fontSize:10, fontWeight:600,
              background:(state.lang||'en')===id ? 'rgba(245,166,35,0.15)' : 'rgba(255,255,255,0.45)',
              border:`1px solid ${(state.lang||'en')===id ? '#7e5106' : 'rgba(100,120,220,0.15)'}`,
              color:(state.lang||'en')===id ? '#7e5106' : 'var(--text3)', borderRadius:7, cursor:'pointer',
            }}>{label}</button>
          ))}
        </div>
      </GlassCard>
    </>
  )

  const analyzeBtn = (
    <button onClick={analyzeVideo} disabled={state.isAnalyzing} style={{
      width:'100%', padding:12, fontSize:13, fontWeight:700,
      background:state.isAnalyzing ? 'rgba(100,120,220,0.15)' : isVulgar ? 'linear-gradient(135deg,#ae1329,#661cf0)' : 'linear-gradient(135deg,#0a47e2,#661cf0)',
      border:'none', color:state.isAnalyzing ? 'var(--text3)' : 'white',
      borderRadius:11, cursor:state.isAnalyzing ? 'not-allowed' : 'pointer',
      boxShadow:state.isAnalyzing ? 'none' : isVulgar ? '0 6px 24px rgba(232,48,74,0.35)' : '0 6px 24px rgba(79,126,247,0.35)',
      display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    }}>
      {state.isAnalyzing ? <><Spin />Analyzing...</> : <><span>▶</span> Analyze {state.selectedScenes?.length ? `${state.selectedScenes.length} Adegan` : 'Video'}</>}
    </button>
  )

  // ── Right panel JSX ──
  const rightPanel = (
    <>
      <div style={{ display:'flex', padding:isMobile ? '8px 12px 0' : '10px 16px 0', borderBottom:'1px solid rgba(100,120,220,0.12)', flexShrink:0, background:'rgba(255,255,255,0.4)', backdropFilter:'blur(10px)', overflowX:'auto' }}>
        {[['prompt', isMobile ? '📝 Prompt' : '📝 Prompt & Adegan'],['transcript', isMobile ? '🗣 Transkrip' : '🗣 Transkrip & Subtitle'],['detail', isMobile ? '💡 Insight' : '💡 Insight & Publishing'],['story','✨ Story']].map(([id,label]) => (
          <button key={id} onClick={() => setSubTab(id)} style={{
            padding:isMobile ? '6px 11px' : '6px 14px', fontSize:12, fontWeight:500, border:'none',
            background:'none', color:subTab===id ? 'var(--accent)' : 'var(--text3)',
            borderBottom:`2.5px solid ${subTab===id ? 'var(--accent)' : 'transparent'}`,
            cursor:'pointer', marginBottom:-1, whiteSpace:'nowrap',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex:1, overflowY:'auto', padding:isMobile ? '12px 12px' : 14, display:'flex', flexDirection:'column', gap:12 }}>

        {subTab === 'prompt' && (
          <>
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text2)' }}>
                {curPlatform?.label} · {state.detailLevel||'Ultra'}
                {state.videoMeta?.durationFormatted && ` · ${state.videoMeta.durationFormatted}`}
                {!isMobile && state.videoMeta?.width && ` · ${state.videoMeta.width}×${state.videoMeta.height}`}
              </span>
              <div style={{ marginLeft:'auto', display:'flex', gap:6 }}>
                <ActionBtn color="#0c6747" copied={copied.all} onClick={() => copy(state.analysisText||'','all')}>📋 Copy</ActionBtn>
                <ActionBtn onClick={() => exportTxt(state.analysisText||'','prompt.txt')}>💾</ActionBtn>
                <ActionBtn onClick={analyzeVideo}>↺</ActionBtn>
              </div>
            </div>
            {state.analysisData && !state.isAnalyzing && (
              <AnalysisEditor
                data={state.analysisData}
                thumbs={thumbs}
                onChange={data => setAnalysis(data)}
                onRegenScene={regenScene}
                busyScene={busyScene}
                onSeek={seekVideo}
              />
            )}
            <GlassCard color={CC[0]} label={`Teks prompt siap salin: ${curPlatform?.label||''}`}>
              <OutputBox content={state.analysisText} loading={state.isAnalyzing} empty="Upload video, pilih adegan (opsional), lalu klik Analyze. Hasilnya bisa dikoreksi per bagian di atas." minH={state.analysisData ? 160 : (isMobile ? 200 : 300)} style={{ maxHeight: state.analysisData ? 360 : 'none' }} />
              {state.analysisText && (
                <div style={{ marginTop:6, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--mono)' }}>{state.analysisText.length} chars</span>
                  <ActionBtn color="#0c6747" copied={copied.toswap} onClick={() => { copy(state.analysisText,'toswap'); showToast('Buka tab Video Variations atau Editor!') }} small>📋 Salin</ActionBtn>
                </div>
              )}
            </GlassCard>
          </>
        )}

        {subTab === 'transcript' && (
          <TranscriptPanel state={state} set={set} showToast={showToast} videoRef={videoRef} />
        )}

        {subTab === 'detail' && (
          <>
            {!state.analysisText
              ? <div style={{ color:'var(--text3)', fontSize:12, fontStyle:'italic', padding:'24px 0', textAlign:'center' }}>Jalankan analisis dulu.</div>
              : <>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                    <span style={{ fontSize:11, fontWeight:600, color:'var(--text2)' }}>💡 Insight untuk {curPlatform?.label}</span>
                    <button onClick={generateInsight} disabled={isGenInsight} style={{
                      padding:'8px 16px', fontSize:12, fontWeight:700,
                      background:isGenInsight ? 'rgba(100,120,220,0.15)' : 'linear-gradient(135deg,#0c6747,#0a47e2)',
                      border:'none', color:isGenInsight ? 'var(--text3)' : 'white',
                      borderRadius:9, cursor:isGenInsight ? 'not-allowed' : 'pointer',
                      display:'flex', alignItems:'center', gap:6,
                    }}>
                      {isGenInsight ? <><Spin />Generating...</> : '✨ Generate Insight'}
                    </button>
                  </div>
                  {insightData
                    ? <InsightPanel data={insightData} copy={copy} copied={copied} exportTxt={exportTxt} />
                    : <GlassCard color={CC[2]} label="Apa yang didapat">
                        <div style={{ fontSize:12, color:'var(--text2)', lineHeight:1.8 }}>
                          Klik <strong>Generate Insight</strong> untuk:<br />
                          • 5 judul dengan gaya berbeda<br />
                          • Caption short / medium / long<br />
                          • Hashtag strategi<br />
                          • Saran jam posting + perkiraan potensi viral<br />
                          • Soundtrack recommendation<br />
                          • Adaptasi lintas platform
                        </div>
                      </GlassCard>
                  }
                </>
            }
          </>
        )}

        {subTab === 'story' && (
          <>
            <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
              <GlassCard color={CC[0]} label="Custom Title" style={{ flex:2, minWidth:180 }}>
                <input value={selectedTitle} placeholder="Judul video baru..." onChange={e => setSelectedTitle(e.target.value)}
                  style={{ width:'100%', background:'rgba(255,255,255,0.6)', border:'1.5px solid rgba(100,120,220,0.2)', color:'var(--text)', fontSize:12, padding:'7px 10px', borderRadius:8, }} />
              </GlassCard>
              <GlassCard color={CC[3]} label="Type" style={{ flex:1, minWidth:110 }}>
                <div style={{ position:'relative' }}>
                  <select value={storyType} onChange={e => setStoryType(e.target.value)} style={{ width:'100%', background:'rgba(255,255,255,0.6)', border:'1.5px solid rgba(100,120,220,0.2)', color:'var(--text)', fontSize:12, padding:'7px 22px 7px 9px', borderRadius:8, appearance:'none', }}>
                    {[['viral','Viral'],['cinematic','Cinematic'],['documentary','Docu'],['emotional','Emotional']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <span style={{ position:'absolute', right:8, top:'50%', transform:'translateY(-50%)', color:'var(--text3)', pointerEvents:'none', fontSize:10 }}>▼</span>
                </div>
              </GlassCard>
              <GlassCard color={CC[2]} label="Clips">
                <div style={{ display:'flex', gap:4 }}>
                  {[2,3,4,5].map(n => (
                    <button key={n} onClick={() => setClipCount(n)} style={{ width:32, height:32, background:clipCount===n ? 'linear-gradient(135deg,#0a47e2,#661cf0)' : 'rgba(255,255,255,0.6)', border:'1px solid rgba(100,120,220,0.2)', color:clipCount===n ? 'white' : 'var(--text2)', borderRadius:8, cursor:'pointer', fontSize:12, fontWeight:700 }}>{n}</button>
                  ))}
                </div>
              </GlassCard>
            </div>
            <button onClick={generateNewStory} disabled={isGenStory} style={{
              padding:11, fontSize:12, fontWeight:700,
              background:isGenStory ? 'rgba(100,120,220,0.15)' : 'linear-gradient(135deg,#661cf0,#ac0f47)',
              border:'none', color:isGenStory ? 'var(--text3)' : 'white', borderRadius:11,
              cursor:isGenStory ? 'not-allowed' : 'pointer',
            }}>
              {isGenStory ? '⟳ Generating...' : '✨ Generate New Story'}
            </button>
            {storyOutput && (
              <GlassCard color={CC[1]} label="Story Output">
                <OutputBox content={storyOutput} minH={180} />
                <div style={{ display:'flex', gap:6, marginTop:8 }}>
                  <ActionBtn color="#661cf0" copied={copied.story} onClick={() => copy(storyOutput,'story')}>📋 Copy</ActionBtn>
                  <ActionBtn onClick={() => exportTxt(storyOutput,'story.txt')}>💾 Export</ActionBtn>
                </div>
              </GlassCard>
            )}
          </>
        )}
      </div>
    </>
  )

  return (
    <MobileLayout
      isMobile={isMobile}
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      analyzeBtn={analyzeBtn}
      drawerLabel="⚙ Video Settings"
    />
  )
}


// ─── InsightPanel ─────────────────────────────────────────────────────────────

function InsightPanel({ data, copy, copied, exportTxt }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div role="note" style={{ fontSize: 11, lineHeight: 1.6, color: '#7e5106', background: 'rgba(245,166,35,0.1)', border: '1px solid rgba(245,166,35,0.35)', borderRadius: 8, padding: '8px 10px' }}>
        Semua isi Insight adalah saran AI dari isi video, bukan data tren atau statistik platform.
        Jam posting, potensi viral, dan sound "trending" belum dicek ke TikTok, Instagram, atau YouTube.
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <ActionBtn color="#0c6747" copied={copied.insight} onClick={() => copy(JSON.stringify(data, null, 2), 'insight')}>📋 Copy All</ActionBtn>
        <ActionBtn onClick={() => exportTxt(JSON.stringify(data, null, 2), 'insight.json')}>💾 Export</ActionBtn>
      </div>

      {/* VIRAL TITLES — top priority */}
      {data.viralTitles?.length > 0 && (
        <GlassCard color={CC[0]} label="📣 Viral Titles">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.viralTitles.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '7px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 8 }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', fontWeight: 700, minWidth: 18, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, lineHeight: 1.5 }}>{t}</span>
                <ActionBtn small copied={copied['vt' + i]} onClick={() => copy(t, 'vt' + i)} color="#0a47e2">Copy</ActionBtn>
              </div>
            ))}
            <div style={{ marginTop: 4, display: 'flex', justifyContent: 'flex-end' }}>
              <ActionBtn copied={copied.vtAll} onClick={() => copy(data.viralTitles.map((t,i) => `${i+1}. ${t}`).join('\n'), 'vtAll')} color="#0a47e2">📋 Copy All Titles</ActionBtn>
            </div>
          </div>
        </GlassCard>
      )}
      {data.postingStrategy && (
        <GlassCard color={CC[2]} label="📈 Posting Strategy (perkiraan AI)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[['Saran jam posting',data.postingStrategy.bestTime],['Frequency',data.postingStrategy.frequency],['Content Pillar',data.postingStrategy.contentPillar],['Perkiraan potensi viral',data.postingStrategy.viralPotential]].filter(([,v])=>v).map(([k,v]) => (
              <div key={k} style={{ background: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, letterSpacing: '0.07em', marginBottom: 3 }}>{k.toUpperCase()}</div>
                <div style={{ fontSize: 11, color: 'var(--text)', fontWeight: 500 }}>{String(v)}</div>
              </div>
            ))}
          </div>
          {data.postingStrategy.viralReason && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text2)', fontStyle: 'italic' }}>💡 {data.postingStrategy.viralReason}</div>}
        </GlassCard>
      )}
      {data.titles?.length > 0 && (
        <GlassCard color={CC[0]} label="🎯 Title Options">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {data.titles.map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--accent)', background: 'rgba(79,126,247,0.1)', padding: '2px 6px', borderRadius: 4, fontWeight: 700, whiteSpace: 'nowrap', marginTop: 1 }}>{t.style}</span>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1 }}>{t.text}</span>
                <ActionBtn small copied={copied['title'+i]} onClick={() => copy(t.text, 'title'+i)} color="#0a47e2">Copy</ActionBtn>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
      {data.descriptions && (
        <GlassCard color={CC[1]} label="📝 Captions">
          {[['short','Short'],['medium','Medium'],['long','Long']].map(([key,label]) => data.descriptions[key] && (
            <div key={key} style={{ marginBottom: 8, background: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.06em' }}>{label.toUpperCase()}</span>
                <ActionBtn small copied={copied['desc'+key]} onClick={() => copy(data.descriptions[key], 'desc'+key)} color="#661cf0">Copy</ActionBtn>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{data.descriptions[key]}</div>
            </div>
          ))}
        </GlassCard>
      )}
      {data.hashtags && (
        <GlassCard color={CC[3]} label="# Hashtags">
          {[['niche','#7e5106','Niche'],['broad','#0c6747','Broad'],['trending','#ac0f47','Trending'],['branded','#0a47e2','Branded']].map(([key,color,label]) => data.hashtags[key]?.length > 0 && (
            <div key={key} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.07em', marginBottom: 5 }}>{label.toUpperCase()}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {data.hashtags[key].map((tag, j) => (
                  <button type="button" key={j} title="Salin hashtag" style={{ fontSize: 11, color, background: `${color}18`, border: `1px solid ${color}40`, borderRadius: 6, padding: '3px 8px', cursor: 'pointer' }} onClick={() => copy(tag, 'htag'+key+j)}>{tag}</button>
                ))}
                <ActionBtn small copied={copied['htags'+key]} onClick={() => copy(data.hashtags[key].join(' '), 'htags'+key)} color={color}>Copy All</ActionBtn>
              </div>
            </div>
          ))}
        </GlassCard>
      )}
      {data.soundtrack && (
        <GlassCard color={CC[1]} label="🎵 Soundtrack / Backsound Recommendation">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Key specs row */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[['Genre', data.soundtrack.genre, '#661cf0'], ['Mood', data.soundtrack.mood, '#ac0f47'], ['Tempo', data.soundtrack.tempo, '#7e5106']].filter(([,v])=>v).map(([k,v,c]) => (
                <div key={k} style={{ background: `${c}12`, border: `1px solid ${c}35`, borderRadius: 8, padding: '6px 12px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.07em' }}>{k.toUpperCase()}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{String(v)}</span>
                </div>
              ))}
            </div>
            {data.soundtrack.instruments && (
              <div style={{ padding: '7px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 3 }}>INSTRUMENTS / ELEMENTS</div>
                <div style={{ fontSize: 12, color: 'var(--text)' }}>{data.soundtrack.instruments}</div>
              </div>
            )}
            {data.soundtrack.references?.length > 0 && (
              <div style={{ padding: '7px 10px', background: 'rgba(255,255,255,0.5)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 700, marginBottom: 6 }}>REFERENSI ARTIS / LAGU (SARAN AI, CEK LISENSI)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                  {data.soundtrack.references.map((r, i) => (
                    <span key={i} style={{ fontSize: 11, color: '#661cf0', background: 'rgba(155,107,245,0.1)', border: '1px solid rgba(155,107,245,0.25)', borderRadius: 6, padding: '3px 9px' }}>{r}</span>
                  ))}
                </div>
              </div>
            )}
            {data.soundtrack.tiktokSound && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'rgba(240,82,138,0.07)', border: '1px solid rgba(240,82,138,0.2)', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#ac0f47', fontWeight: 700, marginBottom: 2 }}>SARAN SOUND TIKTOK (BELUM DICEK TREN)</div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{data.soundtrack.tiktokSound}</div>
                </div>
                <ActionBtn small copied={copied.tiktokSound} onClick={() => copy(data.soundtrack.tiktokSound, 'tiktokSound')} color="#ac0f47">Copy</ActionBtn>
              </div>
            )}
            {data.soundtrack.royaltyFree && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 10px', background: 'rgba(24,201,138,0.07)', border: '1px solid rgba(24,201,138,0.2)', borderRadius: 8 }}>
                <div>
                  <div style={{ fontSize: 11, color: '#0c6747', fontWeight: 700, marginBottom: 2 }}>ROYALTY-FREE SEARCH KEYWORD</div>
                  <div style={{ fontSize: 12, color: 'var(--text)' }}>{data.soundtrack.royaltyFree}</div>
                </div>
                <ActionBtn small copied={copied.rfSound} onClick={() => copy(data.soundtrack.royaltyFree, 'rfSound')} color="#0c6747">Copy</ActionBtn>
              </div>
            )}
          </div>
        </GlassCard>
      )}
      {data.crossPlatform && (
        <GlassCard color={CC[5]} label="🌐 Cross-Platform">
          {[['tiktok','TikTok','#ac0f47'],['instagram','Instagram','#661cf0'],['youtube','YouTube','#ae1329'],['twitter','X/Twitter','#0a47e2']].map(([key,label,color]) => data.crossPlatform[key] && (
            <div key={key} style={{ marginBottom: 8, background: 'rgba(255,255,255,0.5)', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color }}>{label}</span>
                <ActionBtn small copied={copied['cp'+key]} onClick={() => copy(data.crossPlatform[key], 'cp'+key)} color={color}>Copy</ActionBtn>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text2)', lineHeight: 1.5 }}>{data.crossPlatform[key]}</div>
            </div>
          ))}
        </GlassCard>
      )}
    </div>
  )
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function GlassCard({ color, label, children, style = {} }) {
  return (
    <div style={{ background: color?.bg || 'rgba(255,255,255,0.55)', border: `1px solid ${color?.border || 'rgba(100,120,220,0.18)'}`, borderRadius: 12, padding: '11px 12px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(80,100,200,0.07)', ...style }}>
      {label && <div style={{ fontSize: 10, fontWeight: 700, color: color?.accent || 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 8 }}>{label}</div>}
      {children}
    </div>
  )
}

function OutputBox({ content, loading, empty, mono, minH = 80, style = {} }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid rgba(100,120,220,0.12)', borderRadius: 9, padding: '10px 12px', overflowY: 'auto', fontSize: mono ? 11 : 12, lineHeight: 1.75, fontFamily: mono ? 'var(--mono)' : 'var(--sans)', color: content ? 'var(--text)' : 'var(--text3)', fontStyle: !content && !loading ? 'italic' : 'normal', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: minH, animation: loading ? 'pulse 1.2s infinite' : 'none', ...style }}>
      {loading ? '⟳ Analyzing...' : content || empty || ''}
      <style>{`@keyframes pulse{0%,100%{opacity:.65}50%{opacity:1}}`}</style>
    </div>
  )
}

function ActionBtn({ children, onClick, color, copied, small }) {
  return (
    <button onClick={onClick} style={{ padding: small ? '3px 9px' : '5px 12px', fontSize: 10, fontWeight: 600, background: copied ? `${color || '#0c6747'}18` : 'rgba(255,255,255,0.7)', border: `1px solid ${copied ? (color || '#0c6747') : 'rgba(100,120,220,0.2)'}`, color: copied ? (color || '#0c6747') : 'var(--text2)', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 1px 4px rgba(80,100,200,0.08)' }}>
      {copied ? '✓ Copied' : children}
    </button>
  )
}

function Chip({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid rgba(100,120,220,0.15)', borderRadius: 6, padding: '2px 8px', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {label && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</span>}
      <span style={{ fontSize: 10, color: color || 'var(--accent)', fontFamily: 'var(--mono)', fontWeight: 700 }}>{value}</span>
    </div>
  )
}

function SelField({ value, onChange, options }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', background: 'rgba(255,255,255,0.6)', border: '1px solid rgba(100,120,220,0.18)', color: 'var(--text)', fontSize: 11, padding: '6px 22px 6px 9px', borderRadius: 8, appearance: 'none', }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none', fontSize: 10 }}>▼</span>
    </div>
  )
}

function Spin() {
  return <span style={{ display: 'inline-block', animation: 'spin .7s linear infinite', fontSize: 14 }}>⟳<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></span>
}
