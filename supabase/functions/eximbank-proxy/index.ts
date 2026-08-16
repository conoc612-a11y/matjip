// 한국수출입은행 Open API 프록시 — 환율(AP01)·대출금리(AP02) 공용
//
// 요청 형식(실측): https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON
//   ?authkey=<키>&searchdate=YYYYMMDD&data=AP01|AP02
// authkey는 API별로 별도 발급된 키를 쓴다(환율/대출금리가 서로 다른 키,
// keys.env의 EXCHANGE_RATE_KEY / LOAN_RATE_KEY).
//
// 휴일·주말엔 고시가 없어 빈 배열이 오므로, 최대 5일 전까지 거슬러 올라가며 재조회한다.
//
// ── 배포 방법 ─────────────────────────────────────────
//   supabase functions deploy eximbank-proxy --no-verify-jwt
// 호출 예:
//   .../eximbank-proxy?kind=exchange   (환율, USD 고시환율 위주)
//   .../eximbank-proxy?kind=loan       (대출금리)
// ────────────────────────────────────────────────────

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

function ymd(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

// ── 레이트리밋 (2026-08-15 코드리뷰 조치) ──────────────────────────
// 이 함수는 인증 없이(--no-verify-jwt) 공개다. EXCHANGE_RATE_KEY/LOAN_RATE_KEY 를 품고
// 있어 반복 호출로 수출입은행 호출한도를 소진시킬 수 있다. molit-proxy 와 같은
// api_rate_limits/rl_hit DB 카운터를 쓴다. 버킷 접두사는 "eximbank:" — 타 API 와 별도.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 30; // 환율/금리 조회 1회 = API 1호출. 정상 사용은 분당 수 회.
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
      body: JSON.stringify({ p_key: `eximbank:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
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
  const p = new URL(req.url).searchParams;
  const kind = p.get("kind");
  if (kind !== "exchange" && kind !== "loan") {
    return json({ error: "kind는 exchange 또는 loan 이어야 합니다." }, 400);
  }
  const data = kind === "exchange" ? "AP01" : "AP02";
  const key = Deno.env.get(kind === "exchange" ? "EXCHANGE_RATE_KEY" : "LOAN_RATE_KEY");
  if (!key) return json({ error: "서버에 인증키가 설정되지 않았습니다." }, 500);

  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  for (let back = 0; back < 6; back++) {
    const d = new Date(now.getTime() - back * 86400000);
    const searchdate = ymd(d);
    const api = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${key}&searchdate=${searchdate}&data=${data}`;
    try {
      const r = await fetch(api);
      const arr = await r.json();
      if (Array.isArray(arr) && arr.length) {
        return json({ searchdate, kind, items: arr });
      }
    } catch (e) {
      if (back === 5) {
        // 2026-08-16 보안: detail 로 예외 문자열을 내보내면 Deno fetch 실패 메시지에 포함된
        // 요청 URL(authkey 포함)이 익명 호출자에게 새어나간다. 로그로만 남기고 고정 문구 반환.
        console.error("한국수출입은행 API 호출 실패:", e);
        return json({ error: "한국수출입은행 API 호출 실패" }, 502);
      }
    }
  }
  return json({ error: "최근 6일간 고시 데이터를 찾지 못했습니다.", kind }, 404);
});
