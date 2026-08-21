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

// 당사자(이해관계인) 내역 — 채권자·채무자·소유자 등 (2026-08-21 추가)
// ⚠️ 이 데이터는 '물건상세조회'(pgj15B) 응답에 없다. **검색 결과(pgj15A) 응답**의
// dlt_rletCsIntrpsLst 로 온다(실측 2026-08-21: 2025타경1604 에서 23건).
// 그래서 예전 수집기는 이걸 아예 못 봤다 — 응답을 안 듣고 있었기 때문이고, 법원이 안 주는
// 게 아니었다. 이름은 법원이 "김OO" 로 마스킹해 내려준다(그대로 저장·표시한다).
function normalizeParties(sr) {
  const lst = (sr && sr.dlt_rletCsIntrpsLst) || [];
  const seen = new Set();
  const out = [];
  for (const o of lst) {
    const dvs = o.auctnIntrpsDvsNm || '';
    const nm = o.intrpsNm || '';
    if (!dvs && !nm) continue;
    // 같은 구분+이름이 여러 번 오는 경우가 있다(순번만 다름). 화면에 같은 줄을 반복해
    // 보여줄 이유가 없으니 중복은 접는다. 마스킹 때문에 동명이인 구분은 애초에 불가능하다.
    const key = dvs + '|' + nm;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dvs, nm });
  }
  return out;
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
  if (!cn) return null;
  // 병합·중복 사건은 사건번호가 **구분자 없이 이어붙어** 온다(2026-08-21 실측):
  //   "서울동부지방법원2025타경511212025타경51738(중복)"
  // 이 상태로 /(\d{4})[가-힣]+(\d+)/ 를 돌리면 \d+ 가 뒤 사건번호까지 먹어
  //   num = "511212025" (정답 51121) → 검색 실패 → "물건상세조회 버튼 없음" 으로 스킵됐다.
  // 그래서 '숫자 바로 뒤에 \d{4}[가-힣]+\d 가 오는 지점'에 구분자를 끼워 끊고,
  // 원래 정규식으로 **첫 사건번호**를 뽑는다.
  // ⚠️ 토큰을 /^\d{4}/ 로 앵커링해 고르는 방식은 쓰지 말 것 — 법원명이 붙은 첫 토큰을
  //    건너뛰어 **두 번째 사건**을 집는다(실측: 51121 대신 51738 을 뽑았다).
  // 공백으로 구분된 형태("… 2023타경111613 2023타경117390 (중복)")는 원래도 잘 됐고
  // 이 변경 후에도 결과가 같다(정상 형태 2,570건 회귀 검사 전부 동일).
  const norm = String(cn).replace(/(\d)(?=\d{4}[가-힣]+\d)/g, '$1' + String.fromCharCode(1));
  const m = norm.match(/(\d{4})[가-힣]+(\d+)/);
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
      // 대상 = ① 상세가 아예 없는 사건 ② **상세는 있지만 당사자내역(intrps)이 없는 사건**
      // ②를 넣은 이유(2026-08-21): 당사자내역은 나중에 추가된 항목이라 기존 레코드엔 없다.
      // 조건이 `!db[cn]` 뿐이면 기존 2,600건이 영원히 스킵돼 --force 로 전량(약 6시간)을
      // 다시 돌리는 수밖에 없었다. 이 조건이면 **평소 수집이 돌 때 알아서 메꿔진다** —
      // `--max 500` 처럼 나눠 돌려도 되고, 다 채워지면 자동으로 '할 일 없음'이 된다.
      // 새 필드를 또 추가하면 여기에 같은 형태로 한 줄 늘릴 것.
      (FORCE || !db[cn] || !db[cn].intrps));
  if (MAX) targets = targets.slice(0, MAX);
  const missingDetail = targets.filter((t) => !db[t.cn]).length;
  console.log(`대상 ${targets.length}건 / 전체 ${data.rows.length}건 `
    + `(상세 미보유 ${missingDetail} · 당사자 보강 ${targets.length - missingDetail})`
    + ` (${ONLY_CN || ONLY_COURT || '전체'}${FORCE ? ' · 강제 재수집' : ''})`);
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

  // 검색 결과(pgj15A) 응답 캡처 — 당사자내역이 여기 온다. 검색 버튼을 누르기 **전에**
  // 리스너를 걸어야 한다(응답이 클릭 직후 오므로).
  const captureSearchRslt = (ms = 20000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      if (!res.url().includes('/pgj/pgj15A/selectAuctnCsSrchRslt.on') || done) return;
      try {
        const j = JSON.parse(await res.text());
        if (j && j.data && Array.isArray(j.data.dlt_rletCsIntrpsLst)) {
          done = true;
          page.off('response', onRes);
          resolve(j.data);
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
      const waitSrch = captureSearchRslt(20000);   // 당사자내역은 이 클릭의 응답에 온다
      await page.locator(SRCH_BTN).click({ timeout: 10000 });
      await page.waitForFunction((t) => document.body.innerText.length !== t, token, { timeout: 20000 }).catch(() => {});
      // '물건상세조회' 버튼 상태를 정확히 구분해서 기다린다 (2026-08-21 실측으로 정리).
      //   ready    → 누를 수 있다
      //   disabled → 버튼은 있는데 법원이 막아둔 상태. **기다려도 안 열린다** → 즉시 스킵
      //   null     → 아직/끝까지 없음 → 짧게 기다린 뒤 스킵
      // ⚠️ 여기서 두 번 헤맸으니 다음 사람은 읽고 넘어갈 것:
      //  ① 예전 로그는 disabled 든 없든 전부 "물건상세조회 버튼 없음(종결/취하?)" 로 찍혀서
      //     원인을 오판하게 만들었다. 실제로 미보유 154건 중 118건은 **미종국 사건인데도**
      //     버튼이 `disabled`(w2trigger_disabled) 였다 — 우리 버그가 아니라 사이트 정책이다.
      //     (실측: 2025타경102901, 2021타경100523 — 사용자 Chrome 으로도 동일 확인)
      //  ② '고정 2초 대기가 짧아서 놓친다'는 가설로 15초 폴링을 넣었더니, disabled 인 사건마다
      //     15초를 헛되게 버렸다. 상태를 구분하지 않으면 느려지기만 한다.
      const btnState = await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('input[type=button],button')]
          .find((x) => (x.value || x.textContent || '').includes('물건상세조회'));
        if (!b) return null;                       // 아직 안 그려졌으면 계속 기다린다
        return b.disabled ? 'disabled' : 'ready';  // 둘 다 '확정'이므로 폴링을 끝낸다
      }, null, { timeout: 8000, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);
      if (btnState === 'disabled') {
        console.log('  물건상세조회가 비활성(법원이 상세 제공 안 함) — 스킵');
        if (GAP_MS) await sleep(GAP_MS);
        continue;
      }
      const srch = await waitSrch;   // null 이면 당사자 없이 진행(기존 동작 유지)

      const waitDetail = captureDetail(25000);
      const detailBtn = await page.evaluate(() => {
        const b = [...document.querySelectorAll('input[value="물건상세조회"], button')]
          .find((x) => (x.value || x.textContent || '').includes('물건상세조회') && !x.disabled);
        if (b) { b.click(); return true; }
        return false;
      });
      if (!detailBtn) { console.log('  물건상세조회 버튼이 화면에 없음 — 스킵'); continue; }

      const dm = await waitDetail;
      await page.waitForTimeout(1200);
      if (!dm) { console.log('  상세 응답 없음 — 스킵'); continue; }

      db[cn] = Object.assign({ t: Date.now() }, normalize(dm), { intrps: normalizeParties(srch) });
      const gh = db[cn].gihui;
      const ip = db[cn].intrps;
      console.log(`  saNo=${db[cn].base.saNo} · 기일내역 ${gh.length}건 · 당사자 ${ip.length}건 · ${gh.map((g) => `${g.y}${g.rsltNm ? '(' + g.rsltNm + ')' : ''}`).join(' → ')}`);
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
