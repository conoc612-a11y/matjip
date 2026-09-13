// 로그인 세션 기록 — D1 공개 미리보기(2026-09-13)부터 리다이렉트하지 않는다.
// 비로그인도 land.html을 그대로 본다. 로그인이 필요한 동작(경매 상세·관심 동기화)은
// 각 호출부에서 토스트 후 중단한다. 로그인 후에는 최종 접속 시각을 기록한다.
(async () => {
  const SUPABASE_URL = 'https://bhgijvaxxjnocgfnaaeu.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rYaGd3kk5UuFBe3TSpFA8g_uGHWwkqM';
  const sb = await new Promise((resolve) => {
    if (window.supabase) return resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = () => resolve(window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY));
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return; // 비로그인: 내보내지 않는다. 게이트는 각 기능이 맡는다.
  // 실제 접속 시각 기록 — last_sign_in_at은 비밀번호 재로그인 시에만 갱신되므로 별도로 저장.
  sb.from('profiles').update({ last_seen_at: new Date().toISOString() })
    .eq('id', session.user.id).then(() => {}).catch(() => {});
})();
