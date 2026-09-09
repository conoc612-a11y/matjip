// 푸터 통계 — 회원수 = member_count() RPC(security definer, 개인정보 미노출),
// 방문자 = visit-count Edge Function(같은 IP 하루 1회 집계, x-forwarded-for 사용).
// Edge Function 미배포/미설정 시 조용히 넘어가고 '—'로 남는다.
// 왜 공용인가: main.js·land.html 에 각자 중복 구현돼 있던 것을 한 곳으로 모은 것 (2026-08-12).
async function loadFooterStats(page) {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.textContent = Number(v).toLocaleString(); };
  const s = await ensureSb();
  if (!s) return;
  try {
    const { data: m, error: mErr } = await s.rpc('member_count');
    if (!mErr) set('f-members', Number(m));
  } catch (e) {}
  try {
    let hdr = {};
    try { const s2 = await s.auth.getSession(); if (s2.data.session) hdr = { Authorization: 'Bearer ' + s2.data.session.access_token }; } catch (e) {}
    const v = await (await fetch(SUPABASE_URL + '/functions/v1/visit-count?page=' + page, { headers: hdr })).json();
    set('f-today', v.today);
    set('f-total', v.total);
  } catch (e) {}
}
