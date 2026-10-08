import React, { useState, useRef, useEffect } from 'react'
import { Icon } from './ui'

const WIDTH_KEY = 'videoprompt_panel_w'
const DEFAULT_W = 360
const MIN_W = 260
const maxWidth = () => Math.max(MIN_W, Math.min(760, Math.round(window.innerWidth * 0.6)))
const clampW = w => Math.min(maxWidth(), Math.max(MIN_W, w))

function loadWidth() {
  try { return clampW(Number(localStorage.getItem(WIDTH_KEY)) || DEFAULT_W) } catch { return DEFAULT_W }
}

/**
 * MobileLayout — wraps two-panel desktop layout into a responsive mobile layout.
 * Desktop: side-by-side (leftPanel | rightPanel)
 * Mobile:  rightPanel full width + floating drawer for leftPanel + FAB trigger
 */
export default function MobileLayout({ isMobile, leftPanel, rightPanel, analyzeBtn, drawerLabel = 'Pengaturan' }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [width, setWidth] = useState(loadWidth)
  const [dragging, setDragging] = useState(false)
  const widthRef = useRef(width)

  // Drawer bisa ditutup dengan Escape
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  // Seret garis pemisah untuk mengatur lebar panel kiri (dobel-klik = reset)
  function startResize(e) {
    e.preventDefault()
    const startX = e.clientX, startW = widthRef.current
    setDragging(true)
    const move = ev => { widthRef.current = clampW(startW + ev.clientX - startX); setWidth(widthRef.current) }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(false)
      try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)) } catch { /* abaikan */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetWidth() {
    widthRef.current = clampW(DEFAULT_W)
    setWidth(widthRef.current)
    try { localStorage.setItem(WIDTH_KEY, String(widthRef.current)) } catch { /* abaikan */ }
  }

  if (!isMobile) {
    // Desktop: original two-panel layout
    return (
      <div style={{ display:'flex', height:'100%', overflow:'hidden', userSelect: dragging ? 'none' : undefined, cursor: dragging ? 'col-resize' : undefined }}>
        {/* Left panel */}
        <div style={{ width, minWidth:width, display:'flex', flexDirection:'column', overflow:'hidden', background:'var(--panel-bg)', backdropFilter:'var(--blur)', borderRight:'1px solid var(--border)' }}>
          <div style={{ flex:1, overflowY:'auto', padding:'14px 12px', display:'flex', flexDirection:'column', gap:12 }}>
            {leftPanel}
          </div>
          {analyzeBtn && (
            <div style={{ padding:12, borderTop:'1px solid color-mix(in srgb, var(--tint) 12%, transparent)', flexShrink:0 }}>
              {analyzeBtn}
            </div>
          )}
        </div>
        {/* Pemisah yang bisa diseret */}
        <div onPointerDown={startResize} onDoubleClick={resetWidth} title="Seret untuk mengubah lebar panel · dobel-klik untuk reset"
          className="panel-resizer" style={{ width:8, marginLeft:-4, marginRight:-4, cursor:'col-resize', position:'relative', zIndex:5, flexShrink:0, display:'flex', justifyContent:'center' }}>
          <div style={{ width: dragging ? 3 : 1, height:'100%', background: dragging ? 'var(--accent)' : 'color-mix(in srgb, var(--tint) 18%, transparent)', transition:'background .15s' }} />
        </div>
        {/* Right panel */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minWidth:0 }}>
          {rightPanel}
        </div>
      </div>
    )
  }

  // Mobile: stacked layout with slide-in drawer
  return (
    <div style={{ display:'flex', flexDirection:'column', minHeight:0, flex:1 }}>

      {/* Drawer overlay */}
      <div className={`drawer-overlay${drawerOpen ? ' open' : ''}`} onClick={() => setDrawerOpen(false)} />

      {/* Slide-in drawer */}
      {/* React 18 belum kenal prop inert boolean, jadi pakai string kosong */}
      <div className={`side-drawer${drawerOpen ? ' open' : ''}`} inert={drawerOpen ? undefined : ''}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 14px 10px', flexShrink:0, borderBottom:'1px solid color-mix(in srgb, var(--tint) 12%, transparent)' }}>
          <span style={{ fontSize:12, fontWeight:700, color:'var(--text)', letterSpacing:'-0.01em' }}>{drawerLabel}</span>
          <button onClick={() => setDrawerOpen(false)} aria-label="Tutup pengaturan" style={{ background:'none', border:'none', fontSize:18, color:'var(--text3)', cursor:'pointer', lineHeight:1, padding:'2px 4px' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'12px 12px', display:'flex', flexDirection:'column', gap:10 }}>
          {leftPanel}
        </div>
        {analyzeBtn && (
          <div style={{ padding:'10px 12px', borderTop:'1px solid color-mix(in srgb, var(--tint) 12%, transparent)', flexShrink:0 }}>
            {analyzeBtn}
          </div>
        )}
      </div>

      {/* Mobile top action bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'color-mix(in srgb, var(--paper) 50%, transparent)', borderBottom:'1px solid color-mix(in srgb, var(--tint) 10%, transparent)', backdropFilter:'var(--blur)', flexShrink:0 }}>
        <button onClick={() => setDrawerOpen(true)} style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'7px 14px', fontSize:12, fontWeight:600,
          background:'color-mix(in srgb, var(--c-blue) 10%, transparent)', border:'1px solid color-mix(in srgb, var(--c-blue) 30%, transparent)',
          color:'var(--accent)', borderRadius:9, cursor:'pointer',
        }}>
          <Icon name="settings" size={16} /> {drawerLabel}
        </button>
        {analyzeBtn && (
          <div style={{ flex:1 }}>
            {analyzeBtn}
          </div>
        )}
      </div>

      {/* Right panel — full width on mobile */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0, overflow:'visible' }}>
        {rightPanel}
      </div>
    </div>
  )
}
