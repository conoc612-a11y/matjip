// 관리자 데이터 — Supabase Edge Function (Deno)
//
// admin-login 에서 받은 세션 토큰을 검증한 뒤에만 회원 목록·방문자 통계를 돌려준다.
// service role 로 집계하므로 RLS(anon 차단)를 우회하지 않고, 토큰이 없으면 401.
// 광고업체 협의용 지표: 오늘/누적/고유IP 방문자, 최근 30일 일일 추이, 시간대·요일 분포,
// 페이지(land/main) 분포, 회원수·신규가입 추이, 회원별 취향(세그먼트) 데이터.
//
// 호출:
//   GET https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-data
//   Authorization: Bearer <admin-login이 발급한 토큰>

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

const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

// "오늘" 집계는 한국시간 00:00(24:00) 경계 기준 (visit-count와 동일한 규칙)
const KST = 9 * 3600e3;
const toKstDate = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10);
const DAY = 86400e3;
// 한국 시간 기준 시간대 (UTC+9, 한국은 서머타임 없음)
const seoulHour = (iso: string) => (new Date(iso).getUTCHours() + 9) % 24;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return json({ error: "GET만 허용합니다." }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "로그인이 필요합니다." }, 401);

  const suUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!suUrl || !serviceKey) return json({ error: "서버 설정 오류" }, 500);

  const admin = createClient(suUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 세션 검증 (토큰 원문이 아니라 해시로 조회 → DB가 털려도 토큰 무용지물)
  const { data: sess, error: sessErr } = await admin.from("admin_sessions")
    .select("expires_at").eq("token_hash", await sha256hex(token)).maybeSingle();
  if (sessErr || !sess || new Date(sess.expires_at).getTime() < Date.now()) {
    return json({ error: "세션이 만료되었습니다. 다시 로그인하세요." }, 401);
  }

  try {
    const now = new Date();
    const today = toKstDate(now);
    const todayStart = new Date(new Date(today + "T00:00:00Z").getTime() - KST).toISOString();
    const day29 = toKstDate(new Date(now.getTime() - 29 * DAY));
    const day7iso = new Date(now.getTime() - 6 * DAY).toISOString();

    // ── 개수 (오늘/누적/고유IP/회원수) ──
    const [totRes, todayRes, ipsRes, memRes] = await Promise.all([
      admin.from("visits").select("*", { count: "exact", head: true }),
      admin.from("visits").select("*", { count: "exact", head: true })
        .or(`visit_date.eq.${today},created_at.gte.${todayStart}`),
      admin.from("visits").select("ip").not("ip", "is", null),
      admin.from("profiles").select("*", { count: "exact", head: true }),
    ]);
    const total = totRes.count ?? 0;
    const todayCount = todayRes.count ?? 0;
    const uniqueIps = new Set((ipsRes.data || []).map((r) => r.ip)).size;
    const memberCount = memRes.count ?? 0;

    // ── 최근 30일 일일 방문자 (dedup된 visit_date 기준) ──
    const dailyRows = (await admin.from("visits").select("visit_date")
      .gte("visit_date", day29).not("visit_date", "is", null)).data || [];
    const dailyMap: Record<string, number> = {};
    dailyRows.forEach((r) => { dailyMap[r.visit_date] = (dailyMap[r.visit_date] || 0) + 1; });
    const daily: { d: string; c: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = toKstDate(new Date(now.getTime() - (29 - i) * DAY));
      daily.push({ d, c: dailyMap[d] || 0 });
    }

    // ── 최근 7일 시간대·요일 분포 ──
    const recRows = (await admin.from("visits").select("created_at").gte("created_at", day7iso)).data || [];
    const hourMap: Record<number, number> = {};
    const wdMap: Record<number, number> = {};
    recRows.forEach((r) => {
      const h = seoulHour(r.created_at);
      hourMap[h] = (hourMap[h] || 0) + 1;
      wdMap[new Date(r.created_at).getUTCDay()] = (wdMap[new Date(r.created_at).getUTCDay()] || 0) + 1;
    });
    const hourly: { h: number; c: number }[] = Array.from({ length: 24 }, (_, h) => ({ h, c: hourMap[h] || 0 }));
    // 월(1)~일(0)
    const weekday: { d: number; c: number }[] = [1, 2, 3, 4, 5, 6, 0].map((d) => ({ d, c: wdMap[d] || 0 }));

    // ── 페이지(land/main) 분포 ──
    const pageRows = (await admin.from("visits").select("page")).data || [];
    const byPage: Record<string, number> = {};
    pageRows.forEach((r) => { byPage[r.page] = (byPage[r.page] || 0) + 1; });

    // ── 회원 목록 (취향 + 최종 접속일 포함, 최신순) ──
    // taste_profiles.user_id는 profiles가 아닌 auth.users를 직접 참조하므로
    // PostgREST embed가 안 된다 → profiles/taste_profiles/auth.users 를 따로 조회해 조인한다.
    // 최종 접속일은 profiles.last_seen_at (auth-guard.js가 방문마다 기록) 우선,
    // 미기록 회원은 auth.users.last_sign_in_at(비밀번호 로그인 시각)으로 대체.
    const [pRes, tRes, aRes] = await Promise.all([
      admin.from("profiles").select("id,email,created_at,last_seen_at").order("created_at", { ascending: false }),
      admin.from("taste_profiles").select("user_id,spicy_level,flavor_tags,situation_tags"),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);
    const tByUser = new Map((tRes.data || []).map((t) => [t.user_id, t]));
    const authByUser = new Map((aRes.data.users || []).map((u) => [u.id, { last: u.last_sign_in_at ?? null, name: u.user_metadata?.name ?? null }]));
    const members = (pRes.data || []).map((p) => {
      const t = tByUser.get(p.id);
      const a = authByUser.get(p.id);
      return {
        id: p.id,
        email: p.email,
        name: a?.name ?? null,
        joined_at: p.created_at,
        last_login_at: p.last_seen_at ?? a?.last ?? null,
        spicy_level: t?.spicy_level ?? null,
        flavor_tags: t?.flavor_tags ?? [],
        situation_tags: t?.situation_tags ?? [],
      };
    });

    // ── 최근 30일 신규가입 추이 ──
    const day29Start = new Date(new Date(day29 + "T00:00:00Z").getTime() - KST).toISOString();
    const mpRows = (await admin.from("profiles").select("created_at").gte("created_at", day29Start)).data || [];
    const mpMap: Record<string, number> = {};
    mpRows.forEach((r) => { const d = toKstDate(new Date(r.created_at)); mpMap[d] = (mpMap[d] || 0) + 1; });
    const memberDaily: { d: string; c: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const d = toKstDate(new Date(now.getTime() - (29 - i) * DAY));
      memberDaily.push({ d, c: mpMap[d] || 0 });
    }

    return json({
      today: todayCount, total, uniqueIps, memberCount,
      daily, hourly, weekday, byPage, memberDaily,
      members,
    });
  } catch (e) {
    return json({ error: "데이터 조회 실패", detail: String(e) }, 500);
  }
});
