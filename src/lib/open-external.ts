/**
 * Opens an external http(s) link through the allowed path.
 *
 * In the Tauri desktop app the Rust navigation guard intercepts this
 * navigation and launches the system browser instead of loading the page in
 * the WebView. In a normal browser we open a new tab as usual.
 */
export function openExternal(rawUrl: string): void {
  if (!rawUrl?.trim()) return
  let url: URL
  try {
    url = new URL(rawUrl, window.location.href)
  } catch {
    return
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return

  if ('__TAURI_INTERNALS__' in window) {
    // Cancelled by the navigation guard; the WebView stays on the app.
    window.location.href = url.toString()
    return
  }

  const anchor = document.createElement('a')
  anchor.href = url.toString()
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}
