import { useState, useCallback, useEffect } from 'react'

const PROVIDER_KEY = 'videoprompt_provider'
const KEY_SLOT = { gemini: 'videoprompt_gemini_key', claude: 'videoprompt_claude_key' }
const DEFAULT_MODEL = { gemini: 'gemini-3-flash-preview', claude: 'claude-opus-4-8' }

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
  model: DEFAULT_MODEL[savedProvider],
  temperature: 0.7,
  maxTokens: 8192,
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
        next.model = DEFAULT_MODEL[patch.provider]
      }

      // Simpan key ke slot provider aktif hanya saat user mengubah apiKey
      if ('apiKey' in patch) {
        const slot = KEY_SLOT[next.provider]
        if (next.apiKey) localStorage.setItem(slot, next.apiKey)
        else localStorage.removeItem(slot)
      }
      return next
    })
  }, [])

  const showToast = useCallback((msg, isError = false) => {
    set({ toast: { msg, isError } })
    setTimeout(() => set({ toast: null }), 2800)
  }, [set])

  return { state, set, showToast }
}
