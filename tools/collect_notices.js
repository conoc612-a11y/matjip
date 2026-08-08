// SH(서울주택도시개발공사) 공고 RSS → notices.json 생성
//
// 왜: land.html의 '정비 관련 새 소식' 피드용. RSS는 EUC-KR 인코딩이라 그대로 내려받으면
//   한글이 깨지고, 브라우저 CORS 때문에 GitHub Pages에서 직접 fetch 할 수 없다.
//   → 이 스크립트가 정적 JSON(notices.json)을 만들어 두면 같은 출처에서 바로 읽는다.
//   청약 배지가 (키가 필요한) Edge Function을 쓰는 것과 달리, 공개 RSS는 키가 없어
//   서버 중계 없이 정적 파일 수집으로 충분하다.
//
// 실행: node tools/collect_notices.js  (재실행하면 다시 수집해 덮어씀)
// 갱신: 구역이 바뀔 때처럼 주기적으로 실행하거나 GitHub Actions cron으로 예약.
// 주의: 피드에 없는 내용을 임의로 넣지 않는다 — 여기서는 제목만 정규화할 뿐.

const fs = require('fs');
const path = require('path');

const FEEDS = [
  // 서울주택도시개발공사 공고 및 공지 (실측: 2026-08-08 정상 응답, 29건, RSS 2.0 / EUC-KR)
  { url: 'https://www.i-sh.co.kr/main/lay2/program/S1T294C295/www/rss/rssNoticeWrite.do', name: 'SH공사 공고' },
];

async function fetchFeed(feed) {
  const res = await fetch(feed.url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const buf = await res.arrayBuffer();
  const xml = new TextDecoder('euc-kr').decode(buf);
  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const s = m[1];
    const tag = (t) => {
      const g = s.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>', 'i'));
      return g ? g[1].trim() : '';
    };
    const title = tag('title').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
    const link = tag('link').trim();
    const dateRaw = tag('pubDate');
    const date = dateRaw ? new Date(dateRaw).toISOString().slice(0, 10) : '';
    if (title && link) items.push({ title, link, date, source: feed.name });
  }
  return items;
}

(async () => {
  const all = [];
  for (const f of FEEDS) {
    try {
      const items = await fetchFeed(f);
      all.push(...items);
      console.log('피드:', f.name, items.length, '건');
    } catch (e) {
      console.warn('피드 실패:', f.url, '—', e.message);
    }
  }
  all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const seen = new Set();
  const out = all.filter((it) => (seen.has(it.title) ? false : (seen.add(it.title), true))).slice(0, 30);
  fs.writeFileSync(path.join(__dirname, '..', 'notices.json'), JSON.stringify({ fetched: new Date().toISOString(), items: out }, null, 1));
  console.log('저장: notices.json', out.length, '건');
})().catch((e) => { console.error('실패:', e); process.exit(1); });
