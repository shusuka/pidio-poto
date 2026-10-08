import React, { useEffect, useMemo, useRef, useState } from 'react'
import MobileLayout from './MobileLayout'
import { GlassCard, Btn, PrimaryBtn, Spin, Empty, inputStyle, CC, pressable, tint } from './ui'
import { callAI, parseJsonResponse, extractVideoMetadata, PLATFORM_CONFIGS } from '../utils/gemini'
import { buildHighlightPrompt, normalizeHighlight, speechRanges } from '../utils/analysis'
import { fmtTime, downloadBlob, chunkScenes } from '../utils/media'
import {
  TimelinePlayer, uid, clipDur, totalDuration, clipStarts, locate, splitAt, keepRanges, subtitleCues,
} from '../utils/timeline'

export const EMPTY_EDITOR = {
  sources: {},
  music: null,
  doc: { clips: [], texts: [], subtitles: true, subtitleSize: 'M', videoVolume: 1, musicVolume: 0.4, aspect: 'source', fit: 'contain' },
  past: [],
  future: [],
}

const ASPECTS = [['source', 'Asli'], ['9:16', '9:16'], ['16:9', '16:9'], ['1:1', '1:1'], ['4:5', '4:5']]
const SRC_COLORS = ['var(--c-blue)', 'var(--c-violet)', 'var(--c-green)', 'var(--c-amber)', 'var(--c-pink)', 'var(--c-orange)']
const HISTORY_LIMIT = 60

function outputSize(aspect, src) {
  const sw = src?.width || 1280, sh = src?.height || 720
  let w, h
  if (aspect === 'source') { w = sw; h = sh } else {
    const [a, b] = aspect.split(':').map(Number)
    if (a >= b) { w = 1920; h = (1920 * b) / a } else { h = 1920; w = (1920 * a) / b }
  }
  const scale = Math.min(1, 1920 / Math.max(w, h))
  const even = n => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { W: even(w), H: even(h) }
}

