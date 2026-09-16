// 로그인 세션 기록 — D1 공개 미리보기(2026-09-13)부터 리다이렉트하지 않는다.
// 비로그인도 land.html을 그대로 본다. 로그인이 필요한 동작(경매 상세·관심 동기화)은
// 각 호출부에서 토스트 후 중단한다. 로그인 후에는 최종 접속 시각을 기록한다.
(async () => {
  const SUPABASE_URL = 'https://bhgijvaxxjnocgfnaaeu.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_rYaGd3kk5UuFBe3TSpFA8g_uGHWwkqM';
  // 🔴 클라이언트는 **한 페이지에 하나**여야 한다(2026-09-16 콘솔 실측).
  //    land.html 은 이 파일(8행)과 js/common.js(2004행)를 둘 다 싣는데, 각자
  //    createClient 를 불러 **같은 저장소 키로 클라이언트가 둘** 생겼다 —
  //    "Multiple GoTrueClient instances detected ... may produce undefined behavior
  //     when used concurrently under the same storage key" 경고가 그것이다.
  //    이 파일이 먼저 도므로 여기서 만들어 `window.__mjSb` 에 걸어 두고,
  //    ensureSb(common.js)가 그것을 재사용한다. ⛔ 양쪽에서 따로 만들지 마라.
  const mk = () => (window.__mjSb || (window.__mjSb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY)));
  const sb = await new Promise((resolve) => {
    if (window.supabase) return resolve(mk());
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.onload = () => resolve(mk());
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
