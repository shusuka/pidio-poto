import React, { useRef, useState, useEffect, useCallback } from 'react'
import { callAI, parseJsonResponse } from '../utils/gemini'
import { IMG_PLATFORMS } from '../config/platforms'
import { lockInstruction } from '../utils/analysis'
import { addHistory } from '../utils/db'
import MobileLayout from './MobileLayout'
import LockCard from './LockCard'
import { GlassCard, Btn, PrimaryBtn, ActionBtn, Spin, Note, Icon, CC, tint, inputStyle, pressable, copyText } from './ui'

export default function ObjectSwapTab({ state, set, showToast, isMobile, focusKey }) {
  const [image, setImage]       = useState(null)
  const [platform, setPlatform] = useState('gpt_dalle')
  const [customModel, setCustomModel] = useState('')
  const [changes, setChanges]   = useState('')
  const [result, setResult]     = useState(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [copied, setCopied]     = useState({})
  const [screenshotting, setScreenshotting] = useState(false)
  const fileRef = useRef()

  const curPlat = IMG_PLATFORMS.find(p => p.id === platform) || IMG_PLATFORMS[0]
  const targetName = customModel.trim() ? `${curPlat.label} (${customModel.trim()})` : curPlat.label

  function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return showToast('Pilih file gambar (JPG, PNG, WEBP)', true)
    const url = URL.createObjectURL(file)
    const reader = new FileReader()
    reader.onload = () => {
      setImage({ url, base64: reader.result.split(',')[1], mime: file.type, name: file.name })
      setResult(null); setError(null)
    }
    reader.readAsDataURL(file)
  }

  // Frame adegan dari tab Analisis
  useEffect(() => {
    const p = state.pendingImage
    if (!p) return
    const blob = new Blob([Uint8Array.from(atob(p.base64), c => c.charCodeAt(0))], { type: p.mime })
    setImage({ url: URL.createObjectURL(blob), base64: p.base64, mime: p.mime, name: p.name })
    setResult(null); setError(null)
    set({ pendingImage: null })
  }, [state.pendingImage])

  // Buka entri riwayat
  useEffect(() => {
    const r = state.restore
    if (!r || r.kind !== 'image') return
    setResult(r.data?.result || null)
    if (r.data?.platform) setPlatform(r.data.platform)
    if (r.thumb) setImage(img => img || { url: r.thumb, base64: r.thumb.split(',')[1], mime: 'image/jpeg', name: 'riwayat.jpg' })
    set({ restore: null })
  }, [state.restore])

  const handlePaste = useCallback((e) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) { loadImage(file); showToast('Gambar ditempel') }
        return
      }
    }
  }, [])
  useEffect(() => {
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handlePaste])

  async function captureScreenshot() {
    setScreenshotting(true)
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false })
      const track = stream.getVideoTracks()[0]
      let source
      if (typeof ImageCapture !== 'undefined') {
        source = await new ImageCapture(track).grabFrame()
      } else {
        // Firefox/Safari belum punya ImageCapture, ambil frame lewat <video>
        source = document.createElement('video')
        source.muted = true
        source.srcObject = stream
        await source.play()
        await new Promise(r => requestAnimationFrame(r))
      }
      const width = source.videoWidth || source.width
      const height = source.videoHeight || source.height
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(source, 0, 0, width, height)
      stream.getTracks().forEach(t => t.stop())
      canvas.toBlob(blob => {
        if (blob) { loadImage(new File([blob], 'screenshot.png', { type: 'image/png' })); showToast('Screenshot diambil') }
      }, 'image/png')
    } catch (e) {
      if (e.name !== 'NotAllowedError') showToast('Screenshot gagal: ' + e.message, true)
    }
    setScreenshotting(false)
  }

  function pasteFromClipboard() {
    navigator.clipboard.read().then(items => {
      for (const item of items) {
        const imgType = item.types.find(t => t.startsWith('image/'))
        if (imgType) {
          item.getType(imgType).then(blob => { loadImage(new File([blob], 'clipboard.png', { type: imgType })); showToast('Gambar dari clipboard') })
          return
        }
      }
      showToast('Tidak ada gambar di clipboard', true)
    }).catch(() => showToast('Browser menolak akses clipboard. Tekan Ctrl+V di halaman ini', true))
  }

  async function generate(isRegen = false) {
    if (!image) return showToast('Pilih gambar dulu', true)
    if (!state.apiKey) { showToast('Isi API key dulu', true); return focusKey?.() }

    setLoading(true); setError(null)
    if (!isRegen) setResult(null)
    const prev = isRegen && result ? `\n\nPREVIOUS BREAKDOWN (keep everything that the user does not ask to change):\n${JSON.stringify(result)}` : ''
    const regenNote = isRegen && changes.trim()
      ? `${prev}\n\nUSER MODIFICATION: "${changes.trim()}"\nApply this change to the breakdown and regenerate the suggested_full_prompt accordingly.`
      : isRegen ? '\n\nGive a fresh, alternative take: different wording and a different emphasis in suggested_full_prompt.' : ''

    const prompt = `You are an expert image analyst and prompt engineer for ${targetName}.
Platform note: ${curPlat.note}

Analyze this image in detail and return a structured JSON breakdown.${regenNote}
${lockInstruction(state.lock)}

Rules:
- image_breakdown keys must be snake_case, descriptive, and chosen based on what is ACTUALLY visible in the image
- If a key has multiple distinct sub-values (e.g. colors of different elements), use a nested object
- Be specific and concrete, avoid vague descriptions
- Also describe camera/lens feel (shot type, focal length, depth of field) and any visible text or logos
- suggested_full_prompt must be detailed enough to recreate the image closely: subject, pose, clothing, setting, composition, lighting direction, color palette, style and camera
- suggested_full_prompt must be a single ready-to-paste string optimized specifically for ${targetName}
- negative_prompt only if the platform supports one, otherwise ""
- Return ONLY valid JSON. No markdown. No backticks. Start with { end with }

Schema:
{
  "image_breakdown": {
    "core_subject": "...",
    "composition": "...",
    "colors": { "primary": "...", "secondary": "...", "background": "..." },
    "lighting": "...",
    "style": "...",
    "mood_and_atmosphere": "...",
    "texture_and_detail": "...",
    "additional_details": "..."
  },
  "suggested_full_prompt": "...",
  "negative_prompt": "..."
}`

    try {
      const { text, tokens } = await callAI({
        provider: state.provider, apiKey: state.apiKey, model: state.model, prompt,
        mediaData: image.base64, mimeType: image.mime, temperature: 0.5, json: true,
      })
      set(p => ({ totalTokens: p.totalTokens + tokens }))
      const parsed = parseJsonResponse(text)
      if (!parsed?.suggested_full_prompt) throw new Error('Respons AI bukan JSON yang valid, coba lagi.')
      setResult(parsed)
      addHistory({ kind: 'image', title: image.name || 'Gambar', platform: targetName, text: parsed.suggested_full_prompt, data: { result: parsed, platform }, thumb: await smallThumb(image.url) })
      showToast('Prompt gambar siap')
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
    <PrimaryBtn onClick={() => generate(false)} disabled={loading || !image}>
      {loading ? <><Spin /> Menganalisis gambar…</> : 'Buat prompt gambar'}
    </PrimaryBtn>
  )

  const leftPanel = (
    <>
      <GlassCard color={CC[0]} label="Gambar">
        {image ? (
          <div style={{ position: 'relative' }}>
            <img src={image.url} alt="Gambar yang akan dianalisis" style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 7, display: 'block', background: tint('var(--tint)', 8) }} />
            <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
              <Btn small onClick={() => fileRef.current?.click()}>Ganti gambar</Btn>
              <Btn small color="var(--danger)" onClick={() => { setImage(null); setResult(null) }}>Lepas</Btn>
            </div>
          </div>
        ) : (
          <div {...pressable(() => fileRef.current?.click())} aria-label="Pilih file gambar"
            onDrop={e => { e.preventDefault(); loadImage(e.dataTransfer.files[0]) }} onDragOver={e => e.preventDefault()}
            style={{ minHeight: 130, borderRadius: 7, border: '1.5px dashed var(--border2)', background: 'var(--paper)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', padding: 12, textAlign: 'center' }}>
            <Icon name="image" size={24} style={{ color: 'var(--accent)' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Pilih, seret, atau tempel gambar</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>JPG, PNG, WEBP · Ctrl+V di mana saja</div>
          </div>
        )}
        <input type="file" ref={fileRef} accept="image/*" style={{ display: 'none' }} onChange={e => { loadImage(e.target.files[0]); e.target.value = '' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Btn onClick={captureScreenshot} disabled={screenshotting} style={{ flex: 1 }}>{screenshotting ? <><Spin /> Mengambil…</> : 'Screenshot layar'}</Btn>
          <Btn onClick={pasteFromClipboard} style={{ flex: 1 }}>Tempel dari clipboard</Btn>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Frame adegan juga bisa dikirim dari tab Analisis lewat tombol "Frame ke Prompt gambar".</div>
      </GlassCard>

      <GlassCard color={CC[1]} label="Generator gambar tujuan">
        <div role="radiogroup" aria-label="Generator gambar tujuan" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {IMG_PLATFORMS.map(p => {
            const on = platform === p.id
            return (
              <button key={p.id} role="radio" aria-checked={on} onClick={() => setPlatform(p.id)} style={{
                padding: '6px 10px', fontSize: 12, fontWeight: 600,
                background: on ? tint('var(--c-violet)', 10) : tint('var(--paper)', 60),
                border: `1px solid ${on ? 'var(--c-violet)' : tint('var(--tint)', 18)}`,
                color: on ? 'var(--c-violet)' : 'var(--text2)', borderRadius: 6, cursor: 'pointer',
              }}>{p.label}</button>
            )
          })}
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>{curPlat.note}</div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
          Model/versi (opsional)
          <input value={customModel} onChange={e => setCustomModel(e.target.value)} placeholder="mis. Seedream 4, Midjourney v7" style={{ ...inputStyle, width: '100%', marginTop: 4 }} />
        </label>
      </GlassCard>

      {result && (
        <GlassCard color={CC[2]} label="Ubah hasil">
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 6, lineHeight: 1.5 }}>
            Tulis perubahan yang diinginkan, atau kosongkan untuk versi lain dari prompt yang sama.
          </div>
          <textarea value={changes} onChange={e => setChanges(e.target.value)} aria-label="Perubahan yang diinginkan"
            placeholder="mis. latar jadi biru gelap, tambahkan bokeh"
            style={{ ...inputStyle, width: '100%', minHeight: 70, fontSize: 13, lineHeight: 1.55, resize: 'vertical' }} />
          <Btn onClick={() => generate(true)} disabled={loading} style={{ width: '100%', marginTop: 8 }}>
            {loading ? <><Spin /> Memproses…</> : changes.trim() ? 'Terapkan perubahan' : 'Buat versi lain'}
          </Btn>
        </GlassCard>
      )}

      {state.advanced && <LockCard lock={state.lock} set={set} />}
    </>
  )

  const rightPanel = (
    <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && !loading && <Note tone="error">Gagal: {error} <Btn small onClick={() => generate(!!result)} style={{ marginLeft: 6 }}>Coba lagi</Btn></Note>}

      {!result && !loading && (
        <Note>
          Pilih gambar atau tempel screenshot, pilih generator tujuan, lalu tekan <strong>Buat prompt gambar</strong>. Hasilnya: rincian isi gambar dan satu prompt siap tempel untuk {targetName}.
        </Note>
      )}

      {loading && (
        <GlassCard color={CC[0]} label="Menganalisis gambar">
          <div style={{ height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', fontSize: 13, gap: 10 }}>
            <Spin /> Membaca isi gambar dan menyusun prompt…
          </div>
        </GlassCard>
      )}

      {result && !loading && (
        <>
          <GlassCard color={CC[1]} label={`Prompt untuk ${targetName}`}>
            <div style={{ background: tint('var(--paper)', 70), border: '1px solid var(--border)', borderRadius: 7, padding: '12px 14px', fontSize: 14, lineHeight: 1.75, color: 'var(--text)', marginBottom: 10, wordBreak: 'break-word' }}>
              {result.suggested_full_prompt}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <ActionBtn copied={copied.prompt} onClick={() => copy(result.suggested_full_prompt, 'prompt')}>Salin prompt</ActionBtn>
              {result.negative_prompt && (
                <ActionBtn copied={copied.full} onClick={() => copy(`${result.suggested_full_prompt}\n\nNegative prompt:\n${result.negative_prompt}`, 'full')}>Salin + negative prompt</ActionBtn>
              )}
              <ActionBtn onClick={() => { set({ variationBase: result.suggested_full_prompt, activeTab: 'realistic' }); showToast('Dikirim ke tab Variasi') }}>Jadikan video (Variasi)</ActionBtn>
            </div>
          </GlassCard>

          {result.negative_prompt && (
            <GlassCard color={CC[4]} label="Negative prompt" right={<ActionBtn small copied={copied.neg} onClick={() => copy(result.negative_prompt, 'neg')}>Salin</ActionBtn>}>
              <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)', wordBreak: 'break-word' }}>{result.negative_prompt}</div>
            </GlassCard>
          )}

          <GlassCard color={CC[0]} label="Rincian gambar" right={<ActionBtn small copied={copied.rawjson} onClick={() => copy(JSON.stringify(result, null, 2), 'rawjson')}>Salin JSON</ActionBtn>}>
            <FieldTree data={result.image_breakdown} copied={copied} onCopy={copy} depth={0} />
          </GlassCard>
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
      drawerLabel="Gambar & generator"
    />
  )
}

function FieldTree({ data, copied, onCopy, depth }) {
  if (!data || typeof data !== 'object') return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: depth === 0 ? 7 : 5 }}>
      {Object.entries(data).map(([key, value]) => {
        const label = key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
        const copyKey = depth + '_' + key
        if (typeof value === 'object' && value !== null) {
          return (
            <div key={key} style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text3)', marginBottom: 6 }}>{label}</div>
              <FieldTree data={value} copied={copied} onCopy={onCopy} depth={depth + 1} />
            </div>
          )
        }
        return (
          <div key={key} style={{ background: tint('var(--paper)', 60), border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text3)', marginBottom: 3 }}>{label}</div>
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6, wordBreak: 'break-word' }}>{String(value)}</div>
            </div>
            <ActionBtn small copied={copied[copyKey]} onClick={() => onCopy(String(value), copyKey)} title={`Salin ${label}`}>Salin</ActionBtn>
          </div>
        )
      })}
    </div>
  )
}

// Gambar kecil untuk riwayat (supaya IndexedDB tidak cepat penuh)
function smallThumb(url) {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, 240 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.7))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
