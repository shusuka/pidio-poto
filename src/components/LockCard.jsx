import React from 'react'
import { GlassCard, AutoText, Btn, CC } from './ui'
import { LOCK_FIELDS } from '../utils/analysis'

// Kunci konsistensi: deskripsi tetap untuk karakter/produk/gaya, dipakai di semua tab.
export default function LockCard({ lock = {}, set }) {
  const filled = LOCK_FIELDS.filter(f => lock[f.key]?.trim()).length
  const update = (key, v) => set(prev => ({ lock: { ...prev.lock, [key]: v } }))
  return (
    <GlassCard color={CC[1]} label="Kunci konsistensi" right={
      <span className="num" style={{ fontSize: 11, color: filled ? 'var(--c-green)' : 'var(--text3)' }}>{filled ? `${filled} aktif` : 'kosong'}</span>
    }>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 8 }}>
        Deskripsi ini dipakai sama persis di setiap adegan, variasi, dan prompt gambar. Membantu konsistensi, tapi tidak menjamin generator video menghasilkan wajah atau produk yang identik.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {LOCK_FIELDS.map(f => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{f.label}</span>
            <AutoText value={lock[f.key] || ''} onChange={v => update(f.key, v)} placeholder={f.hint} />
          </label>
        ))}
      </div>
      {filled > 0 && <Btn small onClick={() => set({ lock: {} })} style={{ marginTop: 8 }}>Kosongkan semua</Btn>}
    </GlassCard>
  )
}
