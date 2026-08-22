#!/usr/bin/env node
/**
 * 법원경매 사건 통합 수집기 — 사건당 **한 번 방문**으로 사진·상세·당사자를 전부 가져온다.
 *
 * 사용법:
 *   node tools/collect_auction_case.js                 # 부족한 것만 채운다(권장)
 *   node tools/collect_auction_case.js --max 500       # 나눠 돌리기(회당 약 3시간)
 *   node tools/collect_auction_case.js --court 서울중앙  # 특정 법원만
 *   node tools/collect_auction_case.js --cn 2025타경1604 --force   # 한 건 강제 재수집
 *   node tools/collect_auction_case.js --headful       # 브라우저 띄워서 확인
 *   node tools/collect_auction_case.js --no-photos     # 상세·당사자만 (사진 저장 건너뜀)
 *   node tools/collect_auction_case.js --no-shrink     # 끝에 사진 축소 안 함
 *
 * ── 왜 만들었나 (2026-08-21) ─────────────────────────────────────────────
 * collect_auction_photos.js 와 collect_auction_detail.js 는 **완전히 같은 요청**을 쓴다:
 *   둘 다  POST /pgj/pgj15B/selectAuctnCsSrchRslt.on
 *   사진 → data.dma_result.csPicLst
 *   상세 → data.dma_result.csBaseInfo / dspslGdsDxdyInfo / gdsDspslDxdyLst / …
 * 즉 **한 번 받은 응답에 사진과 상세가 같이 들어있는데** 두 스크립트가 각각 따로 사건 페이지를
 * 방문해 자기 필드만 챙기고 나머지를 버렸다. 사건당 22.5초씩 **두 번** 든 셈이다.
 * 사용자 지적으로 확인해 하나로 합쳤다. 효과:
 *   - 전량 정리 32시간 → **16시간**
 *   - 법원 사이트 요청 **절반** (IP 차단 위험 감소 — TROUBLESHOOTING §6-11)
 *   - 사진/상세 커버리지가 **항상 일치**(예전엔 2,534 vs 2,602 로 어긋났다)
 *
 * 기존 두 스크립트는 **지우지 않았다**. 문제가 생기면 즉시 되돌릴 수 있게 남겨 둔 것이고,
 * 산출물 포맷(auction_photos.json / auction_detail.json / auction_photos/)은 **완전히 동일**해서
 * land.html 은 아무것도 바꿀 필요가 없다.
 *
 * ── 반드시 알아야 할 함정 (실측으로 확인, 반복하지 말 것) ────────────────
 *  1) el.click() (JS 이벤트) 는 이 사이트가 거부한다(isTrusted=false). Playwright 실제 클릭 필요.
 *     단 페이지 안에서 버튼을 누를 때는 page.evaluate 안의 b.click() 이 통한다(검색 버튼과 달리
 *     물건상세조회는 WebSquare 트리거라 동작함 — 기존 두 수집기가 그렇게 쓰고 있었다).
 *  2) '물건상세조회' 버튼이 **보이지만 disabled** 인 사건이 많다(w2trigger_disabled).
 *     법원이 상세 제공을 막은 것으로, 기다려도 안 열린다 → 즉시 스킵.
 *     예전 로그가 이걸 "버튼 없음(종결/취하?)" 으로 뭉뚱그려 원인 오판을 유발했다.
 *     실측: 2025타경102901, 2021타경100523 (둘 다 미종국인데 disabled).
 *  3) 당사자내역은 pgj15B 에 **없다**. 검색 결과(pgj15A) 응답의 dlt_rletCsIntrpsLst 로 온다.
 *     그래서 리스너를 **검색 버튼 누르기 전에** 걸어야 한다.
 *  4) 병합·중복 사건은 사건번호가 구분자 없이 이어붙어 온다("…2025타경511212025타경51738").
 *     splitCsNo 가 끊어주지 않으면 검색이 실패한다.
 *
 * 산출물(기존과 동일):
 *   auction_photos/<사건>/<구분>_<n>.<ext>
 *   auction_photos.json   { cn: [{ dvs, name, file }] }
 *   auction_detail.json   { cn: { t, base, dspsl, gihui, objct, notsugt, evlt, intrps } }
 */

const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME_PATH
  || [process.env.PROGRAMFILES, `${process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)'}`, process.env.LOCALAPPDATA]
    .map((p) => p && path.join(p, 'Google', 'Chrome', 'Application', 'chrome.exe'))
    .find((p) => p && fs.existsSync(p));

