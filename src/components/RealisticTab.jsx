import React, { useState } from 'react'
import { callAI } from '../utils/gemini'
import { VIDEO_PLATFORMS, videoTargetName } from '../config/platforms'
import { lockInstruction } from '../utils/analysis'
import { addHistory } from '../utils/db'
import MobileLayout from './MobileLayout'
import LockCard from './LockCard'
import { GlassCard, Btn, PrimaryBtn, ActionBtn, Seg, Toggle, Spin, Note, CC, tint, inputStyle, copyText, downloadText, SelField } from './ui'

const THEMES = [
  { id: 'same',      label: 'Sama dengan prompt dasar', desc: 'Variasi sudut, momen, dan komposisi saja' },
  { id: 'pov',       label: 'POV',                  desc: 'Sudut pandang orang pertama' },
  { id: 'travel',    label: 'Perjalanan sinematik', desc: 'Lanskap dan tempat yang estetik' },
  { id: 'transform', label: 'Sebelum/sesudah',      desc: 'Transformasi dengan momen reveal' },
  { id: 'darkacademia', label: 'Dark academia',     desc: 'Suasana muram dan misterius' },
  { id: 'neon',      label: 'Kota neon malam',      desc: 'Urban, lampu neon, cyberpunk' },
  { id: 'emotional', label: 'Momen emosional',      desc: 'Cerita yang terasa nyata' },
  { id: 'surreal',   label: 'Surreal',              desc: 'Adegan yang mustahil, seperti mimpi' },
  { id: 'fashion',   label: 'Outfit reveal',        desc: 'Transisi gaya dan pakaian' },
  { id: 'asmr',      label: 'Tenang / ASMR',        desc: 'Slow motion yang memuaskan' },
  { id: 'hype',      label: 'Motivasi',             desc: 'Energi tinggi, kerja keras' },
  { id: 'dance',     label: 'Sinkron musik',        desc: 'Gerakan mengikuti ketukan' },
  { id: 'horror',    label: 'Thriller',             desc: 'Ketegangan dan kejutan' },
  { id: 'custom',    label: 'Tema sendiri',         desc: 'Tulis temanya' },
]
const AXES = [
  { value: 'mixed',    label: 'Campur' },
  { value: 'camera',   label: 'Kamera' },
  { value: 'lighting', label: 'Cahaya' },
  { value: 'moment',   label: 'Momen' },
  { value: 'setting',  label: 'Latar' },
]
const AXIS_INSTR = {
  mixed: 'Vary whatever makes each variation most distinct.',
  camera: 'Vary mainly the camera: shot size, angle, lens and movement. Keep the action similar.',
  lighting: 'Vary mainly lighting and color grade (time of day, light direction, mood).',
  moment: 'Vary mainly the moment and action shown, as if from different points of the same story.',
  setting: 'Vary mainly the location/background while the subject stays the same.',
}

