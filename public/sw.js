const CACHE_NAME = 'cooplog-v4'
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.31/jspdf.plugin.autotable.min.js'
]

// Helper to safely open cache with error handling
async function safeOpenCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch (err) {
    console.warn('[SW] Cache open failed, proceeding without cache:', err);
    return null;
  }
}

// Install event: cache initial assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    safeOpenCache().then((cache) => {
      if (cache) {
        // Cache assets individually with fallbacks
        return Promise.allSettled(
          ASSETS_TO_CACHE.map(url => 
            cache.add(url).catch(err => 
              console.warn('[SW] Failed to cache:', url, err)
            )
          )
        );
      }
    }).then(() => {
      self.skipWaiting();
    }).catch(err => {
      console.warn('[SW] Install failed, skipping:', err);
      self.skipWaiting();
    })
  );
})

// Activate event: cleanup old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.allSettled(
        keys.filter((key) => key !== CACHE_NAME).map((key) => 
          caches.delete(key).catch(err => 
            console.warn('[SW] Failed to delete old cache:', key, err)
          )
        )
      );
    }).then(() => {
      self.clients.claim();
    })
  );
})

// Fetch event: Stale-While-Revalidate for assets, Network-First for navigation
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  // Skip Firebase/API/Google checks - let the SDKs handle their own offline logic
  if (
    url.hostname.includes('firebase') || 
    url.hostname.includes('googleapis') || 
    url.hostname.includes('google.com') ||
    url.hostname.includes('gstatic.com') ||
    url.pathname.endsWith('.wasm')
  ) {
    return
  }

  // Navigation requests: Try network first, fallback to index.html
  // NOTE: COOP/COEP headers intentionally omitted on navigation to allow
  // Firebase Auth popup opener communication.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(async () => {
          try {
            const cache = await safeOpenCache();
            if (cache) {
              const cachedRes = await cache.match('./index.html');
              if (cachedRes) return cachedRes;
            }
          } catch (err) {
            console.warn('[SW] Navigation cache fallback failed:', err);
          }
          throw new Error('Network error and no cache available');
        })
    )
    return
  }

  // Static Assets / Chunks: Stale-While-Revalidate
  event.respondWith(
    (async () => {
      let cachedResponse = null;
      try {
        const cache = await safeOpenCache();
        if (cache) {
          cachedResponse = await cache.match(event.request);
        }
      } catch (err) {
        console.warn('[SW] Cache match failed:', err);
      }

      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.status === 200 && event.request.method === 'GET') {
          try {
            const cache = await safeOpenCache();
            if (cache) {
              const cacheCopy = networkResponse.clone();
              await cache.put(event.request, cacheCopy);
            }
          } catch (err) {
            console.warn('[SW] Cache put failed:', err);
          }
        }
        return addSecurityHeaders(networkResponse);
      } catch (err) {
        if (cachedResponse) {
          return addSecurityHeaders(cachedResponse);
        }
        throw err;
      }
    })()
  );
})

/**
 * Injects COOP/COEP headers required for SQLite WASM OPFS persistence
 */
function addSecurityHeaders(response) {
  if (!response) return response
  
  const newHeaders = new Headers(response.headers)
  newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin')
  newHeaders.set('Cross-Origin-Embedder-Policy', 'credentialless')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  })
}
