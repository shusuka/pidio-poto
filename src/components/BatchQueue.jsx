import React, { useRef, useState } from 'react'
import { GlassCard, Btn, Spin, CC, downloadText, tint } from './ui'

const STATUS = {
  wait:  { label: 'Menunggu', color: 'var(--text3)' },
  run:   { label: 'Diproses', color: 'var(--c-amber)' },
  done:  { label: 'Selesai',  color: 'var(--c-green)' },
  error: { label: 'Gagal',    color: 'var(--danger)' },
}

// Antrean banyak video dengan pengaturan yang sama. Hasil bisa ditinjau satu per satu.
export default function BatchQueue({ runOne, onReview, disabled, platformName, showToast }) {
  const [items, setItems] = useState([])
  const [running, setRunning] = useState(false)
  const stopRef = useRef(false)
  const fileRef = useRef(null)

  const patch = (id, p) => setItems(list => list.map(it => it.id === id ? { ...it, ...p } : it))

  function addFiles(files) {
    const vids = [...files].filter(f => f.type.startsWith('video/'))
    if (!vids.length) return showToast('Pilih file video', true)
    setItems(list => [...list, ...vids.map(f => ({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 6)}`, file: f, status: 'wait' }))])
  }

  async function run(onlyFailed = false) {
    stopRef.current = false
    setRunning(true)
    for (const it of items) {
      if (stopRef.current) break
      if (it.status === 'done' || (onlyFailed && it.status !== 'error')) continue
      patch(it.id, { status: 'run', error: null })
      try {
        const res = await runOne(it.file)
        patch(it.id, { status: 'done', ...res })
      } catch (e) {
        patch(it.id, { status: 'error', error: e.message })
      }
    }
    setRunning(false)
  }

  const done = items.filter(i => i.status === 'done')
  const failed = items.filter(i => i.status === 'error')

  function exportJson() {
    downloadText(JSON.stringify(done.map(i => ({ file: i.file.name, platform: platformName, prompt: i.text, analysis: i.data })), null, 2), 'antrean-analisis.json', 'application/json')
  }
  function exportCsv() {
    const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['File', 'Durasi', 'Adegan', 'Platform', 'Prompt']]
    done.forEach(i => rows.push([i.file.name, i.meta?.durationFormatted, i.data?.scenes?.length, platformName, i.text]))
    downloadText('﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n'), 'antrean-analisis.csv', 'text/csv')
  }

  return (
    <GlassCard color={CC[2]} label="Antrean banyak video" right={items.length ? <span className="num" style={{ fontSize: 11, color: 'var(--text3)' }}>{done.length}/{items.length} selesai</span> : null}>
      <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, marginBottom: 8 }}>
        Semua video memakai platform, bahasa, dan pengaturan yang sedang aktif. Diproses satu per satu; hasil masuk ke Riwayat.
      </div>
      <input ref={fileRef} type="file" accept="video/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        <Btn small onClick={() => fileRef.current?.click()} disabled={running}>Tambah video</Btn>
        {!running && <Btn small onClick={() => run(false)} disabled={disabled || !items.some(i => i.status === 'wait' || i.status === 'error')} active color="var(--accent)">Jalankan antrean</Btn>}
        {running && <Btn small onClick={() => { stopRef.current = true }}>Berhenti setelah video ini</Btn>}
        {!running && failed.length > 0 && <Btn small onClick={() => run(true)}>Ulangi yang gagal ({failed.length})</Btn>}
        {!running && items.length > 0 && <Btn small onClick={() => setItems([])}>Kosongkan</Btn>}
      </div>
      {items.length > 0 && (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 240, overflowY: 'auto' }}>
          {items.map(it => (
            <li key={it.id} style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '5px 7px', background: tint('var(--paper)', 70), border: '1px solid var(--border)', borderRadius: 6 }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.error || it.file.name}>{it.file.name}</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: STATUS[it.status].color, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                {it.status === 'run' && <Spin />}{STATUS[it.status].label}
              </span>
              {it.status === 'done' && <Btn small onClick={() => onReview(it)}>Tinjau</Btn>}
              {!running && it.status !== 'run' && <Btn small onClick={() => setItems(l => l.filter(x => x.id !== it.id))} aria-label={`Hapus ${it.file.name} dari antrean`} title="Hapus dari antrean">✕</Btn>}
              {it.error && <div style={{ width: '100%', fontSize: 11, color: 'var(--danger)' }}>{it.error}</div>}
            </li>
          ))}
        </ul>
      )}
      {done.length > 0 && (
        <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
          <Btn small onClick={exportCsv}>Unduh CSV</Btn>
          <Btn small onClick={exportJson}>Unduh JSON</Btn>
        </div>
      )}
    </GlassCard>
  )
}
