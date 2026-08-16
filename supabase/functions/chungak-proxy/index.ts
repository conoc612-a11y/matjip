// 한국부동산원 청약홈 분양정보 조회 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: api.odcloud.kr(공공데이터포털 Infuser)의 serviceKey를 land.html에 그대로 두면
//   공개 GitHub Pages 배포본에 키가 노출되어 제3자가 일일 호출 한도를 소진시킬 수 있다.
//   그래서 이 서버 함수가 중계한다. Secret은 여기(서버)에만 둔다.
//
// ── 배포 방법 (CLI에서 1회) ─────────────────────────────────────────
//   npm i -g supabase
//   supabase login
//   supabase link --project-ref bhgijvaxxjnocgfnaaeu
//   supabase secrets set CHUNGAK_API_KEY=<data.go.kr 발급 화면의 인코딩된 serviceKey 그대로>
//   supabase functions deploy chungak-proxy --no-verify-jwt
// 배포되면 호출 URL:
//   https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/chungak-proxy?op=getAPTLttotPblancDetail&perPage=30&cond%5BSUBSCRPT_AREA_CODE_NM%3A%3AEQ%5D=서울
// ──────────────────────────────────────────────────────────────────
// API 원본 (data.go.kr data/15098547, 기술문서 nttSn=79889):
//   GET https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/{op}
//   파라미터: serviceKey, page, perPage, returnType(JSON/XML),
//     cond[FIELD::OP] — FIELD: HOUSE_MANAGE_NO/PBLANC_NO/HOUSE_NM/HOUSE_SECD/
//       HOUSE_DTL_SECD/SUBSCRPT_AREA_CODE/SUBSCRPT_AREA_CODE_NM/HSSPLY_ADRES/RCRIT_PBLANC_DE
//     OP: EQ/LIKE/GT/GTE/LT/LTE
//   응답: { currentCount, data:[...], matchCount, page, perPage, totalCount }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

// 이 프록시가 중계하도록 허용한 오퍼레이션만 화이트리스트로 제한한다.
// (임의의 op를 그대로 넘기면 이 함수가 만능 오픈 프록시가 되어 남용될 수 있다.)
const ALLOWED_OPS = new Set([
  "getAPTLttotPblancDetail", "getAPTLttotPblancMdl",
  "getOPTLttotPblancDetail", "getOPTLttotPblancMdl",
  "getUrbtyOfctlLttotPblancDetail", "getUrbtyOfctlLttotPblancMdl",
  "getPblPvtRentLttotPblancDetail", "getPblPvtRentLttotPblancMdl",
  "getRemndrLttotPblancDetail", "getRemndrLttotPblancMdl",
]);

const COND_FIELDS = new Set([
  "HOUSE_MANAGE_NO", "PBLANC_NO", "HOUSE_NM", "HOUSE_SECD",
  "HOUSE_DTL_SECD", "SUBSCRPT_AREA_CODE", "SUBSCRPT_AREA_CODE_NM",
  "HSSPLY_ADRES", "RCRIT_PBLANC_DE",
]);
const COND_OPS = new Set(["EQ", "LIKE", "GT", "GTE", "LT", "LTE"]);

function json(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

// ── 레이트리밋 (2026-08-15 코드리뷰 조치) ──────────────────────────
// 이 함수는 인증 없이(--no-verify-jwt) 공개다. CHUNGAK_API_KEY(data.go.kr 서비스키)를
// 품고 있어 반복 호출로 일일 한도를 소진시킬 수 있다. molit-proxy 와 같은
// api_rate_limits/rl_hit DB 카운터를 쓴다. 버킷 접두사는 "chungak:" — odcloud 별도
// 서비스키라 data.go.kr 계정 버킷과는 따로 센다.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 30; // 분양 목록 조회 1회 = API 1호출. 정상 사용은 분당 수 회.
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
      body: JSON.stringify({ p_key: `chungak:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
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

  const url = new URL(req.url);
  const p = url.searchParams;
  const op = p.get("op") || "";
  if (!ALLOWED_OPS.has(op)) {
    return json({ error: `op은 ${[...ALLOWED_OPS].join(", ")} 중 하나여야 합니다.` }, 400);
  }

  const key = Deno.env.get("CHUNGAK_API_KEY");
  if (!key) {
    return json({ error: "서버에 CHUNGAK_API_KEY가 설정되지 않았습니다." }, 500);
  }

  // serviceKey는 data.go.kr에서 받은 인코딩된 문자열을 그대로 넘긴다.
  // encodeURIComponent로 감싸면 %가 %25로 이중 인코딩되어 인증이 깨진다(molit-proxy와 동일).
  const qp = [`serviceKey=${key}`];
  const push = (k, v) => qp.push(`${k}=${encodeURIComponent(v)}`);
  push("page", p.get("page") || "1");
  push("perPage", p.get("perPage") || "20");
  push("returnType", p.get("returnType") || "JSON");
  for (const k of p.keys()) {
    const m = /^cond\[([A-Z_]+)::(EQ|LIKE|GT|GTE|LT|LTE)\]$/.exec(k);
    if (!m || !COND_FIELDS.has(m[1])) continue; // 화이트리스트 밖 cond는 버린다
    push(k, p.get(k) || "");
  }

  const api = `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/${op}?${qp.join("&")}`;
  try {
    const r = await fetch(api);
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        ...CORS,
        "content-type": r.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    // 2026-08-16 보안: detail 로 예외 문자열을 내보내면 Deno fetch 실패 메시지에 포함된
    // 요청 URL(serviceKey 포함)이 익명 호출자에게 새어나간다. 로그로만 남기고 고정 문구 반환.
    console.error("청약홈 API 호출 실패:", e);
    return json({ error: "청약홈 API 호출 실패" }, 502);
  }
});
