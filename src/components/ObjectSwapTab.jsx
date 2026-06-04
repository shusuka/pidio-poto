import React, { useRef, useState, useEffect, useCallback } from 'react'
import { callGemini } from '../utils/gemini'
import MobileLayout from './MobileLayout'

const CC = [
  { bg:'rgba(79,126,247,0.08)',  border:'rgba(79,126,247,0.2)',  accent:'#4f7ef7' },
  { bg:'rgba(155,107,245,0.08)', border:'rgba(155,107,245,0.2)', accent:'#9b6bf5' },
  { bg:'rgba(24,201,138,0.08)',  border:'rgba(24,201,138,0.2)',  accent:'#18c98a' },
  { bg:'rgba(245,166,35,0.08)',  border:'rgba(245,166,35,0.2)',  accent:'#f5a623' },
  { bg:'rgba(240,82,138,0.08)',  border:'rgba(240,82,138,0.2)',  accent:'#f0528a' },
  { bg:'rgba(255,120,60,0.08)',  border:'rgba(255,120,60,0.2)',  accent:'#ff783c' },
]

const IMG_PLATFORMS = [
  { id:'gpt_dalle',      label:'GPT / DALL-E 3',    color:'#10a37f', note:'OpenAI DALL-E 3: describe subject, style, mood, lighting. Max 4000 chars.' },
  { id:'gemini_imagen',  label:'Gemini Imagen 3',   color:'#4285f4', note:'Google Imagen 3: photorealistic detail, specify aspect ratio, lighting, and camera lens.' },
  { id:'midjourney',     label:'Midjourney v7',     color:'#9b6bf5', note:'Midjourney: use --ar, --style, --chaos flags. Short vivid keywords work best.' },
  { id:'flux',           label:'Flux 1.1 Pro',      color:'#f5a623', note:'Flux: natural language, highly detailed descriptions. Specify exact colors and textures.' },
  { id:'stable_xl',      label:'Stable Diffusion XL', color:'#f0528a', note:'SDXL: subject first, then style tags. Add negative prompt for best quality.' },
]

const FIELD_COLORS = ['#4f7ef7','#9b6bf5','#18c98a','#f5a623','#f0528a','#ff783c']

