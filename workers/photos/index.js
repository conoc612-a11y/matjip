/**
 * matjip 사진 서빙 Worker — R2 를 CDN 캐시와 함께 내보낸다.
 *
 * ⚠️⚠️ 지금 이 Worker 는 **프론트에서 쓰지 않는다.** land.html 의 PHOTO_BASE 는 여전히
 *      r2.dev 를 가리킨다. 실측 결과 개선이 없어서 되돌렸다. 전체 근거는
 *      TROUBLESHOOTING.md §49. **PHOTO_BASE 를 이 주소로 바꾸지 말 것.**
 *
 * ── 왜 만들었고, 왜 안 쓰는가 (2026-08-22 실측) ─────────────────────────
 * 만든 이유(가설): r2.dev 는 "development purposes only" 엔드포인트라 CDN 캐시를 타지 않고
 * 한국에서 LAX 로 우회한다. Worker 는 최근접 PoP(ICN)에서 실행되니 이게 사라질 것이다.
 *
 * **가설의 뒷부분이 틀렸다.** 같은 시점·같은 회선 실측:
 *
 *   cloudflare.com              TTFB 0.16초   CF-RAY …-ICN
 *   developers.cloudflare.com   TTFB 0.31초   CF-RAY …-ICN
 *   discord.com                 TTFB 0.23초   CF-RAY …-ICN
 *   우리 r2.dev                 TTFB 0.73~0.87초   CF-RAY …-LAX
 *   우리 Worker (이 파일)       TTFB 0.55~0.72초   CF-RAY …-**LAX**
 *
 * Worker 도 LAX 다. LA 우회는 r2.dev 의 성질이 아니라 **이 계정/플랜에 묶인 라우팅**이고,
 * Worker 를 얹어도 지리적 거리는 그대로다.
 *
 * 게다가 r2.dev 는 이미 `Cache-Control: public, max-age=31536000, immutable` 을 보내고 있어서
 * 재열람은 원래부터 브라우저 캐시가 처리한다. 아래 Cache API 가 이길 구간이 거의 없다.
 *
 *   첫 요청(MISS)   Worker 0.96~1.37초  vs  r2.dev 0.89~1.28초  ← Worker 가 더 느리다
 *   재요청(HIT)     Worker 0.55~0.61초  vs  r2.dev — (브라우저 캐시)
 *
 * 사용자가 체감하는 경로(사진 첫 로드)에서 더 느리므로 채택하지 않았다.
 *
 * ── 그래도 왜 배포된 상태로 남겨두나 ────────────────────────────────────
 * 무료(10만 요청/일)이고 위험이 없다. 아래 조건이 생기면 PHOTO_BASE 한 줄 + preconnect 한 줄만
 * 바꿔 바로 쓸 수 있다:
 *   ① 유료 플랜으로 ICN 라우팅을 받게 됨   ② 사용자가 여러 명(같은 사진을 여럿이 봄)
 *   ③ 커스텀 도메인 확보
 * 바꾸기 전에 **반드시 위 표와 같은 방식으로 재측정**할 것. 문서가 맞아도 우리 계정에서
 * 그렇게 동작하는지는 별개다(§49-7).
 *
 * 주소: https://matjip-photos.matjip-kr.workers.dev
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
