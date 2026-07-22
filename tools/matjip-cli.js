// 맛집 추천 CLI — 스킬이 대신 호출한다.
//   node tools/matjip-cli.js list
//   node tools/matjip-cli.js recommend --spicy 4 --flavors 매콤,단짠 --situations 회식 [--limit 5]
const { recommend, fetchRestaurants } = require('./recommend');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };

(async () => {
  try {
    if (cmd === 'list') {
      const rs = await fetchRestaurants();
      rs.forEach((r) => console.log(`${r.id}. ${r.name} [${(r.tags || []).join(',')}] (${r.category})`));
      return;
    }
    if (cmd === 'recommend') {
      const taste = {
        spicy_level: Number(opt('spicy', 2)),
        flavor_tags: (opt('flavors', '') || '').split(',').filter(Boolean),
        situation_tags: (opt('situations', '') || '').split(',').filter(Boolean),
      };
      const recs = await recommend(taste, Number(opt('limit', 5)));
      console.log(`취향: 매운맛${taste.spicy_level} · 맛[${taste.flavor_tags.join(',')}] · 상황[${taste.situation_tags.join(',')}]`);
      recs.forEach((r) => console.log(`${r.score}점  ${r.name}  [${(r.tags || []).join(',')}]${r.hits.length ? '  ← ' + r.hits.join(',') : ''}`));
      return;
    }
    console.log('명령: list | recommend --spicy <0-5> --flavors 매콤,단짠 --situations 회식 [--limit 5]');
  } catch (e) {
    console.error('오류:', e.message);
    process.exit(1);
  }
})();