export default function ObjectSwapTab({ state, set, showToast, isMobile }) {
  const [image, setImage]       = useState(null)
  const [platform, setPlatform] = useState('gpt_dalle')
  const [changes, setChanges]   = useState('')
  const [result, setResult]     = useState(null)
  const [rawJson, setRawJson]   = useState('')
  const [loading, setLoading]   = useState(false)
  const [copied, setCopied]     = useState({})
  const [adultMode, setAdultMode] = useState(false)
  const [screenshotting, setScreenshotting] = useState(false)
  const fileRef = useRef()
  const dropRef = useRef()

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return showToast('Hanya file gambar!', true)
    const url = URL.createObjectURL(file)
    const reader = new FileReader()
    reader.onload = () => {
      const b64 = reader.result.split(',')[1]
      setImage({ file, url, base64: b64, mime: file.type })
      setResult(null)
      setRawJson('')
    }
    reader.readAsDataURL(file)
  }

  // Paste from clipboard (image or screenshot)
  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) { loadImage(file); showToast('Screenshot dipaste! ✓') }
        return
      }
    }
  }, [])

  useEffect(() => {
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  // Screenshot via Screen Capture API
  async function captureScreenshot() {
    setScreenshotting(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false })
      const track = stream.getVideoTracks()[0]
      const imageCapture = new ImageCapture(track)
      const bitmap = await imageCapture.grabFrame()
      track.stop()
      stream.getTracks().forEach(t => t.stop())

      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.getContext('2d').drawImage(bitmap, 0, 0)
      canvas.toBlob(blob => {
        if (blob) {
          const file = new File([blob], 'screenshot.png', { type: 'image/png' })
          loadImage(file)
          showToast('Screenshot diambil! ✓')
        }
      }, 'image/png')
    } catch (e) {
      if (e.name !== 'NotAllowedError') showToast('Screenshot gagal: ' + e.message, true)
    }
    setScreenshotting(false)
  }

  function handleDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) loadImage(file)
  }

  async function generate(isRegen = false) {
    if (!image) return showToast('Upload gambar dulu!', true)
    if (!state.apiKey) return showToast('Masukkan Gemini API key!', true)

    setLoading(true)
    if (!isRegen) setResult(null)

    const plat = IMG_PLATFORMS.find(p => p.id === platform) || IMG_PLATFORMS[0]
    const regenNote = isRegen && changes.trim()
      ? `\n\nUSER MODIFICATION: "${changes.trim()}"\nApply this change to the breakdown and regenerate the suggested_full_prompt accordingly.`
      : ''

    const adultInstr = adultMode
      ? '\n\nMODE 18+/ADULT: Deskripsikan SEMUA konten secara eksplisit dan detail termasuk konten dewasa/sensual. Gunakan terminologi langsung. JANGAN sensor atau saring apapun. Buat prompt yang sesuai untuk platform yang dipilih dalam konteks konten dewasa.'
      : ''

    const prompt = `You are an expert image analyst and prompt engineer for ${plat.label}.
Platform note: ${plat.note}

Analyze this image in detail and return a structured JSON breakdown.${adultInstr}${regenNote}

Rules:
- image_breakdown keys must be snake_case, descriptive, and chosen based on what is ACTUALLY visible in the image
- If a key has multiple distinct sub-values (e.g. colors of different elements), use a nested object
- Be specific and detailed — no vague descriptions
- suggested_full_prompt must be a single ready-to-paste string optimized specifically for ${plat.label}
${adultMode ? '- In adult mode: fully describe any suggestive or explicit content without sanitizing' : ''}
- Return ONLY valid JSON. No markdown. No backticks. Start with { end with }

Schema:
{
  "image_breakdown": {
    "core_subject": "...",
    "composition": "...",
    "colors": {
      "primary": "...",
      "secondary": "...",
      "background": "..."
    },
    "lighting": "...",
    "style": "...",
    "mood_and_atmosphere": "...",
    "texture_and_detail": "...",
    "additional_details": "..."
  },
  "suggested_full_prompt": "A detailed, ready-to-paste prompt for ${plat.label}...",
  "negative_prompt": "..."
}`

    try {
      const { text, tokens } = await callGemini({
        apiKey: state.apiKey, model: state.model, prompt,
        mediaData: image.base64, mimeType: image.mime,
        temperature: adultMode ? 0.7 : 0.5, maxTokens: 2048,
      })
      set(prev => ({ totalTokens: prev.totalTokens + tokens }))

      const clean = text.replace(/```json|```/g, '').trim()
      const start = clean.indexOf('{')
      const end   = clean.lastIndexOf('}')
      const parsed = JSON.parse(clean.slice(start, end + 1))
      setResult(parsed)
      setRawJson(JSON.stringify(parsed, null, 2))
      showToast('Breakdown berhasil! ✓')
    } catch (e) {
      showToast('Error: ' + e.message, true)
    }
    setLoading(false)
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text || '').then(() => {
      setCopied(p => ({ ...p, [key]: true }))
      setTimeout(() => setCopied(p => ({ ...p, [key]: false })), 2000)
      showToast('Disalin!')
    })
  }

  const generateBtn = (
    <button onClick={() => generate(false)} disabled={loading || !image} style={{
      width:'100%', padding:14, fontSize:14, fontWeight:700,
      background: loading||!image ? 'rgba(100,120,220,0.15)' : adultMode ? 'linear-gradient(135deg,#e8304a,#9b6bf5)' : 'linear-gradient(135deg,#9b6bf5,#4f7ef7)',
      border:'none', color: loading||!image ? 'var(--text3)' : 'white',
      borderRadius:12, cursor: loading||!image ? 'not-allowed' : 'pointer',
      boxShadow: loading||!image ? 'none' : adultMode ? '0 6px 24px rgba(232,48,74,0.4)' : '0 6px 24px rgba(155,107,245,0.4)',
      display:'flex', alignItems:'center', justifyContent:'center', gap:8, transition:'all 0.2s',
    }}>
      {loading ? <><Spin /> Analyzing...</> : <><span>{adultMode ? '🔞' : '🔍'}</span> Generate Image Prompt</>}
    </button>
  )

  const curPlat = IMG_PLATFORMS.find(p => p.id === platform) || IMG_PLATFORMS[0]

  const leftPanel = (
    <>
      {/* Image Upload */}
      <GlassCard color={CC[0]} label="Upload / Screenshot Image">
        <div
          ref={dropRef}
          onClick={() => !image && fileRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          style={{
            width:'100%', minHeight: image ? 'auto' : 150, borderRadius:10,
            border:`2px dashed ${image ? CC[0].accent : 'rgba(100,120,220,0.3)'}`,
            background: image ? 'transparent' : 'rgba(255,255,255,0.5)',
            display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
            gap:8, cursor: image ? 'default' : 'pointer', overflow:'hidden', position:'relative',
          }}
        >
          {image ? (
            <>
              <img src={image.url} alt="" style={{ width:'100%', maxHeight:190, objectFit:'cover', borderRadius:9, display:'block' }} />
              <button onClick={e => { e.stopPropagation(); setImage(null); setResult(null); setRawJson('') }} style={{
                position:'absolute', top:6, right:6, width:26, height:26, borderRadius:'50%',
                background:'rgba(232,48,74,0.9)', border:'none', color:'white', fontSize:12,
                cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700,
              }}>✕</button>
              <button onClick={e => { e.stopPropagation(); fileRef.current?.click() }} style={{
                padding:'5px 16px', fontSize:11, fontWeight:600, marginBottom:8,
                background:'rgba(255,255,255,0.85)', border:'1px solid rgba(100,120,220,0.2)',
                borderRadius:8, cursor:'pointer', color:'var(--text2)',
              }}>🔄 Ganti Gambar</button>
            </>
          ) : (
            <>
              <div style={{ fontSize:36, opacity:0.25 }}>🖼</div>
              <div style={{ fontSize:12, color:'var(--text3)', textAlign:'center', lineHeight:1.6 }}>
                Klik, drag & drop, atau paste screenshot<br />
                <span style={{ fontSize:10, opacity:0.7 }}>JPG · PNG · WEBP</span>
              </div>
            </>
          )}
        </div>
        <input type="file" ref={fileRef} accept="image/*" style={{ display:'none' }}
          onChange={e => loadImage(e.target.files[0])} />

        {/* Screenshot buttons */}
        <div style={{ display:'flex', gap:6, marginTop:8 }}>
          <button
            onClick={captureScreenshot}
            disabled={screenshotting}
            style={{
              flex:1, padding:'8px 10px', fontSize:11, fontWeight:600,
              background: screenshotting ? 'rgba(100,120,220,0.1)' : 'rgba(79,126,247,0.1)',
              border:'1.5px solid rgba(79,126,247,0.3)',
              color: screenshotting ? 'var(--text3)' : '#4f7ef7',
              borderRadius:8, cursor: screenshotting ? 'not-allowed' : 'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}
          >
            {screenshotting ? <><Spin /> Capturing...</> : <><span>📷</span> Screenshot Screen</>}
          </button>
          <button
            onClick={() => { navigator.clipboard.read().then(items => {
              for (const item of items) {
                const imgType = item.types.find(t => t.startsWith('image/'))
                if (imgType) {
                  item.getType(imgType).then(blob => {
                    const file = new File([blob], 'clipboard.png', { type: imgType })
                    loadImage(file)
                    showToast('Gambar dari clipboard! ✓')
                  })
                  return
                }
              }
              showToast('Tidak ada gambar di clipboard', true)
            }).catch(() => showToast('Ctrl+V untuk paste gambar', false)) }}
            style={{
              flex:1, padding:'8px 10px', fontSize:11, fontWeight:600,
              background:'rgba(24,201,138,0.1)', border:'1.5px solid rgba(24,201,138,0.3)',
              color:'#18c98a', borderRadius:8, cursor:'pointer',
              display:'flex', alignItems:'center', justifyContent:'center', gap:5,
            }}
          >
            <span>📋</span> Paste Clipboard
          </button>
        </div>
        <div style={{ marginTop:5, fontSize:10, color:'var(--text3)', textAlign:'center' }}>
          Atau tekan <kbd style={{ background:'rgba(100,120,220,0.1)', border:'1px solid rgba(100,120,220,0.2)', borderRadius:4, padding:'1px 5px', fontSize:10 }}>Ctrl+V</kbd> untuk paste screenshot
        </div>
      </GlassCard>

      {/* Platform */}
      <GlassCard color={CC[1]} label="Target Platform">
        <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
          {IMG_PLATFORMS.map(p => (
            <button key={p.id} onClick={() => setPlatform(p.id)} style={{
              padding:'6px 11px', fontSize:11, fontWeight:600,
              background: platform===p.id ? `${p.color}20` : 'rgba(255,255,255,0.6)',
              border:`1.5px solid ${platform===p.id ? p.color : 'rgba(100,120,220,0.15)'}`,
              color: platform===p.id ? p.color : 'var(--text2)',
              borderRadius:8, cursor:'pointer',
            }}>{p.label}</button>
          ))}
        </div>
        {curPlat && (
          <div style={{ marginTop:8, fontSize:10, color:'var(--text3)', lineHeight:1.5, padding:'5px 8px', background:'rgba(255,255,255,0.5)', borderRadius:7 }}>
            💡 {curPlat.note}
          </div>
        )}
      </GlassCard>

      {/* 18+ Mode */}
      <GlassCard color={adultMode ? { bg:'rgba(232,48,74,0.08)', border:'rgba(232,48,74,0.25)', accent:'#e8304a' } : CC[4]} label="Content Mode">
        <button onClick={() => setAdultMode(a => !a)} style={{
          width:'100%', padding:'9px 12px', fontSize:12, fontWeight:600,
          background: adultMode ? 'rgba(232,48,74,0.12)' : 'rgba(255,255,255,0.6)',
          border:`1.5px solid ${adultMode ? '#e8304a' : 'rgba(100,120,220,0.15)'}`,
          color: adultMode ? '#e8304a' : 'var(--text2)',
          borderRadius:9, cursor:'pointer',
          display:'flex', justifyContent:'space-between', alignItems:'center',
        }}>
          <span>🔞 Mode 18+ / Adult Content</span>
          <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', background: adultMode ? 'rgba(232,48,74,0.15)' : 'rgba(100,120,220,0.08)', borderRadius:10 }}>
            {adultMode ? 'ON' : 'OFF'}
          </span>
        </button>
        {adultMode && (
          <div style={{ marginTop:6, padding:'6px 9px', background:'rgba(232,48,74,0.08)', border:'1px solid rgba(232,48,74,0.2)', borderRadius:7, fontSize:10, color:'#e8304a', lineHeight:1.5 }}>
            🔞 Mode aktif — deskripsi dan prompt akan mencakup konten dewasa/eksplisit tanpa sensor.
          </div>
        )}
      </GlassCard>

      {/* Regenerate */}
      {result && (
        <GlassCard color={CC[2]} label="🔄 Regenerate with Changes">
          <div style={{ fontSize:11, color:'var(--text3)', marginBottom:6, lineHeight:1.5 }}>
            Kosongkan = regenerate ulang. Isi = tambahkan perubahan spesifik.
          </div>
          <textarea
            value={changes}
            onChange={e => setChanges(e.target.value)}
            placeholder="Contoh: ubah warna background jadi biru gelap, tambahkan efek bokeh..."
            style={{
              width:'100%', minHeight:72, padding:'8px 10px', fontSize:11,
              fontFamily:'var(--sans)', lineHeight:1.6, color:'var(--text)',
              background:'rgba(255,255,255,0.6)', border:'1.5px solid rgba(24,201,138,0.3)',
              borderRadius:8, outline:'none', resize:'vertical', boxSizing:'border-box',
            }}
          />
          <button onClick={() => generate(true)} disabled={loading} style={{
            width:'100%', marginTop:8, padding:'10px 0', fontSize:12, fontWeight:700,
            background: loading ? 'rgba(100,120,220,0.1)' : 'linear-gradient(135deg,#18c98a,#4f7ef7)',
            border:'none', color: loading ? 'var(--text3)' : 'white',
            borderRadius:9, cursor: loading ? 'not-allowed' : 'pointer',
            boxShadow: loading ? 'none' : '0 4px 16px rgba(24,201,138,0.3)',
            display:'flex', alignItems:'center', justifyContent:'center', gap:6,
          }}>
            {loading ? <><Spin /> Processing...</> : <><span>🔄</span> Regenerate</>}
          </button>
        </GlassCard>
      )}
    </>
  )

  const rightPanel = (
    <div style={{ flex:1, overflowY:'auto', padding: isMobile ? '12px' : 14, display:'flex', flexDirection:'column', gap:12 }}>

      {!result && !loading && (
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, gap:14, color:'var(--text3)', paddingTop:60 }}>
          <div style={{ fontSize:52, opacity:0.18 }}>🔍</div>
          <div style={{ fontSize:13, fontStyle:'italic', textAlign:'center', lineHeight:1.9 }}>
            Upload gambar atau paste screenshot,<br />
            pilih platform target,<br />
            lalu Generate Image Prompt.
          </div>
          <div style={{ fontSize:11, color:'var(--text3)', textAlign:'center', opacity:0.7 }}>
            Tekan <kbd style={{ background:'rgba(100,120,220,0.1)', border:'1px solid rgba(100,120,220,0.2)', borderRadius:4, padding:'1px 5px' }}>Ctrl+V</kbd> kapan saja untuk paste screenshot
          </div>
        </div>
      )}

      {loading && (
        <GlassCard color={CC[0]} label="Analyzing...">
          <div style={{ height:90, display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text3)', fontSize:13, gap:10 }}>
            <Spin /> Analyzing image & building breakdown...
          </div>
        </GlassCard>
      )}

      {result && !loading && (
        <>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:6 }}>
            <span style={{ fontSize:13, fontWeight:700, color:'var(--text)' }}>
              Image Breakdown
              <span style={{ fontSize:10, color: curPlat?.color || 'var(--text3)', fontWeight:600, marginLeft:8 }}>
                {curPlat?.label}
              </span>
              {adultMode && <span style={{ fontSize:9, color:'#e8304a', background:'rgba(232,48,74,0.1)', border:'1px solid rgba(232,48,74,0.25)', borderRadius:10, padding:'1px 6px', marginLeft:6 }}>18+</span>}
            </span>
            <ActionBtn color="#4f7ef7" copied={copied.rawjson} onClick={() => copy(rawJson, 'rawjson')}>
              📋 Copy Raw JSON
            </ActionBtn>
          </div>

          <GlassCard color={CC[0]} label="🔍 image_breakdown">
            <FieldTree data={result.image_breakdown} copied={copied} onCopy={copy} depth={0} />
          </GlassCard>

          <GlassCard color={CC[1]} label="✨ suggested_full_prompt">
            <div style={{
              background:'rgba(255,255,255,0.65)', borderRadius:8, padding:'12px 14px',
              fontSize:13, lineHeight:1.8, color:'var(--text)', marginBottom:10,
              fontStyle:'italic', wordBreak:'break-word',
            }}>
              {result.suggested_full_prompt}
            </div>
            <div style={{ display:'flex', gap:6 }}>
              <ActionBtn color={CC[1].accent} copied={copied.prompt} onClick={() => copy(result.suggested_full_prompt, 'prompt')}>
                📋 Copy Prompt
              </ActionBtn>
              <ActionBtn color="#18c98a" copied={copied.promptGpt} onClick={() => {
                const formatted = `Platform: ${curPlat?.label}\n\nPrompt:\n${result.suggested_full_prompt}${result.negative_prompt ? `\n\nNegative Prompt:\n${result.negative_prompt}` : ''}`
                copy(formatted, 'promptGpt')
              }}>
                📋 Copy Full (with negative)
              </ActionBtn>
            </div>
          </GlassCard>

          {result.negative_prompt && (
            <GlassCard color={CC[4]} label="🚫 negative_prompt">
              <div style={{ background:'rgba(255,255,255,0.65)', borderRadius:8, padding:'10px 12px', fontSize:12, lineHeight:1.7, color:'var(--text)', marginBottom:8, wordBreak:'break-word' }}>
                {result.negative_prompt}
              </div>
              <ActionBtn color={CC[4].accent} copied={copied.neg} onClick={() => copy(result.negative_prompt, 'neg')}>
                📋 Copy Negative
              </ActionBtn>
            </GlassCard>
          )}
        </>
      )}
    </div>
  )

  return (
    <MobileLayout
      isMobile={isMobile}
      leftPanel={leftPanel}
      rightPanel={rightPanel}
      analyzeBtn={generateBtn}
      drawerLabel="⚙ Image Settings"
    />
  )
}

