// 방문자 집계 — Supabase Edge Function (Deno)
//
// F5 새로고침이나 같은 IP 재방문으로 오늘방문자/누적방문자가 부풀려지지 않도록,
// 서버에서 클라이언트 IP(x-forwarded-for)를 읽어 같은 IP는 하루에 1번만 기록한다.
// (브라우저 JS만으로는 자기 IP를 알 수 없어 서버 함수가 필요하다)
//
// ── 스키마 (schema.sql 에 포함) ─────────────────────────
//   visits 에 ip text, visit_date date 컬럼 + (ip, visit_date) unique 인덱스
// ── 배포 방법 (CLI에서 1회) ─────────────────────────
//   npx -y supabase functions deploy visit-count --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 CLI 배포 시 자동 주입된다)
// 호출:
//   GET https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/visit-count?page=main
//   → { today: 3, total: 120 }

import { createClient } from "npm:@supabase/supabase-js@2";

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

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

// IP → 국가/지역/도시 조회. ipwho.is 는 무료·키 불필요·HTTPS.
// 조회 실패해도 방문 기록 자체는 계속되어야 하므로 실패 시 null 반환.
async function lookupGeo(ip: string): Promise<{ country: string | null; region: string | null; city: string | null }> {
  const empty = { country: null, region: null, city: null };
  if (!ip || ip === "unknown") return empty;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(5000) });
    const geo = await res.json();
    if (geo && geo.success !== false) {
      return { country: geo.country ?? null, region: geo.region ?? null, city: geo.city ?? null };
    }
  } catch { /* 위치 조회 실패는 무시 */ }
  return empty;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "GET만 허용합니다." }, 405);

  const page = new URL(req.url).searchParams.get("page") || "land";
  const ip = clientIp(req);
  // 로그인 사용자면 Authorization(JWT)로 user_id 를 식별해 방문 기록에 남긴다.
  // 토큰이 없거나 만료면 비회원 방문으로 기록 (방문 집계 자체는 계속되어야 함).
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  // "오늘"은 항상 한국시간 00:00(24:00 경계) 기준 — UTC 날짜로 쓰면 자정~09시에 전날 숫자로 보인다.
  const KST = 9 * 3600e3;
  const today = new Date(Date.now() + KST).toISOString().slice(0, 10);               // 한국 날짜
  const todayStart = new Date(new Date(today + "T00:00:00Z").getTime() - KST).toISOString(); // 한국 0시(UTC)

  const suUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!suUrl || !serviceKey) return json({ error: "서버 설정 오류" }, 500);

  const admin = createClient(suUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // 같은 IP는 하루 1건만 (unique index visits_ip_date_uniq 덕에 중복 무시)
    const geo = await lookupGeo(ip);
    let userId: string | null = null;
    if (token) {
      const { data: u } = await admin.auth.getUser(token);
      if (u?.user) userId = u.user.id;
    }
    await admin.from("visits").upsert(
      { page, ip, visit_date: today, country: geo.country, region: geo.region, city: geo.city, user_id: userId },
      { onConflict: "ip,visit_date", ignoreDuplicates: true }
    );
    const [tRes, totRes] = await Promise.all([
      admin.from("visits").select("*", { count: "exact", head: true })
        .or(`visit_date.eq.${today},created_at.gte.${todayStart}`),
      admin.from("visits").select("*", { count: "exact", head: true }),
    ]);
    return json({ today: tRes.count ?? 0, total: totRes.count ?? 0 });
  } catch (e) {
    return json({ error: "방문자 집계 실패", detail: String(e) }, 500);
  }
});
