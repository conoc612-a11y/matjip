// 네이버 지역검색(Local Search) 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: 네이버 지역검색 API(openapi.naver.com)는
//   (1) Client Secret 헤더가 필요하고(프론트에 노출 금지),
//   (2) 브라우저 CORS를 허용하지 않는다.
// 그래서 이 서버 함수가 중계한다. Secret은 여기(서버)에만 둔다.
//
// ── 배포 방법 (오재호 님이 CLI에서 1회) ─────────────────────────────
//   npm i -g supabase
//   supabase login
//   supabase link --project-ref bhgijvaxxjnocgfnaaeu
//   supabase secrets set NAVER_CLIENT_ID=발급받은ID NAVER_CLIENT_SECRET=발급받은시크릿
//   supabase functions deploy naver-search --no-verify-jwt
// 배포되면 호출 URL:
//   https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/naver-search?query=강남 맛집
// ────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const query = new URL(req.url).searchParams.get("query")?.trim();
  if (!query) return json({ error: "query 파라미터가 필요합니다." }, 400);

  const id = Deno.env.get("NAVER_CLIENT_ID");
  const secret = Deno.env.get("NAVER_CLIENT_SECRET");
  if (!id || !secret) {
    return json({ error: "서버에 NAVER_CLIENT_ID/SECRET이 설정되지 않았습니다." }, 500);
  }

  const api = `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(query)}&display=5&sort=random`;
  try {
    const r = await fetch(api, {
      headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    });
    const data = await r.json();
    // 네이버 응답의 items[].mapx/mapy는 KATECH(TM128) 좌표라 위경도로 변환 필요.
    // (mapx/1e7=경도, mapy/1e7=위도 — v1 local 기준). 프론트에서 처리한다.
    return json(data, r.status);
  } catch (e) {
    return json({ error: "네이버 검색 호출 실패", detail: String(e) }, 502);
  }
});