export default function EditorTab({ state, set, showToast, isMobile }) {
  const editor = state.editor || EMPTY_EDITOR
  const { doc, sources, music } = editor
  const canvasRef = useRef(null)
  const playerRef = useRef(null)
  const trackRef = useRef(null)
  const addVideoRef = useRef(null)
  const addMusicRef = useRef(null)
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState(null) // { kind: 'clip'|'text', id }
  const [pps, setPps] = useState(40) // piksel per detik
  const [exporting, setExporting] = useState(null) // progress 0..1
  const [autoBusy, setAutoBusy] = useState(false)
  const [target, setTarget] = useState(30)
  const [gap, setGap] = useState({ pad: 0.25, minGap: 0.6 })
  const dragId = useRef(null)
  const lastT = useRef(0)

  // ── Riwayat (undo/redo) ──
  const setEditor = fn => set(prev => ({ editor: fn(prev.editor || EMPTY_EDITOR) }))
  const commit = fn => setEditor(e => ({ ...e, doc: fn(e.doc), past: [...e.past, e.doc].slice(-HISTORY_LIMIT), future: [] }))
  const undo = () => setEditor(e => e.past.length ? { ...e, doc: e.past.at(-1), past: e.past.slice(0, -1), future: [e.doc, ...e.future] } : e)
  const redo = () => setEditor(e => e.future.length ? { ...e, doc: e.future[0], past: [...e.past, e.doc], future: e.future.slice(1) } : e)

  // ── Video dari tab Analyze otomatis jadi sumber "main" ──
  useEffect(() => {
    if (!state.videoFile || !state.videoUrl) return
    if (sources.main?.file === state.videoFile) return
    const m = state.videoMeta || {}
    setEditor(e => ({
      ...e,
      sources: { ...e.sources, main: { id: 'main', name: m.name || 'Video utama', file: state.videoFile, url: state.videoUrl, duration: m.duration || 0, width: m.width, height: m.height } },
      doc: { ...e.doc, clips: e.doc.clips.filter(c => c.src !== 'main') },
      past: [], future: [],
    }))
  }, [state.videoFile, state.videoUrl])

  // ── Adegan yang dikirim dari tab Analisis ──
  useEffect(() => {
    const pending = state.pendingClips
    if (!pending?.length || !sources.main) return
    commit(d => ({ ...d, clips: [...d.clips, ...pending.map(r => ({ id: uid(), src: 'main', in: r.start, out: r.end }))] }))
    set({ pendingClips: null })
  }, [state.pendingClips, sources.main])

  const duration = totalDuration(doc.clips)
  const starts = useMemo(() => clipStarts(doc.clips), [doc.clips])
  const firstSrc = sources[doc.clips[0]?.src] || sources.main || Object.values(sources)[0]
  const { W, H } = outputSize(doc.aspect, firstSrc)
  const cues = useMemo(() => doc.subtitles ? subtitleCues(doc.clips, state.transcript || []) : [], [doc.clips, doc.subtitles, state.transcript])

  // ── Pemutar canvas ──
  useEffect(() => {
    const player = new TimelinePlayer(canvasRef.current, {
      onTime: time => {
        const now = performance.now()
        if (now - lastT.current > 80 || !player.playing) { lastT.current = now; setT(time) }
      },
      onState: setPlaying,
      onError: () => showToast('Browser menahan pemutaran. Klik ▶ sekali lagi', true),
    })
    playerRef.current = player
    return () => player.destroy()
  }, [])

  useEffect(() => {
    playerRef.current?.setProject({
      clips: doc.clips, texts: doc.texts, cues, sources, music, W, H, fit: doc.fit,
      videoVolume: doc.videoVolume, musicVolume: doc.musicVolume, subtitleSize: doc.subtitleSize,
    })
  }, [doc, cues, sources, music, W, H])

  // ── Keyboard ──
  useEffect(() => {
    const onKey = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || exporting != null) return
      const k = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo() }
      else if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo() }
      // Spasi di tombol yang sedang difokus = tekan tombol itu, bukan play/pause
      else if (k === ' ' && !e.target.closest('button, [role="button"]')) { e.preventDefault(); togglePlay() }
      else if (k === 's') split()
      else if (k === 'delete') removeSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const player = () => playerRef.current
  function togglePlay() { if (!doc.clips.length) return; playing ? player().pause() : player().play() }
  function seek(time) { player().pause(); player().seek(time) }

  // ── Operasi klip ──
  function addFullClip(srcId) {
    const src = sources[srcId]
    if (!src?.duration) return showToast('Durasi video belum terbaca', true)
    commit(d => ({ ...d, clips: [...d.clips, { id: uid(), src: srcId, in: 0, out: src.duration }] }))
  }
  function split() {
    const res = splitAt(doc.clips, t)
    if (!res.id) return showToast('Posisikan playhead di tengah klip untuk memotong', true)
    commit(d => ({ ...d, clips: res.clips }))
    setSel({ kind: 'clip', id: res.id })
  }
  function removeSelected() {
    if (!sel) return
    if (sel.kind === 'clip') commit(d => ({ ...d, clips: d.clips.filter(c => c.id !== sel.id) }))
    else commit(d => ({ ...d, texts: d.texts.filter(x => x.id !== sel.id) }))
    setSel(null)
  }
  function duplicate() {
    if (sel?.kind !== 'clip') return
    commit(d => {
      const i = d.clips.findIndex(c => c.id === sel.id)
      const clips = [...d.clips]
      clips.splice(i + 1, 0, { ...d.clips[i], id: uid() })
      return { ...d, clips }
    })
  }
  function move(dir) {
    if (sel?.kind !== 'clip') return
    commit(d => {
      const i = d.clips.findIndex(c => c.id === sel.id), j = i + dir
      if (i < 0 || j < 0 || j >= d.clips.length) return d
      const clips = [...d.clips];
      [clips[i], clips[j]] = [clips[j], clips[i]]
      return { ...d, clips }
    })
  }
  function updateClip(id, patch) {
    commit(d => ({
      ...d, clips: d.clips.map(c => {
        if (c.id !== id) return c
        const max = sources[c.src]?.duration || Infinity
        const n = { ...c, ...patch }
        n.in = Math.max(0, Math.min(n.in, max - 0.1))
        n.out = Math.max(n.in + 0.1, Math.min(n.out, max))
        return n
      }),
    }))
  }
  function trimToPlayhead(side) {
    const loc = locate(doc.clips, t)
    if (!loc || loc.clip.id !== sel?.id) return showToast('Pindahkan playhead ke dalam klip yang dipilih', true)
    updateClip(loc.clip.id, side === 'in' ? { in: loc.offset } : { out: loc.offset })
  }
  function onDrop(targetId, e) {
    const from = dragId.current
    dragId.current = null
    if (!from || from === targetId) return
    const rect = e.currentTarget.getBoundingClientRect()
    const after = e.clientX > rect.left + rect.width / 2
    commit(d => {
      const clips = d.clips.filter(c => c.id !== from)
      const moving = d.clips.find(c => c.id === from)
      let idx = clips.findIndex(c => c.id === targetId)
      if (after) idx++
      clips.splice(idx, 0, moving)
      return { ...d, clips }
    })
  }

  // ── Teks overlay ──
  function addText() {
    const id = uid('x')
    commit(d => ({ ...d, texts: [...d.texts, { id, text: 'Teks baru', start: Math.min(t, Math.max(0, duration - 1)), dur: 3, pos: 'center', size: 'L' }] }))
    setSel({ kind: 'text', id })
  }
  const updateText = (id, patch) => commit(d => ({ ...d, texts: d.texts.map(x => x.id === id ? { ...x, ...patch } : x) }))

  // ── Sumber media ──
  async function addVideoFile(file) {
    if (!file?.type.startsWith('video/')) return showToast('Pilih file video', true)
    const meta = await extractVideoMetadata(file)
    const id = uid('v')
    const url = URL.createObjectURL(file)
    setEditor(e => ({ ...e, sources: { ...e.sources, [id]: { id, name: file.name, file, url, duration: meta.duration || 0, width: meta.width, height: meta.height } } }))
    if (meta.duration) commit(d => ({ ...d, clips: [...d.clips, { id: uid(), src: id, in: 0, out: meta.duration }] }))
  }
  function removeSource(id) {
    if (id === 'main') return
    setEditor(e => {
      URL.revokeObjectURL(e.sources[id]?.url)
      const { [id]: _, ...rest } = e.sources
      return { ...e, sources: rest, doc: { ...e.doc, clips: e.doc.clips.filter(c => c.src !== id) }, past: [], future: [] }
    })
  }
  function setMusic(file) {
    if (music?.url) URL.revokeObjectURL(music.url)
    setEditor(e => ({ ...e, music: file ? { name: file.name, url: URL.createObjectURL(file) } : null }))
  }

  // ── Otomatis ──
  function clipsFromScenes() {
    if (!sources.main) return showToast('Upload video di tab Analyze dulu', true)
    const all = state.scenes?.length ? state.scenes : chunkScenes(sources.main.duration)
    const picked = state.selectedScenes?.length ? all.filter(s => state.selectedScenes.includes(s.id)) : all
    commit(d => ({ ...d, clips: picked.map(s => ({ id: uid(), src: 'main', in: s.start, out: s.end })) }))
    showToast(`${picked.length} klip dari adegan ✓`)
  }
  function cutSilence() {
    if (!state.transcript?.length) return showToast('Buat transkrip dulu di tab Analyze → Transkrip', true)
    const ranges = speechRanges(state.transcript, { ...gap, duration: sources.main?.duration })
    const base = doc.clips.some(c => c.src === 'main') ? doc.clips : [{ id: uid(), src: 'main', in: 0, out: sources.main.duration }]
    const next = keepRanges(base, ranges)
    const saved = totalDuration(base) - totalDuration(next)
    commit(d => ({ ...d, clips: next }))
    showToast(`Jeda dipotong: hemat ${saved.toFixed(1)} detik ✓`)
  }
  async function autoHighlight() {
    if (!sources.main) return showToast('Upload video di tab Analyze dulu', true)
    if (!state.apiKey) return showToast('Masukkan API key!', true)
    const scenes = state.scenes?.length ? state.scenes : chunkScenes(sources.main.duration)
    setAutoBusy(true)
    try {
      const prompt = buildHighlightPrompt({
        scenes, analysis: state.analysisData, transcript: state.transcript, target, lang: state.lang,
        platformName: PLATFORM_CONFIGS[state.promptMode]?.name || 'short-form video', duration: sources.main.duration,
      })
      // Tanpa hasil analisis/transkrip, AI perlu melihat videonya sendiri
      const needsVideo = !state.analysisData && !state.transcript?.length
      const { text, tokens } = await callAI({
        provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, json: true, temperature: 0.7,
        ...(needsVideo ? { mediaFile: sources.main.file, mimeType: sources.main.file.type || 'video/mp4' } : {}),
      })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons AI bukan JSON yang valid.')
      const { hook, clips } = normalizeHighlight(parsed, scenes, sources.main.duration)
      commit(d => ({
        ...d,
        clips: clips.map(c => ({ id: uid(), src: 'main', in: c.start, out: c.end, note: c.reason })),
        texts: hook ? [{ id: uid('x'), text: hook, start: 0, dur: 2.5, pos: 'top', size: 'L', hook: true }, ...d.texts.filter(x => !x.hook)] : d.texts,
      }))
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))
      showToast(`Highlight ${clips.length} klip ✓ (bisa di-undo)`)
    } catch (e) { showToast('Error: ' + e.message, true) }
    setAutoBusy(false)
  }

  // ── Ekspor ──
  async function exportVideo() {
    if (!doc.clips.length) return showToast('Timeline masih kosong', true)
    setSel(null)
    setExporting(0)
    try {
      const { blob, ext } = await player().record({ onProgress: p => setExporting(p) })
      downloadBlob(blob, `pidio-edit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`)
      showToast(`Ekspor selesai (${(blob.size / 1048576).toFixed(1)} MB, ${ext.toUpperCase()}) ✓`)
    } catch (e) { showToast('Ekspor gagal: ' + e.message, true) }
    setExporting(null)
  }

  const selClip = sel?.kind === 'clip' ? doc.clips.find(c => c.id === sel.id) : null
  const selText = sel?.kind === 'text' ? doc.texts.find(x => x.id === sel.id) : null
  const srcIds = Object.keys(sources)
  const colorOf = id => SRC_COLORS[Math.max(0, srcIds.indexOf(id)) % SRC_COLORS.length]
  const busy = exporting != null
  const trackW = Math.max(duration * pps + 40, 300)

  // ── Panel kiri ──
  const leftPanel = (
    <>
      <GlassCard color={CC[0]} label="Sumber video">
        {!srcIds.length && <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8 }}>Upload video di tab Analyze, atau tambah video di sini.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {srcIds.map(id => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', background: 'color-mix(in srgb, var(--paper) 55%, transparent)', borderRadius: 8, borderLeft: `3px solid ${colorOf(id)}` }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={sources[id].name}>{id === 'main' ? '★ ' : ''}{sources[id].name}</span>
              <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)' }}>{fmtTime(sources[id].duration, 0)}</span>
              <Btn small onClick={() => addFullClip(id)} disabled={busy} title="Tambah seluruh video ke timeline">＋</Btn>
              {id !== 'main' && <Btn small onClick={() => removeSource(id)} disabled={busy} title="Hapus sumber">✕</Btn>}
            </div>
          ))}
        </div>
        <Btn onClick={() => addVideoRef.current?.click()} disabled={busy} style={{ marginTop: 8, width: '100%' }}>＋ Tambah video lain</Btn>
        <input ref={addVideoRef} type="file" accept="video/*" hidden onChange={e => { addVideoFile(e.target.files[0]); e.target.value = '' }} />
      </GlassCard>

      <GlassCard color={CC[2]} label="Otomatis">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <Btn onClick={clipsFromScenes} disabled={busy || !sources.main} style={{ justifyContent: 'flex-start' }}>
            Klip dari adegan {state.selectedScenes?.length ? `terpilih (${state.selectedScenes.length})` : `(${state.scenes?.length || 0})`}
          </Btn>
          <div style={{ padding: 7, background: 'color-mix(in srgb, var(--paper) 45%, transparent)', borderRadius: 8 }}>
            <Btn onClick={cutSilence} disabled={busy || !sources.main} style={{ width: '100%', justifyContent: 'flex-start' }}>Potong jeda (dari transkrip)</Btn>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '3px 6px', alignItems: 'center', marginTop: 6, fontSize: 11, color: 'var(--text3)' }}>
              <span>Jeda min</span>
              <input type="range" min={0.2} max={2} step={0.1} value={gap.minGap} onChange={e => setGap(g => ({ ...g, minGap: +e.target.value }))} />
              <span style={{ fontFamily: 'var(--mono)' }}>{gap.minGap.toFixed(1)}s</span>
              <span>Sisa napas</span>
              <input type="range" min={0} max={0.8} step={0.05} value={gap.pad} onChange={e => setGap(g => ({ ...g, pad: +e.target.value }))} />
              <span style={{ fontFamily: 'var(--mono)' }}>{gap.pad.toFixed(2)}s</span>
            </div>
            {!state.transcript?.length && <div style={{ fontSize: 11, color: 'var(--c-amber)', marginTop: 4 }}>Butuh transkrip (tab Analyze → Transkrip).</div>}
          </div>
          <div style={{ padding: 7, background: 'color-mix(in srgb, var(--paper) 45%, transparent)', borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', marginRight: 'auto' }}>Target durasi</span>
              {[15, 30, 60].map(n => <Btn key={n} small active={target === n} onClick={() => setTarget(n)}>{n}s</Btn>)}
            </div>
            <Btn onClick={autoHighlight} disabled={busy || autoBusy || !sources.main} style={{ width: '100%', justifyContent: 'flex-start' }}>
              {autoBusy ? <><Spin /> Menyusun…</> : 'Susun highlight otomatis (AI)'}
            </Btn>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, lineHeight: 1.5 }}>Paling akurat setelah Analyze dan/atau transkrip dibuat.</div>
          </div>
        </div>
      </GlassCard>

      <GlassCard color={CC[3]} label="Teks & subtitle">
        <Btn onClick={addText} disabled={busy || !doc.clips.length} style={{ width: '100%' }}>＋ Tambah teks di playhead</Btn>
        <div style={{ display: 'flex', gap: 5, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Btn small active={doc.subtitles} color="var(--c-green)" disabled={!state.transcript?.length} onClick={() => commit(d => ({ ...d, subtitles: !d.subtitles }))}>
            {doc.subtitles ? '✓ ' : ''}Subtitle transkrip
          </Btn>
          {['S', 'M', 'L'].map(sz => <Btn key={sz} small active={doc.subtitleSize === sz} onClick={() => commit(d => ({ ...d, subtitleSize: sz }))}>{sz}</Btn>)}
        </div>
        {!state.transcript?.length && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>Subtitle diambil dari transkrip yang sudah dikoreksi.</div>}
      </GlassCard>

      <GlassCard color={CC[1]} label="Audio">
        <Slider label="Volume video" value={doc.videoVolume} onChange={v => commit(d => ({ ...d, videoVolume: v }))} />
        {music ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0 4px' }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Musik: {music.name}</span>
              <Btn small onClick={() => setMusic(null)} disabled={busy} aria-label="Hapus musik latar" title="Hapus musik latar">✕</Btn>
            </div>
            <Slider label="Volume musik" value={doc.musicVolume} onChange={v => commit(d => ({ ...d, musicVolume: v }))} />
          </>
        ) : (
          <Btn onClick={() => addMusicRef.current?.click()} disabled={busy} style={{ width: '100%', marginTop: 8 }}>＋ Musik latar</Btn>
        )}
        <input ref={addMusicRef} type="file" accept="audio/*" hidden onChange={e => { setMusic(e.target.files[0]); e.target.value = '' }} />
      </GlassCard>

      <GlassCard color={CC[4]} label="Format output">
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {ASPECTS.map(([id, label]) => <Btn key={id} small active={doc.aspect === id} onClick={() => commit(d => ({ ...d, aspect: id }))}>{label}</Btn>)}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
          <Btn small active={doc.fit === 'contain'} onClick={() => commit(d => ({ ...d, fit: 'contain' }))}>Utuh (bar hitam)</Btn>
          <Btn small active={doc.fit === 'cover'} onClick={() => commit(d => ({ ...d, fit: 'cover' }))}>Penuh (crop)</Btn>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, fontFamily: 'var(--mono)' }}>{W}×{H}</div>
      </GlassCard>
    </>
  )

  const exportBtn = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {doc.clips.length > 0 && (
        <div className="num" style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
          {exportFormat()} · {W}×{H} · {doc.aspect === 'source' ? 'rasio asli' : doc.aspect} · {fmtTime(duration, 0)}<br />
          Butuh ±{fmtTime(Math.ceil(duration + 2), 0)} (direkam real-time) · ukuran ±{Math.max(1, Math.round(duration))} MB
        </div>
      )}
      <PrimaryBtn onClick={exportVideo} disabled={busy || !doc.clips.length}>
        {busy ? <><Spin /> Merekam {Math.round(exporting * 100)}%</> : `Ekspor video (${fmtTime(duration, 0)})`}
      </PrimaryBtn>
    </div>
  )

  // ── Panel kanan: pratinjau + timeline ──
  const rightPanel = (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'center', background: '#0d1020', borderRadius: 12, padding: 8 }}>
        <canvas ref={canvasRef} onClick={togglePlay}
          style={{ maxWidth: '100%', maxHeight: isMobile ? '55vh' : '60vh', aspectRatio: `${W} / ${H}`, background: '#000', borderRadius: 6, cursor: doc.clips.length ? 'pointer' : 'default', display: 'block' }} />
      </div>

      {busy && (
        <div style={{ padding: '8px 10px', borderRadius: 9, background: 'color-mix(in srgb, var(--c-amber) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--c-amber) 35%, transparent)', fontSize: 11, color: 'var(--text2)' }}>
          Merekam secara real-time. Jangan pindah tab atau minimalkan jendela sampai selesai.
        </div>
      )}

      {/* Kontrol putar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Btn onClick={togglePlay} disabled={busy || !doc.clips.length} style={{ minWidth: 44 }} aria-label={playing ? 'Jeda' : 'Putar'}>{playing ? '⏸' : '▶'}</Btn>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)' }}>{fmtTime(t)} / {fmtTime(duration)}</span>
        <input type="range" min={0} max={duration || 0} step={0.01} value={Math.min(t, duration)} disabled={busy || !duration}
          onChange={e => seek(+e.target.value)} style={{ flex: '1 1 160px' }} />
        <Btn small onClick={undo} disabled={busy || !editor.past.length} title="Undo (Ctrl+Z)" aria-label="Undo">↶</Btn>
        <Btn small onClick={redo} disabled={busy || !editor.future.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</Btn>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        <Btn onClick={split} disabled={busy || !doc.clips.length} title="Potong klip di playhead (S)">✂ Split</Btn>
        <Btn onClick={() => trimToPlayhead('in')} disabled={busy || !selClip} title="Buang bagian klip sebelum playhead">⇤ Trim awal</Btn>
        <Btn onClick={() => trimToPlayhead('out')} disabled={busy || !selClip} title="Buang bagian klip setelah playhead">Trim akhir ⇥</Btn>
        <Btn onClick={() => move(-1)} disabled={busy || !selClip} aria-label="Geser klip ke kiri" title="Geser klip ke kiri">◀</Btn>
        <Btn onClick={() => move(1)} disabled={busy || !selClip} aria-label="Geser klip ke kanan" title="Geser klip ke kanan">▶</Btn>
        <Btn onClick={duplicate} disabled={busy || !selClip} aria-label="Duplikat klip" title="Duplikat klip">Duplikat</Btn>
        <Btn onClick={removeSelected} disabled={busy || !sel} color="var(--danger)" title="Hapus (Delete)">Hapus</Btn>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text3)' }}>
          Zoom <input type="range" min={8} max={160} value={pps} onChange={e => setPps(+e.target.value)} style={{ width: 90 }} aria-label="Zoom timeline" />
        </span>
      </div>

      {/* Timeline */}
      {!doc.clips.length ? (
        <Empty>Timeline kosong. Tambahkan klip lewat panel kiri:<br />“Klip dari adegan”, “＋” pada sumber video, atau “Susun highlight otomatis”.</Empty>
      ) : (
        <div ref={trackRef} style={{ overflowX: 'auto', background: 'color-mix(in srgb, var(--paper) 45%, transparent)', border: '1px solid color-mix(in srgb, var(--tint) 15%, transparent)', borderRadius: 10, padding: '8px 0' }}>
          <div style={{ position: 'relative', width: trackW, paddingLeft: 10 }}
            onClick={e => {
              if (e.target !== e.currentTarget && !e.target.dataset.lane) return
              const rect = e.currentTarget.getBoundingClientRect()
              seek(Math.max(0, (e.clientX - rect.left - 10) / pps))
            }}>
            {/* penggaris */}
            <div data-lane="1" style={{ position: 'relative', height: 16 }}>
              {Array.from({ length: Math.floor(duration / rulerStep(pps)) + 1 }, (_, i) => i * rulerStep(pps)).map(sec => (
                <span key={sec} data-lane="1" style={{ position: 'absolute', left: sec * pps, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text3)', borderLeft: '1px solid color-mix(in srgb, var(--tint) 30%, transparent)', paddingLeft: 2, height: 14 }}>{fmtTime(sec, 0)}</span>
              ))}
            </div>
            {/* klip */}
            <div data-lane="1" style={{ position: 'relative', height: 50, marginTop: 4 }}>
              {doc.clips.map((c, i) => {
                const on = sel?.kind === 'clip' && sel.id === c.id
                const color = colorOf(c.src)
                return (
                  <div key={c.id} draggable={!busy}
                    onDragStart={() => { dragId.current = c.id }}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => onDrop(c.id, e)}
                    {...pressable(e => { e.stopPropagation(); setSel({ kind: 'clip', id: c.id }) })} data-timeline="1" aria-pressed={on}
                    title={`${sources[c.src]?.name || c.src} · ${fmtTime(c.in)}–${fmtTime(c.out)}${c.note ? `\n${c.note}` : ''}`}
                    style={{
                      position: 'absolute', left: starts[i] * pps, width: Math.max(4, clipDur(c) * pps - 2), top: 0, bottom: 0,
                      background: tint(color, on ? 33 : 18), border: `2px solid ${on ? color : tint(color, 53)}`, borderRadius: 7,
                      cursor: 'grab', overflow: 'hidden', padding: '3px 5px', boxSizing: 'border-box',
                    }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{i + 1}</div>
                    <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'nowrap' }}>{clipDur(c).toFixed(1)}s</div>
                  </div>
                )
              })}
            </div>
            {/* teks */}
            <div data-lane="1" style={{ position: 'relative', height: 22, marginTop: 5 }}>
              {doc.texts.map(x => {
                const on = sel?.kind === 'text' && sel.id === x.id
                return (
                  <div key={x.id} {...pressable(e => { e.stopPropagation(); setSel({ kind: 'text', id: x.id }) })} data-timeline="1" aria-pressed={on} title={x.text}
                    style={{ position: 'absolute', left: x.start * pps, width: Math.max(10, x.dur * pps - 2), top: 0, bottom: 0, background: on ? 'color-mix(in srgb, var(--c-amber) 45%, transparent)' : 'color-mix(in srgb, var(--c-amber) 22%, transparent)', border: `1px solid ${on ? 'var(--c-amber)' : 'color-mix(in srgb, var(--c-amber) 50%, transparent)'}`, borderRadius: 5, fontSize: 11, padding: '3px 5px', overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer', boxSizing: 'border-box' }}>
                    T {x.text}
                  </div>
                )
              })}
            </div>
            {/* subtitle */}
            {cues.length > 0 && (
              <div data-lane="1" style={{ position: 'relative', height: 10, marginTop: 4 }}>
                {cues.map((cue, i) => (
                  <div key={i} data-lane="1" title={cue.text} style={{ position: 'absolute', left: cue.start * pps, width: Math.max(2, (cue.end - cue.start) * pps - 1), top: 0, bottom: 0, background: 'color-mix(in srgb, var(--c-green) 45%, transparent)', borderRadius: 3 }} />
                ))}
              </div>
            )}
            {/* playhead */}
            <div style={{ position: 'absolute', top: 0, bottom: 0, left: 10 + t * pps, width: 2, background: 'var(--danger)', pointerEvents: 'none' }} />
          </div>
        </div>
      )}

      {/* Inspector */}
      {selClip && (
        <GlassCard color={CC[0]} label={`Klip ${doc.clips.indexOf(selClip) + 1} · ${sources[selClip.src]?.name || ''}`}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <NumField label="Mulai (detik sumber)" value={selClip.in} onCommit={v => updateClip(selClip.id, { in: v })} />
            <NumField label="Selesai (detik sumber)" value={selClip.out} onCommit={v => updateClip(selClip.id, { out: v })} />
            <span style={{ fontSize: 11, color: 'var(--text2)', paddingBottom: 6 }}>Durasi {clipDur(selClip).toFixed(2)}s</span>
          </div>
          {selClip.note && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>Alasan AI: {selClip.note}</div>}
        </GlassCard>
      )}
      {selText && (
        <GlassCard color={CC[3]} label="Teks overlay">
          <textarea value={selText.text} onChange={e => updateText(selText.id, { text: e.target.value })} rows={2}
            style={{ ...inputStyle, width: '100%', fontSize: 12, resize: 'vertical', fontFamily: 'var(--sans)' }} />
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
            <NumField label="Muncul (detik)" value={selText.start} onCommit={v => updateText(selText.id, { start: Math.max(0, v) })} />
            <NumField label="Lama (detik)" value={selText.dur} onCommit={v => updateText(selText.id, { dur: Math.max(0.3, v) })} />
            <div style={{ display: 'flex', gap: 3 }}>
              {[['top', 'Atas'], ['center', 'Tengah'], ['bottom', 'Bawah']].map(([p, l]) => <Btn key={p} small active={selText.pos === p} onClick={() => updateText(selText.id, { pos: p })}>{l}</Btn>)}
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {['S', 'M', 'L'].map(sz => <Btn key={sz} small active={selText.size === sz} onClick={() => updateText(selText.id, { size: sz })}>{sz}</Btn>)}
            </div>
          </div>
        </GlassCard>
      )}

      <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
        Pintasan: Spasi = play/pause · S = split · Delete = hapus · Ctrl+Z / Ctrl+Shift+Z = undo/redo · seret klip untuk mengubah urutan.
        Ekspor direkam real-time di browser (MP4 bila didukung, selain itu WebM).
      </div>
    </div>
  )

  return <MobileLayout isMobile={isMobile} leftPanel={leftPanel} rightPanel={rightPanel} analyzeBtn={exportBtn} drawerLabel="Media & otomatis" />
}

// Format yang benar-benar akan dipakai MediaRecorder di browser ini
function exportFormat() {
  if (typeof MediaRecorder === 'undefined') return 'Ekspor tidak didukung browser ini'
  return MediaRecorder.isTypeSupported('video/mp4') ? 'MP4' : 'WebM'
}

function rulerStep(pps) {
  return [1, 2, 5, 10, 15, 30, 60].find(s => s * pps >= 48) || 60
}

function Slider({ label, value, onChange }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 2, fontSize: 11, color: 'var(--text3)' }}>
      <span>{label}</span>
      <span style={{ fontFamily: 'var(--mono)' }}>{Math.round(v * 100)}%</span>
      <input type="range" min={0} max={1.5} step={0.05} value={v} style={{ gridColumn: '1 / -1' }}
        onChange={e => setV(+e.target.value)} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} />
    </div>
  )
}

function NumField({ label, value, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(Math.round(value * 100) / 100)), [value])
  const commit = () => { const n = parseFloat(draft); if (isFinite(n)) onCommit(Math.round(n * 100) / 100); else setDraft(String(value)) }
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>
      {label}
      <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
        style={{ ...inputStyle, width: 90, fontFamily: 'var(--mono)' }} />
    </label>
  )
}
