// 관리자 회원 탈퇴 — Supabase Edge Function (Deno)
//
// admin-login에서 받은 세션 토큰을 검증한 뒤 지정한 회원(auth.users)을 삭제한다.
// auth.users를 지우면 FK `on delete cascade`로 profiles/taste_profiles/
// saved_restaurants/feedbacks/visits 가 전부 함께 삭제된다 (delete-account와 동일).
//
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-delete-user
//   Authorization: Bearer <admin-login이 발급한 토큰>
//   { "user_id": "..." }

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "로그인이 필요합니다." }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "서버 설정 오류" }, 500);

  let userId = "";
  try {
    const body = await req.json();
    userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!userId) return json({ error: "user_id가 필요합니다." }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 관리자 세션 검증 (admin-data와 동일한 방식)
  const { data: sess, error: sessErr } = await admin.from("admin_sessions")
    .select("expires_at").eq("token_hash", await sha256hex(token)).maybeSingle();
  if (sessErr || !sess || new Date(sess.expires_at).getTime() < Date.now()) {
    return json({ error: "세션이 만료되었습니다. 다시 로그인하세요." }, 401);
  }

  try {
    const { error: delErr } = await admin.auth.admin.deleteUser(userId);
    if (delErr) return json({ error: "탈퇴 처리 실패: " + delErr.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return json({ error: "탈퇴 처리 오류", detail: String(e) }, 500);
  }
});
