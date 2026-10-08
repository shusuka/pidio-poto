// Ambil video dari link medsos lalu alirkan (stream) ke browser.
// Hanya platform yang dikenal yang dilayani, dan file video hanya diambil dari host CDN yang diizinkan,
// jadi endpoint ini tidak bisa dipakai sebagai proxy umum.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const MAX_BYTES = 500 * 1048576

const MEDIA_HOSTS = [
  'tikwm.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com', 'tiktok.com', 'byteoversea.com', 'ibytedtos.com', 'douyinvod.com',
  'twimg.com',
  'cdninstagram.com', 'fbcdn.net',
]

class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

const hostIs = (host, list) => list.some(d => host === d || host.endsWith('.' + d))

export function detectPlatform(raw) {
  let u
  try { u = new URL(raw) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  const h = u.hostname.toLowerCase()
  if (hostIs(h, ['tiktok.com', 'douyin.com'])) return 'tiktok'
  if (hostIs(h, ['x.com', 'twitter.com', 'fxtwitter.com', 'vxtwitter.com', 'fixupx.com'])) return 'x'
  if (hostIs(h, ['instagram.com'])) return 'instagram'
  if (hostIs(h, ['facebook.com', 'fb.watch', 'fb.com'])) return 'facebook'
  if (hostIs(h, ['youtube.com', 'youtu.be'])) return 'youtube'
  return null
}

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { 'user-agent': UA, ...init.headers } })
  const text = await res.text()
  try { return { status: res.status, json: JSON.parse(text) } } catch { return { status: res.status, json: null } }
}

const decodeEntities = s => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const unescapeJson =s => { try { return JSON.parse(`"${s}"`) } catch { return s.replace(/\\\//g, '/') } }

// ── TikTok / Douyin lewat tikwm ──
async function resolveTikTok(url) {
  const { json } = await getJson('https://www.tikwm.com/api/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ url, hd: '1' }),
  })
  if (!json || json.code !== 0 || !json.data) throw new UserError(json?.msg ? `TikTok: ${json.msg}` : 'Video TikTok tidak ditemukan. Pastikan link-nya publik.', 404)
  const d = json.data
  if (d.images?.length && !d.play) throw new UserError('Postingan ini berisi foto (slideshow), bukan video.')
  const media = d.hdplay || d.play
  if (!media) throw new UserError('Video TikTok tidak ditemukan.', 404)
  return { media: media.startsWith('/') ? 'https://www.tikwm.com' + media : media, title: d.title, referer: 'https://www.tikwm.com/' }
}

// ── X / Twitter lewat fxtwitter ──
async function resolveX(url) {
  const id = new URL(url).pathname.match(/\/status(?:es)?\/(\d+)/)?.[1]
  if (!id) throw new UserError('Link X harus link postingan (…/status/123…).')
  const { json } = await getJson(`https://api.fxtwitter.com/status/${id}`)
  const tweet = json?.tweet
  if (!tweet) throw new UserError(json?.message || 'Postingan X tidak ditemukan atau bersifat privat.', 404)
  const video = (tweet.media?.videos || tweet.media?.all?.filter(m => m.type === 'video' || m.type === 'gif') || [])[0]
  if (!video) throw new UserError('Postingan X ini tidak berisi video.')
  const best = (video.formats || [])
    .filter(f => f.container === 'mp4' || /\.mp4/.test(f.url))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0]
  return { media: best?.url || video.url, title: tweet.text, referer: 'https://x.com/' }
}

// ── Instagram (beta): halaman embed, lalu GraphQL publik ──
async function resolveInstagram(url) {
  const code = new URL(url).pathname.match(/\/(?:p|reels?|tv)\/([\w-]+)/)?.[1]
  if (!code) throw new UserError('Link Instagram harus link postingan atau reel (…/reel/ABC…).')

  const embed = await fetch(`https://www.instagram.com/p/${code}/embed/captioned/`, { headers: { 'user-agent': UA } })
  const html = await embed.text()
  const fromEmbed = html.match(/\\?"video_url\\?":\\?"(.+?)\\?"/)?.[1]
  if (fromEmbed) {
    const media = unescapeJson(fromEmbed.replace(/\\\\/g, '\\'))
    return { media, title: `Instagram ${code}`, referer: 'https://www.instagram.com/' }
  }

  const page = await fetch(`https://www.instagram.com/reel/${code}/`, { headers: { 'user-agent': UA, 'sec-fetch-mode': 'navigate' } })
  const pageHtml = await page.text()
  const lsd = pageHtml.match(/"LSD",\[\],\{"token":"([^"]+)/)?.[1] || ''
  const csrf = (page.headers.get('set-cookie') || '').match(/csrftoken=([^;]+)/)?.[1] || ''
  const { json } = await getJson('https://www.instagram.com/graphql/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded', 'x-ig-app-id': '936619743392459', 'x-fb-lsd': lsd,
      'x-csrftoken': csrf, 'x-asbd-id': '129477', 'x-fb-friendly-name': 'PolarisPostActionLoadPostQueryQuery',
      origin: 'https://www.instagram.com', referer: `https://www.instagram.com/reel/${code}/`, cookie: csrf ? `csrftoken=${csrf}` : '',
    },
    body: new URLSearchParams({
      av: '0', __d: 'www', __user: '0', __a: '1', lsd, fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: 'PolarisPostActionLoadPostQueryQuery', server_timestamps: 'true', doc_id: '8845758582119845',
      variables: JSON.stringify({ shortcode: code, fetch_tagged_user_count: null, hoisted_comment_id: null, hoisted_reply_id: null }),
    }),
  })
  const m = json?.data?.xdt_shortcode_media
  if (m?.video_url) return { media: m.video_url, title: m.edge_media_to_caption?.edges?.[0]?.node?.text || `Instagram ${code}`, referer: 'https://www.instagram.com/' }
  if (m && !m.is_video) throw new UserError('Postingan Instagram ini bukan video.')
  throw new UserError('Instagram menolak permintaan (biasanya karena akun privat atau dibatasi). Coba lagi nanti, atau unduh manual lalu unggah.', 502)
}

