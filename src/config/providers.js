// Provider AI yang bisa dipilih di header. Model Gemini dipakai oleh Gemini API
// (key AI Studio) dan Vertex AI (key Google Cloud, tagihan/kredit project GCP).
const GEMINI_MODELS = [
  { id: 'gemini-3.8-flash',       label: '3.8 Flash' },
  { id: 'gemini-3.1-pro-preview', label: '3.1 Pro' },
  { id: 'gemini-2.5-flash',       label: '2.5 Flash' },
]

export const PROVIDERS = {
  gemini: {
    label: 'Gemini', company: 'Google', host: 'generativelanguage.googleapis.com',
    keySite: 'Google AI Studio', keyUrl: 'https://aistudio.google.com/apikey',
    hearsAudio: true, models: GEMINI_MODELS,
  },
  vertex: {
    label: 'Vertex AI', company: 'Google Cloud', host: 'aiplatform.googleapis.com',
    keySite: 'Google Cloud Console', keyUrl: 'https://console.cloud.google.com/apis/credentials',
    hearsAudio: true, models: GEMINI_MODELS,
  },
  claude: {
    label: 'Claude', company: 'Anthropic', host: 'api.anthropic.com',
    keySite: 'Anthropic Console', keyUrl: 'https://console.anthropic.com/settings/keys',
    hearsAudio: false,
    models: [
      { id: 'claude-opus-5',   label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
    ],
  },
}

export const PROVIDER_IDS = Object.keys(PROVIDERS)
export const providerName = id => PROVIDERS[id]?.label || id
