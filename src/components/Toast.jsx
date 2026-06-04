import React from 'react'

export default function Toast({ toast }) {
  if (!toast) return null
  return (
    <div style={{
      position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
      background: toast.isError ? 'var(--danger)' : 'var(--accent3)',
      color: toast.isError ? 'white' : '#0d1a14',
      padding: '9px 16px', borderRadius: 6,
      fontSize: 11, fontFamily: 'var(--mono)', fontWeight: 700,
      animation: 'fadeIn 0.25s ease',
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
      maxWidth: 320, wordBreak: 'break-word',
    }}>
      {toast.msg}
      <style>{`@keyframes fadeIn { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:translateY(0); } }`}</style>
    </div>
  )
}
