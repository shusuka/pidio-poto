# VideoPrompt Pro

AI-powered video prompt generator. Choose your provider: **Google Gemini** or **Anthropic Claude**.

## Features

- **Analyze Tab** — Upload video, generate detailed prompts (T2V/I2V/Kling/Runway/Sora), 3 sub-tabs: Prompt / Detail Analysis / New Story
- **Motion Tab** — Manual motion params + auto-detect from video, camera movement, blur, pan, zoom, transitions
- **Realistic AI Tab** — Optimized for Sora, Runway Gen-3, Kling AI, Wan 2.1, Hailuo, Luma — camera params, lighting breakdown

## Setup

1. Clone repo
2. `npm install`
3. `npm run dev`
4. Pick a provider (Gemini / Claude) in the top bar, then enter that provider's API key
   - Gemini key (`AIza...`) — supports video + image analysis
   - Claude key (`sk-ant-...`) — image only (Claude has no video input)

## Deploy to Vercel

```bash
npm run build
# push to GitHub, connect repo in vercel.com/new
```

## Stack

- React 18 + Vite 5
- Google Gemini API (gemini-3-flash / 2.5-flash) + Anthropic Claude API (opus-4-8 / sonnet-4-6)
- CSS Modules
- No backend required — runs entirely in the browser

## Environment

No `.env` needed — API key is entered by the user in the UI.
