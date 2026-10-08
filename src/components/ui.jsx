import React from 'react'

// Warna transparan dari token tema (bisa hex atau var(--...))
export const tint = (color, pct) => `color-mix(in srgb, ${color} ${pct}%, transparent)`

// Warna kartu diambil dari tema: Studio = netral semua, Klasik = enam warna lama
export const CC = [0, 1, 2, 3, 4, 5].map(i => ({ bg: `var(--cc${i}-bg)`, border: `var(--cc${i}-line)`, accent: `var(--cc${i}-ink)` }))

export function GlassCard({ color, label, right, children, style = {}, as: Tag = 'div' }) {
  return (
    <Tag style={{ background: color?.bg || 'var(--cc0-bg)', border: `1px solid ${color?.border || 'var(--border)'}`, borderRadius: 'var(--radius)', padding: '11px 12px', backdropFilter: 'var(--blur)', WebkitBackdropFilter: 'var(--blur)', boxShadow: 'var(--card-shadow)', minWidth: 0, ...style }}>
      {(label || right) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          {label && <CardLabel color={color?.accent}>{label}</CardLabel>}
          {right}
        </div>
      )}
      {children}
    </Tag>
  )
}

export function CardLabel({ children, color, style = {} }) {
  return <div style={{ fontSize: 'var(--label-size)', fontWeight: 650, color: color || 'var(--text2)', textTransform: 'var(--label-case)', letterSpacing: 'var(--label-track)', flex: 1, minWidth: 0, ...style }}>{children}</div>
}

export function Btn({ children, onClick, color = 'var(--c-blue)', active, disabled, small, title, style = {}, type = 'button', ...rest }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} aria-pressed={active === undefined ? undefined : !!active} {...rest} style={{
      padding: small ? '4px 9px' : '7px 12px', fontSize: small ? 11 : 12, fontWeight: 600,
      background: active ? tint(color, 12) : tint('var(--paper)', 75),
      border: `1px solid ${active ? color : tint('var(--tint)', 22)}`,
      color: disabled ? 'var(--text3)' : active ? color : 'var(--text2)',
      borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.55 : 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, ...style,
    }}>{children}</button>
  )
}

export function PrimaryBtn({ children, onClick, disabled, gradient = 'var(--grad-primary)', style = {}, ...rest }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} {...rest} style={{
      width: '100%', padding: 12, fontSize: 13, fontWeight: 700,
      background: disabled ? tint('var(--tint)', 15) : gradient,
      border: 'none', color: disabled ? 'var(--text3)' : 'var(--on-accent)', borderRadius: 9,
      cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, ...style,
    }}>{children}</button>
  )
}

// Tombol aksi kecil (salin, ekspor). `copied` menampilkan status berhasil.
export function ActionBtn({ children, onClick, color = 'var(--c-green)', copied, small, title, disabled }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title} disabled={disabled} style={{
      padding: small ? '4px 9px' : '6px 12px', fontSize: 11, fontWeight: 600,
      background: copied ? tint(color, 12) : tint('var(--paper)', 75),
      border: `1px solid ${copied ? color : tint('var(--tint)', 22)}`,
      color: copied ? color : disabled ? 'var(--text3)' : 'var(--text2)', opacity: disabled ? 0.55 : 1,
      borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', gap: 5,
    }}>
      {copied ? 'Tersalin' : children}
    </button>
  )
}

export function OutputBox({ content, loading, empty, mono, minH = 80, style = {} }) {
  return (
    <div style={{ background: tint('var(--paper)', 60), border: `1px solid ${tint('var(--tint)', 14)}`, borderRadius: 7, padding: '10px 12px', overflowY: 'auto', fontSize: mono ? 11 : 13, lineHeight: 1.7, fontFamily: mono ? 'var(--mono)' : 'var(--sans)', color: content ? 'var(--text)' : 'var(--text3)', fontStyle: !content && !loading ? 'italic' : 'normal', whiteSpace: 'pre-wrap', wordBreak: 'break-word', minHeight: minH, animation: loading ? 'pulse 1.2s infinite' : 'none', ...style }}>
      {loading ? 'Sedang diproses…' : content || empty || ''}
    </div>
  )
}

export function Chip({ label, value }) {
  return (
    <div style={{ background: tint('var(--paper)', 70), border: `1px solid ${tint('var(--tint)', 16)}`, borderRadius: 6, padding: '2px 8px', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {label && <span style={{ fontSize: 11, color: 'var(--text3)' }}>{label}</span>}
      <span className="num" style={{ fontSize: 11, color: 'var(--text)', fontFamily: 'var(--mono)', fontWeight: 600 }}>{value}</span>
    </div>
  )
}

export function SelField({ value, onChange, options, label, style = {} }) {
  return (
    <div style={{ position: 'relative', ...style }}>
      <select value={value} onChange={e => onChange(e.target.value)} aria-label={label} style={{ width: '100%', background: tint('var(--paper)', 75), border: `1px solid ${tint('var(--tint)', 22)}`, color: 'var(--text)', fontSize: 12, padding: '7px 24px 7px 9px', borderRadius: 7, appearance: 'none' }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span aria-hidden style={{ position: 'absolute', right: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)', pointerEvents: 'none', fontSize: 10 }}>▼</span>
    </div>
  )
}

// Pilihan bersebelahan (radio sederhana)
export function Seg({ value, onChange, options, color = 'var(--c-violet)', label }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const on = value === o.value
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)} title={o.title} style={{
            flex: '1 1 auto', padding: '6px 10px', fontSize: 12, fontWeight: 600,
            background: on ? tint(color, 12) : tint('var(--paper)', 60),
            border: `1px solid ${on ? color : tint('var(--tint)', 18)}`,
            color: on ? color : 'var(--text2)', borderRadius: 7, cursor: 'pointer',
          }}>{o.label}</button>
        )
      })}
    </div>
  )
}

