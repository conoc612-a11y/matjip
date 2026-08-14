// 기상청 초단기예보 조회서비스 프록시 — Supabase Edge Function (Deno)
//
// 왜 필요한가: apis.data.go.kr의 serviceKey를 프론트에 두지 않기 위함
// (molit-proxy와 동일한 이유·패턴). 이 프로젝트는 data.go.kr 계정당
// 인증키 하나를 모든 apis.data.go.kr 서비스에 공용으로 쓰므로,
// 이미 등록된 MOLIT_KEY를 여기서도 그대로 쓴다(같은 계정, 별도 발급 불필요).
//
// 클라이언트는 lat/lng만 보내면 된다 — KMA 격자좌표(nx,ny) 변환과
// base_date/base_time 계산은 전부 여기서 처리한다.
//
// ── 배포 방법 ─────────────────────────────────────────
//   supabase functions deploy kma-weather-proxy --no-verify-jwt
// 호출 예:
//   https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/kma-weather-proxy?lat=37.4899&lng=126.9589
// ────────────────────────────────────────────────────

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

// ── 레이트리밋 (2026-08-14) ────────────────────────────────────────────
// molit-proxy 에만 걸어놨더니 이 함수가 우회로가 됐다 — 위 주석대로 data.go.kr 계정당
// 인증키 하나를 공용으로 쓰므로, 여기서 무제한으로 부르면 molit-proxy 쪽 방어와 상관없이
// 같은 계정의 일일 호출한도가 소진된다. 두 함수 모두 인증이 없어(--no-verify-jwt) 공개다.
// 키 앞에 "datagokr:" 를 붙여 molit-proxy 와 같은 버킷을 공유한다 — 한도가 계정 단위라
// 함수별로 따로 세면 합계가 한도를 넘긴다.
const RATE_WINDOW_SEC = 60;
const RATE_MAX = 42;
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
      body: JSON.stringify({ p_key: `datagokr:${ip}`, p_window_seconds: RATE_WINDOW_SEC, p_max: RATE_MAX }),
    });
    if (!r.ok) return { ok: true };   // 카운터 자체가 죽었으면 서비스는 막지 않는다
    const rows = await r.json();
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (row && row.allowed === false) return { ok: false, retryAfterSec: row.retry_after ?? RATE_WINDOW_SEC };
    return { ok: true };
  } catch (_e) {
    return { ok: true };
  }
}

// 위경도 → 기상청 격자(nx,ny) — Lambert Conformal Conic 변환(공식 문서 알고리즘)
function toGrid(lat: number, lon: number) {
  const RE = 6371.00877, GRID = 5.0;
  const SLAT1 = 30.0 * Math.PI / 180, SLAT2 = 60.0 * Math.PI / 180;
  const OLON = 126.0 * Math.PI / 180, OLAT = 38.0 * Math.PI / 180;
  const XO = 43, YO = 136;
  const re = RE / GRID;
  const sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + SLAT1 * 0.5), sn) * Math.cos(SLAT1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + OLAT * 0.5), sn);
  const ra0 = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * Math.PI / 180 * 0.5), sn);
  let theta = lon * Math.PI / 180 - OLON;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;
  const x = Math.floor(ra0 * Math.sin(theta) + XO + 1.5);
  const y = Math.floor(ro - ra0 * Math.cos(theta) + YO + 1.5);
  return { nx: x, ny: y };
}

// 초단기예보(getUltraSrtFcst)는 매시 30분 발표, 45분부터 서비스된다.
function baseDateTime() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  let h = now.getUTCHours(), d = now;
  if (now.getUTCMinutes() < 45) {
    d = new Date(now.getTime() - 60 * 60 * 1000);
    h = d.getUTCHours();
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  const base_date = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
  const base_time = `${pad(h)}30`;
  return { base_date, base_time };
}

const SKY_NM: Record<string, string> = { "1": "맑음", "3": "구름많음", "4": "흐림" };
const PTY_NM: Record<string, string> = { "0": "", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기", "5": "빗방울", "6": "빗방울눈날림", "7": "눈날림" };

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

  const p = new URL(req.url).searchParams;
  const lat = Number(p.get("lat")), lng = Number(p.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "lat/lng 파라미터가 필요합니다." }, 400);
  }
  const key = Deno.env.get("MOLIT_KEY");
  if (!key) return json({ error: "서버에 MOLIT_KEY가 설정되지 않았습니다." }, 500);

  const { nx, ny } = toGrid(lat, lng);
  const { base_date, base_time } = baseDateTime();
  const q = `serviceKey=${key}&pageNo=1&numOfRows=60&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx}&ny=${ny}`;
  const api = `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst?${q}`;

  try {
    const r = await fetch(api);
    const data = await r.json();
    const items = data?.response?.body?.items?.item;
    // 상류 응답 원문(raw)을 그대로 돌려주지 않는다 — 오류 응답에 요청 URL 이나 키가 섞여
    // 나올 수 있고, 이 함수는 인증 없이 공개다. 진단은 서버 로그로만(2026-08-14).
    if (!Array.isArray(items)) {
      console.error("기상청 응답 형식 이상:", JSON.stringify(data).slice(0, 500));
      return json({ error: "기상청 응답 형식 이상" }, 502);
    }
    // 가장 이른 예보 시각(가장 최신) 것만 모아 하나의 요약으로 만든다.
    const firstTime = items.map((i: any) => i.fcstTime).sort()[0];
    const row: Record<string, string> = {};
    items.filter((i: any) => i.fcstTime === firstTime).forEach((i: any) => { row[i.category] = i.fcstValue; });
    const temp = row.T1H != null ? Math.round(Number(row.T1H)) : null;
    const pty = row.PTY && row.PTY !== "0" ? PTY_NM[row.PTY] : null;
    const sky = row.SKY ? SKY_NM[row.SKY] : null;
    const label = pty || sky || "-";
    return json({ nx, ny, base_date, base_time, fcstTime: firstTime, temp, label, raw: row });
  } catch (e) {
    // detail 로 예외 문자열을 그대로 내보내면 Deno fetch 실패 메시지에 포함된 요청 URL —
    // 즉 serviceKey — 가 익명 호출자에게 새어나갈 수 있다. 로그로만 남긴다(2026-08-14).
    console.error("기상청 API 호출 실패:", e);
    return json({ error: "기상청 API 호출 실패" }, 502);
  }
});