const OUT_AUCTION = path.resolve(__dirname, '..', 'auction.json');
const OUT_PHOTOS = path.resolve(__dirname, '..', 'auction_photos.json');
const OUT_PHOTOS_DIR = path.resolve(__dirname, '..', 'auction_photos');
const OUT_DETAIL = path.resolve(__dirname, '..', 'auction_detail.json');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const HEADFUL = flag('--headful');
const FORCE = flag('--force');
const NO_PHOTOS = flag('--no-photos');
const NO_DETAIL = flag('--no-detail');
const NO_SHRINK = flag('--no-shrink');
const ONLY_COURT = opt('--court', '');
const ONLY_CN = opt('--cn', '');
const MAX = Number(opt('--max', 0)) || 0;
const GAP_MS = 1000;                    // 요청 간 최소 간격 — 사이트 공지대로 폭주 금지
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SRCH_URL = 'https://www.courtauction.go.kr/pgj/index.on?w2xPath=' + encodeURIComponent('/pgj/ui/pgj100/PGJ159M00.xml');
const SRCH_BTN = '#mf_wfm_mainFrame_btn_auctnCsSrchBtn';
const COURT_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCortOfc';
const YEAR_SEL = '#mf_wfm_mainFrame_sbx_auctnCsSrchCsYear';
const CSNO_SEL = '#mf_wfm_mainFrame_ibx_auctnCsSrchCsNo';

// ── 사진 관련 (collect_auction_photos.js 와 동일 규칙 유지) ──
const DVS_NAMES = { '000241': '전경도', '000243': '내부구조도', '000244': '위치도', '000245': '관련사진', '000246': '지적도', '000247': '000247' };
// 매직바이트로 실제 확장자 판별 — picFile 이 jpeg 인 줄 알았는데 GIF 도 온다(000247 실측).
const imgExt = (b) =>
  (b[0] === 0xff && b[1] === 0xd8) ? 'jpg'
    : (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) ? 'gif'
      : (b[0] === 0x89 && b[1] === 0x50) ? 'png'
        : 'bin';
const dirName = (cn) => cn.replace(/[^\w가-힣]+/g, '_');

// ── 상세 관련 (collect_auction_detail.js 와 동일) ──
const KND_NM = { '01': '매각기일', '02': '매각결정기일' };
const RSLT_NM = { '002': '유찰' };

function normalizeDetail(dm) {
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

// 감정평가 정보 — 화면에 없던 값들(가격시점·조사일·작성일·감정인·평가서번호).
// 출처: POST /pgj/pgj15B/selectAeeWevlInfo.on (감정평가서 버튼을 누를 때 발생)
// ⚠️ PDF 본문은 여기 없다. 협회 뷰어가 IE 플러그인 전용이라 문서 자체는 못 가져온다(§47).
// 그래도 이 필드들을 저장해 두는 이유:
//   ① 가격시점(dspslPrcCrtrYmd)은 "이 감정가가 언제 기준인지"라 유찰 반복 물건 판단에 직접 쓰인다.
//   ② 협회가 뷰어를 현대화하면 이 필드만으로 문서 URL 을 조립할 수 있다(§47-2 매핑표) —
//      그때 16시간 재수집을 다시 하지 않아도 된다. **그게 지금 같이 받는 진짜 이유다.**
function normalizeAee(sr) {
  const d = sr && (sr.dma_ordTsIndvdAeeWevlInf || sr.data && sr.data.dma_ordTsIndvdAeeWevlInf);
  if (!d) return null;
  const out = {
    cortCd: d.cortOfcCd || '',        // "B000210" — URL 조립 시 맨 앞 B 를 뗀다
    csNo: d.csNo || '',               // 내부 사건번호
    ordTs: d.ordTsCnt || 0,           // 명령회차
    no: d.aeeWevlNo || '',            // 평가서번호 (URL 조각 / 옛 사건은 한글 포함)
    crtrYmd: d.dspslPrcCrtrYmd || '', // 가격시점 ★
    exmnYmd: d.exmnYmd || '',         // 조사일
    wrtYmd: d.wrtYmd || '',           // 작성일 (URL 조각)
    examr: d.aeeEvlExamrNm || '',     // 감정평가 담당자
    jdgr: d.aeeEvlJdgrNm || '',       // 심사자
  };
  // 의미 있는 값이 하나도 없으면 저장하지 않는다(빈 객체로 레코드를 더럽히지 않게)
  return (out.no || out.crtrYmd || out.wrtYmd || out.examr) ? out : null;
}

// 당사자(이해관계인) — 검색 결과(pgj15A) 응답에서 온다. 이름은 법원이 "김OO" 로 마스킹해 준다.
function normalizeParties(sr) {
  const lst = (sr && sr.dlt_rletCsIntrpsLst) || [];
  const seen = new Set();
  const out = [];
  for (const o of lst) {
    const dvs = o.auctnIntrpsDvsNm || '';
    const nm = o.intrpsNm || '';
    if (!dvs && !nm) continue;
    const key = dvs + '|' + nm;      // 순번만 다른 중복 행은 접는다(화면에 같은 줄 반복 방지)
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dvs, nm });
  }
  return out;
}

