import React, { useState } from 'react'
import { callAI, fileToBase64 } from '../utils/gemini'
import MobileLayout from './MobileLayout'

const CC = [
  { bg:'rgba(79,126,247,0.08)',  border:'rgba(79,126,247,0.2)',  accent:'#4f7ef7' },
  { bg:'rgba(155,107,245,0.08)', border:'rgba(155,107,245,0.2)', accent:'#9b6bf5' },
  { bg:'rgba(24,201,138,0.08)',  border:'rgba(24,201,138,0.2)',  accent:'#18c98a' },
  { bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.2)',  accent:'#f5a623' },
  { bg:'rgba(240,82,138,0.08)',  border:'rgba(240,82,138,0.2)',  accent:'#f0528a' },
  { bg:'rgba(255,120,60,0.08)',  border:'rgba(255,120,60,0.2)',  accent:'#ff783c' },
]

const PLATFORMS = [
  { id:'sora',    label:'OpenAI Sora' },
  { id:'runway',  label:'Runway Gen-3' },
  { id:'kling',   label:'Kling AI' },
  { id:'wan',     label:'Wan 2.1' },
  { id:'hailuo',  label:'Hailuo MiniMax' },
  { id:'luma',    label:'Luma Dream Machine' },
  { id:'veo',     label:'Google Veo 3' },
]

const THEMES = [
  { id:'pov',         label:'👁 POV Immersive',        desc:'First-person viral shots · TikTok #1' },
  { id:'travel',      label:'✈️ Cinematic Travel',      desc:'Aesthetic destination · IG Reels viral' },
  { id:'transform',   label:'⚡ Before/After Reveal',   desc:'Transformation glow-up · massive views' },
  { id:'darkacademia',label:'🌙 Dark Academia Aesthetic',desc:'Moody mystery vibes · trending IG/TT' },
  { id:'neon',        label:'🏙 Neon City Night',        desc:'Cyberpunk urban · YouTube viral' },
  { id:'emotional',   label:'💙 Raw Emotional Moment',  desc:'Real storytelling · highest engagement' },
  { id:'surreal',     label:'🌀 AI Surreal / Dreamlike', desc:'Impossible scenes · AI content trend' },
  { id:'fashion',     label:'👗 Fashion / Outfit Reveal',desc:'Style transition · TikTok & IG top' },
  { id:'asmr',        label:'🍃 Cozy ASMR Calm',         desc:'Satisfying slow-mo · binge-watch content' },
  { id:'hype',        label:'🔥 Hype / Motivational',   desc:'Hustle grind energy · YouTube Shorts' },
  { id:'dance',       label:'🎵 Beat Sync / Dance',      desc:'Music-driven moves · TikTok top trending' },
  { id:'horror',      label:'😱 Jump Scare / Thriller',  desc:'Horror tension · high rewatch rate' },
  { id:'custom',      label:'✏️ Custom Theme',           desc:'Tulis tema sendiri' },
]

