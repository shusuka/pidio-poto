import React, { useState } from 'react'

/**
 * MobileLayout — wraps two-panel desktop layout into a responsive mobile layout.
 * Desktop: side-by-side (leftPanel | rightPanel)
 * Mobile:  rightPanel full width + floating drawer for leftPanel + FAB trigger
 */
export default function MobileLayout({ isMobile, leftPanel, rightPanel, analyzeBtn, drawerLabel = 'Settings' }) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!isMobile) {
    // Desktop: original two-panel layout
    return (
      <div style={{ display:'flex', height:'100%', overflow:'hidden' }}>
        {/* Left panel */}
        <div style={{ width:290, minWidth:290, borderRight:'1px solid rgba(100,120,220,0.12)', display:'flex', flexDirection:'column', overflow:'hidden', background:'rgba(255,255,255,0.35)', backdropFilter:'blur(10px)' }}>
          <div style={{ flex:1, overflowY:'auto', padding:'14px 12px', display:'flex', flexDirection:'column', gap:12 }}>
            {leftPanel}
          </div>
          {analyzeBtn && (
            <div style={{ padding:12, borderTop:'1px solid rgba(100,120,220,0.12)', flexShrink:0 }}>
              {analyzeBtn}
            </div>
          )}
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
      <div className={`side-drawer${drawerOpen ? ' open' : ''}`}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 14px 10px', flexShrink:0, borderBottom:'1px solid rgba(100,120,220,0.12)' }}>
          <span style={{ fontSize:12, fontWeight:700, color:'var(--text)', letterSpacing:'-0.01em' }}>{drawerLabel}</span>
          <button onClick={() => setDrawerOpen(false)} style={{ background:'none', border:'none', fontSize:18, color:'var(--text3)', cursor:'pointer', lineHeight:1, padding:'2px 4px' }}>✕</button>
        </div>
        <div style={{ flex:1, overflowY:'auto', padding:'12px 12px', display:'flex', flexDirection:'column', gap:10 }}>
          {leftPanel}
        </div>
        {analyzeBtn && (
          <div style={{ padding:'10px 12px', borderTop:'1px solid rgba(100,120,220,0.12)', flexShrink:0 }}>
            {analyzeBtn}
          </div>
        )}
      </div>

      {/* Mobile top action bar */}
      <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'rgba(255,255,255,0.5)', borderBottom:'1px solid rgba(100,120,220,0.1)', backdropFilter:'blur(10px)', flexShrink:0 }}>
        <button onClick={() => setDrawerOpen(true)} style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'7px 14px', fontSize:12, fontWeight:600,
          background:'rgba(79,126,247,0.1)', border:'1px solid rgba(79,126,247,0.3)',
          color:'var(--accent)', borderRadius:9, cursor:'pointer',
        }}>
          ⚙ {drawerLabel}
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