function FieldTree({ data, copied, onCopy, depth }) {
  if (!data || typeof data !== 'object') return null
  return (
    <div style={{ display:'flex', flexDirection:'column', gap: depth === 0 ? 8 : 5 }}>
      {Object.entries(data).map(([key, value], idx) => {
        const color = FIELD_COLORS[idx % FIELD_COLORS.length]
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
        const copyKey = depth + '_' + key

        if (typeof value === 'object' && value !== null) {
          return (
            <div key={key} style={{ borderLeft:`3px solid ${color}`, background:`${color}08`, borderRadius:8, padding:'8px 10px' }}>
              <div style={{ fontSize:9, fontWeight:700, color, letterSpacing:'0.07em', marginBottom:6 }}>{label}</div>
              <FieldTree data={value} copied={copied} onCopy={onCopy} depth={depth + 1} />
            </div>
          )
        }

        return (
          <div key={key} style={{
            background:'rgba(255,255,255,0.55)', border:`1px solid ${color}22`,
            borderLeft:`3px solid ${color}`, borderRadius:8, padding:'8px 10px',
            display:'flex', gap:8, alignItems:'flex-start',
          }}>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:9, fontWeight:700, color, letterSpacing:'0.07em', marginBottom:3 }}>{label}</div>
              <div style={{ fontSize:12, color:'var(--text)', lineHeight:1.6, wordBreak:'break-word' }}>{String(value)}</div>
            </div>
            <button onClick={() => onCopy(String(value), copyKey)} style={{
              flexShrink:0, padding:'3px 8px', fontSize:9, fontWeight:600,
              background: copied[copyKey] ? `${color}18` : 'rgba(255,255,255,0.7)',
              border:`1px solid ${copied[copyKey] ? color : 'rgba(100,120,220,0.2)'}`,
              color: copied[copyKey] ? color : 'var(--text3)',
              borderRadius:6, cursor:'pointer', whiteSpace:'nowrap', transition:'all 0.15s',
            }}>{copied[copyKey] ? '✓' : '📋'}</button>
          </div>
        )
      })}
    </div>
  )
}

