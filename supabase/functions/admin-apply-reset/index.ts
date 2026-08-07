// 관리자 비밀번호 변경 적용 — Supabase Edge Function (Deno)
//
// admin-request-reset이 이메일로 보낸 링크의 토큰을 검증한 뒤에만
// ADMIN_PASSWORD secret을 새 비밀번호로 교체한다 (Management API 사용).
//
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-apply-reset
//   { "token": "...", "new_password": "..." }

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

const MIN_PW = 6;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const newPw = typeof body.new_password === "string" ? body.new_password : "";
  if (!token) return json({ error: "인증 토큰이 필요합니다." }, 400);
  if (newPw.length < MIN_PW) return json({ error: `새 비밀번호는 ${MIN_PW}자 이상이어야 합니다.` }, 400);

  const mgmtToken = Deno.env.get("ADMIN_MGMT_TOKEN");
  const suUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!mgmtToken || !suUrl || !serviceKey) return json({ error: "서버 설정 오류" }, 500);

  const ref = (suUrl.replace("https://", "").split(".")[0] || "").trim();
  const admin = createClient(suUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const hash = await sha256hex(token);
  const { data: row, error: selErr } = await admin.from("admin_reset_tokens")
    .select("*").eq("token_hash", hash).maybeSingle();
  if (selErr || !row) return json({ error: "유효하지 않은 인증 토큰입니다." }, 400);
  if (row.used_at) return json({ error: "이미 사용된 인증 토큰입니다." }, 400);
  if (new Date(row.expires_at).getTime() < Date.now()) return json({ error: "인증 토큰이 만료되었습니다. 다시 요청해 주세요." }, 400);

  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
    method: "POST",
    headers: { "Authorization": "Bearer " + mgmtToken, "content-type": "application/json" },
    body: JSON.stringify([{ name: "ADMIN_PASSWORD", value: newPw }]),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    return json({ error: "비밀번호 적용 실패: " + (j.message || res.status) }, 502);
  }

  await admin.from("admin_reset_tokens").update({ used_at: new Date().toISOString() }).eq("token_hash", hash);
  return json({ ok: true });
});
