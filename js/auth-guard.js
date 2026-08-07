// 로그인 필수 게이트 — 로그인 없이 접근하면 onboarding.html(로그인/회원가입)로 보낸다.
// 가입/로그인 후에는 원래 가려던 페이지(next)로 자동 복귀한다.
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
  if (!session) {
    const page = location.pathname.split('/').pop() || 'main.html';
    location.replace('onboarding.html?next=' + encodeURIComponent(page + location.search + location.hash));
  }
})();
