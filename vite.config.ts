import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const VOICE_PROXY_PORT = process.env.VOICE_PROXY_PORT ?? '8787'
const MEDIA_SERVER_PORT = process.env.MEDIA_SERVER_PORT ?? '8788'

/**
 * Both backends are optional. Without this hook a missing target surfaces as a
 * 500, which reads like an application fault; the app already treats 503 as
 * "not configured" and falls back to its offline tier.
 */
const optionalBackend = (port: string, message: string): ProxyOptions => ({
  target: `http://localhost:${port}`,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on('error', (_err, _req, res) => {
      const r = res as unknown as { headersSent?: boolean; writeHead?: Function; end?: Function }
      if (!r?.writeHead || r.headersSent) return
      r.writeHead(503, { 'content-type': 'application/json' })
      r.end(JSON.stringify({ error: 'not_configured', message }))
    })
  },
})

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    /* The voice proxy holds ELEVENLABS_API_KEY and the media server holds
     * FAL_KEY, so the browser talks to both same-origin through here and no key
     * ever enters the bundle. */
    proxy: {
      '/api/voice': optionalBackend(VOICE_PROXY_PORT, 'Voice proxy is not running.'),
      '/api/media': optionalBackend(MEDIA_SERVER_PORT, 'Media server is not running.'),
    },
  },
})
