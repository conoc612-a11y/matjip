// browser 전용 — <script src="js/recommend.js"> 로 포함
// taste 객체별로 Set을 1회만 생성 (1,300곳 스코어링 반복 시 성능)
const _tasteCache = new WeakMap();
window.score = function score(r, taste) {
  if (!taste) return { score: 0, hits: [] };
  let want = _tasteCache.get(taste);
  if (!want) { want = new Set([...(taste.flavor_tags || []), ...(taste.situation_tags || [])]); _tasteCache.set(taste, want); }
  const hits = [];
  let s = 0;
  (r.tags || []).forEach(function (t) { if (want.has(t)) { s += 2; hits.push(t); } });
  const sp = taste.spicy_level ?? 2;
  if (sp >= 3 && (r.tags || []).includes('매콤') && !hits.includes('매콤')) { s += 2; hits.push('매콤'); }
  if (sp <= 1 && (r.tags || []).includes('담백') && !hits.includes('담백')) { s += 2; hits.push('담백'); }
  return { score: s, hits };
};

window.fetchAndRecommend = async function fetchAndRecommend(sb, taste, limit) {
  if (limit === undefined) limit = 5;
  const { data } = await sb.from('mj_restaurants').select('*');
  return (data || []).map(function (r) { return Object.assign({}, r, window.score(r, taste)); })
    .sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); })
    .slice(0, limit);
};
