import React, { useState } from 'react'
import { GlassCard, Btn, Badge, AutoText, Spin, CC, tint, inputStyle } from './ui'
import { GLOBAL_FIELDS, SOURCES, countMissing, sceneNo, scenePrompt, sceneReview } from '../utils/analysis'
import { fmtTime } from '../utils/media'

const FIELD_ID = { subject: 'Subjek', action: 'Aksi', environment: 'Lingkungan', cameraWork: 'Kamera', timeOfDay: 'Waktu', lighting: 'Pencahayaan', style: 'Gaya', sound: 'Suara' }

function SourceBadge({ source, onVerify }) {
  const s = SOURCES[source] || SOURCES.inferred
  const canVerify = source !== 'edited' && onVerify
  return (
    <Badge label={s.id} color={s.color} onClick={canVerify ? onVerify : undefined}
      title={`${s.hint}${canVerify ? '. Klik untuk tandai sudah diperiksa' : ''}`} />
  )
}

function FieldRow({ label, value, onChange, onVerify }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>{label}</span>
        <SourceBadge source={value.source} onVerify={onVerify} />
      </div>
      <AutoText value={value.text} onChange={onChange} aria-label={label} style={{ borderLeft: `3px solid ${(SOURCES[value.source] || SOURCES.inferred).color}` }} />
    </div>
  )
}

// Hasil analisis terstruktur yang bisa dikoreksi per bagian, dengan aksi per adegan.
export default function AnalysisEditor({ data, thumbs, onChange, onRegenScene, busyScene, onSeek, platform, actions }) {
  const counts = { observed: 0, inferred: 0, suggested: 0, edited: 0 }
  const tally = f => { if (f?.text) counts[f.source] = (counts[f.source] || 0) + 1 }
  GLOBAL_FIELDS.forEach(f => tally(data.global[f.key]))
  data.scenes.forEach(s => { tally(s.summary); tally(s.camera); tally(s.dialogue); s.slots.forEach(tally) })

  function update(mutator) {
    const next = structuredClone(data)
    mutator(next)
    next.missing = countMissing(next)
    onChange(next)
  }
  const setText = (get) => (text) => update(d => { const f = get(d); f.text = text; f.source = 'edited' })
  const verify = (get) => () => update(d => { get(d).source = 'edited' })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
        {Object.entries(SOURCES).map(([k, s]) => (
          <Badge key={k} label={`${s.id} · ${counts[k] || 0}`} color={s.color} title={s.hint} />
        ))}
        {data.missing > 0 && <Badge label={`${data.missing} bagian kosong`} color="var(--danger)" title="Bagian yang tidak diisi AI. Isi manual atau ulangi adegannya" />}
        <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 'auto' }}>Klik label untuk menandai sudah diperiksa</span>
      </div>

      <GlassCard color={CC[0]} label="Ringkasan seluruh video">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
          {GLOBAL_FIELDS.map(f => (
            <FieldRow key={f.key} label={FIELD_ID[f.key] || f.label} value={data.global[f.key]}
              onChange={setText(d => d.global[f.key])} onVerify={verify(d => d.global[f.key])} />
          ))}
          {data.platformParams && (
            <FieldRow label="Parameter platform" value={data.platformParams}
              onChange={setText(d => d.platformParams)} onVerify={verify(d => d.platformParams)} />
          )}
        </div>
      </GlassCard>

      {data.scenes.map((s, i) => (
        <SceneCard key={s.id} s={s} i={i} data={data} thumb={thumbs[s.id]} platform={platform}
          busy={busyScene === s.id} anyBusy={!!busyScene} onSeek={onSeek} onRegen={() => onRegenScene(s.id)}
          setText={setText} verify={verify} actions={actions} />
      ))}
    </div>
  )
}