export default function RealisticTab({ state, set, showToast, isMobile }) {
  const [platform, setPlatform] = useState('kling')
  const [theme, setTheme] = useState('disaster')
  const [customTheme, setCustomTheme] = useState('')
  const [basePrompt, setBasePrompt] = useState('')
  const [variations, setVariations] = useState(3) // how many variations to generate
  const [includeAudio, setIncludeAudio] = useState(true)
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState({})

  // Auto-load from analyze tab
  React.useEffect(() => {
    if (state.analysisText && !basePrompt) setBasePrompt(state.analysisText)
  }, [state.analysisText])

  async function generateVariations() {
    if (!basePrompt.trim()) return showToast('Isi base prompt dulu!', true)
    if (!state.apiKey) return showToast('Masukkan API key!', true)
    if (theme === 'custom' && !customTheme.trim()) return showToast('Tulis tema custom dulu!', true)

    setLoading(true)
    setResults([])
    const themeLabel = theme === 'custom' ? customTheme.trim() : THEMES.find(t => t.id === theme)?.label || theme
    const platformLabel = PLATFORMS.find(p => p.id === platform)?.label || platform

    try {
      const prompt = `You are an expert AI video prompt engineer for ${platformLabel}.

BASE PROMPT:
${basePrompt}

TASK: Generate ${variations} different video prompt variations with the same THEME: "${themeLabel}"

Each variation must:
- Keep the same theme and atmosphere as the base
- Be a completely different scene, angle, moment, or perspective
- Include an audio section if not present
- Be ready to paste directly into ${platformLabel}

OUTPUT FORMAT — write EXACTLY like this, no asterisks, no markdown bold, no bullet symbols:

=== VARIATION 1 ===
[One-line scene summary]

[Main prompt paragraph — setting, atmosphere, key elements]
[Additional detail paragraph if needed]

[00-02s]
Description of what happens.

[02-04s]
Description of what happens.

[continue per 2s until end]

Camera:
Camera movement and style.

Environment:
Setting and atmosphere details.

Audio:
${includeAudio ? 'Sound design — music genre/mood, ambient sounds, key audio elements, no asterisks' : 'No audio description needed.'}

Style:
Visual style and aesthetic.

=== VARIATION 2 ===
[repeat same structure]

[continue for all ${variations} variations]

STRICT RULES:
- No asterisks (*) anywhere in output
- No markdown formatting (no **bold**, no _italic_)
- No bullet points (- or •)
- Plain text only
- Each variation must feel genuinely different from the others
- Platform: ${platformLabel}`

      const { text, tokens } = await callAI({ provider: state.provider,
        apiKey: state.apiKey, model: state.model, prompt,
        temperature: 0.85, maxTokens: 8192,
      })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))

      // Split by === VARIATION N ===
      const parts = text.split(/===\s*VARIATION\s*\d+\s*===/).filter(p => p.trim())
      const parsed = parts.map((p, i) => ({ index: i + 1, prompt: p.trim() }))
      setResults(parsed.length > 0 ? parsed : [{ index: 1, prompt: text.trim() }])
      showToast(`${parsed.length || 1} variasi berhasil! ✓`)
    } catch (e) {
      showToast('Error: ' + e.message, true)
    }
    setLoading(false)
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(p => ({...p,[key]:true}))
      setTimeout(() => setCopied(p => ({...p,[key]:false})), 2000)
      showToast('Disalin!')
    })
  }

  function exportAll() {
    const content = results.map(r => `=== VARIATION ${r.index} ===\n${r.prompt}`).join('\n\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([content], {type:'text/plain'}))
    a.download = 'video-variations.txt'; a.click()
  }

  const generateBtn = (
    <button onClick={generateVariations} disabled={loading} style={{
      width:'100%', padding:12, fontSize:13, fontWeight:700,
      background: loading ? 'rgba(100,120,220,0.15)' : 'linear-gradient(135deg,#9b6bf5,#f0528a)',
      border:'none', color: loading ? 'var(--text3)' : 'white',
      borderRadius:11, cursor: loading ? 'not-allowed' : 'pointer',
      boxShadow: loading ? 'none' : '0 6px 24px rgba(155,107,245,0.35)',
      display:'flex', alignItems:'center', justifyContent:'center', gap:8,
    }}>
      {loading ? <><Spin/>Generating...</> : <><span>✨</span> Generate Variations</>}
    </button>
  )

  const leftPanel = (
    <>
      {/* PLATFORM */}
      <GlassCard color={CC[0]} label="Platform">
        <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
          {PLATFORMS.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)} style={{
              padding:'5px 10px', fontSize:11, fontWeight:600,
              background: platform===p.id ? 'rgba(79,126,247,0.15)' : 'rgba(255,255,255,0.5)',
              border:`1.5px solid ${platform===p.id ? '#4f7ef7' : 'rgba(100,120,220,0.15)'}`,
              color: platform===p.id ? '#4f7ef7' : 'var(--text2)',
              borderRadius:8, cursor:'pointer',
            }}>{p.label}</button>
          ))}
        </div>
      </GlassCard>

      {/* THEME */}
      <GlassCard color={CC[1]} label="Theme">
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {THEMES.map(t => (
            <button key={t.id} onClick={() => setTheme(t.id)} style={{
              width:'100%', padding:'7px 10px', fontSize:11, fontWeight:500, textAlign:'left',
              display:'flex', alignItems:'center', gap:8,
              background: theme===t.id ? 'rgba(155,107,245,0.12)' : 'rgba(255,255,255,0.45)',
              border:`1.5px solid ${theme===t.id ? '#9b6bf5' : 'rgba(100,120,220,0.15)'}`,
              color: theme===t.id ? '#9b6bf5' : 'var(--text2)',
              borderRadius:9, cursor:'pointer',
            }}>
              <span style={{ flex:1 }}>{t.label}</span>
              <span style={{ fontSize:9, color:'var(--text3)', fontWeight:400 }}>{t.desc}</span>
            </button>
          ))}
        </div>
        {theme === 'custom' && (
          <div style={{ marginTop:8 }}>
            <input
              value={customTheme}
              onChange={e => setCustomTheme(e.target.value)}
              placeholder="Contoh: underwater civilization, ancient mythology..."
              style={{ width:'100%', padding:'7px 10px', fontSize:11, color:'var(--text)', background:'rgba(255,255,255,0.6)', border:'1.5px solid rgba(155,107,245,0.3)', borderRadius:8, outline:'none', boxSizing:'border-box' }}
            />
          </div>
        )}
      </GlassCard>

      {/* OPTIONS */}
      <GlassCard color={CC[2]} label="Options">
        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:'var(--text3)', marginBottom:6 }}>Jumlah Variasi</div>
          <div style={{ display:'flex', gap:5 }}>
            {[1,2,3,4,5].map(n => (
              <button key={n} onClick={() => setVariations(n)} style={{
                flex:1, padding:'6px 0', fontSize:12, fontWeight:700,
                background: variations===n ? 'linear-gradient(135deg,#4f7ef7,#9b6bf5)' : 'rgba(255,255,255,0.6)',
                border:'1px solid rgba(100,120,220,0.2)',
                color: variations===n ? 'white' : 'var(--text2)',
                borderRadius:8, cursor:'pointer',
                boxShadow: variations===n ? '0 3px 10px rgba(100,130,250,0.3)' : 'none',
              }}>{n}</button>
            ))}
          </div>
        </div>
        <button onClick={() => setIncludeAudio(a => !a)} style={{
          width:'100%', padding:'7px 10px', fontSize:11, fontWeight:500, textAlign:'left',
          display:'flex', justifyContent:'space-between', alignItems:'center',
          background: includeAudio ? 'rgba(24,201,138,0.1)' : 'rgba(255,255,255,0.45)',
          border:`1.5px solid ${includeAudio ? '#18c98a' : 'rgba(100,120,220,0.15)'}`,
          color: includeAudio ? '#18c98a' : 'var(--text2)',
          borderRadius:9, cursor:'pointer',
        }}>
          <span>🎵 Include Audio / Soundtrack</span>
          <span style={{ fontSize:10, fontWeight:700 }}>{includeAudio ? 'ON' : 'OFF'}</span>
        </button>
      </GlassCard>
    </>
  )

  const rightPanel = (
    <>
      {/* BASE PROMPT */}
      <div style={{ padding: isMobile ? '10px 12px' : '12px 14px', borderBottom:'1px solid rgba(100,120,220,0.1)', flexShrink:0, background:'rgba(255,255,255,0.4)', backdropFilter:'blur(10px)' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6, flexWrap:'wrap', gap:6 }}>
          <span style={{ fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:'0.08em' }}>BASE PROMPT</span>
          <div style={{ display:'flex', gap:6 }}>
            {state.analysisText && (
              <button onClick={() => setBasePrompt(state.analysisText)} style={{ fontSize:10, padding:'3px 9px', background:'rgba(79,126,247,0.1)', border:'1px solid rgba(79,126,247,0.3)', color:'var(--accent)', borderRadius:6, cursor:'pointer' }}>
                ↩ Load from Analyze
              </button>
            )}
            <button onClick={() => setBasePrompt('')} style={{ fontSize:10, padding:'3px 9px', background:'rgba(255,255,255,0.6)', border:'1px solid rgba(100,120,220,0.2)', color:'var(--text3)', borderRadius:6, cursor:'pointer' }}>Clear</button>
          </div>
        </div>
        <textarea
          value={basePrompt}
          onChange={e => setBasePrompt(e.target.value)}
          placeholder="Paste prompt dari Analyze tab, atau tulis prompt dasar..."
          style={{
            width:'100%', minHeight: isMobile ? 70 : 90, maxHeight:160, padding:'9px 11px', fontSize:12,
            fontFamily:'var(--sans)', lineHeight:1.65, color:'var(--text)',
            background:'rgba(255,255,255,0.7)', border:'1.5px solid rgba(100,120,220,0.2)',
            borderRadius:9, outline:'none', resize:'vertical', boxSizing:'border-box',
          }}
        />
      </div>

      {/* RESULTS */}
      <div style={{ flex:1, overflowY:'auto', padding: isMobile ? '12px' : 14, display:'flex', flexDirection:'column', gap:12 }}>

        {results.length === 0 && !loading && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, gap:12, color:'var(--text3)', paddingTop:40 }}>
            <div style={{ fontSize:36, opacity:0.25 }}>✨</div>
            <div style={{ fontSize:12, fontStyle:'italic', textAlign:'center', lineHeight:1.7 }}>
              Pilih tema, isi base prompt,<br/>tentukan jumlah variasi,<br/>lalu Generate.
            </div>
          </div>
        )}

        {loading && Array.from({length: variations}).map((_, i) => (
          <GlassCard key={i} color={CC[i % CC.length]} label={`Generating variation ${i+1}...`}>
            <div style={{ height:70, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:12, animation:'pulse 1.2s infinite' }}>
              ⟳ Writing variation {i+1} of {variations}...
            </div>
          </GlassCard>
        ))}

        {results.length > 0 && (
          <>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
              <span style={{ fontSize:11, fontWeight:600, color:'var(--text2)' }}>
                {results.length} variation{results.length > 1 ? 's' : ''} — {PLATFORMS.find(p=>p.id===platform)?.label} · {theme === 'custom' ? customTheme : THEMES.find(t=>t.id===theme)?.label}
              </span>
              {results.length > 1 && <ActionBtn onClick={exportAll}>💾 Export All</ActionBtn>}
            </div>

            {results.map((r, i) => (
              <GlassCard key={i} color={CC[i % CC.length]} label={`Variation ${r.index}`}>
                <div style={{
                  background:'rgba(255,255,255,0.5)', border:'1px solid rgba(100,120,220,0.12)',
                  borderRadius:9, padding:'10px 12px', fontSize:12, lineHeight:1.8,
                  color:'var(--text)', whiteSpace:'pre-wrap', wordBreak:'break-word', minHeight:80,
                  fontFamily:'var(--sans)',
                }}>{r.prompt}</div>
                <div style={{ display:'flex', gap:6, marginTop:8, justifyContent:'flex-end', flexWrap:'wrap' }}>
                  <ActionBtn color={CC[i%CC.length].accent} copied={copied['v'+i]} onClick={() => copy(r.prompt,'v'+i)}>📋 Copy</ActionBtn>
                  <ActionBtn onClick={() => { setBasePrompt(r.prompt); showToast('Di-load ke base!') }}>🔄 Use as Base</ActionBtn>
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
      drawerLabel="⚙ Theme & Platform"
    />
  )
}

function GlassCard({ color, label, children, style={} }) {
  return (
    <div style={{ background:color?.bg||'rgba(255,255,255,0.55)', border:`1px solid ${color?.border||'rgba(100,120,220,0.18)'}`, borderRadius:12, padding:'11px 12px', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', boxShadow:'0 2px 12px rgba(80,100,200,0.07)', ...style }}>
      {label && <div style={{ fontSize:10, fontWeight:700, color:color?.accent||'var(--text3)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:8 }}>{label}</div>}
      {children}
    </div>
  )
}

function ActionBtn({ children, onClick, color, copied, small }) {
  return (
    <button onClick={onClick} style={{ padding:small?'3px 9px':'5px 12px', fontSize:10, fontWeight:600, background:copied?`${color||'#18c98a'}18`:'rgba(255,255,255,0.7)', border:`1px solid ${copied?(color||'#18c98a'):'rgba(100,120,220,0.2)'}`, color:copied?(color||'#18c98a'):'var(--text2)', borderRadius:7, cursor:'pointer', whiteSpace:'nowrap' }}>
      {copied?'✓ Copied':children}
    </button>
  )
}

function Spin() {
  return <span style={{ display:'inline-block', animation:'spin .7s linear infinite', fontSize:14 }}>⟳<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></span>
}
