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

// ── 레이트리밋 (2026-08-15 코드리뷰 조치) ──────────────────────────
// 이 함수는 인증 없이(--no-verify-jwt) 공개다. NAVER_CLIENT_SECRET 을 품고 있으므로
// 남이 스크립트로 반복 호출하면 네이버 일일 호출한도를 소진시킬 수 있다.
// molit-proxy 와 같은 api_rate_limits/rl_hit DB 카운터를 쓴다(인스턴스 무관 공유).
// 버킷 접두사는 "naver:" — data.go.kr 계정과 무관한 별도 키라 molit/kma 와 안 섞는다.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 20; // 검색 1회 = API 1호출. 정상 사용은 분당 수 회 — 20 은 넉넉하다.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function checkRateLimit(ip: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rl_hit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SERVICE_ROLE_KEY,
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({ p_key: `naver:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
    });
    if (!r.ok) { console.error("rl_hit 실패:", r.status); return { ok: true }; }
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.allowed === false) return { ok: false, retryAfterSec: row.retry_after ?? RATE_WINDOW_SEC };
    return { ok: true };
  } catch (_e) {
    // DB 왕복 실패 시 서비스 자체를 막지 않는다 — 레이트리밋은 방어선이지 필수 경로가 아니다.
    return { ok: true };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const rl = await checkRateLimit(ip);
  if (!rl.ok) {
    return json({ error: `요청이 너무 많습니다. ${rl.retryAfterSec}초 후 다시 시도하세요.` }, 429);
  }

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
