import React, { useEffect, useRef, useState } from 'react'
import { useStore } from './hooks/useStore'
import { useMobile, useWidth } from './hooks/useMobile'
import AnalyzeTab from './components/AnalyzeTab'
import ObjectSwapTab from './components/ObjectSwapTab'
import RealisticTab from './components/RealisticTab'
import EditorTab from './components/EditorTab'
import HistoryDrawer from './components/HistoryDrawer'
import Toast from './components/Toast'
import { Icon, tint } from './components/ui'
import { loadSession, saveSession, clearSession } from './utils/db'

const PROVIDERS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
]
const MODELS_BY_PROVIDER = {
  gemini: [
    { id: 'gemini-3.8-flash',       label: '3.8 Flash' },
    { id: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
    { id: 'gemini-2.5-flash',       label: '2.5 Flash' },
  ],
  claude: [
    { id: 'claude-opus-5',   label: 'Opus 5' },
    { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  ],
}
const KEY_HELP = {
  gemini: { url: 'https://aistudio.google.com/apikey', site: 'Google AI Studio' },
  claude: { url: 'https://console.anthropic.com/settings/keys', site: 'Anthropic Console' },
}
const TABS = [
  { id: 'analyze',   label: 'Analisis video', short: 'Analisis', icon: 'analyze' },
  { id: 'swap',      label: 'Prompt gambar',  short: 'Gambar',   icon: 'image' },
  { id: 'realistic', label: 'Variasi',        short: 'Variasi',  icon: 'variations' },
  { id: 'editor',    label: 'Editor',         short: 'Editor',   icon: 'editor' },
]
const SESSION_MAX_VIDEO = 400 * 1024 * 1024

export default function App() {
  const { state, set, showToast } = useStore()
  const isMobile = useMobile()
  const width = useWidth()
  const models = MODELS_BY_PROVIDER[state.provider] || []
  const keyRef = useRef(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [restoreOffer, setRestoreOffer] = useState(undefined) // undefined = belum dicek
  const compact = width < 1560

  // ── Sesi terakhir: tawarkan pemulihan sekali saat halaman dibuka ──
  useEffect(() => {
    loadSession().then(s => setRestoreOffer(s?.analysisData || s?.videoFile || s?.transcript?.length ? s : null))
  }, [])
  function restoreSession() {
    const s = restoreOffer
    const patch = { ...s, videoUrl: null }
    delete patch.savedAt
    if (s.videoFile) patch.videoUrl = URL.createObjectURL(s.videoFile)
    set({ ...patch, activeTab: 'analyze' })
    setRestoreOffer(null)
    showToast('Sesi terakhir dipulihkan')
  }
  function dropSession() { clearSession(); setRestoreOffer(null) }

  // ── Autosave (setelah tawaran pemulihan dijawab) ──
  useEffect(() => {
    if (restoreOffer !== null) return
    if (!state.videoFile && !state.analysisData && !state.transcript?.length) return
    const timer = setTimeout(() => {
      saveSession({
        savedAt: Date.now(),
        videoFile: state.videoFile && state.videoFile.size <= SESSION_MAX_VIDEO ? state.videoFile : null,
        videoMeta: state.videoMeta, scenes: state.scenes, selectedScenes: state.selectedScenes,
        analysisData: state.analysisData, analysisText: state.analysisText,
        transcript: state.transcript, transcriptLang: state.transcriptLang,
        insight: state.insight, story: state.story, variationBase: state.variationBase,
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [restoreOffer, state.videoFile, state.analysisData, state.transcript, state.selectedScenes, state.insight, state.story, state.variationBase, state.scenes])

  const focusKey = () => { keyRef.current?.focus(); keyRef.current?.scrollIntoView?.({ block: 'nearest' }) }
  const ctx = { state, set, showToast, isMobile, focusKey }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh', overflow: isMobile ? 'visible' : 'hidden', height: isMobile ? 'auto' : '100vh', background: 'var(--app-bg)' }}>

      {/* ── HEADER ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: isMobile ? '8px 12px' : '0 16px', minHeight: isMobile ? 'auto' : 54,
        flexWrap: isMobile ? 'wrap' : 'nowrap', rowGap: 8, flexShrink: 0,
        background: 'var(--header-bg)', borderBottom: '1px solid var(--border2)',
        backdropFilter: 'var(--blur)', WebkitBackdropFilter: 'var(--blur)',
        position: 'relative', zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 18, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div aria-hidden style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--c-violet)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, color: '#fff', fontFamily: 'var(--mono)' }}>VP</div>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>VideoPrompt</span>
          </div>
          {!isMobile && (
            <nav aria-label="Menu utama" style={{ display: 'flex', gap: 2 }}>
              {TABS.map(t => {
                const on = state.activeTab === t.id
                return (
                  <button key={t.id} onClick={() => set({ activeTab: t.id })} aria-current={on ? 'page' : undefined} style={{
                    padding: '8px 12px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                    display: 'flex', alignItems: 'center', gap: 7,
                    background: on ? tint('var(--c-violet)', 9) : 'transparent',
                    border: 'none', borderRadius: 7,
                    color: on ? 'var(--text)' : 'var(--text3)', cursor: 'pointer',
                    boxShadow: on ? 'inset 0 -2px 0 var(--accent)' : 'none',
                  }}><Icon name={t.icon} size={16} />{width < 1280 ? t.short : t.label}</button>
                )
              })}
            </nav>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...(isMobile ? { width: '100%', minWidth: 0, flexWrap: 'wrap' } : { minWidth: 0 }) }}>
          {state.totalTokens > 0 && !compact && (
            <div className="num" title="Total token yang dipakai di sesi ini" style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
              {state.totalTokens.toLocaleString('id-ID')} token
            </div>
          )}
          <div role="radiogroup" aria-label="Provider AI" style={{ display: 'flex', gap: 2, padding: 2, background: tint('var(--tint)', 8), borderRadius: 8, flexShrink: 0 }}>
            {PROVIDERS.map(p => {
              const on = state.provider === p.id
              return (
                <button key={p.id} role="radio" aria-checked={on} onClick={() => set({ provider: p.id })} style={{
                  padding: '5px 10px', fontSize: 12, fontWeight: 650,
                  background: on ? 'var(--paper)' : 'transparent', border: on ? '1px solid var(--border2)' : '1px solid transparent',
                  color: on ? 'var(--text)' : 'var(--text3)', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap',
                }}>{p.label}</button>
              )
            })}
          </div>
          {compact ? (
            <select value={state.model} onChange={e => set({ model: e.target.value })} aria-label="Model AI" style={{ fontSize: 12, padding: '6px 8px', background: 'var(--paper)', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', ...(isMobile ? { flex: 1, minWidth: 0 } : { flexShrink: 0 }) }}>
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          ) : (
            <div role="radiogroup" aria-label="Model AI" style={{ display: 'flex', gap: 4 }}>
              {models.map(m => {
                const on = state.model === m.id
                return (
                  <button key={m.id} role="radio" aria-checked={on} onClick={() => set({ model: m.id })} style={{
                    padding: '6px 11px', fontSize: 12, fontWeight: 600,
                    background: on ? 'var(--c-violet)' : 'transparent',
                    border: `1px solid ${on ? 'var(--c-violet)' : 'var(--border2)'}`,
                    color: on ? '#fff' : 'var(--text2)', borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>{m.label}</button>
                )
              })}
            </div>
          )}
          <ApiKeyInput inputRef={keyRef} value={state.apiKey} onChange={v => set({ apiKey: v })} isMobile={isMobile} provider={state.provider} />
          <button onClick={() => setHistoryOpen(true)} title="Riwayat hasil" aria-label="Buka riwayat hasil" style={iconBtn}>
            <Icon name="history" />
          </button>
        </div>
      </header>

      {/* ── Banner: pulihkan sesi / isi API key ── */}
      {restoreOffer && (
        <Banner>
          <span style={{ flex: 1, minWidth: 200 }}>
            Ada sesi kerja yang belum selesai{restoreOffer.videoMeta?.name ? `: ${restoreOffer.videoMeta.name}` : ''} ({new Date(restoreOffer.savedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}).
            {restoreOffer.videoMeta && !restoreOffer.videoFile ? ' Videonya terlalu besar untuk disimpan, jadi perlu diunggah ulang.' : ''}
          </span>
          <button onClick={restoreSession} style={bannerBtnPrimary}>Lanjutkan sesi</button>
          <button onClick={dropSession} style={bannerBtn}>Mulai baru</button>
        </Banner>
      )}
      {!state.apiKey && (
        <Banner>
          <span style={{ flex: 1, minWidth: 220 }}>
            Belum ada API key {state.provider === 'claude' ? 'Claude' : 'Gemini'}. Buat gratis di{' '}
            <a href={KEY_HELP[state.provider].url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>{KEY_HELP[state.provider].site}</a>,
            lalu tempel di kolom key. Key hanya disimpan di browser ini dan dikirim langsung ke {state.provider === 'claude' ? 'Anthropic' : 'Google'}.
          </span>
          <button onClick={focusKey} style={bannerBtnPrimary}>Isi API key</button>
        </Banner>
      )}

      {/* ── KONTEN ── */}
      <main style={{ flex: 1, overflow: isMobile ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column', paddingBottom: isMobile ? 72 : 0, minHeight: 0 }}>
        {state.activeTab === 'analyze'   && <AnalyzeTab    {...ctx} />}
        {state.activeTab === 'swap'      && <ObjectSwapTab {...ctx} />}
        {state.activeTab === 'realistic' && <RealisticTab  {...ctx} />}
        {state.activeTab === 'editor'    && <EditorTab     {...ctx} />}
      </main>

      <nav className="bottom-nav" aria-label="Menu utama">
        {TABS.map(t => {
          const on = state.activeTab === t.id
          return (
            <button key={t.id} onClick={() => set({ activeTab: t.id })} aria-current={on ? 'page' : undefined} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              gap: 3, padding: '6px 4px', border: 'none', cursor: 'pointer',
              background: 'none', color: on ? 'var(--accent)' : 'var(--text3)',
              boxShadow: on ? 'inset 0 2px 0 var(--accent)' : 'none',
            }}>
              <Icon name={t.icon} size={22} />
              <span style={{ fontSize: 11, fontWeight: 650 }}>{t.short}</span>
            </button>
          )
        })}
      </nav>

      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} set={set} showToast={showToast} />
      <Toast toast={state.toast} />
    </div>
  )
}

const iconBtn = { width: 36, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', cursor: 'pointer', flexShrink: 0 }
const bannerBtn = { padding: '6px 12px', fontSize: 12, fontWeight: 600, background: 'var(--paper)', border: '1px solid var(--border2)', borderRadius: 7, color: 'var(--text2)', cursor: 'pointer' }
const bannerBtnPrimary = { ...bannerBtn, background: 'var(--grad-primary)', border: 'none', color: 'var(--on-accent)' }

function Banner({ children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '8px 16px', fontSize: 13, color: 'var(--text2)', background: tint('var(--accent)', 7), borderBottom: '1px solid var(--border2)', flexShrink: 0 }}>
      {children}
    </div>
  )
}

function ApiKeyInput({ value, onChange, isMobile, provider, inputRef }) {
  const [show, setShow] = useState(false)
  const [help, setHelp] = useState(false)
  const saved = !!value
  const name = provider === 'claude' ? 'Claude' : 'Gemini'
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4, ...(isMobile ? { flex: '1 1 100%', minWidth: 0, order: 5 } : {}) }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', ...(isMobile ? { flex: 1, minWidth: 0 } : {}) }}>
        <input
          ref={inputRef}
          type={show ? 'text' : 'password'}
          placeholder={`API key ${name}`}
          aria-label={`API key ${name}`}
          autoComplete="off" spellCheck={false}
          value={value}
          onChange={e => onChange(e.target.value.trim())}
          style={{
            width: isMobile ? '100%' : 176,
            padding: isMobile ? '7px 100px 7px 10px' : '7px 64px 7px 10px', fontSize: 12, fontFamily: 'var(--mono)',
            background: 'var(--paper)', border: `1px solid ${saved ? 'var(--c-green)' : 'var(--border2)'}`,
            borderRadius: 7, color: 'var(--text)',
          }}
        />
        <div style={{ position: 'absolute', right: 2, display: 'flex', alignItems: 'center' }}>
          <button onClick={() => setShow(s => !s)} aria-label={show ? 'Sembunyikan key' : 'Tampilkan key'} title={show ? 'Sembunyikan key' : 'Tampilkan key'} style={keyBtn}>{show ? 'Tutup' : 'Lihat'}</button>
          {value && <button onClick={() => onChange('')} aria-label="Hapus key dari browser ini" title="Hapus key dari browser ini" style={keyBtn}>✕</button>}
        </div>
      </div>
      {!isMobile && saved && <span style={{ fontSize: 11, color: 'var(--c-green)', whiteSpace: 'nowrap' }}>Tersimpan</span>}
      <button onClick={() => setHelp(h => !h)} aria-expanded={help} aria-label="Tentang penyimpanan API key" title="Tentang penyimpanan API key" style={{ ...iconBtn, width: 30, border: 'none' }}><Icon name="info" size={16} /></button>
      {help && (
        <div role="dialog" aria-label="Tentang API key" onKeyDown={e => e.key === 'Escape' && setHelp(false)}
          style={{ position: 'absolute', top: '100%', right: 0, marginTop: 6, width: 300, zIndex: 60, background: 'var(--paper)', border: '1px solid var(--border2)', borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.6, color: 'var(--text2)', boxShadow: '0 8px 24px rgba(20,18,15,0.12)' }}>
          <strong style={{ color: 'var(--text)' }}>Ke mana key {name} pergi?</strong>
          <ul style={{ paddingLeft: 16, margin: '6px 0' }}>
            <li>Disimpan di localStorage browser ini saja, terpisah untuk Gemini dan Claude.</li>
            <li>Dikirim langsung dari browser ke {provider === 'claude' ? 'api.anthropic.com' : 'generativelanguage.googleapis.com'} lewat header, tidak lewat server lain.</li>
            <li>Tidak ikut tersimpan di riwayat, sesi otomatis, maupun file ekspor.</li>
            <li>Hapus kapan saja dengan tombol ✕ di kolom key.</li>
          </ul>
          <button onClick={() => setHelp(false)} style={{ ...keyBtn, border: '1px solid var(--border2)', borderRadius: 6, padding: '4px 10px' }}>Tutup</button>
        </div>
      )}
    </div>
  )
}
const keyBtn = { background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 11, padding: '4px 6px' }
