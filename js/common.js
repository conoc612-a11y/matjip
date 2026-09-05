// 공용 상수·유틸 — 모든 페이지가 먼저 로드 (js/common.js)
// 왜 한 곳인가: SUPABASE_URL/KEY·ODSAY·VWORLD·$·esc 는 6개 페이지에서 각자 복붙돼
// 있었다. 키 정책(`AGENTS.md` 규칙 7)대로 **프론트 허용 발행키만** 여기 있다.
//
// 🔴 여기 있는 키는 **노출 사고가 아니다.** 넷 다 방어 수단이 도메인 잠금이라
//    서버로 빼도 얻는 것이 없다. 옮기지 마라. (예전 참조 `TROUBLESHOOTING §9` 는
//    문서가 사라져 끊겨 있었고, 그래서 여러 AI 가 매번 '키 노출' 로 잘못 보고했다
//    — 2026-09-05 사용자 지적으로 규칙 7 에 허용 목록을 되살렸다.)
//    ⛔ 서버 전용 키(MOLIT_KEY·NTS_API_KEY 등)를 여기 추가하지 마라 — 그건 진짜 사고다.
//
// ⚠️ **아래 const 네 줄은 주석 한 글자도 고치지 마라.** 전역 pre-commit 훅은
//    diff 의 **추가된 줄만** 정규식으로 훑는데, 그 훅에는 저장소별 예외가 없다
//    (`.gitleaks.toml` 의 allowlist 와 별개다). 줄을 건드리는 순간 새 줄로 취급돼
//    커밋이 막힌다(2026-09-05 실측). 설명할 것이 있으면 **여기 머리말에** 적어라.
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
