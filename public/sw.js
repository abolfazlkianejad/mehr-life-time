const CACHE_NAME = 'mehr-life-shell-v1'
const APP_SHELL = ['/', '/manifest.webmanifest', '/images/pwa-icon.svg']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('mehr-life-shell-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/')))
    return
  }

  // Cache same-origin app assets after a successful response. API and third
  // party requests are never cached or presented as fresh offline results.
  if (['script', 'style', 'image', 'font'].includes(request.destination)) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      }).catch(async () => (await caches.match(request)) || Response.error())
    )
  }
})