function GlassCard({ color, label, children, style = {} }) {
  return (
    <div style={{ background:color?.bg||'rgba(255,255,255,0.55)', border:`1px solid ${color?.border||'rgba(100,120,220,0.18)'}`, borderRadius:12, padding:'11px 12px', backdropFilter:'blur(12px)', WebkitBackdropFilter:'blur(12px)', boxShadow:'0 2px 12px rgba(80,100,200,0.07)', ...style }}>
      {label && <div style={{ fontSize:10, fontWeight:700, color:color?.accent||'var(--text3)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:8 }}>{label}</div>}
      {children}
    </div>
  )
}

function ActionBtn({ children, onClick, color, copied, small }) {
  return (
    <button onClick={onClick} style={{ padding:small?'3px 9px':'6px 14px', fontSize:11, fontWeight:600, background:copied?`${color||'#18c98a'}18`:'rgba(255,255,255,0.7)', border:`1px solid ${copied?(color||'#18c98a'):'rgba(100,120,220,0.2)'}`, color:copied?(color||'#18c98a'):'var(--text2)', borderRadius:7, cursor:'pointer', whiteSpace:'nowrap', transition:'all 0.15s' }}>
      {copied ? '✓ Copied' : children}
    </button>
  )
}

function Spin() {
  return <span style={{ display:'inline-block', animation:'spin .7s linear infinite', fontSize:14 }}>⟳<style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></span>
}
