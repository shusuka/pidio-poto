import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'

// Saat `npm run dev`, layani /api/fetch-video dengan handler yang sama seperti di Vercel
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/fetch-video', async (req, res) => {
        try {
          const { GET } = await server.ssrLoadModule('/api/fetch-video.js')
          const out = await GET(new Request(new URL(req.originalUrl, 'http://localhost')))
          res.statusCode = out.status
          out.headers.forEach((v, k) => res.setHeader(k, v))
          if (out.body) Readable.fromWeb(out.body).pipe(res)
          else res.end()
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: e.message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApi()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  }
})
