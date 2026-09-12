/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANTHROPIC_API_KEY?: string
  readonly VITE_LLM_PROXY_URL?: string
  readonly VITE_LLM_MODEL?: string
  readonly VITE_ELEVENLABS_API_KEY?: string
  readonly VITE_ELEVENLABS_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
