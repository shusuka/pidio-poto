import React, { useEffect, useState } from 'react'
import { GlassCard, Btn, PrimaryBtn, Spin, Empty, inputStyle, CC } from './ui'
import { callAI, parseJsonResponse } from '../utils/gemini'
import { buildTranscriptPrompt, normalizeTranscript, toSRT, toVTT, toPlainTranscript, newSegId } from '../utils/analysis'
import { fmtTime, parseTime, downloadBlob } from '../utils/media'

function TimeInput({ value, onCommit }) {
  const [draft, setDraft] = useState(fmtTime(value))
  useEffect(() => setDraft(fmtTime(value)), [value])
  const commit = () => {
    const t = parseTime(draft)
    if (isFinite(t)) onCommit(Math.round(t * 100) / 100)
    else setDraft(fmtTime(value))
  }
  return (
    <input value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
      style={{ ...inputStyle, width: 64, fontFamily: 'var(--mono)', fontSize: 10, padding: '4px 5px' }} />
  )
}

// Transkrip bertimestamp: buat otomatis (Gemini), koreksi manual, cari momen, ekspor subtitle.
export default function TranscriptPanel({ state, set, showToast, videoRef }) {
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [now, setNow] = useState(0)
  const segments = state.transcript || []
  const isClaude = state.provider === 'claude'

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const fn = () => setNow(v.currentTime)
    v.addEventListener('timeupdate', fn)
    return () => v.removeEventListener('timeupdate', fn)
  }, [videoRef, state.videoUrl])

  async function generate() {
    if (!state.videoFile) return showToast('Upload video dulu!', true)
    if (!state.apiKey) return showToast('Masukkan API key!', true)
    if (isClaude) return showToast('Transkripsi butuh Gemini (Claude tidak bisa mendengar audio).', true)
    if (segments.length && !confirm('Ganti transkrip yang ada (termasuk koreksi manual)?')) return
    setLoading(true)
    try {
      const { text, tokens } = await callAI({
        provider: state.provider, apiKey: state.apiKey, model: state.model,
        prompt: buildTranscriptPrompt({ duration: state.videoMeta?.duration }),
        mediaFile: state.videoFile, json: true, temperature: 0.2,
      })
      const parsed = parseJsonResponse(text)
      if (!parsed) throw new Error('Respons transkrip bukan JSON yang valid.')
      const { segments: segs, language } = normalizeTranscript(parsed, state.videoMeta?.duration)
      set(prev => ({ transcript: segs, transcriptLang: language, totalTokens: prev.totalTokens + tokens }))
      showToast(segs.length ? `${segs.length} segmen transkrip ✓` : 'Tidak ada ucapan terdeteksi')
    } catch (e) { showToast('Error: ' + e.message, true) }
    setLoading(false)
  }

  const update = (id, patch) => set(prev => ({
    transcript: prev.transcript.map(s => s.id === id ? { ...s, ...patch } : s).sort((a, b) => a.start - b.start),
  }))
  const remove = id => set(prev => ({ transcript: prev.transcript.filter(s => s.id !== id) }))
  const addRow = () => {
    const t = videoRef.current?.currentTime || (segments.at(-1)?.end ?? 0)
    set(prev => ({ transcript: [...(prev.transcript || []), { id: newSegId(), start: Math.round(t * 100) / 100, end: Math.round((t + 2) * 100) / 100, speaker: '', text: '' }].sort((a, b) => a.start - b.start) }))
  }
  const seek = t => { const v = videoRef.current; if (v) { v.currentTime = t; v.play().catch(() => {}) } }
  const base = (state.videoMeta?.name || 'video').replace(/\.[^.]+$/, '')

  const q = query.trim().toLowerCase()
  const shown = q ? segments.filter(s => s.text.toLowerCase().includes(q) || s.speaker.toLowerCase().includes(q)) : segments

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <GlassCard color={CC[2]} label="Transkrip & Subtitle">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 200px' }}>
            <PrimaryBtn onClick={generate} disabled={loading || !state.videoFile || isClaude} gradient="linear-gradient(135deg,#18c98a,#4f7ef7)">
              {loading ? <><Spin /> Mentranskripsi…</> : segments.length ? '↻ Buat ulang transkrip' : '🗣 Buat transkrip otomatis'}
            </PrimaryBtn>
          </div>
          <Btn onClick={addRow} disabled={!state.videoFile}>＋ Baris</Btn>
          <Btn active={state.subtitleOnVideo} color="#18c98a" onClick={() => set({ subtitleOnVideo: !state.subtitleOnVideo })} disabled={!segments.length}>
            {state.subtitleOnVideo ? '✓ ' : ''}Subtitle di video
          </Btn>
        </div>
        {isClaude && <div style={{ marginTop: 7, fontSize: 10, color: '#f5a623' }}>Transkripsi otomatis butuh provider Gemini. Anda tetap bisa menulis transkrip manual.</div>}
        {segments.length > 0 && (
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>{segments.length} segmen{state.transcriptLang ? ` · ${state.transcriptLang}` : ''} · Ekspor:</span>
            <Btn small onClick={() => downloadBlob(new Blob([toSRT(segments)], { type: 'text/plain' }), `${base}.srt`)}>SRT</Btn>
            <Btn small onClick={() => downloadBlob(new Blob([toVTT(segments)], { type: 'text/vtt' }), `${base}.vtt`)}>VTT</Btn>
            <Btn small onClick={() => downloadBlob(new Blob([toPlainTranscript(segments)], { type: 'text/plain' }), `${base}-transkrip.txt`)}>TXT</Btn>
            <Btn small onClick={() => { navigator.clipboard.writeText(toPlainTranscript(segments)); showToast('Transkrip disalin!') }}>📋 Salin</Btn>
          </div>
        )}
      </GlassCard>

      {segments.length > 0 && (
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="🔍 Cari kata / momen di transkrip…"
          style={{ ...inputStyle, width: '100%', padding: '8px 10px', fontSize: 12 }} />
      )}

      {!segments.length && !loading && (
        <Empty>Buat transkrip untuk subtitle bertimestamp, pencarian momen,<br />dan fitur “Potong jeda” di tab Editor. Semua baris bisa dikoreksi manual.</Empty>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {shown.map(s => {
          const active = now >= s.start && now < s.end
          return (
            <div key={s.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: 6, borderRadius: 9, background: active ? 'rgba(24,201,138,0.12)' : 'rgba(255,255,255,0.5)', border: `1px solid ${active ? 'rgba(24,201,138,0.45)' : 'rgba(100,120,220,0.12)'}`, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => seek(s.start)} title="Putar dari sini" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 12, marginTop: 4 }}>▶</button>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <TimeInput value={s.start} onCommit={v => update(s.id, { start: v, end: Math.max(v + 0.1, s.end) })} />
                <TimeInput value={s.end} onCommit={v => update(s.id, { end: Math.max(s.start + 0.1, v) })} />
              </div>
              <input value={s.speaker} onChange={e => update(s.id, { speaker: e.target.value })} placeholder="Pembicara"
                style={{ ...inputStyle, width: 86, fontSize: 10 }} />
              <textarea value={s.text} onChange={e => update(s.id, { text: e.target.value })} rows={1}
                style={{ ...inputStyle, flex: '1 1 180px', fontSize: 12, lineHeight: 1.5, resize: 'vertical', fieldSizing: 'content', minHeight: 30, fontFamily: 'var(--sans)' }} />
              <button type="button" onClick={() => remove(s.id)} title="Hapus baris" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>🗑</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
