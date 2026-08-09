// 신규 회원 가입 알림 — Supabase Edge Function (Deno)
//
// profiles 에 새 행이 INSERT 되면(pg_net 트리거) 이 함수를 POST 로 호출하고,
// 네이버 SMTP(앱 비밀번호)로 관리자 이메일을 보낸다.
// 함수 URL은 공개(--no-verify-jwt)이므로 x-notify-secret 헤더로 호출자를 검증한다.
// 시크릿(비밀번호 등)은 env 에만 두고 소스·DB·리포 어디에도 평문 저장하지 않는다.
//
// ── 배포 방법 ─────────────────────────────────────────────
//   supabase secrets set ADMIN_NOTIFY_SECRET=<랜덤> NAVER_SMTP_USER=conoc \
//     NAVER_SMTP_PASS=<앱비밀번호> NAVER_SMTP_FROM=conoc@naver.com NOTIFY_TO=conoc@naver.com
//   supabase functions deploy admin-notify --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
// 호출:
//   POST https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-notify
//   header: x-notify-secret: <ADMIN_NOTIFY_SECRET>
//   body: { email: "x@y.com", name: "홍길동" }

import nodemailer from "npm:nodemailer@6";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, x-notify-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST만 허용합니다." }, 405);

  const secret = Deno.env.get("ADMIN_NOTIFY_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) {
    return json({ error: "인증 실패" }, 401);
  }

  const { email, name } = await req.json().catch(() => ({})) as { email?: string; name?: string };
  const smtpUser = Deno.env.get("NAVER_SMTP_USER");
  const smtpPass = Deno.env.get("NAVER_SMTP_PASS");
  const smtpFrom = Deno.env.get("NAVER_SMTP_FROM") || "conoc@naver.com";
  const to = Deno.env.get("NOTIFY_TO") || "conoc@naver.com";
  if (!smtpUser || !smtpPass) return json({ error: "SMTP 설정 오류" }, 500);

  const kst = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const text =
    `새 회원이 가입했습니다.\n\n` +
    `이메일: ${email || "-"}\n` +
    `이름: ${name || "-"}\n` +
    `가입 시각(KST): ${kst}\n`;

  try {
    const t = nodemailer.createTransport({
      host: "smtp.naver.com",
      port: 465,
      secure: true,
      auth: { user: smtpUser, pass: smtpPass },
    });
    const info = await t.sendMail({
      from: `"맛집 탐방" <${smtpFrom}>`,
      to,
      subject: "[맛집 탐방] 신규 회원 가입 알림",
      text,
    });
    return json({ ok: true, messageId: info.messageId });
  } catch (e) {
    return json({ error: "메일 발송 실패", detail: String(e) }, 500);
  }
});
