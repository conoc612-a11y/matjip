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
// 소진시키는 걸 막는다. Deno Edge Function 인스턴스 안에서만 유효한 메모리 카운터라
// 인스턴스가 재시작/분산되면 리셋된다 — 완벽한 방어는 아니지만 별도 인프라(Redis 등)
// 없이 이 정도로도 무차별 반복 호출은 충분히 걸러진다.
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60; // 지도 클릭 1회 = op 7개 호출이라 여유 있게 잡음
const rateMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now >= entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return { ok: true };
  }
  entry.count += 1;
  if (entry.count > RATE_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const rl = checkRateLimit(ip);
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
    return json({ error: "건축HUB 호출 실패", detail: String(e) }, 502);
  }
});
