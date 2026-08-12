// 공용 상수·유틸 — 모든 페이지가 먼저 로드 (js/common.js)
// 왜 한 곳인가: SUPABASE_URL/KEY·ODSAY·VWORLD·$·esc 는 6개 페이지에서 각자 복붙돼
// 있었다. 키 정책(TROUBLESHOOTING §9)대로 프론트 허용 발행키만 여기 있다.
const SUPABASE_URL = 'https://bhgijvaxxjnocgfnaaeu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rYaGd3kk5UuFBe3TSpFA8g_uGHWwkqM';
const ODSAY_KEY = 'H4Vo/z04g/E+AUShnTQIiQ'; // ODsay 대중교통(웹 도메인 잠금 키 → 프론트 노출 안전)
const VWORLD_KEY = 'B2CDEEDD-D622-311B-883B-CC7890E50822'; // V-World 지도
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// 지연 supabase 클라이언트 — 첫 사용 시 SDK 를 로드하고 1회 재사용.
// land.html 은 초기 지도 렌더와 무관하므로(푸터 통계·로그아웃 전용) 이 패턴을 쓴다.
let _sb = null;
let _sbPromise = null;
function ensureSb() {
  if (_sbPromise) return _sbPromise;
  if (window.supabase) { _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); _sbPromise = Promise.resolve(_sb); return _sbPromise; }
  _sbPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    s.async = true;
    s.onload = () => { try { _sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch (e) { _sb = null; } resolve(_sb); };
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
  return _sbPromise;
}
