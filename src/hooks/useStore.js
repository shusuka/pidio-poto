import { useState, useCallback, useRef } from 'react'

const PROVIDER_KEY = 'videoprompt_provider'
const KEY_SLOT = { gemini: 'videoprompt_gemini_key', claude: 'videoprompt_claude_key' }
const MODEL_KEY = 'videoprompt_model_'
const DEFAULT_MODEL = { gemini: 'gemini-3.8-flash', claude: 'claude-opus-5' }
// Model lama yang sudah dimatikan/diganti → arahkan ke pengganti
const RETIRED = {
  'gemini-3-flash-preview': 'gemini-3.8-flash',
  'gemini-2.5-flash-preview-05-20': 'gemini-2.5-flash',
  'claude-opus-4-8': 'claude-opus-5',
  'claude-sonnet-4-6': 'claude-sonnet-5',
}
function loadModel(provider) {
  const m = localStorage.getItem(MODEL_KEY + provider)
  return RETIRED[m] || m || DEFAULT_MODEL[provider]
}

// Ambil key tersimpan untuk provider; fallback ke key lama (videoprompt_apikey) untuk Gemini.
function loadKey(provider) {
  return localStorage.getItem(KEY_SLOT[provider])
    || (provider === 'gemini' ? localStorage.getItem('videoprompt_apikey') : '')
    || ''
}

const savedProvider = localStorage.getItem(PROVIDER_KEY) || 'gemini'

const initialState = {
  provider: savedProvider,
  apiKey: loadKey(savedProvider),
  model: loadModel(savedProvider),
  temperature: 0.7,
  maxTokens: 32768,
  toggleCinematic: true,
  toggleMotion: true,
  toggleAiParams: true,
  lang: 'en',
  promptMode: 'douyin',
  focusArea: 'all',
  generateMode: 'precise',
  videoFile: null,
  videoUrl: null,
  videoMeta: null,
  analysisText: null,
  analysisData: null,      // hasil analisis terstruktur (bisa diedit)
  markSources: false,      // tandai [perkiraan]/[saran AI] di teks salinan
  scenes: [],              // [{id,start,end,thumb,cut}]
  selectedScenes: [],      // id adegan yang dipilih; kosong = semua
  scenesStatus: null,
  sceneSensitivity: 'medium',
  transcript: [],          // [{id,start,end,speaker,text}]
  transcriptLang: '',
  subtitleOnVideo: true,
  editor: null,            // proyek tab Editor (lihat EditorTab EMPTY_EDITOR)
  isAnalyzing: false,
  totalTokens: 0,
  activeTab: 'analyze',
  toast: null,
}

export function useStore() {
  const [state, setState] = useState(() => ({ ...initialState }))

  const set = useCallback((updates) => {
    setState(prev => {
      const patch = typeof updates === 'function' ? updates(prev) : updates
      const next = { ...prev, ...patch }

      // Ganti provider → muat key provider tsb + reset model ke default provider
      if (patch.provider && patch.provider !== prev.provider) {
        localStorage.setItem(PROVIDER_KEY, patch.provider)
        next.apiKey = loadKey(patch.provider)
        next.model = loadModel(patch.provider)
      }
      if (patch.model && !patch.provider) localStorage.setItem(MODEL_KEY + next.provider, patch.model)

      // Simpan key ke slot provider aktif hanya saat user mengubah apiKey
      if ('apiKey' in patch) {
        const slot = KEY_SLOT[next.provider]
        if (next.apiKey) localStorage.setItem(slot, next.apiKey)
        else localStorage.removeItem(slot)
      }
      return next
    })
  }, [])

  const toastTimer = useRef(null)
  const showToast = useCallback((msg, isError = false) => {
    set({ toast: { msg, isError } })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => set({ toast: null }), isError ? 5000 : 2800)
  }, [set])

  return { state, set, showToast }
}