// 사건번호 '2023타경2726' → { year:'2023', num:'2726' }
function splitCsNo(cn) {
  if (!cn) return null;
  // 병합·중복 사건은 사건번호가 구분자 없이 이어붙어 온다:
  //   "서울동부지방법원2025타경511212025타경51738(중복)"
  // 그대로 /(\d{4})[가-힣]+(\d+)/ 를 돌리면 \d+ 가 뒤 사건번호까지 먹어 num="511212025"
  // (정답 51121)가 되어 검색이 실패한다. 이어붙은 지점에 구분자를 끼워 끊고 첫 사건번호만 쓴다.
  // ⚠️ 토큰을 /^\d{4}/ 로 앵커링해 고르는 방식은 금지 — 법원명이 붙은 첫 토큰을 건너뛰어
  //    두 번째 사건을 집는다(실측: 51121 대신 51738).
  const norm = String(cn).replace(/(\d)(?=\d{4}[가-힣]+\d)/g, '$1' + String.fromCharCode(1));
  const m = norm.match(/(\d{4})[가-힣]+(\d+)/);
  return m ? { year: m[1], num: m[2] } : null;
}

async function openSearch(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    // goto 가 타임아웃으로 throw 할 수 있다(실측). 삼켜서 재시도 루프를 타게 한다.
    try { await page.goto(SRCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
    catch (e) { console.log(`  페이지 이동 실패(${attempt + 1}/3): ${String(e.message).split('\n')[0]}`); continue; }
    let ok = false;
    for (let i = 0; i < 15; i++) {
      await page.waitForTimeout(1000);
      ok = await page.evaluate((s) => !!document.querySelector(s), COURT_SEL).catch(() => false);
      if (ok) break;
    }
    if (ok) break;
    console.log(`  화면 로드 실패 → 재시도 (${attempt + 1}/3)`);
  }
  await page.waitForTimeout(1500);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(OUT_AUCTION, 'utf8'));
  const F = {};
  data.fields.forEach((f, i) => { F[f] = i; });

  const photosDb = fs.existsSync(OUT_PHOTOS) ? JSON.parse(fs.readFileSync(OUT_PHOTOS, 'utf8')) : {};
  const detailDb = fs.existsSync(OUT_DETAIL) ? JSON.parse(fs.readFileSync(OUT_DETAIL, 'utf8')) : {};

  // 이 사건에서 아직 없는 것이 있나 — 세 가지를 각각 본다.
  const needPhotos = (cn) => !NO_PHOTOS && !photosDb[cn];
  const needDetail = (cn) => !NO_DETAIL && !detailDb[cn];
  // 당사자·감정평가정보는 **나중에 추가된 항목**이라 기존 레코드엔 없다. '레코드는 있는데
  // 이것만 없는' 사건을 대상에 넣지 않으면 --force 로 전량을 다시 돌리는 수밖에 없다.
  // ⚠️ 새 필드를 또 추가하면 여기에 같은 형태로 한 줄 늘릴 것. 안 늘리면 그 필드는
  //    기존 사건에서 **영구히 비어 있게 된다**(실제로 겪음: 옛 상세 수집기가 당사자만
  //    채워 둔 사건들은 aee 조건이 없으면 영원히 감정평가 정보를 못 받았다).
  const needParties = (cn) => !NO_DETAIL && detailDb[cn] && !detailDb[cn].intrps;
  const needAee = (cn) => !NO_DETAIL && detailDb[cn] && !detailDb[cn].aee;

  const seen = new Set();
  let targets = data.rows
    .map((r) => ({ cn: r[F.cn], court: data.courts[r[F.court]] || '' }))
    .filter(({ cn }) => cn && !seen.has(cn) && (seen.add(cn), true))
    .filter(({ cn, court }) =>
      (ONLY_CN ? cn.includes(ONLY_CN) : true) &&
      (!ONLY_COURT || court.includes(ONLY_COURT)) &&
      (FORCE || needPhotos(cn) || needDetail(cn) || needParties(cn) || needAee(cn)));
  if (MAX) targets = targets.slice(0, MAX);

  const nP = targets.filter((t) => needPhotos(t.cn)).length;
  const nD = targets.filter((t) => needDetail(t.cn)).length;
  const nI = targets.filter((t) => needParties(t.cn)).length;
  const nA = targets.filter((t) => needAee(t.cn)).length;
  console.log(`대상 ${targets.length}건 / 전체 고유사건 ${seen.size}건`
    + `  (사진 ${nP} · 상세 ${nD} · 당사자보강 ${nI} · 감정정보보강 ${nA})`
    + `${ONLY_CN || ONLY_COURT ? ' · 필터 ' + (ONLY_CN || ONLY_COURT) : ''}${FORCE ? ' · 강제' : ''}`);
  if (!targets.length) { console.log('할 일 없음 — 종료'); return; }

  const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADFUL });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  console.log(`Chrome: ${CHROME || '(시스템 Chrome 없음 → playwright 번들 브라우저 사용)'}`);

  // 검색 결과(pgj15A) — 당사자내역. **검색 버튼 클릭 전에** 리스너를 걸어야 한다.
  const captureSearch = (ms = 20000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      if (!res.url().includes('/pgj/pgj15A/selectAuctnCsSrchRslt.on') || done) return;
      try {
        const j = JSON.parse(await res.text());
        if (j && j.data && Array.isArray(j.data.dlt_rletCsIntrpsLst)) {
          done = true; page.off('response', onRes); resolve(j.data);
        }
      } catch (e) { /* 무시 */ }
    };
    page.on('response', onRes);
    setTimeout(() => { if (done) return; done = true; page.off('response', onRes); resolve(null); }, ms);
  });

  // 물건상세(pgj15B) — 사진(csPicLst)과 상세가 **같은 응답**에 함께 온다. 이게 통합의 근거다.
  const captureDetail = (ms = 25000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      if (!res.url().includes('/pgj/pgj15B/selectAuctnCsSrchRslt.on') || done) return;
      try {
        const j = JSON.parse(await res.text());
        if (j && j.data && j.data.dma_result) {
          done = true; page.off('response', onRes); resolve(j.data.dma_result);
        }
      } catch (e) { /* 무시 */ }
    };
    page.on('response', onRes);
    setTimeout(() => { if (done) return; done = true; page.off('response', onRes); resolve(null); }, ms);
  });

  // 감정평가 정보(selectAeeWevlInfo) — 감정평가서 버튼을 누를 때 온다.
  // 물건상세 화면의 버튼도 같은 API 를 호출하므로(실측), 상세를 받은 **뒤에** 누른다.
  // 사건내역 화면에서 먼저 누르면 모달이 떠서 물건상세조회 클릭을 방해할 수 있다.
  const captureAee = (ms = 12000) => new Promise((resolve) => {
    let done = false;
    const onRes = async (res) => {
      if (!res.url().includes('selectAeeWevlInfo') || done) return;
      try {
        const j = JSON.parse(await res.text());
        if (j && j.data) { done = true; page.off('response', onRes); resolve(j.data); }
      } catch (e) { /* 무시 */ }
    };
    page.on('response', onRes);
    setTimeout(() => { if (done) return; done = true; page.off('response', onRes); resolve(null); }, ms);
  });

  const stat = { ok: 0, photo: 0, detail: 0, parties: 0, aee: 0, disabled: 0, noBtn: 0, noResp: 0, err: 0 };
  let done = 0;
  let savedAnyPhoto = false;

  for (const { cn, court } of targets) {
    const sp = splitCsNo(cn);
    console.log(`[${++done}/${targets.length}] ${court} · ${cn}`);
    if (!sp) { console.log('  사건번호 형식 오류 — 스킵'); stat.err++; continue; }

    // 사건 1건 처리 전체를 try 로 감싼다 — 예상 밖 예외 하나로 몇 시간짜리 배치를 잃지 않게.
    // 저장은 사건마다 즉시 하므로 중간에 끊겨도 이전 진행분은 안전하다.
    try {
      await openSearch(page);
      const pick = (sel, v) => page.evaluate(({ sel, v }) => {
        const s = document.querySelector(sel);
        const o = [...s.options].find((x) => x.textContent.trim() === v);
        if (o) { s.value = o.value; s.dispatchEvent(new Event('change', { bubbles: true })); s.dispatchEvent(new Event('input', { bubbles: true })); }
      }, { sel, v }).catch(() => {});
      await pick(COURT_SEL, court);
      await pick(YEAR_SEL, sp.year);
      await page.waitForTimeout(400);
      await page.locator(CSNO_SEL).click().catch(() => {});
      await page.locator(CSNO_SEL).fill(sp.num).catch(() => {});
      await page.waitForTimeout(300);

      const token = await page.evaluate('document.body.innerText.length');
      const waitSrch = captureSearch(20000);     // ← 당사자. 클릭 전에 걸어야 놓치지 않는다
      await page.locator(SRCH_BTN).click({ timeout: 10000 });
      await page.waitForFunction((t) => document.body.innerText.length !== t, token, { timeout: 20000 }).catch(() => {});

      // 물건상세조회 버튼 상태를 구분해서 기다린다.
      //   ready → 진행 / disabled → 법원이 막은 것이므로 즉시 스킵(기다려도 안 열린다) / null → 없음
      const btnState = await page.waitForFunction(() => {
        const b = [...document.querySelectorAll('input[type=button],button')]
          .find((x) => (x.value || x.textContent || '').includes('물건상세조회'));
        if (!b) return null;
        return b.disabled ? 'disabled' : 'ready';
      }, null, { timeout: 8000, polling: 250 }).then((h) => h.jsonValue()).catch(() => null);

      const srch = await waitSrch;               // 당사자는 상세 여부와 무관하게 확보된다
      const parties = normalizeParties(srch);

      if (btnState !== 'ready') {
        // 상세는 못 받지만, 당사자만이라도 기존 레코드에 채워 넣는다(있는 건 버리지 않는다).
        if (parties.length && detailDb[cn] && !detailDb[cn].intrps) {
          detailDb[cn].intrps = parties;
          fs.writeFileSync(OUT_DETAIL, JSON.stringify(detailDb));
          stat.parties++;
          console.log(`  ${btnState === 'disabled' ? '물건상세조회 비활성' : '물건상세조회 버튼 없음'} — 당사자 ${parties.length}건만 보강`);
        } else {
          console.log(`  ${btnState === 'disabled' ? '물건상세조회가 비활성(법원이 상세 제공 안 함)' : '물건상세조회 버튼이 화면에 없음'} — 스킵`);
        }
        if (btnState === 'disabled') stat.disabled++; else stat.noBtn++;
        if (GAP_MS) await sleep(GAP_MS);
        continue;
      }

      const waitDetail = captureDetail(25000);
      const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('input[value="물건상세조회"], button')]
          .find((x) => (x.value || x.textContent || '').includes('물건상세조회') && !x.disabled);
        if (b) { b.click(); return true; }
        return false;
      });
      if (!clicked) { console.log('  물건상세조회 클릭 실패 — 스킵'); stat.noBtn++; if (GAP_MS) await sleep(GAP_MS); continue; }

      const dm = await waitDetail;
      await page.waitForTimeout(1200);
      if (!dm) { console.log('  상세 응답 없음 — 스킵'); stat.noResp++; if (GAP_MS) await sleep(GAP_MS); continue; }

      const bits = [];

      // ── 감정평가 정보 (같은 방문에서 추가로 확보 — 사건당 2~3초) ──
      // 상세를 받은 뒤 물건상세 화면의 '감정평가서' 버튼을 눌러 selectAeeWevlInfo 를 받는다.
      // 버튼이 없거나 비활성이면 그냥 넘어간다(감정평가 정보 없는 사건도 있다).
      let aee = null;
      if (!NO_DETAIL) {
        const waitAee = captureAee(12000);
        const aeeClicked = await page.evaluate(() => {
          const b = [...document.querySelectorAll('input[value="감정평가서"], input[type=button], button')]
            .find((x) => (x.value || x.textContent || '').trim() === '감정평가서'
              && !x.disabled && (x.offsetWidth > 0 || x.offsetHeight > 0));
          if (b) { b.click(); return true; }
          return false;
        }).catch(() => false);
        if (aeeClicked) {
          aee = normalizeAee(await waitAee);
          await page.waitForTimeout(600);
        } else {
          // 리스너를 걸어놨으니 타임아웃까지 기다리지 않도록 흘려보낸다
          waitAee.then(() => {});
        }
      }

      // ── 상세 + 당사자 + 감정평가 정보 저장 ──
      if (!NO_DETAIL && (FORCE || needDetail(cn) || needParties(cn) || needAee(cn))) {
        const rec = Object.assign({ t: Date.now() }, normalizeDetail(dm), { intrps: parties });
        if (aee) rec.aee = aee;
        detailDb[cn] = rec;
        fs.writeFileSync(OUT_DETAIL, JSON.stringify(detailDb));
        stat.detail++;
        if (parties.length) stat.parties++;
        if (aee) stat.aee++;
        bits.push(`기일 ${rec.gihui.length}`, `당사자 ${parties.length}`, `감정요약 ${rec.evlt.length}`);
        if (aee) bits.push(`가격시점 ${aee.crtrYmd || '-'}`);
      }

      // ── 사진 저장 (같은 응답의 csPicLst — 추가 요청 없음) ──
      if (!NO_PHOTOS && (FORCE || needPhotos(cn))) {
        const lst = Array.isArray(dm.csPicLst) ? dm.csPicLst : [];
        const pics = lst.filter((p) => p.picFile)
          .sort((a, b) => (a.cortAuctnPicDvsCd || '').localeCompare(b.cortAuctnPicDvsCd || ''));
        if (pics.length) {
          const dir = path.join(OUT_PHOTOS_DIR, dirName(cn));
          fs.mkdirSync(dir, { recursive: true });
          const seq = {};
          photosDb[cn] = pics.map((p) => {
            const dvs = p.cortAuctnPicDvsCd || '000245';
            seq[dvs] = (seq[dvs] || 0) + 1;
            const buf = Buffer.from(p.picFile, 'base64');
            const file = `${dvs}_${seq[dvs]}.${imgExt(buf)}`;
            fs.writeFileSync(path.join(dir, file), buf);
            return { dvs, name: DVS_NAMES[dvs] || dvs, file: 'auction_photos/' + dirName(cn) + '/' + file };
          });
          fs.writeFileSync(OUT_PHOTOS, JSON.stringify(photosDb));
          savedAnyPhoto = true;
          stat.photo++;
          bits.push(`사진 ${photosDb[cn].length}장`);
        } else {
          bits.push('사진 없음');
        }
      }

      stat.ok++;
      console.log('  ' + (bits.length ? bits.join(' · ') : '변경 없음'));
    } catch (e) {
      stat.err++;
      console.log(`  처리 중 오류 — 스킵: ${String((e && e.message) || e).split('\n')[0]}`);
    }
    if (GAP_MS) await sleep(GAP_MS);
  }

  await browser.close();
  console.log(`\n완료 — 성공 ${stat.ok} (사진 ${stat.photo} · 상세 ${stat.detail} · 당사자 ${stat.parties} · 감정정보 ${stat.aee})`);
  console.log(`      스킵: 상세비활성 ${stat.disabled} · 버튼없음 ${stat.noBtn} · 응답없음 ${stat.noResp} · 오류 ${stat.err}`);
  console.log(`      보유 총계: 사진 ${Object.keys(photosDb).length}건 · 상세 ${Object.keys(detailDb).length}건`);

  // ── 사진을 새로 저장했으면 축소한다 (GitHub Pages 1GB 한도 대응) ──
  // 법원 원본은 장당 평균 148KB 라 전량이면 약 6GB. 400px·품질 55 로 줄이면 장당 17KB.
  // 축소 스크립트는 이미 작은 파일을 건너뛰므로 매번 돌려도 안전하다.
  if (savedAnyPhoto && !NO_SHRINK) {
    try {
      const { spawnSync } = require('child_process');
      console.log('\n사진 축소 중 (400px)');
      const r = spawnSync('python', [path.join(__dirname, 'shrink_auction_photos.py')], {
        stdio: 'inherit',
        env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
      });
      if (r.status !== 0) {
        console.log('  ⚠ 축소 실패 — 사진은 원본 크기로 남아 있다.');
        console.log('    pip install Pillow && python tools/shrink_auction_photos.py');
      }
    } catch (e) {
      console.log(`  ⚠ 축소 단계 건너뜀: ${e.message}`);
    }
    console.log('\n⚠️ 사진을 새로 받았으면 R2 업로드가 필요하다:  node tools/upload_r2.mjs');
  }
})();