export default function RealisticTab({ state, set, showToast, isMobile, focusKey }) {
  const promptMode = VIDEO_PLATFORMS[state.promptMode] ? state.promptMode : 'kling'
  const [theme, setTheme] = useState('same')
  const [customTheme, setCustomTheme] = useState('')
  const [count, setCount] = useState(3)
  const [axis, setAxis] = useState('mixed')
  const [keepSubject, setKeepSubject] = useState(true)
  const [keepStyle, setKeepStyle] = useState(false)
  const [includeAudio, setIncludeAudio] = useState(true)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState({})
  const basePrompt = state.variationBase || ''
  const setBasePrompt = v => set({ variationBase: v })
  const target = videoTargetName(promptMode, state.customTarget)

  // Buka entri riwayat
  React.useEffect(() => {
    const r = state.restore
    if (!r || r.kind !== 'variations') return
    setResults(r.data?.results || [])
    set({ restore: null, ...(r.data?.base ? { variationBase: r.data.base } : {}) })
  }, [state.restore])

  async function generateVariations() {
    if (!basePrompt.trim()) return showToast('Isi prompt dasar dulu', true)
    if (!state.apiKey) { showToast('Isi API key dulu', true); return focusKey?.() }
    if (theme === 'custom' && !customTheme.trim()) return showToast('Tulis temanya dulu', true)

    setLoading(true); setError(null)
    setResults([])
    const t = THEMES.find(x => x.id === theme)
    const themeLine = theme === 'same' ? 'Keep the theme and atmosphere of the base prompt.'
      : `All variations share the THEME: "${theme === 'custom' ? customTheme.trim() : `${t.label} (${t.desc})`}".`
    const keeps = [
      keepSubject && 'Keep the main subject (person/product/character) exactly as described in the base prompt in every variation.',
      keepStyle && 'Keep the visual style, color grade and lens look of the base prompt in every variation.',
    ].filter(Boolean).join('\n')

    try {
      const prompt = `You are an expert AI video prompt engineer for ${target}.
Platform style: ${VIDEO_PLATFORMS[promptMode].note}

BASE PROMPT:
${basePrompt}

TASK: Write ${count} clearly different video prompt variations.
${themeLine}
${AXIS_INSTR[axis]}
${keeps}
${lockInstruction(state.lock)}

Each variation must be a different scene, angle, moment, or perspective and be ready to paste into ${target}.

OUTPUT FORMAT. Write EXACTLY like this, no asterisks, no markdown, no bullet symbols:

=== VARIATION 1 ===
Beda: what is different from the base prompt, at most 8 words, in Bahasa Indonesia
Judul: a short name for this variation, at most 4 words, in Bahasa Indonesia

[Main prompt paragraph: setting, atmosphere, key elements]

[00-02s]
What happens.

[02-04s]
What happens.

[continue per 2s until end]

Camera:
Camera movement and style.

Environment:
Setting and atmosphere details.

Audio:
${includeAudio ? 'Sound design: music genre/mood, ambient sounds, key audio elements.' : 'None.'}

Style:
Visual style and aesthetic.

=== VARIATION 2 ===
[same structure]

STRICT RULES:
- Plain text only. No asterisks, no **bold**, no bullet points.
- Each variation is self-contained: never write "same as above".
- The "Beda" line must name the real difference, e.g. "kamera statis, close-up wajah" or "cahaya senja hangat".`

      const { text, tokens } = await callAI({ provider: state.provider, apiKey: state.apiKey, model: state.model, prompt, temperature: 0.85 })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))

      const parts = text.split(/===\s*VARIATION\s*\d+\s*===/i).filter(p => p.trim())
      const parsed = (parts.length ? parts : [text]).map((p, i) => {
        let body = p.trim()
        const diff = body.match(/^Beda\s*:\s*(.+)$/im)?.[1]?.trim() || ''
        const title = body.match(/^Judul\s*:\s*(.+)$/im)?.[1]?.trim() || ''
        body = body.replace(/^Beda\s*:.*$/im, '').replace(/^Judul\s*:.*$/im, '').trim()
        return { index: i + 1, title, diff, prompt: body }
      })
      setResults(parsed)
      addHistory({ kind: 'variations', title: parsed.map(r => r.title || `Variasi ${r.index}`).join(' · ').slice(0, 120), platform: target, text: parsed.map(r => r.prompt).join('\n\n'), data: { base: basePrompt, results: parsed } })
      showToast(`${parsed.length} variasi siap`)
    } catch (e) {
      setError(e.message)
      showToast('Gagal: ' + e.message, true)
    }
    setLoading(false)
  }

  function copy(text, key) {
    copyText(text, showToast).then(ok => {
      if (!ok) return
      setCopied(p => ({ ...p, [key]: true }))
      setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 1800)
    })
  }

  const generateBtn = (
    <PrimaryBtn onClick={generateVariations} disabled={loading}>
      {loading ? <><Spin /> Menulis variasi…</> : `Buat ${count} variasi`}
    </PrimaryBtn>
  )

  const leftPanel = (
    <>
      <GlassCard color={CC[0]} label="Platform tujuan">
        <SelField value={promptMode} onChange={v => set({ promptMode: v })} label="Platform tujuan"
          options={Object.entries(VIDEO_PLATFORMS).map(([id, p]) => ({ value: id, label: p.name }))} />
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Sama dengan pilihan di tab Analisis.</div>
      </GlassCard>

      <GlassCard color={CC[2]} label="Yang dibuat berbeda">
        <Seg value={axis} onChange={setAxis} options={AXES} label="Yang dibuat berbeda" />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
          <Toggle on={keepSubject} onClick={() => setKeepSubject(v => !v)} title="Subjek utama tidak berubah di semua variasi">Kunci subjek</Toggle>
          <Toggle on={keepStyle} onClick={() => setKeepStyle(v => !v)} title="Gaya visual dan color grade tidak berubah">Kunci gaya visual</Toggle>
          <Toggle on={includeAudio} onClick={() => setIncludeAudio(v => !v)} title="Tambahkan bagian audio di setiap variasi">Sertakan audio</Toggle>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', margin: '10px 0 4px' }}>Jumlah variasi</div>
        <Seg value={count} onChange={setCount} label="Jumlah variasi" options={[1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} />
      </GlassCard>

      <GlassCard color={CC[1]} label="Tema">
        <div role="radiogroup" aria-label="Tema" style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {THEMES.map(t => {
            const on = theme === t.id
            return (
              <button key={t.id} role="radio" aria-checked={on} onClick={() => setTheme(t.id)} style={{
                width: '100%', padding: '7px 10px', fontSize: 12, textAlign: 'left',
                display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap',
                background: on ? tint('var(--c-violet)', 10) : 'transparent',
                border: `1px solid ${on ? 'var(--c-violet)' : 'transparent'}`,
                color: on ? 'var(--c-violet)' : 'var(--text2)', borderRadius: 7, cursor: 'pointer',
              }}>
                <span style={{ fontWeight: 600 }}>{t.label}</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{t.desc}</span>
              </button>
            )
          })}
        </div>
        {theme === 'custom' && (
          <input value={customTheme} onChange={e => setCustomTheme(e.target.value)} aria-label="Tema sendiri"
            placeholder="mis. peradaban bawah laut, mitologi Jawa" style={{ ...inputStyle, width: '100%', marginTop: 8 }} />
        )}
      </GlassCard>

      {state.advanced && <LockCard lock={state.lock} set={set} />}
    </>
  )

  const rightPanel = (
    <>
      <div style={{ padding: isMobile ? '10px 12px' : '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 6 }}>
          <label htmlFor="var-base" style={{ fontSize: 13, fontWeight: 650, color: 'var(--text)' }}>Prompt dasar</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {state.analysisText && state.analysisText !== basePrompt && (
              <Btn small onClick={() => setBasePrompt(state.analysisText)}>Ambil dari hasil Analisis</Btn>
            )}
            <Btn small onClick={() => setBasePrompt('')} disabled={!basePrompt}>Kosongkan</Btn>
          </div>
        </div>
        <textarea id="var-base"
          value={basePrompt}
          onChange={e => setBasePrompt(e.target.value)}
          placeholder="Tulis prompt dasar, atau kirim dari tab Analisis lewat tombol Buat variasi"
          style={{ ...inputStyle, width: '100%', minHeight: isMobile ? 80 : 100, maxHeight: 200, padding: '9px 11px', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {error && !loading && (
          <Note tone="error">Gagal membuat variasi: {error} <Btn small onClick={generateVariations} style={{ marginLeft: 6 }}>Coba lagi</Btn></Note>
        )}
        {results.length === 0 && !loading && !error && (
          <Note>
            Pilih apa yang dibuat berbeda (kamera, cahaya, momen, atau latar), tentukan jumlahnya, lalu tekan <strong>Buat variasi</strong>. Setiap hasil diberi keterangan bagian yang berubah.
          </Note>
        )}

        {loading && Array.from({ length: count }).map((_, i) => (
          <GlassCard key={i} color={CC[0]} label={`Variasi ${i + 1}`}>
            <div style={{ height: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, animation: 'pulse 1.2s infinite' }}>
              Menulis variasi {i + 1} dari {count}…
            </div>
          </GlassCard>
        ))}

        {results.length > 0 && !loading && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{results.length} variasi · {target}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <ActionBtn copied={copied.all} onClick={() => copy(results.map(r => `=== ${r.title || `Variasi ${r.index}`} ===\n${r.prompt}`).join('\n\n'), 'all')}>Salin semua</ActionBtn>
                <ActionBtn onClick={() => downloadText(results.map(r => `=== VARIASI ${r.index}${r.title ? ` · ${r.title}` : ''} ===\n${r.diff ? `Beda: ${r.diff}\n\n` : ''}${r.prompt}`).join('\n\n'), 'variasi-video.txt')}>Unduh .txt</ActionBtn>
              </div>
            </div>

            {results.map((r, i) => (
              <GlassCard key={i} color={CC[i % CC.length]} label={`${r.index}. ${r.title || 'Variasi'}`}>
                {r.diff && <div style={{ fontSize: 12, color: 'var(--c-violet)', fontWeight: 600, marginBottom: 6 }}>Beda: {r.diff}</div>}
                <div style={{ background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7, padding: '10px 12px', fontSize: 13, lineHeight: 1.7, color: 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{r.prompt}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <ActionBtn copied={copied['v' + i]} onClick={() => copy(r.prompt, 'v' + i)}>Salin</ActionBtn>
                  <ActionBtn onClick={() => { setBasePrompt(r.prompt); showToast('Dipakai sebagai prompt dasar') }}>Jadikan prompt dasar</ActionBtn>
                </div>
              </GlassCard>
            ))}
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
      analyzeBtn={generateBtn}
      drawerLabel="Pengaturan variasi"
    />
  )
}