// ── Facebook (beta): baca URL video dari HTML halaman publik ──
async function resolveFacebook(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9', 'sec-fetch-mode': 'navigate', accept: 'text/html' } })
  const html = await res.text()
  const pick = re => html.match(re)?.[1]
  const raw = pick(/"browser_native_hd_url":"([^"]+)"/) || pick(/"playable_url_quality_hd":"([^"]+)"/)
    || pick(/"browser_native_sd_url":"([^"]+)"/) || pick(/"playable_url":"([^"]+)"/) || pick(/hd_src:"([^"]+)"/) || pick(/sd_src:"([^"]+)"/)
  if (!raw) throw new UserError('Video Facebook tidak ditemukan. Pastikan postingannya publik.', 404)
  const title = decodeEntities(pick(/<meta property="og:title" content="([^"]*)"/) || 'Facebook video')
  return { media: unescapeJson(raw), title, referer: 'https://www.facebook.com/' }
}

const RESOLVERS = { tiktok: resolveTikTok, x: resolveX, instagram: resolveInstagram, facebook: resolveFacebook }

// Ikuti redirect secara manual supaya setiap lompatan tetap di host yang diizinkan
async function fetchMedia(mediaUrl, referer) {
  let current = mediaUrl
  for (let hop = 0; hop < 5; hop++) {
    const u = new URL(current)
    if (u.protocol !== 'https:' || !hostIs(u.hostname.toLowerCase(), MEDIA_HOSTS)) throw new UserError('Sumber video tidak dikenal.', 502)
    const res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': UA, referer, accept: '*/*' } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href
      continue
    }
    if (!res.ok) throw new UserError(`Gagal mengunduh video (HTTP ${res.status}).`, 502)
    return res
  }
  throw new UserError('Terlalu banyak redirect.', 502)
}

const errorResponse = (message, status) =>
  new Response(JSON.stringify({ error: message }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

export async function GET(request) {
  const link = new URL(request.url).searchParams.get('url')?.trim()
  if (!link) return errorResponse('Parameter url wajib diisi.', 400)
  const platform = detectPlatform(link)
  if (platform === 'youtube') return errorResponse('YouTube belum didukung lewat link. Unduh videonya dulu lalu unggah.', 400)
  if (!platform) return errorResponse('Link belum didukung. Yang bisa: TikTok, Instagram, Facebook, X/Twitter.', 400)

  try {
    const { media, title, referer } = await RESOLVERS[platform](link)
    const upstream = await fetchMedia(media, referer)
    const type = upstream.headers.get('content-type') || 'video/mp4'
    if (/text\/html|application\/json/.test(type)) throw new UserError('Sumber tidak mengembalikan file video.', 502)
    const length = Number(upstream.headers.get('content-length')) || 0
    if (length > MAX_BYTES) throw new UserError('Video terlalu besar (maks 500 MB).', 413)

    const headers = {
      'content-type': type.startsWith('video/') ? type : 'video/mp4',
      'cache-control': 'no-store',
      'x-video-platform': platform,
      'x-video-title': encodeURIComponent((title || '').replace(/\s+/g, ' ').trim().slice(0, 120)),
    }
    if (length) headers['content-length'] = String(length)
    return new Response(upstream.body, { status: 200, headers })
  } catch (e) {
    if (e instanceof UserError) return errorResponse(e.message, e.status)
    return errorResponse('Gagal mengambil video dari link. Coba lagi sebentar lagi.', 502)
  }
}
