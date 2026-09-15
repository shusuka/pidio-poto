import React from 'react'

export const CC = [
  { bg: 'rgba(79,126,247,0.08)',  border: 'rgba(79,126,247,0.2)',  accent: '#0a47e2' },
  { bg: 'rgba(155,107,245,0.08)', border: 'rgba(155,107,245,0.2)', accent: '#661cf0' },
  { bg: 'rgba(24,201,138,0.08)',  border: 'rgba(24,201,138,0.2)',  accent: '#0c6747' },
  { bg: 'rgba(245,166,35,0.08)',  border: 'rgba(245,166,35,0.2)',  accent: '#7e5106' },
  { bg: 'rgba(240,82,138,0.08)',  border: 'rgba(240,82,138,0.2)',  accent: '#ac0f47' },
  { bg: 'rgba(255,120,60,0.08)',  border: 'rgba(255,120,60,0.2)',  accent: '#a23200' },
]

export function GlassCard({ color, label, right, children, style = {} }) {
  return (
    <div style={{ background: color?.bg || 'rgba(255,255,255,0.55)', border: `1px solid ${color?.border || 'rgba(100,120,220,0.18)'}`, borderRadius: 12, padding: '11px 12px', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: '0 2px 12px rgba(80,100,200,0.07)', minWidth: 0, ...style }}>
      {(label || right) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {label && <div style={{ fontSize: 10, fontWeight: 700, color: color?.accent || 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.09em', flex: 1, minWidth: 0 }}>{label}</div>}
          {right}
        </div>
      )}
      {children}
    </div>
  )
}

export function Btn({ children, onClick, color = '#0a47e2', active, disabled, small, title, style = {} }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} style={{
      padding: small ? '3px 8px' : '6px 11px', fontSize: small ? 10 : 11, fontWeight: 600,
      background: active ? `${color}1f` : 'rgba(255,255,255,0.7)',
      border: `1px solid ${active ? color : 'rgba(100,120,220,0.2)'}`,
      color: disabled ? 'var(--text3)' : active ? color : 'var(--text2)',
      borderRadius: 7, cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', opacity: disabled ? 0.6 : 1,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, ...style,
    }}>{children}</button>
  )
}

export function PrimaryBtn({ children, onClick, disabled, gradient = 'linear-gradient(135deg,#0a47e2,#661cf0)', style = {} }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={{
      width: '100%', padding: 11, fontSize: 12, fontWeight: 700,
      background: disabled ? 'rgba(100,120,220,0.15)' : gradient,
      border: 'none', color: disabled ? 'var(--text3)' : 'white', borderRadius: 10,
      cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, ...style,
    }}>{children}</button>
  )
}

export function Spin() {
  return <span style={{ display: 'inline-block', animation: 'spin .7s linear infinite', fontSize: 13 }}>⟳</span>
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
      fontSize: 11, fontWeight: 700, color, background: `${color}14`, border: `1px solid ${color}40`,
      borderRadius: 10, padding: '1px 6px', whiteSpace: 'nowrap', cursor: onClick ? 'pointer' : 'default', userSelect: 'none',
    }}>{label}</span>
  )
}

export function AutoText({ value, onChange, placeholder, style = {}, ...rest }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={1} {...rest}
      style={{
        width: '100%', fieldSizing: 'content', minHeight: 30, resize: 'vertical', padding: '6px 8px', fontSize: 12, lineHeight: 1.55,
        fontFamily: 'var(--sans)', color: 'var(--text)', background: 'rgba(255,255,255,0.65)',
        border: '1px solid rgba(100,120,220,0.18)', borderRadius: 7, ...style,
      }} />
  )
}

export const inputStyle = {
  padding: '5px 7px', fontSize: 11, color: 'var(--text)', background: 'rgba(255,255,255,0.7)',
  border: '1px solid rgba(100,120,220,0.2)', borderRadius: 7, minWidth: 0,
}

export function Empty({ children }) {
  return <div style={{ color: 'var(--text3)', fontSize: 12, fontStyle: 'italic', padding: '24px 8px', textAlign: 'center', lineHeight: 1.7 }}>{children}</div>
}
