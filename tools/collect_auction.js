#!/usr/bin/env node
/**
 * 법원경매정보(courtauction.go.kr) 경매 물건 수집기 (서울+경기)
 *
 * 사용법:  node tools/collect_auction.js [--sched] [--court 서울중앙] [--headful]
 *   --sched    매각예정물건(PGJ157M00) 수집 → auction_sched.json. 기본은 진행중(PGJ151F00) → auction.json
 *   --court    특정 법원만 수집 (전체 실행 전 점검용). 예: --court 서울중앙
 *   --headful  브라우저를 띄워 과정 확인
 *
 * 산출물:   auction.json (진행중, kind=0) / auction_sched.json (매각예정, kind=1)
 *          — 압축 배열 포맷 (realprice_villa.json 과 같은 구조)
 *
 * 왜 이 구조인가 (실측 근거)
 *  - courtauction.go.kr 은 WebSquare5 SPA라 목록 API 를 직접 POST 로 부르면
 *    "DB에서 자료를 불러오는 중 파라미터가 없습니다" 를 뱉는다. 검색 버튼도
 *    JS el.click() (isTrusted=false) 를 거부한다. 그래서 실제 마우스 이벤트를
 *    보내는 브라우저 자동화(playwright-core)로 화면을 조작해야 한다.
 *  - 화면 분담 (2026-08-09 실측): 물건상세검색 PGJ151F00 = 매각기일 오늘~+2주,
 *    매각예정물건 PGJ157M00 = 예정매각기간 기본 오늘~+2개월(실측 2026.08.24~10.08).
 *    auction.json 2,949건의 매각기일이 전부 2026.08.10~08.21 인 게 두 화면 분담을 확증 —
 *    예정 수집분은 진행중과 사실상 안 겹치는 신규 물건이다.
 *  - PGJ157 의 결과 그리드는 PGJ151 과 동일한 rowspan 2단 구조(실측)라 EXTRACT_JS 재사용.
 *  - 사이트의 총 N건은 일괄매각 필지 행까지 센 값이라 물건 수와 어긋나고,
 *    법원별 페이지를 순회해 행이 없어질 때까지 돌면 누락이 없다.
 *
 * IP 차단 주의: 사이트가 공지한 대로 폭주 시 차단된다. 요청 사이 최소 1초 대기.
 * PGJ157 화면은 재방문 로드가 비결정적(가끔 빈 화면) — 법원 셀렉트가 뜰 때까지 폴링 후
 * 그래도 안 뜨면 재로드한다. 반복 요청이 쌓이면 차단되므로 실패 시 즉시 재시도 금지.
 * (오픈소스 검증: BYM117/court-auction-crawler 가 같은 화면·셀렉터·rowspan 처리 사용)
 */

const { chromium } = require('playwright-core');
const https = require('https');
const fs = require('fs');
const path = require('path');

