// 관리자 비밀번호 변경 요청 — Supabase Edge Function (Deno)
//
// 관리자 비밀번호 변경 시 백업 이메일(ADMIN_BACKUP_EMAIL)로 인증 메일
// (30분 유효 링크)을 발송한다. 링크의 토큰은 admin_apply_reset에서
// 검증된 뒤에만 관리자 비밀번호(ADMIN_PASSWORD secret)가 바뀐다.
// (메인 ADMIN_EMAIL 발송은 Resend 도메인 인증 후에 추가한다 — ponytail: domain needed)
//
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-request-reset

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

const SITE = "https://conoc612-a11y.github.io/matjip/admin.html";
const RESET_MIN = 30;
const MIN_GAP_MIN = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const adminEmail = Deno.env.get("ADMIN_EMAIL");
  const backupEmail = Deno.env.get("ADMIN_BACKUP_EMAIL");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const resendFrom = Deno.env.get("RESEND_FROM") || "onboarding@resend.dev";
  const suUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!adminEmail || !backupEmail || !resendKey || !suUrl || !serviceKey) {
    return json({ error: "서버 설정 오류" }, 500);
  }

  const admin = createClient(suUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 진행 중인 요청이 있으면 거부 (토큰 1개만 활성 → 메일 폭탄 방지)
  const { count } = await admin.from("admin_reset_tokens")
    .select("*", { count: "exact", head: true }).gt("expires_at", new Date().toISOString());
  if ((count ?? 0) > 0) {
    return json({ error: `이미 진행 중인 요청이 있습니다. ${MIN_GAP_MIN}분 후 다시 시도하거나 메일을 확인하세요.` }, 429);
  }

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + RESET_MIN * 60e3).toISOString();
  const { error: insErr } = await admin.from("admin_reset_tokens").insert({
    token_hash: await sha256hex(token), expires_at: expiresAt,
  });
  if (insErr) return json({ error: "요청 처리 실패", detail: insErr.message }, 500);

  const link = `${SITE}?reset=${token}`;
  const subject = "[맛집 관리자] 비밀번호 변경 인증";
  const html = `
    <div style="font-family:Malgun Gothic,sans-serif;max-width:480px;margin:0 auto;">
      <h2 style="color:#1a2332;">관리자 비밀번호 변경 인증</h2>
      <p>관리자 비밀번호 변경이 요청되었습니다. 아래 버튼을 누르면 새 비밀번호를 설정할 수 있습니다.</p>
      <p style="margin:24px 0;">
        <a href="${link}" style="display:inline-block;background:#4da3ff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;">비밀번호 변경하기</a>
      </p>
      <p style="color:#8b9bb4;font-size:12px;">본 링크는 30분 동안 유효합니다. 요청하지 않으셨다면 이 메일을 무시해 주세요.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + resendKey, "content-type": "application/json" },
    // Resend 무료 모드: 자기 이메일(백업)로만 발송 가능 — 도메인 인증 전까지 메인은 제외
    body: JSON.stringify({ from: resendFrom, to: [backupEmail], subject, html }),
  });
  const resBody = await res.json().catch(() => ({}));

  if (!res.ok) {
    await admin.from("admin_reset_tokens").delete().eq("token_hash", await sha256hex(token));
    return json({ error: "메일 발송 실패: " + (resBody.message || res.status) }, 502);
  }

  return json({ ok: true, sent_to: [backupEmail] });
});