function SceneCard({ s, i, data, thumb, platform, busy, anyBusy, onSeek, onRegen, setText, verify, actions }) {
  const [instr, setInstr] = useState('')
  const review = sceneReview(s)
  const prompt = scenePrompt(data, s, platform)
  const n = sceneNo(s, i)
  return (
    <GlassCard as="section" color={CC[(i % 5) + 1]}
      label={<span className="num">Adegan {n} · {fmtTime(s.start)}–{fmtTime(s.end)} · {(s.end - s.start).toFixed(1)} dtk</span>}
      right={<>
        <Btn small onClick={() => onSeek(s.start)} title="Putar adegan ini di video">Putar</Btn>
        <Btn small onClick={onRegen} disabled={anyBusy} title="Kirim ulang adegan ini ke AI bersama videonya">
          {busy ? <><Spin /> Mengulang…</> : 'Analisis ulang'}
        </Btn>
      </>}
      style={{ opacity: busy ? 0.6 : 1 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {thumb && (
          <button type="button" onClick={() => onSeek(s.start)} aria-label={`Putar adegan ${n}`} style={{ padding: 0, border: 'none', background: 'none', cursor: 'pointer', flexShrink: 0 }}>
            <img src={thumb} alt="" style={{ width: 132, maxWidth: '100%', borderRadius: 6, display: 'block' }} />
          </button>
        )}
        <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <FieldRow label="Ringkasan" value={s.summary} onChange={setText(d => d.scenes[i].summary)} onVerify={verify(d => d.scenes[i].summary)} />
          <FieldRow label="Kamera" value={s.camera} onChange={setText(d => d.scenes[i].camera)} onVerify={verify(d => d.scenes[i].camera)} />
          <FieldRow label="Dialog" value={s.dialogue} onChange={setText(d => d.scenes[i].dialogue)} onVerify={verify(d => d.scenes[i].dialogue)} />
        </div>
      </div>

      <details style={{ marginTop: 9 }}>
        <summary style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>Detail per 2 detik ({s.slots.length})</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 7 }}>
          {s.slots.map((sl, k) => (
            <div key={sl.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <button type="button" onClick={() => onSeek(sl.start)} title="Putar bagian ini" className="num"
                style={{ flexShrink: 0, width: 78, marginTop: 4, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', background: tint('var(--tint)', 8), border: `1px solid ${tint('var(--tint)', 18)}`, borderRadius: 6, padding: '3px 0', cursor: 'pointer' }}>
                {fmtTime(sl.start, 0)}–{fmtTime(sl.end, 0)}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <AutoText value={sl.text} onChange={setText(d => d.scenes[i].slots[k])} aria-label={`Detik ${fmtTime(sl.start, 0)}`}
                  style={{ borderLeft: `3px solid ${(SOURCES[sl.source] || SOURCES.inferred).color}` }} />
              </div>
              <div style={{ marginTop: 6 }}>
                <SourceBadge source={sl.source} onVerify={verify(d => d.scenes[i].slots[k])} />
              </div>
            </div>
          ))}
        </div>
      </details>

      {/* Prompt siap salin untuk adegan ini */}
      <div style={{ marginTop: 9, background: tint('var(--paper)', 70), border: '1px solid var(--border)', borderRadius: 7, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text)', flex: 1 }}>Prompt siap salin</span>
          <Btn small onClick={() => actions.copy(prompt, `scene-${s.id}`)} active={actions.copied[`scene-${s.id}`]} color="var(--c-green)">
            {actions.copied[`scene-${s.id}`] ? 'Tersalin' : 'Salin prompt'}
          </Btn>
        </div>
        <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.55, color: 'var(--text2)', maxHeight: 180, overflowY: 'auto' }}>{prompt}</pre>
        {review.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--c-amber)', marginTop: 6, lineHeight: 1.5 }}>
            Perlu diperiksa: {review.map(r => `${r.label} (${SOURCES[r.source].id.toLowerCase()})`).join(', ')}
          </div>
        )}
      </div>

      {/* Revisi terarah + aksi lanjutan */}
      <form onSubmit={e => { e.preventDefault(); if (instr.trim()) actions.revise(s.id, instr.trim()).then(ok => ok && setInstr('')) }}
        style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <input value={instr} onChange={e => setInstr(e.target.value)} placeholder="Revisi adegan ini, mis. latar jadi studio putih, kamera lebih pelan"
          aria-label={`Instruksi revisi adegan ${n}`} style={{ ...inputStyle, flex: '1 1 220px', fontSize: 12 }} />
        <Btn type="submit" small disabled={!instr.trim() || actions.revising} title="Revisi teks tanpa mengirim ulang video">
          {actions.revising === s.id ? <><Spin /> Merevisi…</> : 'Revisi'}
        </Btn>
      </form>
      <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
        <Btn small onClick={() => actions.toVariation(prompt)}>Buat variasi</Btn>
        <Btn small onClick={() => actions.toImage(s)} disabled={actions.framing === s.id}>{actions.framing === s.id ? <><Spin /> Mengambil frame…</> : 'Frame ke Prompt gambar'}</Btn>
        <Btn small onClick={() => actions.toEditor([s])}>Tambahkan ke Editor</Btn>
      </div>
    </GlassCard>
  )
}
