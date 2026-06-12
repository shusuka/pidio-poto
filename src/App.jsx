import React from 'react'
import { useStore } from './hooks/useStore'
import { useMobile } from './hooks/useMobile'
import AnalyzeTab from './components/AnalyzeTab'
import ObjectSwapTab from './components/ObjectSwapTab'
import RealisticTab from './components/RealisticTab'
import Toast from './components/Toast'

const PROVIDERS = [
  { id: 'gemini', label: 'Gemini' },
  { id: 'claude', label: 'Claude' },
]
const MODELS_BY_PROVIDER = {
  gemini: [
    { id: 'gemini-3-flash-preview',         label: '3 Flash ⚡' },
    { id: 'gemini-2.5-flash-preview-05-20', label: '2.5 Flash' },
  ],
  claude: [
    { id: 'claude-opus-4-8',   label: 'Opus 4.8 ⚡' },
    { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  ],
}
const TABS = [
  { id: 'analyze',   label: '🎬 Analyze',        short: '🎬', shortLabel: 'Analyze' },
  { id: 'swap',      label: '🖼 Image Prompt',   short: '🖼', shortLabel: 'Image' },
  { id: 'realistic', label: '✨ Video Variations', short: '✨', shortLabel: 'Variations' },
]

export default function App() {
  const { state, set, showToast } = useStore()
  const isMobile = useMobile()
  const models = MODELS_BY_PROVIDER[state.provider] || []

  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:'100dvh', overflow: isMobile ? 'visible' : 'hidden', height: isMobile ? 'auto' : '100vh', background:'linear-gradient(135deg,#e8eeff 0%,#f5eeff 50%,#eef5ff 100%)' }}>

      {/* ── TOP BAR ── */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding: isMobile ? '0 12px' : '0 20px',
        height: isMobile ? 48 : 52,
        flexShrink: 0,
        background:'rgba(255,255,255,0.7)',
        borderBottom:'1px solid rgba(100,120,220,0.15)',
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        boxShadow:'0 2px 20px rgba(80,100,200,0.08)',
        position: isMobile ? 'sticky' : 'relative',
        top: 0, zIndex: 20,
      }}>
        {/* Logo */}
        <div style={{ display:'flex', alignItems:'center', gap: isMobile ? 8 : 16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#4f7ef7,#9b6bf5)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, fontWeight:700, color:'white', fontFamily:'var(--mono)', boxShadow:'0 4px 12px rgba(100,130,250,0.35)', flexShrink:0 }}>VP</div>
            <span style={{ fontSize: isMobile ? 13 : 14, fontWeight:700, color:'var(--text)', letterSpacing:'-0.02em' }}>VideoPrompt</span>
            <span style={{ fontSize:9, color:'#9b6bf5', background:'rgba(155,107,245,0.12)', padding:'2px 6px', borderRadius:10, fontWeight:600, border:'1px solid rgba(155,107,245,0.25)' }}>PRO</span>
          </div>
          {/* Desktop nav only */}
          {!isMobile && (
            <nav style={{ display:'flex', gap:4 }}>
              {TABS.map(t => (
                <button key={t.id} onClick={() => set({activeTab:t.id})} style={{
                  padding:'8px 18px', fontSize:13, fontWeight:600,
                  background: state.activeTab===t.id ? 'linear-gradient(135deg,rgba(79,126,247,0.15),rgba(155,107,245,0.12))' : 'rgba(255,255,255,0.5)',
                  border: state.activeTab===t.id ? '1.5px solid rgba(79,126,247,0.4)' : '1.5px solid rgba(100,120,220,0.15)',
                  color: state.activeTab===t.id ? 'var(--accent)' : 'var(--text3)',
                  borderRadius:10, cursor:'pointer', transition:'all 0.18s',
                  boxShadow: state.activeTab===t.id ? '0 3px 12px rgba(79,126,247,0.18)' : 'none',
                }}>{t.label}</button>
              ))}
            </nav>
          )}
        </div>

        {/* Right side */}
        <div style={{ display:'flex', alignItems:'center', gap: isMobile ? 6 : 8 }}>
          {state.totalTokens > 0 && !isMobile && (
            <div style={{ fontSize:10, color:'var(--text3)', fontFamily:'var(--mono)', padding:'3px 9px', background:'rgba(100,120,220,0.08)', borderRadius:6, border:'1px solid var(--border)' }}>
              {state.totalTokens.toLocaleString()} tok
            </div>
          )}
          {/* Provider toggle (Gemini / Claude) */}
          <div style={{ display:'flex', gap:3, padding:3, background:'rgba(255,255,255,0.6)', border:'1.5px solid rgba(100,120,220,0.2)', borderRadius:9 }}>
            {PROVIDERS.map(p => (
              <button key={p.id} onClick={() => set({ provider: p.id })} title={`Provider: ${p.label}`} style={{
                padding: isMobile ? '4px 8px' : '5px 12px', fontSize: isMobile ? 10 : 11, fontWeight:700,
                background: state.provider===p.id ? 'linear-gradient(135deg,#4f7ef7,#9b6bf5)' : 'transparent',
                border:'none', color: state.provider===p.id ? 'white' : 'var(--text3)',
                borderRadius:7, cursor:'pointer', whiteSpace:'nowrap',
              }}>{p.label}</button>
            ))}
          </div>
          {/* Model picker — icon only on mobile */}
          {!isMobile && (
            <div style={{ display:'flex', gap:5 }}>
              {models.map(m => (
                <button key={m.id} onClick={() => set({model:m.id})} style={{
                  padding:'7px 14px', fontSize:12, fontWeight:600,
                  background: state.model===m.id ? 'linear-gradient(135deg,#4f7ef7,#9b6bf5)' : 'rgba(255,255,255,0.7)',
                  border:`1.5px solid ${state.model===m.id ? 'transparent' : 'rgba(100,120,220,0.2)'}`,
                  color: state.model===m.id ? 'white' : 'var(--text2)',
                  borderRadius:9, cursor:'pointer', whiteSpace:'nowrap',
                  boxShadow: state.model===m.id ? '0 4px 14px rgba(100,130,250,0.35)' : 'none',
                }}>{m.label}</button>
              ))}
            </div>
          )}
          {/* Model select compact on mobile */}
          {isMobile && (
            <select value={state.model} onChange={e => set({model:e.target.value})} style={{ fontSize:10, padding:'4px 6px', background:'rgba(255,255,255,0.8)', border:'1px solid rgba(100,120,220,0.2)', borderRadius:7, color:'var(--text2)', outline:'none' }}>
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          )}
          <ApiKeyInput value={state.apiKey} onChange={v => set({apiKey:v})} isMobile={isMobile} provider={state.provider} />
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main style={{ flex:1, overflow: isMobile ? 'visible' : 'hidden', display:'flex', flexDirection:'column', paddingBottom: isMobile ? 80 : 0 }}>
        {state.activeTab==='analyze'   && <AnalyzeTab    state={state} set={set} showToast={showToast} isMobile={isMobile} />}
        {state.activeTab==='swap'      && <ObjectSwapTab state={state} set={set} showToast={showToast} isMobile={isMobile} />}
        {state.activeTab==='realistic' && <RealisticTab  state={state} set={set} showToast={showToast} isMobile={isMobile} />}
      </main>

      {/* ── BOTTOM NAV (mobile only) ── */}
      <nav className="bottom-nav">
        {TABS.map(t => (
          <button key={t.id} onClick={() => set({activeTab:t.id})} style={{
            flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            gap:4, padding:'6px 4px', border:'none', cursor:'pointer',
            background: state.activeTab===t.id ? 'rgba(79,126,247,0.08)' : 'none',
            color: state.activeTab===t.id ? 'var(--accent)' : 'var(--text3)',
            borderTop: `3px solid ${state.activeTab===t.id ? 'var(--accent)' : 'transparent'}`,
            transition:'all 0.15s',
          }}>
            <span style={{ fontSize:24, lineHeight:1 }}>{t.short}</span>
            <span style={{ fontSize:10, fontWeight:700, letterSpacing:'0.02em' }}>{t.shortLabel}</span>
          </button>
        ))}
      </nav>

      <Toast toast={state.toast} />
    </div>
  )
}

