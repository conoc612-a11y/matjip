#!/usr/bin/env node
/**
 * 정비구역 진행현황(추진경과 타임라인) 수집기 — 서울시 정비사업 정보몽땅(cleanup.seoul.go.kr)
 *
 * 사용법:  node tools/collect_prtnelapse.js
 *
 * 동작:
 *   1. 정보몽땅 사업장 목록(lsubBsnsSttus.do, 1,147건) 수집
 *   2. redevelop_seoul.json 구역과 자치구+이름 정규화 매칭 (조합/재건축 등 접미사 무시)
 *   3. 매칭 구역의 cafeUrl → mainIndx.do에서 cafeId+bsnsPk 추출
 *   4. 추진경과 vscr.do에서 단계별 첫 날짜 파싱 → {name, date} 타임라인
 *   5. redevelop_seoul.json 행에 tl 필드 추가 후 저장 (없는 구역은 그대로)
 *
 * WHY: 재개발닷컴처럼 "추진위승인 → 정비구역지정 → 조합설립인가 → ..." 단계별 날짜를
 *      land.html 팝업에 표기하기 위함. UPIS(collect_redevelop.js)는 현재 단계만 제공하므로
 *      정보몽땅 추진경과를 별도 수집한다.
 *
 * 제약: 정보몽땅은 조합/추진위가 설립된 사업장만 다룸 → 모아타운·역세권 등은 미매칭(13%).
 *       매칭되는 구역만 tl이 붙는다.
 */

const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '..');
const LIST_URL = 'https://cleanup.seoul.go.kr/cleanup/bsnssttus/lsubBsnsSttus.do';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getList() {
  const all = [];
  for (let cpage = 1; cpage <= 200; cpage++) {
    const r = await fetch(LIST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `cpage=${cpage}&pageSize=100`,
    });
    const html = await r.text();
    const rows = [];
    const trRe = /<tr>([\s\S]*?)<\/tr>/g;
    let m;
    while ((m = trRe.exec(html))) {
      const tr = m[1];
      if (!tr.includes('wordBreakAll')) continue;
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) =>
        c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      );
      const cafe = (tr.match(/cafeOpenPopup\('([^']+)'\)/) || [])[1] || '';
      if (cells.length >= 6 && cafe) {
        rows.push({ gu: cells[1], kind: cells[2], name: cells[3], stage: cells[5], cafe });
      }
    }
    if (!rows.length) break;
    all.push(...rows);
    console.log('목록', cpage + 'p:', rows.length + '건 / 누적', all.length);
    cpage % 5 === 0 && await sleep(200);
  }
  return all;
}

const norm = (s) => String(s || '').replace(/[\s,·()「」()（）/\\\-]/g, '').toLowerCase();
const DROP = [
  '주택재건축정비', '재건축정비', '재건축사업', '재건축', '주택재개발정비', '재개발정비', '재개발사업',
  '재개발', '정비사업', '가로주택정비', '가로주택', '소규모재건축', '소규모재개발', '모아타운',
  '주택정비', '주택재건축', '주택재개발', '역세권활성화사업', '역세권활성화', '정비구역',
  '도시환경정비', '주거환경개선', '특별계획구역', '아파트지구', '활성화사업', '관리계획',
  '정비계획수립', '정비계획', '정비', '사업', '조합', '추진위원회', '추진위', '주민대표회의',
  '아파트', '주택', '주공', '일대', '일원', '번지',
];
const core = (s) => {
  let t = norm(s);
  let prev = '';
  while (prev !== t) { prev = t; for (const d of DROP) t = t.split(d).join(''); }
  return t;
};

async function resolveCafe(cafeUrl) {
  const r = await fetch('https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=' + cafeUrl);
  const t = await r.text();
  const cafeId = (t.match(/name="cafeId" value="([^"]+)"/) || [])[1]
    || (t.match(/cafeId=([^&"' ]+)/) || [])[1] || '';
  const bsnsPk = (t.match(/bsnsPk[=:]([^&"' ]+)/) || [])[1] || '';
  return { cafeId, bsnsPk };
}

async function fetchTimeline(cafeId, bsnsPk) {
  const r = await fetch(`https://cleanup.seoul.go.kr/cafe/mainIndx/cleanup-prtnelapse/vscr.do?bsnsPk=${bsnsPk}&cafeId=${cafeId}`);
  const t = await r.text();
  const clean = (s) => s.replace(/<[^>]+>/g, ' ').replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tl = [];
  const liRe = /<li class="foldings-li[^"]*">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(t))) {
    const blk = m[1];
    const name = clean((blk.match(/<span>\s*([\s\S]*?)\s*<\/span>/) || ['', ''])[1]);
    if (!name) continue;
    const first = (blk.match(/<h3 class="tit">\s*([\s\S]*?)\s*<\/h3>/) || [])[1];
    if (!first) continue;
    const date = clean(first).replace(/[^0-9-]/g, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) tl.push({ name, date });
  }
  return tl;
}

async function main() {
  console.log('1. 정보몽땅 사업장 목록 수집...');
  const list = await getList();
  console.log('   목록:', list.length, '건');

  console.log('2. redevelop_seoul.json 로드...');
  const rowsPath = path.join(OUT_DIR, 'redevelop_seoul.json');
  const rows = JSON.parse(fs.readFileSync(rowsPath, 'utf8'));

  // 정보몽땅 core-key 인덱스
  const clByCore = new Map();
  for (const c of list) {
    const k = norm(c.gu) + '|' + core(c.name);
    if (!clByCore.has(k)) clByCore.set(k, []);
    clByCore.get(k).push(c);
  }

  // 매칭 대상 목록
  const targets = [];
  for (const z of rows) {
    const hits = clByCore.get(norm(z.gu) + '|' + core(z.name)) || [];
    if (hits.length) targets.push({ row: z, cafe: hits[0].cafe });
  }
  console.log('3. 매칭:', targets.length, '/', rows.length);

  let done = 0, got = 0, failed = 0;
  for (const { row, cafe } of targets) {
    try {
      const { cafeId, bsnsPk } = await resolveCafe(cafe);
      if (!cafeId || !bsnsPk) throw new Error('cafeId/bsnsPk 없음');
      const tl = await fetchTimeline(cafeId, bsnsPk);
      if (tl.length) {
        row.tl = tl;
        got++;
      }
    } catch (e) {
      failed++;
      console.log('   실패:', row.gu, row.name, '—', e.message);
    }
    done++;
    if (done % 25 === 0) console.log('   진행', done, '/', targets.length, '(tl:', got, ', 실패:', failed, ')');
    await sleep(150);
  }
  console.log('4. 저장...');
  fs.writeFileSync(rowsPath, JSON.stringify(rows));
  console.log('완료: tl 확보', got, '건 / 실패', failed, '건');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
