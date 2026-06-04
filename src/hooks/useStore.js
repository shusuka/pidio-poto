import { useState, useCallback, useEffect } from 'react'

const STORAGE_KEY = 'videoprompt_apikey'

const initialState = {
  apiKey: '',
  model: 'gemini-3-flash-preview',
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
  const [state, setState] = useState(() => ({
    ...initialState,
    apiKey: localStorage.getItem(STORAGE_KEY) || '',
  }))

  const set = useCallback((updates) => {
    setState(prev => {
      const next = { ...prev, ...(typeof updates === 'function' ? updates(prev) : updates) }
      // Persist apiKey whenever it changes
      if (next.apiKey !== prev.apiKey) {
        if (next.apiKey) localStorage.setItem(STORAGE_KEY, next.apiKey)
        else localStorage.removeItem(STORAGE_KEY)
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