function ApiKeyInput({ value, onChange, isMobile, provider }) {
  const [show, setShow] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const saved = !!value
  const label = provider === 'claude' ? 'Claude API key...' : 'Gemini API key...'
  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center' }}>
      <input
        type={show?'text':'password'}
        placeholder={isMobile ? 'API key...' : label}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: isMobile ? 110 : 185,
          padding:'5px 46px 5px 11px', fontSize:11,
          fontFamily:'var(--mono)',
          background: focused ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)',
          border:`1.5px solid ${focused ? 'var(--accent)' : saved ? 'rgba(24,201,138,0.4)' : 'rgba(100,120,220,0.2)'}`,
          borderRadius:8, color:'var(--text)', outline:'none', transition:'all 0.15s',
          boxShadow: focused ? '0 0 0 3px rgba(79,126,247,0.12)' : 'none',
        }}
      />
      {saved && !focused && (
        <span style={{ position:'absolute', left:8, fontSize:9, color:'#18c98a', fontWeight:700, top:'50%', transform:'translateY(-50%)', pointerEvents:'none' }}>●</span>
      )}
      <div style={{ position:'absolute', right:0, display:'flex', alignItems:'center' }}>
        <button onClick={() => setShow(s=>!s)} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:13, padding:'0 4px' }}>{show?'🙈':'👁'}</button>
        {value && <button onClick={() => onChange('')} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:11, padding:'0 6px 0 0' }}>✕</button>}
      </div>
    </div>
  )
}
