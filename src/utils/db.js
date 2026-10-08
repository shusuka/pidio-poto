// ─── Penyimpanan lokal di browser (IndexedDB) ──────────────────────────────
// "history": hasil yang pernah dibuat (prompt, variasi, image prompt, dll.)
// "session": satu sesi kerja terakhir untuk dipulihkan setelah tab tertutup.
// API key TIDAK pernah ikut disimpan di sini.
const DB_NAME = 'videoprompt'
const VERSION = 1
let dbPromise = null

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB tidak tersedia'))
      const req = indexedDB.open(DB_NAME, VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains('history')) db.createObjectStore('history', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('session')) db.createObjectStore('session')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const out = fn(t.objectStore(store))
    t.oncomplete = () => resolve(out?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

// ── Riwayat ──
const HISTORY_MAX = 300

export async function addHistory(entry) {
  const item = { id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now(), ...entry }
  try {
    await tx('history', 'readwrite', s => s.put(item))
    const all = await listHistory()
    if (all.length > HISTORY_MAX) {
      const drop = all.slice(HISTORY_MAX)
      await tx('history', 'readwrite', s => drop.forEach(d => s.delete(d.id)))
    }
    window.dispatchEvent(new Event('vp-history'))
  } catch { /* penyimpanan penuh/diblokir: aplikasi tetap jalan */ }
  return item
}

export async function listHistory() {
  try {
    const all = await tx('history', 'readonly', s => s.getAll())
    return (all || []).sort((a, b) => b.createdAt - a.createdAt)
  } catch { return [] }
}

export async function deleteHistory(id) {
  await tx('history', 'readwrite', s => s.delete(id))
  window.dispatchEvent(new Event('vp-history'))
}

export async function clearHistory() {
  await tx('history', 'readwrite', s => s.clear())
  window.dispatchEvent(new Event('vp-history'))
}

// ── Sesi terakhir ──
export async function saveSession(data) {
  try { await tx('session', 'readwrite', s => s.put(data, 'last')) } catch { /* abaikan */ }
}
export async function loadSession() {
  try { return await tx('session', 'readonly', s => s.get('last')) } catch { return null }
}
export async function clearSession() {
  try { await tx('session', 'readwrite', s => s.delete('last')) } catch { /* abaikan */ }
}
