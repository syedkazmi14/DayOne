import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

const VOICE_PROXY_PORT = process.env.VOICE_PROXY_PORT ?? '8787'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    /* The voice proxy holds ELEVENLABS_API_KEY, so the browser talks to it
     * same-origin through here and the key never enters the bundle. If the
     * proxy is not running, /api/voice/health simply fails and the app falls
     * back to the browser speech engine. */
    proxy: {
      '/api/voice': {
        target: `http://localhost:${VOICE_PROXY_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
