import React, { useEffect, useMemo, useRef, useState } from 'react'
import { listHistory, deleteHistory, clearHistory } from '../utils/db'
import { Btn, Icon, Seg, copyText, downloadText, tint, inputStyle, Empty } from './ui'

export const KIND = {
  analyze:    { label: 'Analisis', tab: 'analyze' },
  adapt:      { label: 'Adaptasi', tab: 'analyze' },
  batch:      { label: 'Antrean', tab: 'analyze' },
  insight:    { label: 'Insight', tab: 'analyze' },
  story:      { label: 'Cerita', tab: 'analyze' },
  image:      { label: 'Gambar', tab: 'swap' },
  variations: { label: 'Variasi', tab: 'realistic' },
}

// Riwayat hasil: tersimpan di IndexedDB browser ini, bisa dicari, dibuka lagi, diekspor.
export default function HistoryDrawer({ open, onClose, set, showToast }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('all')
  const closeRef = useRef(null)

  useEffect(() => {
    const load = () => listHistory().then(setItems)
    load()
    window.addEventListener('vp-history', load)
    return () => window.removeEventListener('vp-history', load)
  }, [])
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(it => (kind === 'all' || it.kind === kind || (kind === 'analyze' && ['adapt', 'batch'].includes(it.kind)))
      && (!needle || `${it.title} ${it.platform} ${it.text}`.toLowerCase().includes(needle)))
  }, [items, q, kind])

  function openItem(it) {
    set({ restore: { ...it, at: Date.now() }, activeTab: KIND[it.kind]?.tab || 'analyze' })
    onClose()
  }

  return (
    <>
      <div className={`drawer-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`side-drawer right${open ? ' open' : ''}`} inert={open ? undefined : ''} aria-label="Riwayat hasil">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border2)' }}>
          <Icon name="history" />
          <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>Riwayat</h2>
          <button ref={closeRef} onClick={onClose} aria-label="Tutup riwayat" style={{ background: 'none', border: 'none', color: 'var(--text2)', cursor: 'pointer', padding: 6 }}><Icon name="close" /></button>
        </div>
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid var(--border)' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari judul, platform, atau isi prompt" aria-label="Cari riwayat" style={{ ...inputStyle, width: '100%', fontSize: 13 }} />
          <Seg value={kind} onChange={setKind} label="Jenis hasil" options={[
            { value: 'all', label: 'Semua' }, { value: 'analyze', label: 'Analisis' }, { value: 'image', label: 'Gambar' },
            { value: 'variations', label: 'Variasi' }, { value: 'story', label: 'Cerita' },
          ]} />
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
            Disimpan di browser ini saja (maks. 300 hasil terakhir). Video tidak ikut disimpan di riwayat.
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {!items.length && <Empty>Belum ada hasil. Setiap analisis, prompt gambar, variasi, dan cerita yang berhasil dibuat akan muncul di sini.</Empty>}
          {items.length > 0 && !shown.length && <Empty>Tidak ada yang cocok dengan pencarian.</Empty>}
          {shown.map(it => (
            <article key={it.id} style={{ background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 8, padding: 10, display: 'flex', gap: 10 }}>
              {it.thumb && <img src={it.thumb} alt="" style={{ width: 64, height: 40, objectFit: 'cover', borderRadius: 5, flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)' }}>{KIND[it.kind]?.label || it.kind}</span>
                  <span className="num" style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(it.createdAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.title}>{it.title || 'Tanpa judul'}</div>
                {it.platform && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{it.platform}</div>}
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{it.text}</div>
                <div style={{ display: 'flex', gap: 5, marginTop: 7, flexWrap: 'wrap' }}>
                  <Btn small onClick={() => openItem(it)}>Buka</Btn>
                  <Btn small onClick={() => copyText(it.text, showToast)}>Salin</Btn>
                  <Btn small color="var(--danger)" onClick={() => deleteHistory(it.id)} title="Hapus dari riwayat">Hapus</Btn>
                </div>
              </div>
            </article>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderTop: '1px solid var(--border2)' }}>
          <Btn onClick={() => downloadText(JSON.stringify(items.map(({ thumb, ...r }) => r), null, 2), 'riwayat-videoprompt.json', 'application/json')} disabled={!items.length} style={{ flex: 1 }}>Ekspor semua (JSON)</Btn>
          <Btn color="var(--danger)" disabled={!items.length} onClick={() => { if (confirm('Hapus semua riwayat di browser ini?')) clearHistory() }}>Hapus semua</Btn>
        </div>
      </aside>
    </>
  )
}
