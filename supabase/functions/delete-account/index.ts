// 회원탈퇴 — Supabase Edge Function (Deno)
//
// 브라우저(anon key)에서는 auth.admin.deleteUser()를 쓸 수 없어
// service_role 키를 가진 서버 함수가 대신 삭제한다.
// users row를 지우면 FK가 `on delete cascade`로 걸린
// profiles / taste_profiles / saved_restaurants / feedbacks / visits 가 전부 지워진다.
//
// ── 배포 방법 (CLI에서 1회) ─────────────────────────
//   npx -y supabase functions deploy delete-account --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
//   (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 는 CLI 배포 시 자동 주입된다)
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/delete-account
//   Authorization: Bearer <사용자 access token>

import { createClient } from "npm:@supabase/supabase-js@2";

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

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "로그인이 필요합니다." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "서버 설정 오류" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const { data: { user }, error: authErr } = await admin.auth.getUser(token);
    if (authErr || !user) return json({ error: "유효하지 않은 로그인 세션입니다." }, 401);

    const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
    if (delErr) return json({ error: "탈퇴 처리 실패: " + delErr.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "탈퇴 처리 오류", detail: String(e) }, 500);
  }
});
