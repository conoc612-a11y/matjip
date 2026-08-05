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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
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
      if (back === 5) return json({ error: "한국수출입은행 API 호출 실패", detail: String(e) }, 502);
    }
  }
  return json({ error: "최근 6일간 고시 데이터를 찾지 못했습니다.", kind }, 404);
});
