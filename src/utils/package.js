// Paket produksi sekali unduh: prompt, storyboard, frame referensi, subtitle.
import { makeZip, base64ToBytes } from './zip'
import { extractVideoFrames, fmtTime } from './media'
import { analysisToText, scenePrompt, sceneReview, sceneNo, toSRT, toVTT, toPlainTranscript, SOURCES } from './analysis'
import { videoTargetName } from '../config/platforms'

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const pad = n => String(n).padStart(2, '0')

export async function buildProductionPackage({ data, videoFile, videoMeta, transcript, promptMode, customTarget, lang, insight, story, onProgress }) {
  const files = []
  const target = videoTargetName(promptMode, customTarget)
  const title = videoMeta?.name?.replace(/\.[^.]+$/, '') || 'video'

  onProgress?.('Menyusun teks prompt')
  files.push({ name: 'prompt-lengkap.txt', data: analysisToText(data, { lang }) })
  files.push({
    name: 'prompt-per-adegan.txt',
    data: data.scenes.map((s, i) => `=== ADEGAN ${sceneNo(s, i)} · ${fmtTime(s.start)}–${fmtTime(s.end)} ===\n${scenePrompt(data, s, { promptMode, customTarget })}`).join('\n\n'),
  })
  files.push({ name: 'analisis.json', data: JSON.stringify(data, null, 2) })

  // Frame referensi di tengah tiap adegan
  let frames = []
  if (videoFile) {
    onProgress?.('Mengambil frame referensi')
    try {
      frames = await extractVideoFrames(videoFile, { times: data.scenes.map(s => (s.start + s.end) / 2), maxSide: 1280, quality: 0.88 })
      frames.forEach((f, i) => files.push({ name: `frame/adegan-${pad(sceneNo(data.scenes[i], i))}.jpg`, data: base64ToBytes(f.data) }))
    } catch { frames = [] }
  }

  if (transcript?.length) {
    files.push({ name: 'subtitle.srt', data: toSRT(transcript) })
    files.push({ name: 'subtitle.vtt', data: toVTT(transcript) })
    files.push({ name: 'transkrip.txt', data: toPlainTranscript(transcript) })
  }
  if (insight) files.push({ name: 'insight.json', data: JSON.stringify(insight, null, 2) })
  if (story) files.push({ name: 'cerita-baru.txt', data: story })

  // Daftar shot (CSV) untuk editor
  const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`
  const shotRows = [['Adegan', 'Mulai', 'Selesai', 'Durasi (s)', 'Ringkasan', 'Kamera', 'Dialog', 'Perlu diperiksa']]
  data.scenes.forEach((s, i) => shotRows.push([
    sceneNo(s, i), fmtTime(s.start), fmtTime(s.end), (s.end - s.start).toFixed(1),
    s.summary.text, s.camera.text, s.dialogue.text, sceneReview(s).map(r => r.label).join('; '),
  ]))
  files.push({ name: 'daftar-shot.csv', data: '﻿' + shotRows.map(r => r.map(csvCell).join(',')).join('\r\n') })

  onProgress?.('Membuat storyboard')
  files.push({ name: 'storyboard.html', data: storyboardHtml({ data, title, target, hasFrames: frames.length === data.scenes.length, promptMode, customTarget }) })

  files.push({
    name: 'BACA-SAYA.txt',
    data: `Paket produksi: ${title}
Target: ${target}
Dibuat: ${new Date().toLocaleString('id-ID')}

storyboard.html      buka di browser, lalu Ctrl+P untuk simpan sebagai PDF
prompt-per-adegan.txt  prompt siap salin untuk tiap adegan
prompt-lengkap.txt   seluruh analisis dalam satu teks
daftar-shot.csv      daftar shot untuk editor (bisa dibuka di Excel/Sheets)
frame/               gambar referensi dari tengah tiap adegan
subtitle.srt/.vtt    subtitle dari transkrip yang sudah dikoreksi (bila ada)

Label sumber: ${Object.values(SOURCES).map(s => `${s.id} = ${s.hint}`).join(' · ')}
`,
  })

  return makeZip(files)
}

function storyboardHtml({ data, title, target, hasFrames, promptMode, customTarget }) {
  const rows = data.scenes.map((s, i) => {
    const n = sceneNo(s, i)
    const review = sceneReview(s)
    return `<section class="scene">
  ${hasFrames ? `<img src="frame/adegan-${pad(n)}.jpg" alt="Adegan ${n}">` : '<div class="noimg">Tanpa frame</div>'}
  <div class="body">
    <h2>Adegan ${n} <span>${fmtTime(s.start)}–${fmtTime(s.end)} · ${(s.end - s.start).toFixed(1)} detik</span></h2>
    <p>${esc(s.summary.text)}</p>
    ${s.camera.text ? `<p><b>Kamera</b> ${esc(s.camera.text)}</p>` : ''}
    ${s.dialogue.text ? `<p><b>Dialog</b> “${esc(s.dialogue.text)}”</p>` : ''}
    <pre>${esc(scenePrompt(data, s, { promptMode, customTarget }))}</pre>
    ${review.length ? `<p class="review"><b>Perlu diperiksa</b> ${review.map(r => `${esc(r.label)} (${SOURCES[r.source].id.toLowerCase()})`).join(', ')}</p>` : ''}
  </div>
</section>`
  }).join('\n')
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Storyboard · ${esc(title)}</title>
<style>
body{font:14px/1.55 system-ui,sans-serif;color:#1c1a17;background:#f2f0eb;margin:0;padding:24px}
h1{font-size:22px;margin:0 0 4px} .meta{color:#5d584f;margin:0 0 20px}
.scene{display:grid;grid-template-columns:280px 1fr;gap:16px;background:#fff;border:1px solid #e2ddd3;border-radius:8px;padding:14px;margin-bottom:14px;break-inside:avoid}
.scene img,.noimg{width:100%;border-radius:6px;background:#ddd;aspect-ratio:16/9;object-fit:cover}
.noimg{display:flex;align-items:center;justify-content:center;color:#5d584f}
h2{font-size:16px;margin:0 0 6px} h2 span{font-weight:400;color:#5d584f;font-size:13px;font-variant-numeric:tabular-nums}
p{margin:0 0 6px} pre{white-space:pre-wrap;font:12px/1.5 ui-monospace,monospace;background:#f7f5f0;border-radius:6px;padding:8px;margin:8px 0 6px}
.review{color:#85570a;font-size:13px}
@media (max-width:640px){.scene{grid-template-columns:1fr}}
@media print{body{background:#fff;padding:0}.scene{border-color:#ccc}}
</style></head><body>
<h1>Storyboard · ${esc(title)}</h1>
<p class="meta">Target ${esc(target)} · ${data.scenes.length} adegan</p>
${rows}
</body></html>`
}
