import React from 'react'

export default function Toast({ toast }) {
  return (
    <div role="status" aria-live="polite" style={{ position: 'fixed', bottom: 84, right: 16, left: 16, zIndex: 9999, display: 'flex', justifyContent: 'flex-end', pointerEvents: 'none' }}>
      {toast && (
        <div style={{
          background: toast.isError ? 'var(--danger)' : 'var(--text)',
          color: '#fff', padding: '10px 14px', borderRadius: 8,
          fontSize: 13, fontWeight: 600, lineHeight: 1.45,
          animation: 'fadeIn 0.2s ease', boxShadow: '0 6px 20px rgba(20,18,15,0.25)',
          maxWidth: 360, wordBreak: 'break-word',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
