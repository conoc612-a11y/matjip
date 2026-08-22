// 소상공인시장진흥공단 상가(상권)정보 프록시 — Supabase Edge Function (Deno)
//
// 무엇을 하나: **필지(PNU) 하나에 들어 있는 상가업소 목록**을 돌려준다.
//   = 팝업의 "이 건물 업소" 섹션. 층 정보가 함께 온다.
//
// 왜 필요한가:
//   ① apis.data.go.kr 의 serviceKey 를 프론트(land.html)에 두면 공개 GitHub Pages 배포본에
//      키가 노출되어 제3자가 일일 호출 한도를 소진시킬 수 있다(MOLIT_KEY 노출 사고 재발 방지).
//   ② 건축물대장에는 **상호(임차 업소)가 아예 없다.** 클릭한 건물이 상가여도 팝업엔
//      '단독주택'만 뜬다. 그 빈칸을 메우는 데이터가 이것뿐이다(TROUBLESHOOTING §50).
//
// ── 실측으로 확인한 것 (2026-08-22, §51-4) ─────────────────────────
//   storeListInPnu 의 필지 파라미터명은 **`key`** 다.
//   (`pnu`·`lnoCd`·`cd` 는 NO_MANDATORY_REQUEST_PARAMETERS_ERROR)
//
//   PNU 1162010100100340004 (봉천동 34-4 = 파리바게뜨 건물) → 3건, 그 건물만:
//     -층 파리바케트 행운점 [빵/도넛] / 2층 JDS헤어디자인 [미용실] / 3층 제이엠뷰티룸 [피부 관리실]
//
//   응답 39필드 중 채움률(반경 50m 36건 표본):
//     lnoCd(=PNU 19자리) 36/36 · bldMngNo 36/36 · flrNo(층) 28/36 · hoNo 0/36 · dongNo 0/36
//   → **호·동은 절대 오지 않는다.** 층도 22% 는 빈다. 프론트에서 그 전제로 그릴 것.
//
// ⚠️ 갱신주기가 **분기**다. 폐업이 최대 3개월 늦게 반영되므로 프론트에 기준 시점을 표시한다.
// ⚠️ 상가업소 대상이라 사무실·일반 사무업은 누락된다.
//
// ── 배포 방법 ────────────────────────────────────────────────────
//   supabase secrets set SBIZ_KEY=<data.go.kr 인증키(Encoding, keys.env 의 DGK)>
//   supabase functions deploy sbiz-proxy --no-verify-jwt
// 호출 URL:
//   https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/sbiz-proxy?pnu=1162010100100340004
// ────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extraHeaders, "content-type": "application/json; charset=utf-8" },
  });
}

// 레이트리밋 — molit-proxy·kma-weather-proxy 와 **같은 버킷**(`datagokr:`)을 쓴다.
// data.go.kr 은 계정당 인증키를 공용으로 쓰므로 함수별로 따로 세면 합계가 한도를 넘긴다.
// 지도 클릭 1회당 이 함수는 1번만 부른다(건축HUB 는 7번) → 기존 한도에 그대로 얹는다.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 42;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

async function checkRateLimit(ip: string): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/rl_hit`, {
      method: "POST",
      // ⚠️ 서비스롤 키를 모듈 상수에 담아 두고 헤더에서 그 상수 이름을 쓰면, 전역 pre-commit
      //    훅(시크릿 탐지)이 "키 이름 뒤에 8자 이상 값" 패턴으로 읽어 하드코딩으로 오판하고
      //    커밋을 막는다. env 접근을 그 자리에 두면 훅도 통과하고 출처도 더 분명하다.
      //    상수로 되돌리지 말 것 — 다시 막힌다(molit-proxy 는 훅 도입 전에 커밋된 것이다).
      headers: {
        "content-type": "application/json",
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({ p_key: `datagokr:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
    });
    if (!r.ok) { console.error("rl_hit 실패:", r.status); return { ok: true }; }
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.allowed === false) return { ok: false, retryAfterSec: row.retry_after ?? RATE_WINDOW_SEC };
    return { ok: true };
  } catch (_e) {
    // 레이트리밋은 방어선이지 필수 경로가 아니다 — DB 왕복 실패로 서비스를 막지 않는다.
    return { ok: true };
  }
}

// 프론트에 필요한 필드만 골라 내보낸다. 39필드를 그대로 흘리면 응답이 커지고,
// 앞으로 필드가 늘거나 이름이 바뀌어도 프론트가 흔들리지 않게 여기서 한 번 고정한다.
function slim(x: Record<string, unknown>) {
  return {
    id: x.bizesId,                    // 상가업소번호 (중복 제거 키)
    name: x.bizesNm,                  // 상호명
    branch: x.brchNm || "",           // 지점명 ('행운점')
    inds: x.indsSclsNm || x.indsMclsNm || x.indsLclsNm || "",  // 업종 소분류 우선
    flr: x.flrNo === "" || x.flrNo == null ? null : x.flrNo,    // 층 (78% 만 채워진다)
    addr: x.lnoAdr || x.rdnmAdr || "",
    lat: x.lat, lon: x.lon,
  };
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

  const pnu = new URL(req.url).searchParams.get("pnu") || "";
  // PNU 는 19자리 숫자다(시군구5+법정동5+산여부1+본번4+부번4). 형식을 여기서 막아
  // 이 함수가 임의 파라미터를 흘리는 오픈 프록시가 되지 않게 한다.
  if (!/^\d{19}$/.test(pnu)) {
    return json({ error: "pnu 는 19자리 숫자여야 합니다." }, 400);
  }

  const key = Deno.env.get("SBIZ_KEY");
  if (!key) return json({ error: "서버에 SBIZ_KEY 가 설정되지 않았습니다." }, 500);

  // numOfRows 는 서버가 정한다 — 한 필지에 업소가 100개를 넘는 경우는 사실상 없고,
  // 프론트가 큰 값을 넣어 응답을 부풀리는 것을 막는다.
  const api = `https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPnu`
    + `?serviceKey=${key}&key=${pnu}&numOfRows=100&pageNo=1&type=json`;

  try {
    const r = await fetch(api);
    const data = await r.json();
    // 응답 모양이 두 가지로 온다(body 직속 / response.body). 프론트가 분기하지 않도록 여기서 흡수한다.
    const body = (data && (data.body ?? (data.response && data.response.body))) || {};
    const items = body.items;
    const arr = Array.isArray(items) ? items : (items && items.item ? [].concat(items.item) : []);
    return json({ total: Number(body.totalCount) || arr.length, stores: arr.filter(Boolean).map(slim) }, 200);
  } catch (e) {
    // 예외 문자열을 그대로 내보내지 않는다 — Deno fetch 실패 메시지에 요청 URL(= serviceKey 포함)이
    // 실려 익명 호출자에게 샐 수 있다(molit-proxy 에서 겪은 것과 같은 이유).
    console.error("상가정보 호출 실패:", e);
    return json({ error: "상가정보 호출 실패" }, 502);
  }
});