export function Toggle({ on, onClick, children, title, color = 'var(--c-green)' }) {
  return (
    <button type="button" role="switch" aria-checked={!!on} onClick={onClick} title={title} style={{
      padding: '5px 10px', fontSize: 12, fontWeight: 500,
      background: on ? tint(color, 12) : tint('var(--paper)', 55),
      border: `1px solid ${on ? color : tint('var(--tint)', 18)}`,
      color: on ? color : 'var(--text3)', borderRadius: 7, cursor: 'pointer',
    }}>{on ? '✓ ' : ''}{children}</button>
  )
}

export function FieldLabel({ children, htmlFor }) {
  return <label htmlFor={htmlFor} style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginBottom: 4 }}>{children}</label>
}

export function Spin() {
  return <span aria-hidden style={{ display: 'inline-block', animation: 'spin .7s linear infinite', fontSize: 13 }}>⟳</span>
}

// Elemen non-<button> yang bisa diklik: bisa dicapai Tab dan ditekan Enter/Spasi.
// Tombol kecil di dalamnya tidak ikut memicu karena dicek e.target.
export function pressable(onActivate) {
  return {
    role: 'button', tabIndex: 0, onClick: onActivate,
    onKeyDown: e => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      onActivate(e)
    },
  }
}

export function Badge({ label, color, title, onClick }) {
  return (
    <span title={title} {...(onClick ? pressable(onClick) : {})} style={{
      fontSize: 11, fontWeight: 650, color, background: tint(color, 9), border: `1px solid ${tint(color, 28)}`,
      borderRadius: 5, padding: '1px 6px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{label}</span>
  )
}

export function AutoText({ value, onChange, placeholder, style = {}, ...rest }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={1} {...rest}
      style={{
        width: '100%', fieldSizing: 'content', minHeight: 30, resize: 'vertical', padding: '6px 8px', fontSize: 13, lineHeight: 1.55,
        fontFamily: 'var(--sans)', color: 'var(--text)', background: tint('var(--paper)', 70),
        border: `1px solid ${tint('var(--tint)', 18)}`, borderRadius: 7, ...style,
      }} />
  )
}

export const inputStyle = {
  padding: '6px 8px', fontSize: 12, color: 'var(--text)', background: tint('var(--paper)', 75),
  border: `1px solid ${tint('var(--tint)', 22)}`, borderRadius: 7, minWidth: 0,
}

export function Empty({ children }) {
  return <div style={{ color: 'var(--text3)', fontSize: 13, padding: '24px 8px', textAlign: 'center', lineHeight: 1.7 }}>{children}</div>
}

// Catatan kecil (info/peringatan) dengan teks, bukan hanya warna
export function Note({ children, tone = 'info', style = {} }) {
  const color = tone === 'warn' ? 'var(--c-amber)' : tone === 'error' ? 'var(--danger)' : 'var(--text2)'
  return (
    <div role={tone === 'error' ? 'alert' : 'note'} style={{ fontSize: 12, lineHeight: 1.6, color, background: tone === 'info' ? tint('var(--tint)', 7) : tint(color, 8), border: `1px solid ${tone === 'info' ? tint('var(--tint)', 16) : tint(color, 28)}`, borderRadius: 7, padding: '8px 10px', ...style }}>
      {children}
    </div>
  )
}

// Ikon garis sederhana untuk navigasi (dibuat sendiri, satu ketebalan garis)
const ICONS = {
  analyze: <><rect x="3" y="5" width="14" height="14" rx="2" /><path d="M17 10l4-2.5v9L17 14" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-9 9" /></>,
  variations: <><rect x="7" y="3" width="13" height="13" rx="2" /><path d="M4 7v12a1 1 0 0 0 1 1h12" /></>,
  editor: <><circle cx="6" cy="7" r="2.5" /><circle cx="6" cy="17" r="2.5" /><path d="M8 8.5L20 17M8 15.5L20 7" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>,
  settings: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h0" /></>,
}
export function Icon({ name, size = 18, style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, ...style }}>
      {ICONS[name]}
    </svg>
  )
}

export function copyText(text, showToast) {
  if (!text) return Promise.resolve(false)
  return navigator.clipboard.writeText(text).then(() => { showToast?.('Disalin'); return true }, () => { showToast?.('Gagal menyalin, izinkan akses clipboard', true); return false })
}

export function downloadText(content, name, type = 'text/plain') {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
