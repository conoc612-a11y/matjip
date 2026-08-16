#!/usr/bin/env node
/**
 * 법원경매 사건 상세 수집기 (기일내역 + 사건기본 + 매각정보)
 *
 * 사용법:  node tools/collect_auction_detail.js [--court 서울중앙] [--cn 2025타경1604] [--max 5] [--headful] [--force]
 *   --court 특정 법원만 (부분 수집). 예: --court 서울중앙
 *   --cn    특정 사건만 (수동 보정). 예: --cn 2025타경1604
 *   --max   최대 수집 건수 (테스트용, 기본 전체)
 *   --headful 브라우저를 띄워 과정 확인
 *   --force 이미 수집된 사건도 재수집
 *
 * 왜 이 구조인가 (2026-08-17 실측, 응답 덤프: 2025타경1604)
 *  - 법원 사이트 상세 정보는 목록 API가 아니라 사건검색(PGJ159M00) → 검색 →
 *    물건상세조회 클릭 → 응답 selectAuctnCsSrchRslt.on 의 data.dma_result 에 온다.
 *  - dma_result 에서 세 부분을 정규화해 저장한다.
 *      csBaseInfo         — saNo(법원 내부 사건번호)·접수일·채권액·담당계
 *      dspslGdsDxdyInfo   — 감정평가액·최저매각가격·매각기일·매각결정기일·orvParam
 *      gdsDspslDxdyLst    — 기일내역 (회차별 매각기일·최저가·결과) ★ 핵심
 *  - saNo(예: 20250130001604)는 사용자 번호(2025타경1604)와 다르며 상세 API 딥링크에
 *    필요한 값(HANDOFF 57 '딥링크 불가'의 핵심 결손분) — 함께 저장해 둔다.
 *  - IP 차단 주의(TROUBLESHOOTING §6-11): 요청 간 최소 1초, 사건당 화면 1회+검색 1회+상세 1회.
 *    실패한 사건은 건너뛰고 다음으로 — 배치 전체를 잃지 않게 사건 단위 try/catch.
 *
 * 산출물:
 *   auction_detail.json   — { "2025타경1604": { t, base, dspsl, gihui }, ... }
 *                            (auction.json 은 절대 건드리지 않음 — 사진 수집기와 같은 원칙)
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

// 못 찾으면 undefined 를 넘겨 playwright 번들 브라우저를 쓴다(collect_auction.js 동일 패턴).
const CHROME = process.env.CHROME_PATH
  || [process.env.PROGRAMFILES, `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}`, process.env.LOCALAPPDATA]
    .map((p) => p && path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find((p) => p && fs.existsSync(p));

const OUT_AUCTION = path.resolve(__dirname, '..', 'auction.json');
const OUT_DETAIL = path.resolve(__dirname, '..', 'auction_detail.json');
const HEADFUL = process.argv.includes('--headful');
const ONLY_COURT = process.argv.includes('--court') ? process.argv[process.argv.indexOf('--court') + 1] : '';
const ONLY_CN = process.argv.includes('--cn') ? process.argv[process.argv.indexOf('--cn') + 1] : '';
const MAX = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf('--max') + 1]) : 0;
const FORCE = process.argv.includes('--force');
const GAP_MS = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRCH_URL = 'https://www.courtauction.go.kr/pgj/index.on?w2xPath=' + encodeURIComponent('/pgj/ui/pgj100/PGJ159M00.xml');
const SRCH_BTN = '#mf_wfm_mainFrame_btn_auctnCsSrchBtn';
const COURT_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCortOfc';
const YEAR_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCsYear';
const CSNO_SEL = '#mf_wfm_mainFrame_ibx_auctnCsSrchCsNo';

// 코드 → 명칭 (실측 근거: 2025타경1604 응답). 미확인 코드는 코드값 그대로 표기.
const KND_NM = { '01': '매각기일', '02': '매각결정기일' };
const RSLT_NM = { '002': '유찰' };

function normalize(dm) {
  const base = dm.csBaseInfo || {};
  const dsp = dm.dspslGdsDxdyInfo || {};
  return {
    base: {
      saNo: base.csNo || '', nm: base.csNm || '', rcptYmd: base.csRcptYmd || '',
      clmAmt: base.clmAmt || 0, jdbn: base.cortAuctnJdbnNm || '',
      jdbnTel: base.jdbnTelno || '', execTel: base.execrCsTelno || '',
      susp: base.auctnSuspStatCd || '',
    },
    dspsl: {
      appr: dsp.aeeEvlAmt || 0, low: dsp.fstPbancLwsDspslPrc || 0,
      dxdyYmd: dsp.dspslDxdyYmd || '', dcsnYmd: dsp.dspslDcsnDxdyYmd || '',
      dxdyHm: dsp.fstDspslHm || '', dcsnHm: dsp.dspslDcsnHm || '',
      dxdyPlc: dsp.dspslPlcNm || '', dcsnPlc: dsp.dspslDcsnPlcNm || '',
      depositRate: dsp.prchDposRate || 0, rmk: dsp.dspslGdsRmk || '',
      ndstrc: dsp.ndstrcRghCtt || '', orvParam: dsp.orvParam || '',
    },
    gihui: (dm.gdsDspslDxdyLst || []).map((r) => ({
      y: r.dxdyYmd || '', hm: r.dxdyHm || '',
      knd: r.auctnDxdyKndCd || '', kndNm: KND_NM[r.auctnDxdyKndCd] || r.auctnDxdyKndCd || '',
      rslt: r.auctnDxdyRsltCd || '', rsltNm: RSLT_NM[r.auctnDxdyRsltCd] || r.auctnDxdyRsltCd || '',
      low: r.tsLwsDspslPrc || 0, place: r.dxdyPlcNm || '',
    })),
    // 물건명세·제시외·감정요약 — 목록과 다른 섹션(같은 dma_result 안에 함께 온다, 2026-08-17 실측)
    objct: (dm.gdsDspslObjctLst || []).map((o) => ({
      addr: o.userPrintSt || '', use: o.mclDspslGdsLstUsgCd || '',
      ar: o.objctArDts || '', evl: o.aeeEvlAmt || 0,
    })),
    notsugt: (dm.gdsNotSugtBldLsstAll || []).reduce((a, x) => a.concat(x), []).map((o) => ({
      nm: o.etcUsgCtt || '', struc: o.bldStrcDts || '', ar: o.bldArDts || '', amt: o.evlAmt || 0,
    })),
    evlt: (dm.aeeWevlMnpntLst || []).map((o) => o.aeeWevlMnpntCtt || '').filter(Boolean),
  };
}

async function openSearch(page, courtSel) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { await page.goto(SRCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (e) { console.log(`  페이지 이동 실패(${attempt + 1}/3): ${e.message.split('\n')[0]}`); continue; }
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

function splitCsNo(cn) {
  const m = cn.match(/(\d{4})[가-힣]+(\d+)/);
  return m ? { year: m[1], num: m[2] } : null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(OUT_AUCTION, 'utf8'));
  const F = {};
  data.fields.forEach((f, i) => { F[f] = i; });
  const cnIdx = F.cn, courtIdx = F.court;

  const db = fs.existsSync(OUT_DETAIL) ? JSON.parse(fs.readFileSync(OUT_DETAIL, 'utf8')) : {};

  const seen = new Set();
  let targets = data.rows
    .map((r) => ({ cn: r[cnIdx], court: data.courts[r[courtIdx]] || '' }))
    .filter(({ cn, court }) => cn && !seen.has(cn) && (seen.add(cn), true))
    .filter(({ cn, court }) =>
      (ONLY_CN ? cn.includes(ONLY_CN) : true) &&
      (!ONLY_COURT || court.includes(ONLY_COURT)) &&
      (FORCE || !db[cn]));
  if (MAX) targets = targets.slice(0, MAX);
  console.log(`상세 미보유 ${targets.length}건 / 전체 ${data.rows.length}건 (대상 ${ONLY_CN || ONLY_COURT || '전체'}${FORCE ? ' · 강제 재수집' : ''})`);
  if (!targets.length) { console.log('할 일 없음 — 종료'); return; }

  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADFUL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  console.log(`Chrome: ${CHROME || '(시스템 Chrome 없음 → playwright 번들 브라우저 사용)'}`);

  const captureDetail = (ms = 25000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      const url = res.url();
      if (!url.includes('/pgj/pgj15B/selectAuctnCsSrchRslt.on') || done) return;
      try {
        const j = JSON.parse(await res.text());
        if (j && j.data && j.data.dma_result) {
          done = true;
          page.off('response', onRes);
          resolve(j.data.dma_result);
        }
      } catch (e) { /* 무시 */ }
    };
    page.on('response', onRes);
    setTimeout(() => {
      if (done) return;
      done = true;
      page.off('response', onRes);
      resolve(null);
    }, ms);
  });

  let done = 0;
  for (const { cn, court } of targets) {
    const sp = splitCsNo(cn);
    console.log(`[${++done}/${targets.length}] ${court} · ${cn}`);
    if (!sp) { console.log('  사건번호 형식 오류 — 스킵'); continue; }

    try {
      await openSearch(page, COURT_SEL);
      await page.evaluate(({ sel, court }) => {
        const s = document.querySelector(sel);
        const opt = [...s.options].find((o) => o.textContent.trim() === court);
        if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { sel: COURT_SEL, court }).catch(() => {});
      await page.evaluate(({ sel, year }) => {
        const s = document.querySelector(sel);
        const opt = [...s.options].find((o) => o.textContent.trim() === year);
        if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { sel: YEAR_SEL, year: sp.year }).catch(() => {});
      await page.waitForTimeout(400);
      await page.locator(CSNO_SEL).click().catch(() => {});
      await page.locator(CSNO_SEL).fill(sp.num).catch(() => {});
      await page.waitForTimeout(300);

      const token = await page.evaluate('document.body.innerText.length');
      await page.locator(SRCH_BTN).click({ timeout: 10000 });
      await page.waitForFunction((t) => document.body.innerText.length !== t, token, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(2000);

      const waitDetail = captureDetail(25000);
      const detailBtn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('input[value="물건상세조회"], button')]
          .find((x) => (x.value || x.textContent || '').includes('물건상세조회') && !x.disabled);
        if (b) { b.click(); return true; }
        return false;
      });
      if (!detailBtn) { console.log('  물건상세조회 버튼 없음(종결/취하?) — 스킵'); continue; }

      const dm = await waitDetail;
      await page.waitForTimeout(1200);
      if (!dm) { console.log('  상세 응답 없음 — 스킵'); continue; }

      db[cn] = Object.assign({ t: Date.now() }, normalize(dm));
      const gh = db[cn].gihui;
      console.log(`  saNo=${db[cn].base.saNo} · 기일내역 ${gh.length}건 · ${gh.map((g) => `${g.y}${g.rsltNm ? '(' + g.rsltNm + ')' : ''}`).join(' → ')}`);
      fs.writeFileSync(OUT_DETAIL, JSON.stringify(db));
    } catch (e) {
      console.log(`  처리 중 오류 — 스킵: ${String(e && e.message || e).split('\n')[0]}`);
    }
    if (GAP_MS) await sleep(GAP_MS);
  }

  await browser.close();
  console.log(`\n완료 — auction_detail.json 에 상세 ${Object.keys(db).length}건 저장`);
  fs.writeFileSync(OUT_DETAIL, JSON.stringify(db));
})();
