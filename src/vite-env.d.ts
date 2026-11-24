/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AGENT_API_URL?: string
}

interface Window {
  /** Present in the desktop WebView; no native commands are invoked by the app. */
  __TAURI_INTERNALS__?: Record<string, unknown>
}
