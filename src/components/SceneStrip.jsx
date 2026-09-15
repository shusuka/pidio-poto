import React from 'react'
import { GlassCard, Btn, CC } from './ui'
import { fmtTime } from '../utils/media'

const LEVELS = [['low', 'Rendah'], ['medium', 'Sedang'], ['high', 'Tinggi']]

// Daftar adegan hasil deteksi: thumbnail + rentang waktu, bisa dipilih untuk analisis.
export default function SceneStrip({ scenes, status, selected, sensitivity, onToggle, onSelectAll, onClear, onSensitivity, onSeek }) {
  if (!scenes?.length) return null
  const detecting = status?.state === 'detecting'
  const selSet = new Set(selected)
  const selCount = selected.length
  const cuts = scenes.filter(s => s.cut !== false).length

  return (
    <GlassCard color={CC[2]} label={`Adegan · ${scenes.length}`} right={
      <span style={{ fontSize: 10, color: 'var(--text3)' }}>{selCount ? `${selCount} dipilih` : 'semua'}</span>
    }>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: 'var(--text3)', marginRight: 2 }}>Sensitivitas</span>
        {LEVELS.map(([id, label]) => (
          <Btn key={id} small active={sensitivity === id} color="#18c98a" disabled={detecting} onClick={() => onSensitivity(id)}>{label}</Btn>
        ))}
      </div>

      {detecting && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 3 }}>Mendeteksi pergantian adegan… {Math.round((status.progress || 0) * 100)}%</div>
          <div style={{ height: 4, background: 'rgba(100,120,220,0.12)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${(status.progress || 0) * 100}%`, height: '100%', background: '#18c98a', transition: 'width .2s' }} />
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))', gap: 6, maxHeight: 330, overflowY: 'auto', paddingRight: 2 }}>
        {scenes.map((s, i) => {
          const on = selSet.has(s.id)
          return (
            <div key={s.id} onClick={() => onToggle(s.id)} title="Klik untuk memilih adegan ini"
              style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', cursor: 'pointer', background: 'rgba(255,255,255,0.6)', border: `2px solid ${on ? '#18c98a' : 'transparent'}`, boxShadow: on ? '0 0 0 2px rgba(24,201,138,0.18)' : 'none' }}>
              <div style={{ aspectRatio: '16 / 10', background: 'rgba(100,120,220,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {s.thumb
                  ? <img src={s.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <span style={{ fontSize: 16, opacity: 0.3 }}>🎞</span>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 5px' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: on ? '#18c98a' : 'var(--text2)' }}>{i + 1}</span>
                <span style={{ fontSize: 9, fontFamily: 'var(--mono)', color: 'var(--text3)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {fmtTime(s.start, 0)}–{fmtTime(s.end, 0)}
                </span>
                <button type="button" onClick={e => { e.stopPropagation(); onSeek(s.start) }} title="Putar dari sini"
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 10, color: 'var(--accent)', padding: 0 }}>▶</button>
              </div>
              {on && <span style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: '#18c98a', color: 'white', fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>✓</span>}
              {s.cut === false && <span title="Lanjutan adegan panjang yang dipecah" style={{ position: 'absolute', top: 4, left: 4, fontSize: 8, background: 'rgba(0,0,0,0.5)', color: 'white', borderRadius: 4, padding: '0 4px' }}>lanjutan</span>}
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 5, marginTop: 8, alignItems: 'center' }}>
        <Btn small onClick={onSelectAll}>Pilih semua</Btn>
        <Btn small onClick={onClear} disabled={!selCount}>Kosongkan</Btn>
        <span style={{ fontSize: 9, color: 'var(--text3)', marginLeft: 'auto' }}>{cuts} potongan</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 6, lineHeight: 1.5 }}>
        Pilih adegan tertentu agar analisis lebih cepat & hemat. Tidak memilih = semua adegan.
      </div>
    </GlassCard>
  )
}
