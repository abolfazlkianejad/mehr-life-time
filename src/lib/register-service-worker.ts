export function registerServiceWorker(): void {
  // Tauri (WebView2) serves assets from its own protocol and caches them
  // natively; a service worker would only add failure modes.
  if ('__TAURI_INTERNALS__' in window) return
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      // The app remains usable online; browser policy may disable service workers.
    })
  })
}
