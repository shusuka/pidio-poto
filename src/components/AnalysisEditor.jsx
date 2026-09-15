import React from 'react'
import { GlassCard, Btn, Badge, AutoText, Spin, CC } from './ui'
import { GLOBAL_FIELDS, SOURCES, countMissing, sceneNo } from '../utils/analysis'
import { fmtTime } from '../utils/media'

function SourceBadge({ source, onVerify }) {
  const s = SOURCES[source] || SOURCES.inferred
  const canVerify = source !== 'edited' && onVerify
  return (
    <Badge label={s.id} color={s.color} onClick={canVerify ? onVerify : undefined}
      title={`${s.hint}${canVerify ? ' — klik untuk tandai sudah diperiksa' : ''}`} />
  )
}

function FieldRow({ label, value, onChange, onVerify, mono }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.07em', fontFamily: mono ? 'var(--mono)' : undefined }}>{label}</span>
        <SourceBadge source={value.source} onVerify={onVerify} />
      </div>
      <AutoText value={value.text} onChange={onChange} style={{ borderLeft: `3px solid ${(SOURCES[value.source] || SOURCES.inferred).color}` }} />
    </div>
  )
}

// Hasil analisis terstruktur yang bisa dikoreksi per bagian.
export default function AnalysisEditor({ data, thumbs, onChange, onRegenScene, busyScene, onSeek }) {
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
        {data.missing > 0 && <Badge label={`⚠ ${data.missing} kosong`} color="#e8304a" title="Bagian yang tidak diisi AI — isi manual atau ulangi adegannya" />}
        <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>Klik label untuk menandai sudah diperiksa</span>
      </div>

      <GlassCard color={CC[0]} label="Ringkasan global">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
          {GLOBAL_FIELDS.map(f => (
            <FieldRow key={f.key} label={f.label.toUpperCase()} value={data.global[f.key]}
              onChange={setText(d => d.global[f.key])} onVerify={verify(d => d.global[f.key])} />
          ))}
          {data.platformParams && (
            <FieldRow label="PLATFORM PARAMS" value={data.platformParams}
              onChange={setText(d => d.platformParams)} onVerify={verify(d => d.platformParams)} />
          )}
        </div>
      </GlassCard>

      {data.scenes.map((s, i) => {
        const busy = busyScene === s.id
        return (
          <GlassCard key={s.id} color={CC[(i % 5) + 1]}
            label={`Scene ${sceneNo(s, i)} · ${fmtTime(s.start)}–${fmtTime(s.end)}`}
            right={<>
              <Btn small onClick={() => onSeek(s.start)} title="Putar adegan di video">▶</Btn>
              <Btn small onClick={() => onRegenScene(s.id)} disabled={!!busyScene} title="Analisis ulang hanya adegan ini">
                {busy ? <><Spin /> Mengulang…</> : '↻ Ulang adegan'}
              </Btn>
            </>}
            style={{ opacity: busy ? 0.6 : 1 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {thumbs[s.id] && (
                <img src={thumbs[s.id]} alt="" onClick={() => onSeek(s.start)}
                  style={{ width: 120, maxWidth: '100%', borderRadius: 8, cursor: 'pointer', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <FieldRow label="SUMMARY" value={s.summary} onChange={setText(d => d.scenes[i].summary)} onVerify={verify(d => d.scenes[i].summary)} />
                <FieldRow label="CAMERA" value={s.camera} onChange={setText(d => d.scenes[i].camera)} onVerify={verify(d => d.scenes[i].camera)} />
                <FieldRow label="DIALOGUE" value={s.dialogue} onChange={setText(d => d.scenes[i].dialogue)} onVerify={verify(d => d.scenes[i].dialogue)} />
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 9 }}>
              {s.slots.map((sl, k) => (
                <div key={sl.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button type="button" onClick={() => onSeek(sl.start)} title="Putar bagian ini"
                    style={{ flexShrink: 0, width: 74, marginTop: 4, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--accent)', background: 'rgba(79,126,247,0.08)', border: '1px solid rgba(79,126,247,0.2)', borderRadius: 6, padding: '3px 0', cursor: 'pointer' }}>
                    {fmtTime(sl.start, 0)}–{fmtTime(sl.end, 0)}
                  </button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AutoText value={sl.text} onChange={setText(d => d.scenes[i].slots[k])}
                      style={{ borderLeft: `3px solid ${(SOURCES[sl.source] || SOURCES.inferred).color}` }} />
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <SourceBadge source={sl.source} onVerify={verify(d => d.scenes[i].slots[k])} />
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        )
      })}
    </div>
  )
}
