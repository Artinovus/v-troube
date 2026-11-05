// Z trouby – service worker
// Záměrně NEUKLÁDÁ data ani stránky do mezipaměti: aplikace pracuje vždy s živou
// databází, aby nikdy netvrdila, že jsou offline změny uložené. Bez připojení
// zobrazí jen informační stránku.
const OFFLINE_HTML = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Z trouby – offline</title><style>body{font-family:system-ui,sans-serif;background:#fbf7f0;color:#3b2a1e;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}button{background:#8a5a36;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:16px}</style></head><body><main><h1>Jste offline</h1><p>Z trouby potřebuje připojení k internetu, aby mohla načíst a bezpečně uložit vaše data.</p><button onclick="location.reload()">Zkusit znovu</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(() => new Response(OFFLINE_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
  );
});
