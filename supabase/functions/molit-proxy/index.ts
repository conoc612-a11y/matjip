// 국토교통부 건축HUB 건축물대장 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: apis.data.go.kr 의 serviceKey를 프론트(land.html)에 그대로 두면
//   공개 GitHub Pages 배포본에 키가 노출되어 제3자가 일일 호출 한도를 소진시킬 수 있다.
// 그래서 이 서버 함수가 중계한다. Secret은 여기(서버)에만 둔다.
//
// ── 배포 방법 (CLI에서 1회) ─────────────────────────────────────────
//   npm i -g supabase
//   supabase login
//   supabase link --project-ref bhgijvaxxjnocgfnaaeu
//   supabase secrets set MOLIT_KEY=발급받은_디코딩전(인코딩)_서비스키
//   supabase functions deploy molit-proxy --no-verify-jwt
// 배포되면 호출 URL:
//   https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/molit-proxy?op=getBrTitleInfo&sigunguCd=...&bjdongCd=...&platGbCd=...&bun=...&ji=...&numOfRows=10&pageNo=1
// ────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// 건축HUB에서 이 프록시가 중계하도록 허용한 오퍼레이션만 화이트리스트로 제한한다.
// (임의의 op를 그대로 넘기면 이 함수가 만능 오픈 프록시가 되어 남용될 수 있다.)
// getBrTitleInfo/getBrExposInfo는 목록·보충 조회용이고, 나머지는 land.html의
// '건축물대장 상세 보기'(loadLedgerDetail)가 쓰는 상세 조회 op다.
const ALLOWED_OPS = new Set([
  "getBrTitleInfo", "getBrExposInfo",
  "getBrRecapTitleInfo", "getBrBasisOulnInfo", "getBrFlrOulnInfo",
  "getBrAtchJibunInfo", "getBrExposPubuseAreaInfo", "getBrHsprcInfo", "getBrJijiguInfo",
]);

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extraHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

// IP당 레이트리밋 — MOLIT_KEY(data.go.kr 계정당 일일 호출한도)를 남이 반복 호출로
// 소진시키는 걸 막는다. 처음엔 함수 메모리 Map으로 짰으나 실측 결과 65회 연속 요청에도
// 한 번도 안 걸림 — Edge Function 인스턴스가 요청마다 분산돼 메모리가 공유 안 됨.
// 그래서 DB(rl_hit RPC, api_rate_limits 테이블)로 카운터를 옮겼다 — 인스턴스 무관하게 공유됨.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 42; // 지도 클릭 1회 = op 7개 호출 → 분당 클릭 6회 한도(6*7)
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
      // "datagokr:" 접두사로 kma-weather-proxy 와 같은 버킷을 공유한다 — data.go.kr 은
      // 계정당 인증키 하나를 공용으로 쓰므로 함수별로 따로 세면 합계가 한도를 넘긴다(2026-08-14).
      body: JSON.stringify({ p_key: `datagokr:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
    });
    // rl_hit 이 404/권한오류를 내면 예전엔 조용히 통과시켰다(row.allowed 가 undefined).
    // 마이그레이션이 빠져도 아무도 모르는 상태가 되므로 최소한 로그는 남긴다.
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
    return json(
      { error: `요청이 너무 많습니다. ${rl.retryAfterSec}초 후 다시 시도하세요.` },
      429,
      { "Retry-After": String(rl.retryAfterSec) },
    );
  }

  const url = new URL(req.url);
  const p = url.searchParams;
  const op = p.get("op") || "";
  if (!ALLOWED_OPS.has(op)) {
    return json({ error: `op은 ${[...ALLOWED_OPS].join(", ")} 중 하나여야 합니다.` }, 400);
  }

  const sigunguCd = p.get("sigunguCd");
  const bjdongCd = p.get("bjdongCd");
  const platGbCd = p.get("platGbCd");
  const bun = p.get("bun");
  const ji = p.get("ji");
  if (!sigunguCd || !bjdongCd || !platGbCd || !bun || !ji) {
    return json({ error: "sigunguCd/bjdongCd/platGbCd/bun/ji 파라미터가 필요합니다." }, 400);
  }
  const numOfRows = p.get("numOfRows") || "10";
  const pageNo = p.get("pageNo") || "1";

  const key = Deno.env.get("MOLIT_KEY");
  if (!key) {
    return json({ error: "서버에 MOLIT_KEY가 설정되지 않았습니다." }, 500);
  }

  const q = `serviceKey=${key}&sigunguCd=${sigunguCd}&bjdongCd=${bjdongCd}`
    + `&platGbCd=${platGbCd}&bun=${bun}&ji=${ji}&numOfRows=${numOfRows}&pageNo=${pageNo}&_type=json`;
  const api = `https://apis.data.go.kr/1613000/BldRgstHubService/${op}?${q}`;

  try {
    const r = await fetch(api);
    const data = await r.json();
    return json(data, r.status);
  } catch (e) {
    // detail 로 예외 문자열을 그대로 내보내지 않는다 — Deno fetch 실패 메시지에 요청 URL
    // (= serviceKey 포함)이 실려 익명 호출자에게 샐 수 있다. 로그로만 남긴다(2026-08-14).
    console.error("건축HUB 호출 실패:", e);
    return json({ error: "건축HUB 호출 실패" }, 502);
  }
});
