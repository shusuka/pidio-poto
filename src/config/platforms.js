// Satu daftar platform untuk semua tab (Analyze, Variasi, Editor).
// Diperbarui 2026-10-08: Sora dihapus (OpenAI menutupnya April/September 2026).
// Nama sengaja tanpa nomor versi: versi model generator berganti tiap beberapa
// bulan. Versi spesifik bisa ditulis pengguna di kolom "Model/versi target".
export const VIDEO_PLATFORMS = {
  // ── Populer (Oktober 2026) ──
  dola: {
    name: 'Dola', group: 'Populer',
    note: 'Dola (ByteDance app, Seedance video model): one clear sentence per idea: subject, action, scene, camera, lighting, style. Multi-shot is allowed: describe "Shot 1 / Shot 2" with the cut. Native audio: put spoken lines in quotes with who says them, then ambience and music.',
    negative: '',
    platformParams: 'aspect_ratio:9:16, duration:10s, audio:on',
  },
  seedance: {
    name: 'Seedance', group: 'Populer',
    note: 'Seedance (ByteDance, also in Dreamina/Jimeng): subject, action, scene, camera, lighting, style in clear sentences. Supports multi-shot ("Shot 1 / Shot 2", describe each cut) and reference images. Native audio: dialogue in quotes with speaker, then sound effects and music.',
    negative: '',
    platformParams: 'aspect_ratio:9:16, duration:10s, resolution:1080p, audio:on',
  },
  happyhorse: {
    name: 'HappyHorse', group: 'Populer',
    note: 'HappyHorse (Alibaba): generates video and audio together with lip-sync. Describe subject, action, scene and camera, then dialogue in quotes with speaker and language, then ambience and music. Clips 3-15 s.',
    negative: '',
    platformParams: 'aspect_ratio:9:16, duration:8s, resolution:1080p',
  },
  kling: {
    name: 'Kling', group: 'Populer',
    note: 'Kling: subject, action, scene, camera, lighting, style in clear sentences. Supports multi-shot and native audio (dialogue in quotes with speaker). Negative prompt is supported.',
    negative: 'blurry, distorted faces, bad anatomy, low quality, watermark, text, static, flickering',
    platformParams: 'duration:5s, mode:pro, cfg_scale:0.5',
  },
  gemini_ai: {
    name: 'Google Veo / Flow', group: 'Populer',
    note: 'Google Veo / Gemini video (in Flow and Gemini): detailed scene description with camera, lens and lighting, plus audio cues: dialogue in quotes, sound effects, ambience. Aspect ratio required.',
    negative: 'low quality, blurry, artifacts, watermark, text overlay, unrealistic motion',
    platformParams: 'aspect_ratio:16:9, duration:8s, generate_audio:true',
  },
  wan: {
    name: 'Wan', group: 'Populer',
    note: 'Wan (Alibaba): subject, scene and motion in order; add shot type, lighting and style keywords. Audio and dialogue can be described. Negative prompt supported.',
    negative: 'blurry, low quality, static, distorted, watermark, subtitles, extra limbs',
    platformParams: 'resolution:1080p, duration:5s',
  },
  hailuo: {
    name: 'Hailuo (MiniMax)', group: 'Populer',
    note: 'Hailuo / MiniMax: subject + action + scene, camera moves written in [brackets] like [Push in], [Pan left].',
    negative: '',
    platformParams: 'duration:6s, resolution:1080p',
  },
  grok: {
    name: 'Grok Imagine', group: 'Populer',
    note: 'Grok Imagine: short natural-language description of subject, action, setting, camera and mood; audio cues in plain words. Short clips.',
    negative: '',
    platformParams: 'aspect_ratio:9:16, duration:6s',
  },
  // ── Lainnya ──
  runway: {
    name: 'Runway', group: 'Lainnya',
    note: 'Runway: [camera motion] [subject] [action] [environment] [style]. Describe camera movement first. No negative prompt field.',
    negative: '',
    platformParams: 'camera_motion:push_in, style:cinematic',
  },
  pixverse: {
    name: 'PixVerse', group: 'Lainnya',
    note: 'PixVerse: concise subject + action + scene + style, one main camera move. Negative prompt supported.',
    negative: 'blurry, low quality, watermark, deformed',
    platformParams: 'aspect_ratio:9:16, duration:5s, quality:1080p',
  },
  luma: {
    name: 'Luma', group: 'Lainnya',
    note: 'Luma: short natural sentences, one clear camera move, concrete lighting and mood words.',
    negative: '',
    platformParams: 'aspect_ratio:16:9, loop:false',
  },
  ltx: {
    name: 'LTX (open)', group: 'Lainnya',
    note: 'LTX: one flowing paragraph in chronological order: action first, then movements, appearance, background, camera, lighting. Negative prompt supported.',
    negative: 'worst quality, inconsistent motion, blurry, jittery, distorted',
    platformParams: 'resolution:1080p, fps:25',
  },
  douyin: {
    name: 'Gaya Douyin/TikTok', group: 'Lainnya',
    note: 'Short-form vertical style (Douyin/TikTok): punchy phrasing, strong visual hook in the first 2 seconds, fast trendy pacing.',
    negative: '模糊，低质量，水印，静态，无聊，过曝',
    platformParams: 'ratio:9:16, duration:5-10s, style:viral',
  },
}

// Id lama yang sudah tidak ada → pengganti terdekat
export const RETIRED_PLATFORMS = { sora: 'kling', jimeng: 'seedance', runway_gen3: 'runway' }

export const IMG_PLATFORMS = [
  { id: 'gpt_dalle',     label: 'ChatGPT / GPT Image', note: 'OpenAI image models: plain descriptive sentences covering subject, style, mood, lighting; text in the image goes in quotes.' },
  { id: 'gemini_imagen', label: 'Gemini / Nano Banana', note: 'Google Gemini image: natural sentences, photorealistic detail, aspect ratio, lighting and camera lens; text in the image goes in quotes.' },
  { id: 'seedream',      label: 'Seedream (Dola / Dreamina)', note: 'ByteDance Seedream: subject, scene, style and lighting in clear sentences; supports reference images and readable text in quotes.' },
  { id: 'midjourney',    label: 'Midjourney', note: 'Midjourney: short vivid phrases, then flags like --ar, --style raw, --chaos. No negative sentence, use --no.' },
  { id: 'flux',          label: 'Flux', note: 'Flux: natural language, highly detailed descriptions. Specify exact colors and textures. No negative prompt.' },
  { id: 'stable_xl',     label: 'Stable Diffusion', note: 'Stable Diffusion: subject first, then style tags, weighted keywords allowed. Add a negative prompt.' },
]

// Nama yang dikirim ke AI: kalau pengguna menulis model/versi sendiri, itu yang dipakai.
export function videoTargetName(id, custom) {
  const base = VIDEO_PLATFORMS[id]?.name || id
  return custom?.trim() ? `${base} (${custom.trim()})` : base
}
