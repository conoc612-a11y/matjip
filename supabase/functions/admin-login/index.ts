// 관리자 로그인 — Supabase Edge Function (Deno)
//
// 보안 설계 (정적 사이트 + Supabase에서 구현 가능한 최고 수준):
//   1. 관리자 비밀번호는 서버 env secret(ADMIN_PASSWORD)에만 보관 — 브라우저 JS·DB 어디에도 없다.
//   2. 상수시간 비교(SHA-256 다이제스트 XOR)로 타이밍 공격 차단.
//   3. IP당 15분 5회 실패 시 잠금 — admin_login_log 표에 기록(함수 인스턴스 재시작에도 유지).
//   4. 성공 시 세션 토큰(crypto.randomUUID) 1회 발급, DB에는 SHA-256 해시만 저장, 2시간 만료.
//      토큰 원문은 이 응답에서만 나가고 브라우저는 sessionStorage에만 보관한다.
//
// ── 배포 (CLI에서 1회) ─────────────────────────
//   npx -y supabase secrets set ADMIN_PASSWORD=<원하는 관리자 비밀번호> --project-ref bhgijvaxxjnocgfnaaeu
//   npx -y supabase functions deploy admin-login --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
//   npx -y supabase functions deploy admin-data  --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-login  { "password": "..." }
//   → { "token": "<1회용 세션 토큰>", "expires_at": "<2시간 뒤 ISO>" }

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

// 두 문자열이 다르면 즉시 false를 주는 대신 끝까지 순회해 실행시간을 일정하게 유지한다.
function ctEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0].trim() || "unknown";
}

const MAX_FAILS = 5;
const LOCK_MIN = 15;
const SESSION_HOURS = 2;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const pw = body.password;
  if (!email) return json({ error: "이메일을 입력하세요." }, 400);
  if (typeof pw !== "string" || !pw) return json({ error: "비밀번호를 입력하세요." }, 400);

  const adminPw = Deno.env.get("ADMIN_PASSWORD");
  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const suUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!adminPw || !adminEmail || !suUrl || !serviceKey) return json({ error: "서버 설정 오류 (ADMIN_PASSWORD/ADMIN_EMAIL 미설정)" }, 500);

  const admin = createClient(suUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = clientIp(req);
  const now = Date.now();

  // 만료된 세션·오래된 실패기록 정리 (기회비용 거의 없는 잡일)
  await admin.from("admin_sessions").delete().lt("expires_at", new Date(now).toISOString());
  await admin.from("admin_login_log").delete().lt("attempted_at", new Date(now - 24 * 3600e3).toISOString());

  // IP당 잠금 확인
  const { count: fails, error: fErr } = await admin.from("admin_login_log")
    .select("*", { count: "exact", head: true })
    .eq("ip", ip)
    .gte("attempted_at", new Date(now - LOCK_MIN * 60e3).toISOString());
  if (!fErr && (fails ?? 0) >= MAX_FAILS) {
    return json({ error: "로그인 시도가 너무 많습니다. 15분 후 다시 시도하세요." }, 429);
  }

  // 이메일·비밀번호 검증 (둘 다 일치해야 로그인 성공)
  const emailOk = ctEqual(email.toLowerCase(), adminEmail.toLowerCase());
  const pwOk = ctEqual(await sha256hex(pw), await sha256hex(adminPw));
  if (!emailOk || !pwOk) {
    await admin.from("admin_login_log").insert({ ip });
    return json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, 401);
  }

  // 성공: 실패기록 초기화 + 세션 발급
  await admin.from("admin_login_log").delete().eq("ip", ip);
  const token = crypto.randomUUID();
  const expiresAt = new Date(now + SESSION_HOURS * 3600e3).toISOString();
  const { error: sErr } = await admin.from("admin_sessions").insert({ token_hash: await sha256hex(token), expires_at: expiresAt });
  if (sErr) return json({ error: "세션 생성 실패", detail: sErr.message }, 500);
  return json({ token, expires_at: expiresAt });
});
