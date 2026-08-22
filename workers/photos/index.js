/**
 * matjip 사진 서빙 Worker — R2 를 CDN 캐시와 함께 내보낸다.
 *
 * ── 왜 필요한가 (2026-08-22 실측) ───────────────────────────────────────
 * 지금 프론트는 R2 의 **개발용 주소**(`pub-….r2.dev`)를 직접 쓴다. Cloudflare 문서가
 * "development purposes only"라고 명시한 엔드포인트로, **CDN 캐시를 타지 않는다.**
 * 한국에서 실측한 결과:
 *
 *   우리 r2.dev 사진        CF-RAY …-LAX   TTFB 0.74~0.80초   cf-cache-status 없음
 *   cloudflare.com          CF-RAY …-ICN   TTFB 0.23초
 *   developers.cloudflare   CF-RAY …-ICN   TTFB 0.17초
 *   discord.com             CF-RAY …-ICN   TTFB 0.27초
 *   (같은 사이트 정적파일, GitHub Pages/Fastly ICN)  TTFB 0.19~0.35초
 *
 * 즉 **Cloudflare 망은 한국에서 이미 빠르고, r2.dev 만 LA 로 간다.** 버킷은 Asia-Pacific 인데도.
 * Worker 는 **사용자 최근접 PoP(한국이면 ICN)에서 실행**되고 R2 를 바인딩으로 직접 읽으므로
 * 이 우회로가 사라진다. 게다가 Cache API 로 PoP 에 캐시해 재요청은 오리진까지 가지 않는다.
 *
 * 커스텀 도메인이 필요 없다 — `*.workers.dev` 무료 주소로 동작한다(도메인 미보유 상태 대응).
 *
 * ── 캐시 정책 ───────────────────────────────────────────────────────────
 * 사진 파일명은 사건번호+구분+번호로 사실상 불변이라 1년 immutable 로 준다.
 * 업로드 시에도 같은 헤더를 넣어 뒀다(tools/upload_r2.mjs).
 *
 * ── 보안·안전장치 ───────────────────────────────────────────────────────
 *  - GET/HEAD 만 허용. 쓰기 경로를 아예 두지 않는다(버킷 변조 방지).
 *  - `auction_photos/` 접두사만 허용 — 버킷의 다른 객체(있다면)를 노출하지 않는다.
 *  - 경로 순회(`..`) 차단.
 *  - 없는 객체는 404 로 짧게 끝낸다(캐시 오염 방지).
 */

const ALLOW_PREFIX = 'auction_photos/';
const IMMUTABLE = 'public, max-age=31536000, immutable';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }

    const url = new URL(request.url);
    // 앞의 '/' 를 떼고 퍼센트 인코딩을 되돌린다(한글 폴더명이 있으므로 필수).
    let key;
    try { key = decodeURIComponent(url.pathname.slice(1)); }
    catch (e) { return new Response('Bad Request', { status: 400 }); }

    if (!key || key.includes('..') || !key.startsWith(ALLOW_PREFIX)) {
      return new Response('Not Found', { status: 404 });
    }

    // ── PoP 캐시 ──
    // Cache API 키는 요청 URL 이다. 쿼리스트링이 붙으면 캐시가 갈라지므로 경로만으로 만든다.
    const cache = caches.default;
    const cacheKey = new Request(url.origin + url.pathname, { method: 'GET' });
    const hit = await cache.match(cacheKey);
    if (hit) {
      const h = new Headers(hit.headers);
      h.set('X-Matjip-Cache', 'HIT');
      return new Response(request.method === 'HEAD' ? null : hit.body, { status: hit.status, headers: h });
    }

    const obj = await env.PHOTOS.get(key);
    if (!obj) return new Response('Not Found', { status: 404, headers: { 'Cache-Control': 'public, max-age=60' } });

    const headers = new Headers();
    obj.writeHttpMetadata(headers);              // content-type 등 업로드 시 메타데이터 반영
    headers.set('etag', obj.httpEtag);
    headers.set('Cache-Control', IMMUTABLE);
    headers.set('X-Matjip-Cache', 'MISS');
    // 프론트가 github.io 라 출처가 다르다 → CORS 허용이 필요하다(img 태그만 쓰면 불필요하지만
    // 라이트박스에서 fetch 로 다룰 여지가 있어 열어 둔다. 공개 이미지라 위험이 없다).
    headers.set('Access-Control-Allow-Origin', '*');

    const body = await obj.arrayBuffer();
    // 캐시에는 항상 200 GET 응답을 넣는다(HEAD 응답을 캐시하면 이후 GET 이 빈 본문을 받는다).
    ctx.waitUntil(cache.put(cacheKey, new Response(body, { status: 200, headers })));
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  },
};
