#!/usr/bin/env node
/**
 * 법원경매 물건 사진 수집기 (관심 사건만)
 *
 * 사용법:  node tools/collect_auction_photos.js [--court 서울중앙지방법원] [--headful] [--max 5]
 *   --court  특정 법원만 대상 (전체 대상 확인용). 예: --court 서울중앙
 *   --headful 브라우저를 띄워 과정 확인
 *   --max    최대 수집 건수 (테스트용, 기본 전체)
 *
 * 왜 이 구조인가 (2026-08-13 실측)
 *  - 법원 사이트 사진은 base64 로만 내려주고 원본 파일 URL 은 404 다. 외부 핫링크 차단.
 *  - 사건검색(PGJ159M00) → 검색 → 물건상세조회 클릭 → 응답 selectAuctnCsSrchRslt.on 의
 *    data.dma_result.csPicLst 에 사진이 인라인(base64)으로 들어온다.
 *  - csPicLst 항목: cortAuctnPicDvsCd(000241=전경도 · 000243=내부구조도 · 000244=위치도 · 000245=관련사진 · 000246=지적도),
 *    picTitlNm(파일명), picFile(base64 jpeg).
 *  - 전경도(000241) 3장만 대표 사진으로 저장한다. auction.json 은 건드리지 않고,
 *    auction_photos.json 에 { cn: [data URI, ...] } 형태로 따로 저장한다(사진 분리 — auction.json
 *    을 가볍게 유지, land.html 이 둘을 병렬 fetch). auctionPhotoHtml 이 이 배열을 렌더한다.
 *  - IP 차단 주의: 요청 사이 최소 1초 대기, 사건당 PGJ159 진입 1회 + 검색 1회 + 상세 1회.
 *
 * 산출물: auction_photos.json  { "서울중앙지방법원 2023타경2726": ["data:image/jpeg;base64,..."], ... }
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH
  || [process.env.PROGRAMFILES, `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}`, process.env.LOCALAPPDATA]
    .map((p) => p && path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find((p) => p && fs.existsSync(p))
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const OUT_AUCTION = path.resolve(__dirname, '..', 'auction.json');
const OUT_PHOTOS = path.resolve(__dirname, '..', 'auction_photos.json');
const HEADFUL = process.argv.includes('--headful');
const ONLY_COURT = process.argv.includes('--court') ? process.argv[process.argv.indexOf('--court') + 1] : '';
const MAX = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf('--max') + 1]) : 0;
const GAP_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRCH_URL = 'https://www.courtauction.go.kr/pgj/index.on?w2xPath=' + encodeURIComponent('/pgj/ui/pgj100/PGJ159M00.xml');
const SRCH_BTN = '#mf_wfm_mainFrame_btn_auctnCsSrchBtn';
const COURT_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCortOfc';
const YEAR_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCsYear';
const CSNO_SEL = '#mf_wfm_mainFrame_ibx_auctnCsSrchCsNo';

async function openSearch(page, courtSel) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(SRCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    let ok = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      ok = await page.evaluate((s) => !!document.querySelector(s), courtSel).catch(() => false);
      if (ok) break;
    }
    if (ok) break;
    console.log(`  화면 로드 실패 → 재시도 (${attempt + 1}/3)`);
  }
  await page.waitForTimeout(1500);
}

// 사건번호 '2023타경2726' → { year:'2023', num:'2726' }
function splitCsNo(cn) {
  const m = cn.match(/(\d{4})[가-힣]+(\d+)/);
  return m ? { year: m[1], num: m[2] } : null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(OUT_AUCTION, 'utf8'));
  const F = {};
  data.fields.forEach((f, i) => { F[f] = i; });
  const cnIdx = F.cn, courtIdx = F.court;

  // 이미 수집된 사진 (재실행 안전)
  const photosDb = fs.existsSync(OUT_PHOTOS) ? JSON.parse(fs.readFileSync(OUT_PHOTOS, 'utf8')) : {};

  // 대상: 아직 사진 없는 사건 (cn 으로 판단 — auction.json 의 행 인덱스에 의존하지 않는다)
  const seen = new Set();
  let targets = data.rows
    .map((r) => ({ cn: r[cnIdx], court: data.courts[r[courtIdx]] || '' }))
    .filter(({ cn, court }) => cn && !photosDb[cn] && !seen.has(cn) && (!ONLY_COURT || court.includes(ONLY_COURT)) && (seen.add(cn), true));
  if (MAX) targets = targets.slice(0, MAX);
  console.log(`사진 미보유 ${targets.length}건 / 전체 ${data.rows.length}건 (수집 대상 ${ONLY_COURT || '전체'})`);
  if (!targets.length) { console.log('할 일 없음 — 종료'); return; }

  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADFUL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  console.log(`Chrome: ${CHROME}`);

  // 상세 응답 캡처 — csPicLst 추출. resolve/타임아웃 어느 쪽이든 리스너는 제거된다.
  const captureDetail = (ms = 20000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      const url = res.url();
      if (!url.includes('/pgj/pgj15B/selectAuctnCsSrchRslt.on') || done) return;
      try {
        const body = await res.text();
        const j = JSON.parse(body);
        const lst = j && j.data && j.data.dma_result && j.data.dma_result.csPicLst;
        if (Array.isArray(lst)) {
          done = true;
          page.off('response', onRes);
          resolve(lst);
        }
      } catch (e) { /* 무시 */ }
    };
    page.on('response', onRes);
    setTimeout(() => {
      if (done) return;
      done = true;
      page.off('response', onRes);
      resolve([]);
    }, ms);
  });

  let done = 0;
  for (const { cn, court } of targets) {
    const sp = splitCsNo(cn);
    console.log(`[${++done}/${targets.length}] ${court} · ${cn}`);
    if (!sp) { console.log('  사건번호 형식 오류 — 스킵'); continue; }

    await openSearch(page, COURT_SEL);
    // 법원 선택
    await page.evaluate(({ sel, court }) => {
      const s = document.querySelector(sel);
      const opt = [...s.options].find((o) => o.textContent.trim() === court);
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { sel: COURT_SEL, court }).catch(() => {});
    // 연도 선택
    await page.evaluate(({ sel, year }) => {
      const s = document.querySelector(sel);
      const opt = [...s.options].find((o) => o.textContent.trim() === year);
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
    }, { sel: YEAR_SEL, year: sp.year }).catch(() => {});
    await page.waitForTimeout(400);
    // 사건번호 숫자부 입력 (WebSquare: 한글 자동 제거 → 숫자만)
    await page.locator(CSNO_SEL).click().catch(() => {});
    await page.locator(CSNO_SEL).fill(sp.num).catch(() => {});
    await page.waitForTimeout(300);

    // 검색
    const token = await page.evaluate('document.body.innerText.length');
    await page.locator(SRCH_BTN).click({ timeout: 10000 });
    await page.waitForFunction((t) => document.body.innerText.length !== t, token, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 물건상세조회 클릭 → 상세 응답 캡처 (리스너는 클릭 전에 등록해야 응답을 놓치지 않는다)
    const waitDetail = captureDetail(20000);
    const detailBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('input[value="물건상세조회"], button')]
        .find((x) => (x.value || x.textContent || '').includes('물건상세조회') && !x.disabled);
      if (b) { b.click(); return true; }
      return false;
    });
    if (!detailBtn) { console.log('  물건상세조회 버튼 없음(종결/취하?) — 스킵'); continue; }

    const lst = await waitDetail;
    await page.waitForTimeout(1500);

    if (!lst.length) { console.log('  상세 응답에서 사진 목록 없음 — 스킵'); continue; }
    // 전경도(000241) 우선, 부족하면 그 외
    let pics = lst.filter((p) => p.cortAuctnPicDvsCd === '000241');
    if (pics.length < 3) pics = pics.concat(lst.filter((p) => p.cortAuctnPicDvsCd !== '000241'));
    const photos = pics.slice(0, 3)
      .map((p) => p.picFile)
      .filter(Boolean)
      .map((b64) => 'data:image/jpeg;base64,' + b64);
    if (!photos.length) { console.log('  사진 데이터 없음 — 스킵'); continue; }

    photosDb[cn] = photos;
    console.log(`  사진 ${photos.length}장 수집 (전경도 ${pics.filter((p) => p.cortAuctnPicDvsCd === '000241').length}/${lst.filter((p) => p.cortAuctnPicDvsCd === '000241').length})`);
    fs.writeFileSync(OUT_PHOTOS, JSON.stringify(photosDb));
    if (GAP_MS) await sleep(GAP_MS);
  }

  await browser.close();
  const total = Object.keys(photosDb).length;
  console.log(`\n완료 — auction_photos.json 에 사진 ${total}건 저장`);
  fs.writeFileSync(OUT_PHOTOS, JSON.stringify(photosDb));
})();