// 로컬(Windows)엔 설치된 Chrome 경로를 찾아 쓰고, 못 찾으면(예: GitHub Actions의 Linux
// 러너) undefined를 넘겨 playwright-core가 자기 번들 브라우저(npx playwright install
// chromium으로 받은 것)를 쓰게 한다. 예전엔 여기서 항상 Windows 경로로 폴백해서 CI에서
// 존재하지도 않는 파일을 executablePath로 넘겨 실행 자체가 실패했다.
const CHROME = process.env.CHROME_PATH
  || [process.env.PROGRAMFILES, `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}`, process.env.LOCALAPPDATA]
    .map((p) => p && path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find((p) => p && fs.existsSync(p));

const VWORLD_KEY = process.env.VWORLD_KEY || 'B2CDEEDD-D622-311B-883B-CC7890E50822';
const OUT_DIR = path.resolve(__dirname, '..');
const CKPT = path.join(__dirname, '.geocache.json');

// 서울 + 경기 법원. 인천지방법원 본원은 지역이 인천광역시라 제외, 부천지원은 경기도라 포함.
const COURT_FILTER = ['서울', '수원', '성남', '안산', '안양', '평택', '여주', '의정부', '고양', '부천'];
const ONLY_COURT = process.argv.includes('--court') ? process.argv[process.argv.indexOf('--court') + 1] : '';
const HEADFUL = process.argv.includes('--headful');
const REGEO = process.argv.includes('--regeo');
const GAP_MS = 1000;

// 화면 분담 (2026-08-09 실측): PGJ151=오늘~+2주, PGJ157=기본 오늘~+2개월. 그리드 구조 동일.
const MODE_SCHED = process.argv.includes('--sched');
const CONF = MODE_SCHED ? {
  url: 'https://www.courtauction.go.kr/pgj/index.on?w2xPath=' + encodeURIComponent('/pgj/ui/pgj100/PGJ157M00.xml'),
  courtSel: '#mf_wfm_mainFrame_sbx_dspslSchdGdsCortOfc',
  btnSel: '#mf_wfm_mainFrame_btn_dspslSchdGdsSrch',
  kind: 1,
  out: path.join(OUT_DIR, 'auction_sched.json'),
} : {
  url: 'https://www.courtauction.go.kr/pgj/index.on?w2xPath=' + encodeURIComponent('/pgj/ui/pgj100/PGJ151F00.xml'),
  courtSel: '#mf_wfm_mainFrame_sbx_rletCortOfc',
  btnSel: '#mf_wfm_mainFrame_btn_gdsDtlSrch',
  kind: 0,
  out: path.join(OUT_DIR, 'auction.json'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// PGJ157 은 재방문 로드가 비결정적(2026-08-09 실측: 가끔 빈 화면) — 법원 셀렉트가
// 뜰 때까지 폴링하고, 그래도 안 뜨면 재로드한다. 실패를 반복하면 IP 차단이므로
// 실행이 아니라 '스크립트 보수' 차원의 최대 3회 재시도까지만 한다.
async function openScreen(page, url, courtSel) {
  const sel = courtSel.replace('#', '');
  for (let attempt = 0; attempt < 3; attempt++) {
    // goto 자체가 타임아웃으로 throw 한다. 안 잡으면 법원 13곳을 도는 도중 1건만 실패해도
    // 프로세스가 통째로 죽어 그때까지 모은 수집분이 전부 날아간다(collect_auction_photos.js
    // 에서 실제로 116/2323 지점에서 겪은 사고 — 거기선 고쳤는데 여기엔 안 옮겨져 있었다.
    // 2026-08-14 코드리뷰로 발견. 이 스크립트는 매일 07:00 CI 가 돌리므로 특히 중요).
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (e) {
      console.log(`  페이지 이동 실패(${attempt + 1}/3): ${String(e.message || e).split('\n')[0]}`);
      // 실패 직후 즉시 재시도하면 차단을 부른다(§6-11) — 간격을 두고 다시 시도.
      await sleep(GAP_MS);
      continue;
    }
    let ok = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      ok = await page.evaluate((s) => !!document.querySelector(s), sel).catch(() => false);
      if (ok) break;
    }
    if (ok) break;
    console.log(`  화면 로드 실패 → 재시도 (${attempt + 1}/3)`);
  }
  await page.waitForTimeout(1500);
}

// ── V-World 지오코딩 (collect_realprice.js 와 동일한 캐시 공유) ──
const geoCache = new Map();
try {
  if (fs.existsSync(CKPT)) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(CKPT, 'utf8')))) geoCache.set(k, v);
    console.log(`좌표 캐시 ${geoCache.size.toLocaleString()}건 복원`);
  }
} catch (e) {}

