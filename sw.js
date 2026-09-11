// matjip 푸시 Service Worker (S2, 2026-09-11) — push 전용.
// 🔴 fetch 를 가로채지 않는다. 캐시·라우팅 동작이 바뀌면 안 되기 때문이다.
//    S3(발송)는 Edge Function + 일일 크론이 맡는다. 여기서는 받기와 열기만.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { /* 텍스트·빈 payload도 온다 */ }
  e.waitUntil(self.registration.showNotification(d.title || 'matjip 경매 알림', {
    body: d.body || '관심 물건에 변동이 있습니다.',
    data: { url: (d && d.url) || '/land.html' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/land.html';
  e.waitUntil(clients.matchAll({ type: 'window' }).then((ws) => {
    for (const w of ws) { if ('focus' in w) return w.focus(); }
    return clients.openWindow(url);
  }));
});
