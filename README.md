# VideoPrompt Pro

AI-powered video analysis, prompt generator and lightweight video editor. Choose your provider: **Google Gemini** or **Anthropic Claude**.

## Features

- **Analyze Tab**
  - Automatic **scene detection** with thumbnails and timestamps — pick only the scenes you want analyzed (faster and cheaper).
  - **Structured, editable results**: global fields, per-scene summary/camera/dialogue and 2-second slots. Fix any part by hand or re-run a single scene.
  - **Fact vs. guess labels** on every field: *Terlihat* (observed), *Perkiraan* (inferred), *Saran AI* (suggested), *Diedit* (checked by you). Optional markers in the copy-ready text.
  - **Transcript & subtitles** (Gemini): timestamped segments, manual correction, word search, SRT/VTT/TXT export, subtitle preview on the video.
  - Insight & publishing ideas, and new story generation from the analysis.
- **Image Prompt Tab** — image breakdown and prompts for DALL-E, Imagen, Midjourney, Flux, SDXL.
- **Video Variations Tab** — themed prompt variations for Sora, Runway, Kling, Wan, Hailuo, Luma, Veo.
- **Editor Tab**
  - Timeline: split, trim, reorder (drag), duplicate, delete, undo/redo.
  - Automation: clips from selected scenes, **cut pauses** from the transcript, **AI highlight** assembly to 15/30/60 s with a hook title.
  - Text overlays, burned-in subtitles from the transcript, video volume and background music.
  - Output formats: source, 9:16, 16:9, 1:1, 4:5 (fit or crop). Export is rendered in the browser (MP4 when supported, otherwise WebM).

## Setup

1. Clone repo
2. `npm install`
3. `npm run dev`
4. Pick a provider (Gemini / Claude) in the top bar, then enter that provider's API key
   - Gemini key (`AIza...`) — video (with audio), images, transcription
   - Claude key (`sk-ant-...`) — images; videos are analyzed as timestamped frames (no audio, no transcription)

## Deploy to Vercel

```bash
npm run build
# push to GitHub, connect repo in vercel.com/new
```

## Stack

- React 18 + Vite 5
- Google Gemini API (gemini-3.8-flash / 3.1-pro / 2.5-flash) + Anthropic Claude API (opus-5 / sonnet-5)
- Canvas + WebAudio + MediaRecorder for preview and export
- One small Vercel function (`api/fetch-video.js`) for social links; everything else runs in the browser. In `npm run dev` the same handler is served by a Vite middleware.

## Notes

- No `.env` needed — the API key is entered by the user in the UI and stored in the browser.
- Videos larger than 20 MB are uploaded through the Gemini Files API.
- Export records in real time: keep the tab open until it finishes.
