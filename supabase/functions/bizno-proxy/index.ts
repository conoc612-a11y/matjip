// 국세청 사업자등록 진위확인·상태조회 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: api.odcloud.kr(공공데이터포털 Infuser)의 serviceKey를 land.html에 그대로 두면
//   공개 GitHub Pages 배포본에 키가 노출되어 제3자가 일일 호출 한도를 소진시킬 수 있다.
//   그래서 이 서버 함수가 중계한다. Secret은 여기(서버)에만 둔다.
//
// ── 배포 방법 (CLI에서 1회) ─────────────────────────────────────────
//   npx -y supabase secrets set "NTS_API_KEY=<data.go.kr 인코딩된 serviceKey 그대로>" --project-ref bhgijvaxxjnocgfnaaeu
//   npx -y supabase functions deploy bizno-proxy --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
// 배포되면 호출 URL:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/bizno-proxy?op=status
//   body: { "b_no": ["1234567890"] }
//   POST ...?op=validate
//   body: { "businesses": [{ "b_no":"...", "start_dt":"YYYYMMDD", "p_nm":"대표자", "b_nm":"상호" }] }
// ──────────────────────────────────────────────────────────────────
// API 원본 (data.go.kr data/15081808, 국세청_사업자등록정보 진위확인 및 상태조회 서비스):
//   POST https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=<키>
//     body: { "b_no": ["숫자 10자리"] }   (1회 최대 100건, '-' 제거)
//     응답: { status_code:"OK", request_cnt, match_cnt,
//            data:[{ b_no, b_stt_cd, b_stt(계속사업자/휴업자/폐업자),
//                    tax_type_cd, tax_type(부가가치세 일반과세자 등),
//                    end_dt(폐업일자), utcc_yn, ... }] }
//     등록되지 않은 번호면 b_stt가 비고 tax_type에 "국세청에 등록되지 않은 사업자등록번호입니다."가 온다.
//   POST https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=<키>
//     body: { "businesses": [{ b_no(필수), start_dt YYYYMMDD(필수), p_nm 대표자(필수),
//                              b_nm 상호(선택), p_nm2, corp_no, b_sector, b_type }] }
//     응답: data[].valid = "01"(일치) / "02"(불일치 "확인할 수 없습니다."),
//           일치 시 status 정보(b_stt/tax_type/end_dt)도 함께 온다.
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

const clean = (s, max, re) => String(s || "").replace(re, "").slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const key = Deno.env.get("NTS_API_KEY");
  if (!key) return json({ error: "서버에 NTS_API_KEY가 설정되지 않았습니다." }, 500);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "JSON body가 필요합니다." }, 400);
  }
  const op = (new URL(req.url).searchParams.get("op") || "status");

  const headers = { "content-type": "application/json; charset=utf-8", accept: "application/json" };
  let api, payload;

  if (op === "status") {
    const raw = Array.isArray(body?.b_no) ? body.b_no : [];
    // 숫자 10자리만 허용(하이픈 등 기호는 제거). 중복 제거, 최대 100건.
    const b_no = [...new Set(raw.map(String).map((s) => s.replace(/[^0-9]/g, "")).filter((s) => /^[0-9]{10}$/.test(s)))].slice(0, 100);
    if (!b_no.length) return json({ error: "b_no는 10자리 숫자로 1건 이상 주세요. (예: \"1234567890\")" }, 400);
    api = `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${key}`;
    payload = JSON.stringify({ b_no });
  } else if (op === "validate") {
    const list = Array.isArray(body?.businesses) ? body.businesses : [];
    const businesses = list.map((b) => {
      const b_no = clean(b?.b_no, 10, /[^0-9]/g);
      const start_dt = clean(b?.start_dt, 8, /[^0-9]/g);
      const p_nm = String(b?.p_nm || "").trim().slice(0, 50);
      const b_nm = String(b?.b_nm || "").trim().slice(0, 50);
      return { b_no, start_dt, p_nm, p_nm2: "", b_nm, corp_no: "", b_sector: "", b_type: "" };
    }).filter((b) => /^[0-9]{10}$/.test(b.b_no) && /^[0-9]{8}$/.test(b.start_dt) && b.p_nm);
    if (!businesses.length) {
      return json({ error: "businesses는 b_no(10자리)·start_dt(YYYYMMDD)·p_nm(대표자)가 모두 있는 항목이 1건 이상 필요합니다." }, 400);
    }
    api = `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${key}`;
    payload = JSON.stringify({ businesses });
  } else {
    return json({ error: "op는 status|validate 중 하나여야 합니다." }, 400);
  }

  // serviceKey는 인코딩된 문자열을 그대로 URL에 넣는다. encodeURIComponent로 감싸면 %→%25 깨짐.
  try {
    const r = await fetch(api, { method: "POST", headers, body: payload });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...CORS, "content-type": r.headers.get("content-type") || "application/json; charset=utf-8" },
    });
  } catch (e) {
    return json({ error: "국세청 API 호출 실패", detail: String(e) }, 502);
  }
});
