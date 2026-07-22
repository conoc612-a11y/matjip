// 공유 추천 로직 + Supabase 조회 (Node, 의존성 0). CLI·MCP가 함께 사용.
const BASE = process.env.SUPABASE_URL || 'https://bhgijvaxxjnocgfnaaeu.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_rYaGd3kk5UuFBe3TSpFA8g_uGHWwkqM';

async function fetchRestaurants() {
  const res = await fetch(`${BASE}/rest/v1/mj_restaurants?select=*`,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + (await res.text()));
  return res.json();
}

// 규칙기반 점수: 취향 태그 겹침 ×2 + 매운맛 보정
function score(r, taste) {
  const want = new Set([...(taste.flavor_tags || []), ...(taste.situation_tags || [])]);
  const hits = [];
  let s = 0;
  (r.tags || []).forEach((t) => { if (want.has(t)) { s += 2; hits.push(t); } });
  const sp = taste.spicy_level ?? 2;
  if (sp >= 3 && (r.tags || []).includes('매콤') && !hits.includes('매콤')) { s += 2; hits.push('매콤'); }
  if (sp <= 1 && (r.tags || []).includes('담백') && !hits.includes('담백')) { s += 2; hits.push('담백'); }
  return { score: s, hits };
}

async function recommend(taste, limit = 5) {
  const rs = await fetchRestaurants();
  return rs.map((r) => ({ ...r, ...score(r, taste) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
}

module.exports = { fetchRestaurants, score, recommend };
