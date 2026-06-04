import React from 'react'
import s from './Sidebar.module.css'

const MODELS = [
  { id: 'gemini-3-flash-preview', label: '3 Flash' },
  { id: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
  { id: 'gemini-3.1-flash-lite-preview', label: '3.1 Lite' },
  { id: 'gemini-2.5-flash-preview-05-20', label: '2.5 Flash' },
  { id: 'gemini-2.0-flash', label: '2.0 Flash' },
]

const LANGS = [
  { id: 'en', label: 'EN' },
  { id: 'id', label: 'ID' },
  { id: 'bi', label: 'Bilingual' },
]

export default function Sidebar({ state, set }) {
  const [showKey, setShowKey] = React.useState(false)

  const toggle = (key) => set(prev => ({ [key]: !prev[key] }))

  return (
    <aside className={s.sidebar}>
      <div className={s.header}>
        <div className={s.logoMark}>VP</div>
        <div>
          <div className={s.logoText}>VideoPrompt Pro</div>
          <div className={s.logoSub}>Powered by Gemini API</div>
        </div>
      </div>

      <section className={s.section}>
        <div className={s.label}>Gemini API Key</div>
        <div className={s.inputWrap}>
          <input
            className={s.apiInput}
            type={showKey ? 'text' : 'password'}
            placeholder="AIzaSy..."
            value={state.apiKey}
            onChange={e => set({ apiKey: e.target.value })}
          />
          <button className={s.eyeBtn} onClick={() => setShowKey(v => !v)}>👁</button>
        </div>
        <div className={s.btnRow}>
          {MODELS.map(m => (
            <button
              key={m.id}
              className={`${s.modelBtn} ${state.model === m.id ? s.active : ''}`}
              onClick={() => set({ model: m.id })}
            >{m.label}</button>
          ))}
        </div>
      </section>

      <section className={s.section}>
        <div className={s.label}>Generation Parameters</div>
        <Slider label="Temperature" value={state.temperature} min={0} max={1} step={0.1}
          display={v => v} onChange={v => set({ temperature: v })} color="var(--accent)" />
        <Slider label="Detail Level" value={state.detailLevel === 'Normal' ? 1 : state.detailLevel === 'High' ? 2 : 3}
          min={1} max={3} step={1}
          display={v => ['Normal','High','Detail'][v-1]}
          onChange={v => set({ detailLevel: ['Normal','High','Detail'][v-1] })} color="var(--accent)" />
        <Slider label="Max Tokens" value={state.maxTokens} min={512} max={8192} step={512}
          display={v => v} onChange={v => set({ maxTokens: parseInt(v) })} color="var(--accent)" />
      </section>

      <section className={s.section}>
        <div className={s.label}>Output Options</div>
        {[
          ['toggleCinematic', 'Cinematic Terms'],
          ['toggleMotion', 'Motion Analysis'],
          ['toggleAiParams', 'AI Video Params'],
          ['toggleIndonesian', 'Indonesian Output'],
          ['toggleTimestamps', 'Scene Timestamps'],
        ].map(([key, label]) => (
          <div key={key} className={s.toggleRow}>
            <span className={s.toggleLabel}>{label}</span>
            <div
              className={`${s.toggle} ${state[key] ? s.on : ''}`}
              onClick={() => toggle(key)}
            />
          </div>
        ))}
      </section>

      <section className={s.section}>
        <div className={s.label}>Narration Language</div>
        <div className={s.btnRow}>
          {LANGS.map(l => (
            <button
              key={l.id}
              className={`${s.langBtn} ${state.lang === l.id ? s.active : ''}`}
              onClick={() => set({ lang: l.id })}
            >{l.label}</button>
          ))}
        </div>
      </section>

      <div className={s.footer}>
        <span className={s.footerDot} />
        <span>{state.model}</span>
        <span className={s.sep}>·</span>
        <span>Tokens: {state.totalTokens.toLocaleString()}</span>
      </div>
    </aside>
  )
}

function Slider({ label, value, min, max, step, display, onChange, color }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text2)', marginBottom:5 }}>
        <span>{label}</span>
        <span style={{ color: color || 'var(--accent)', fontFamily:'var(--mono)', fontSize:11 }}>{display(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(e.target.value)}
        style={{ width:'100%', accentColor: color || 'var(--accent)' }}
      />
    </div>
  )
}