function httpGet(url, tries = 3) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      let settled = false;
      const deadline = setTimeout(() => settled || (settled = true, resolve('')), 15000);
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36' } }, (res) => {
        res.setEncoding('utf8');
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => { clearTimeout(deadline); if (settled) return; settled = true; if (res.statusCode === 200 && d) resolve(d); else if (n < tries) setTimeout(() => attempt(n + 1), 400 * n); else resolve(''); });
        res.on('error', () => { clearTimeout(deadline); if (settled) return; settled = true; if (n < tries) setTimeout(() => attempt(n + 1), 400 * n); else resolve(''); });
      });
      req.on('error', () => { clearTimeout(deadline); if (settled) return; settled = true; if (n < tries) setTimeout(() => attempt(n + 1), 400 * n); else resolve(''); });
    };
    attempt(1);
  });
}

// 경매 소재지는 '남현7길 51 5층502호' 처럼 층/호가 붙는다. VWorld 지오코더는 이 상세를
// 못 매칭하므로 ('층' 이후 + '비동/가동/나동' 류)를 제거해 정제한다.
const cleanAddr = (a) => a
  .replace(/\s*\d+층.*$/, '')
  .replace(/\s*(비?동|[가나다라]동).*$/, '')
  .trim();

async function geocode(addr) {
  // 실패(null) 캐시는 재시도 대상으로 둔다 (지오코딩 규칙 개선 후 재보강 가능).
  if (geoCache.has(addr) && geoCache.get(addr)) return geoCache.get(addr);
  const candidates = [
    [addr, 'PARCEL'],
    [cleanAddr(addr), 'ROAD'],   // 도로명은 PARCEL 로 못 잡는다 (실측: 남현7길 51 실패)
    [cleanAddr(addr), 'PARCEL'], // 지번인데 층/호만 붙은 경우
  ];
  let pt = null;
  for (const [cand, type] of candidates) {
    const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0&crs=EPSG:4326&type=${type}&format=json&key=${VWORLD_KEY}&address=${encodeURIComponent(cand)}`;
    for (let i = 1; i <= 3; i++) {
      const body = await httpGet(url, 1);
      try {
        const j = JSON.parse(body);
        if (j.response.status === 'OK') {
          const p = j.response.result.point;
          pt = [Number(Number(p.y).toFixed(6)), Number(Number(p.x).toFixed(6))];
          break;
        }
        if (j.response.status === 'NOT_FOUND') break;
      } catch (e) {}
      await sleep(300 * i);
    }
    if (pt) break;
  }
  geoCache.set(addr, pt);
  try { fs.writeFileSync(CKPT, JSON.stringify(Object.fromEntries(geoCache))); } catch (e) {}
  return pt;
}

// ── 경매 화면 조작 ──
// 결과 테이블 (PGJ151F01, 2026-08-09 실측 열 구조 — 헤더 2줄):
//   R0: 전체|사건번호|물건번호|소재지 및 내역(cs2)|비고|감정평가액|담당계 매각기일(입찰기간)
//   R1:                                     |용도|최저매각가격|진행상태
//   데이터 행은 물건행(사건번호~담당계) + 상세행(용도~진행상태) 2줄짜리. rowspan 으로
//   사건번호/감정평가액 등이 이월된다. 물건번호가 있는 행만 수집하고, 일괄매각 추가
//   필지 행(물건번호 이월값)은 걸러진다.
// 주의: playwright evaluate 는 문자열을 표현식으로 eval 하므로 즉시실행 형태여야 한다.
// (함수 표현식으로만 두면 함수 객체를 반환해 직렬화 불가 → undefined)
const EXTRACT_JS = `
(() => {
  const clean = (v) => (v || '').replace(/\\s+/g, ' ').trim();
  const table = [...document.querySelectorAll('table')]
    .find((t) => { const x = clean(t.innerText); return x.includes('사건번호') && x.includes('최저매각가격') && x.includes('진행상태'); });
  if (!table) return [];
  const pending = [], grid = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('th,td')];
    if (!cells.length) continue;
    const texts = [], fresh = [], links = [];
    let col = 0;
    const absorb = () => { while (pending[col] && pending[col].r > 0) { texts[col] = pending[col].t; fresh[col] = false; links[col] = pending[col].l; pending[col].r -= 1; col += 1; } };
    for (const cell of cells) {
      absorb();
      const rs = parseInt(cell.getAttribute('rowspan') || '1', 10) || 1;
      const cs = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const t = clean(cell.innerText);
      const link = cell.querySelector('a[href]');
      const href = link ? new URL(link.getAttribute('href'), location.href).href : '';
      for (let c = 0; c < cs; c++) { texts[col] = t; fresh[col] = true; links[col] = href; if (rs > 1) pending[col] = { t, r: rs - 1, l: href }; col += 1; }
    }
    absorb();
    if (texts.some(Boolean)) grid.push({ texts, fresh, links });
  }
  const items = [];
  for (let i = 0; i < grid.length - 1; i++) {
    const a = grid[i];
    if (a.texts[2] && a.fresh[2] && /^\\d+$/.test(a.texts[2].trim())) {
      const b = grid[i + 1];
      const deptDate = a.texts[7] || '';
      const sale = (deptDate.match(/\\d{4}\\.\\d{2}\\.\\d{2}/) || [''])[0];
      // 실측 열 배치 (2026-08-09): 물건행 [전체|사건번호|물건번호|소재지|지도|비고|감정평가액|담당계 매각기일]
      //                             상세행 [  ·  |   ·    |  용도 |  ·   | ·  | ·  | 최저매각가격|진행상태]
      // 사건번호 셀은 링크가 없는 WebSquare5 그리드라 url 은 저장하지 않는다.
      items.push({
        cn: a.texts[1] || '',        // 사건번호
        no: a.texts[2].trim(),       // 물건번호
        addr: (a.texts[3] || '').split('[')[0].split('(')[0].trim(), // 소재지(지번/도로명)
        note: a.texts[5] || '',      // 비고
        appr: a.texts[6] || '',      // 감정평가액
        dept: deptDate.replace(sale, '').trim(), // 담당계
        sale,                        // 매각기일
        use: b.texts[2] || '',       // 용도
        low: b.texts[6] || '',       // 최저매각가격
        status: b.texts[7] || '',    // 진행상태
      });
      i++;
    }
  }
  return items;
})()`;

// "259,840,000 (64%)" 같은 원화 문자열에서 첫 숫자만 만원 단위로. 괄호/단위가 섞여도 안전.
const eok = (v) => { const m = String(v).match(/[\d,]+/); return m ? Math.round(Number(m[0].replace(/,/g, '')) / 10000 * 10) / 10 : 0; };

const SAVE_F = ['kind', 'court', 'cn', 'no', 'addr', 'note', 'appr', 'dept', 'sale', 'use', 'low', 'status', 'lat', 'lng'];

async function saveAuction(items) {
  const courts2 = [];
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const rows = [];
  for (const r of items) {
    const pt = r.addr ? geoCache.get(r.addr) : null;
    rows.push([
      r.kind ?? CONF.kind, idx(courts2, r.court), r.cn, r.no, r.addr, r.note, eok(r.appr), r.dept, r.sale, r.use, eok(r.low), r.status,
      pt ? Number(pt[0].toFixed(5)) : 0, pt ? Number(pt[1].toFixed(5)) : 0,
    ]);
  }
  // ── 빈/축소 결과로 기존 파일을 덮어쓰지 않는다 (2026-08-14 코드리뷰) ──
  // 법원 사이트가 IP 를 차단하거나 그리드 마크업을 바꾸면 추출기가 조용히 []를 돌려주고,
  // 예외 없이 종료코드 0 으로 끝난다. 예전엔 그대로 저장돼 2,949건짜리 파일이 rows:[] 로
  // 바뀔 수 있었고, CI(매일 07:00)가 그 변경을 자동 커밋·푸시했다.
  // 기존 파일 대비 절반 미만이면 사고로 보고 중단한다(모드마다 건수가 다르므로 절대값이
  // 아니라 기존 파일 기준). 진짜로 물건이 반 토막 났다면 --force 로 넘긴다.
  const FORCE = process.argv.includes('--force');
  let prevRows = 0;
  try {
    if (fs.existsSync(CONF.out)) prevRows = (JSON.parse(fs.readFileSync(CONF.out, 'utf8')).rows || []).length;
  } catch (e) { /* 기존 파일이 깨져 있으면 비교 대상 없음으로 취급 */ }
  if (!rows.length) {
    throw new Error(`수집 0건 — 기존 파일(${prevRows.toLocaleString()}건)을 보존하고 중단합니다. 사이트 차단/마크업 변경 의심.`);
  }
  if (prevRows && rows.length < prevRows * 0.5 && !FORCE) {
    throw new Error(`수집 ${rows.length.toLocaleString()}건 — 기존 ${prevRows.toLocaleString()}건의 절반 미만이라 중단합니다. 의도한 변화면 --force 로 실행하세요.`);
  }
  // 원자적 교체: 쓰는 도중 프로세스가 죽어도 기존 파일이 잘린 채 남지 않는다.
  const tmp = CONF.out + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ fields: SAVE_F, courts: courts2, rows }));
  fs.renameSync(tmp, CONF.out);
  console.log(`${MODE_SCHED ? 'auction_sched.json' : 'auction.json'} 저장 — ${rows.length.toLocaleString()}건 / ${(fs.statSync(CONF.out).size / 1024).toFixed(1)}KB`);
}

(async () => {
  // ── 재보강 모드: 기존 JSON 의 좌표 없는 건만 다시 지오코딩 ──
  if (REGEO) {
    const d = JSON.parse(fs.readFileSync(CONF.out, 'utf8'));
    const addrI = d.fields.indexOf('addr'), latI = d.fields.indexOf('lat'), lngI = d.fields.indexOf('lng');
    const targets = [...new Set(d.rows.filter((r) => !r[latI] && !r[lngI]).map((r) => r[addrI]).filter(Boolean))];
    console.log(`재보강: 좌표 없는 주소 ${targets.length}개`);
    let done = 0, hit = 0;
    for (let i = 0; i < targets.length; i += 2) {
      await Promise.all(targets.slice(i, i + 2).map(async (a) => { const pt = await geocode(a); if (pt) hit++; done++; }));
      if (done % 100 === 0) console.log(`  ${done}/${targets.length} · 성공 ${hit}`);
      await sleep(150);
    }
    console.log(`  완료 — ${hit}/${targets.length}`);
    const f = (n) => d.fields.indexOf(n);
    const items = d.rows.map((r) => ({ kind: r[f('kind')], court: d.courts[r[f('court')]], cn: r[f('cn')], no: r[f('no')], addr: r[f('addr')], note: r[f('note')], appr: r[f('appr')], dept: r[f('dept')], sale: r[f('sale')], use: r[f('use')], low: r[f('low')], status: r[f('status')] }));
    await saveAuction(items);
    return;
  }

  console.log(`Chrome: ${CHROME || '(시스템 Chrome 없음 → playwright 번들 브라우저 사용)'}`);
  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADFUL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  console.log(`검색 화면 열기: ${MODE_SCHED ? '매각예정물건(PGJ157M00)' : '물건상세검색(PGJ151F00)'}`);
  await openScreen(page, CONF.url, CONF.courtSel);

  const courts = await page.evaluate((sel) =>
    [...document.querySelector(sel).options].map((o) => o.textContent.trim()).filter((t) => t && t !== '전체'), CONF.courtSel);
  const targets = courts.filter((c) => COURT_FILTER.some((f) => c.includes(f)));
  const finalTargets = ONLY_COURT ? targets.filter((c) => c.includes(ONLY_COURT)) : targets;
  console.log(`전체 법원 ${courts.length}개 중 서울·경기 ${targets.length}개 → 수집 대상 ${finalTargets.length}개`);
  console.log(`  ${finalTargets.join(' / ')}`);

  const items = [];
  const seen = new Set();

  for (const [ci, court] of finalTargets.entries()) {
    console.log(`[${ci + 1}/${finalTargets.length}] ${court}`);
    await openScreen(page, CONF.url, CONF.courtSel);

    // 법원 선택 (value 대신 옵션 텍스트 매칭)
    await page.evaluate(({ sel, court }) => {
      const s = document.querySelector(sel);
      const opt = [...s.options].find((o) => o.textContent.trim() === court);
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { sel: CONF.courtSel, court });
    await page.waitForTimeout(500);

    // 검색 클릭 (기간 없이 — 진행중이면 2주 이내, 매각예정이면 기본 2개월 이내 전체가 나온다)
    const token = await page.evaluate(`document.body.innerText.length`);
    await page.locator(CONF.btnSel).click({ timeout: 10000 });
    await page.waitForFunction((t) => document.body.innerText.length !== t, token, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 페이지 크기 40 (검색 후에만 나타나는 셀렉트)
    const sizeToken = await page.evaluate(`document.body.innerText.length`);
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find((s) => {
        const ts = [...s.options].map((o) => o.textContent.trim());
        return ts.includes('40') && ts.includes('10');
      });
      if (sel) { const opt = [...sel.options].find((o) => o.textContent.trim() === '40'); if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true })); } }
    });
    await page.waitForFunction((t) => document.body.innerText.length !== t, sizeToken, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    let pageNo = 0;
    for (;;) {
      const rows = await page.evaluate(EXTRACT_JS);
      let added = 0;
      for (const r of rows) {
        const key = r.cn + r.no;
        if (seen.has(key)) continue;
        seen.add(key);
        r.court = court;
        items.push(r);
        added++;
      }
      console.log(`  페이지 ${pageNo + 1}: ${rows.length}행 · 누적 ${items.length}건 (+${added})`);
      if (!rows.length) break;

      pageNo++;
      const token2 = await page.evaluate(`document.body.innerText.length`);
      const next = page.locator(`.w2pageList a[id$="_page_${pageNo + 1}"]:visible`).first();
      if (!(await next.count())) break;
      let clicked = false;
      try { await next.click({ timeout: 5000 }); clicked = true; } catch (e) { break; }
      if (!clicked) break;
      await page.waitForFunction((t) => document.body.innerText.length !== t, token2, { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (GAP_MS) await sleep(GAP_MS);
    }
    if (GAP_MS) await sleep(GAP_MS);
  }

  await browser.close();
  console.log(`\n수집 완료 — 총 ${items.length}건`);

  // ── 지오코딩 ──
  console.log('지오코딩 (V-World)');
  const addrs = [...new Set(items.map((r) => r.addr).filter(Boolean))];
  let done = 0, hit = 0;
  for (let i = 0; i < addrs.length; i += 2) {
    await Promise.all(addrs.slice(i, i + 2).map(async (a) => {
      const pt = await geocode(a);
      if (pt) hit++;
      done++;
    }));
    if (done % 100 === 0) console.log(`  ${done}/${addrs.length}`);
    await sleep(150);
  }
  console.log(`  완료 — ${addrs.length}개 주소 중 좌표 ${hit}개 (${(hit / addrs.length * 100).toFixed(1)}%)`);

  await saveAuction(items);
})().catch((e) => {
  // 잡히지 않은 예외를 삼키지 않고 실패로 끝낸다 — CI 가 빨간불로 알려주고, 무엇보다
  // 저장 단계까지 못 갔으므로 기존 auction.json 이 그대로 보존된다.
  console.error('수집 실패:', e && e.stack || e);
  process.exit(1);
});
