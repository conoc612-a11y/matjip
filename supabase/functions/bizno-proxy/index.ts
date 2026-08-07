// 국세청 사업자등록 상태조회 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: api.odcloud.kr(공공데이터포털 Infuser)의 serviceKey를 land.html에 그대로 두면
//   공개 GitHub Pages 배포본에 키가 노출되어 제3자가 일일 호출 한도를 소진시킬 수 있다.
//   그래서 이 서버 함수가 중계한다. Secret은 여기(서버)에만 둔다.
//
// ── 배포 방법 (CLI에서 1회) ─────────────────────────────────────────
//   npx -y supabase secrets set "NTS_API_KEY=<data.go.kr 인코딩된 serviceKey 그대로>" --project-ref bhgijvaxxjnocgfnaaeu
//   npx -y supabase functions deploy bizno-proxy --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
// 배포되면 호출 URL:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/bizno-proxy
//   body: { "b_no": ["1234567890"] }
// ──────────────────────────────────────────────────────────────────
// API 원본 (data.go.kr data/15081808, 국세청_사업자등록정보 진위확인 및 상태조회 서비스):
//   POST https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=<키>
//   body: { "b_no": ["숫자 10자리"] }   (1회 최대 100건, '-' 제거)
//   응답: { status_code:"OK", request_cnt, match_cnt,
//          data:[{ b_no, b_stt_cd, b_stt(계속사업자/휴업자/폐업자),
//                  tax_type_cd, tax_type(부가가치세 일반과세자 등),
//                  end_dt(폐업일자), utcc_yn, ... }] }
//   등록되지 않은 번호면 b_stt가 비고 tax_type에 "국세청에 등록되지 않은 사업자등록번호입니다."가 온다.
//   serviceKey는 data.go.kr에서 받은 인코딩된 문자열을 그대로 넘긴다(이중 인코딩 금지).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

function json(body, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const key = Deno.env.get("NTS_API_KEY");
  if (!key) return json({ error: "서버에 NTS_API_KEY가 설정되지 않았습니다." }, 500);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "JSON body가 필요합니다. { \"b_no\": [\"1234567890\"] }" }, 400);
  }
  const raw = Array.isArray(body?.b_no) ? body.b_no : [];
  // 숫자 10자리만 허용(하이픈 등 기호는 제거 후 요청해야 한다). 중복 제거, 최대 100건.
  const b_no = [...new Set(raw.map(String).map((s) => s.replace(/[^0-9]/g, "")).filter((s) => /^[0-9]{10}$/.test(s)))].slice(0, 100);
  if (!b_no.length) return json({ error: "b_no는 10자리 숫자로 1건 이상 주세요. (예: \"1234567890\")" }, 400);

  // serviceKey는 인코딩된 문자열을 그대로 URL에 넣는다. encodeURIComponent로 감싸면 %→%25 깨짐.
  const api = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${key}`;
  try {
    const r = await fetch(api, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8", accept: "application/json" },
      body: JSON.stringify({ b_no }),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: {
        ...CORS,
        "content-type": r.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    return json({ error: "국세청 API 호출 실패", detail: String(e) }, 502);
  }
});
