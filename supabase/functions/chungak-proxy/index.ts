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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

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
    return json({ error: "청약홈 API 호출 실패", detail: String(e) }, 502);
  }
});
