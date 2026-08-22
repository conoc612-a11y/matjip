#!/usr/bin/env node
/**
 * 국토교통부 실거래가 수집기 (연립다세대 / 단독다가구)
 *
 * 사용법:  DGK=<data.go.kr 인증키> node tools/collect_realprice.js
 *          (키는 절대 이 파일에 적지 말 것 — 환경변수로만 받는다)
 *
 * 산출물:
 *   realprice_villa.json   연립다세대 — 건물 단위, 압축 배열 포맷
 *   realprice_house.json   단독다가구 — 동 단위 집계
 *
 * 왜 이런 구조인가 (실측 근거)
 *  - 연립다세대는 서울 12개월치가 거래 약 4.8만건 / 고유 건물 약 3만개다.
 *    아파트 파일과 같은 {"key":value} 포맷이면 6MB 가 넘어 초기 로딩을 망친다.
 *    그래서 키 이름을 한 번만 적고 값은 배열로 저장한다(약 60% 절감).
 *  - 단독다가구는 국토부가 개인정보 때문에 지번을 '1***' 로 마스킹한다.
 *    실측: 표본 428건 전부 마스킹. 개별 좌표를 찍는 것이 원리상 불가능하므로
 *    동 단위 집계(건수/중앙값/면적범위)로만 제공한다.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const RAW_KEY = process.env.DGK;
if (!RAW_KEY) {
  console.error('DGK 환경변수에 data.go.kr 인증키를 넣어 실행하세요.');
  process.exit(1);
}
// data.go.kr 의 Decoding 키에는 + / = 가 들어있다. 그대로 URL 에 붙이면
// '+' 가 공백으로 해석되는 등으로 인증이 깨져 서버가 조용히 0건을 돌려준다
// (2026-08-14 실측: 전 구·전 월에서 0건 → writeSafe 가드가 덮어쓰기를 막아 발각).
// 이미 인코딩된 키(%2B 등 포함)를 넣은 경우 이중 인코딩되지 않도록 원형을 먼저 복원한다.
const KEY = encodeURIComponent(/%[0-9A-Fa-f]{2}/.test(RAW_KEY) ? decodeURIComponent(RAW_KEY) : RAW_KEY);
const VWORLD_KEY = process.env.VWORLD_KEY || 'B2CDEEDD-D622-311B-883B-CC7890E50822';
const OUT_DIR = path.resolve(__dirname, '..');
const MONTHS_BACK = Number(process.env.MONTHS || 12);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

// LAWD_CD 는 추측으로 넣지 않는다 — 2026-08-14 전수 탐색(41100~41899 전 코드 1회 호출)으로
// 데이터가 실제로 나오는 47개만 확보. 수원(41111/13/15/17)·부천(41192/94/96)·화성(41591/93/95/97)은
// 표준 시군구 코드와 달라 API 로 확인했다 (세부는 HANDOFF (28)).
//   - 수원 4구: 41111 장안·41113 권선·41115 팔달·41117 영통 (41119 등은 무효)
//   - 부천 3구(2024 일반구 분리): 41192 원미·41194 소사·41196 오정 (41190/95/97/99 는 전부 0건)
//   - 화성: 41591/41593/41595/41597 4개 코드 합집합이 화성 전체(능동만 중복 — 수집기 dedupe 로 흡수)
const GU_GG = {
  41111: '수원시 장안구', 41113: '수원시 권선구', 41115: '수원시 팔달구', 41117: '수원시 영통구',
  41131: '성남시 수정구', 41133: '성남시 중원구', 41135: '성남시 분당구',
  41150: '의정부시', 41171: '안양시 만안구', 41173: '안양시 동안구',
  41192: '부천시 원미구', 41194: '부천시 소사구', 41196: '부천시 오정구',
  41210: '광명시', 41220: '평택시', 41250: '동두천시',
  41271: '안산시 상록구', 41273: '안산시 단원구',
  41281: '고양시 덕양구', 41285: '고양시 일산동구', 41287: '고양시 일산서구',
  41290: '과천시', 41310: '구리시', 41360: '남양주시', 41370: '오산시', 41390: '시흥시',
  41410: '군포시', 41430: '의왕시', 41450: '하남시',
  41461: '용인시 처인구', 41463: '용인시 기흥구', 41465: '용인시 수지구',
  41480: '파주시', 41500: '이천시', 41550: '안성시', 41570: '김포시',
  41591: '화성시', 41593: '화성시', 41595: '화성시', 41597: '화성시',
  41610: '광주시', 41630: '양주시', 41650: '포천시', 41670: '여주시',
  41800: '연천군', 41820: '가평군', 41830: '양평군',
};
const GU_ALL = {
  11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구',
  11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구',
  11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구',
  11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구',
  11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구',
  ...GU_GG,
};
// ONLY_GU=11620,11440 처럼 지정하면 일부 구만 수집한다 (전체 실행 전 점검용).
// SUFFIX=_test 를 주면 산출 파일명 뒤에 붙어 실제 데이터를 덮어쓰지 않는다.
const ONLY = (process.env.ONLY_GU || '').split(',').map((s) => s.trim()).filter(Boolean);
const GU = ONLY.length
  ? Object.fromEntries(Object.entries(GU_ALL).filter(([cd]) => ONLY.includes(cd)))
  : GU_ALL;
const SUFFIX = process.env.SUFFIX || '';
// 시도 구분: LAWD_CD 11 로 시작 = 서울, 41 로 시작 = 경기 (이 수집기가 쓰는 코드는 11/41 둘 뿐)
const SIDO = (cd) => (String(cd).startsWith('11') ? '서울특별시' : '경기도');
// RENT_ONLY 가 dong/house 에서 코드 없이 구 이름만 들고 다닐 때 시도 복원용 (구 이름은 전체에서 유일)
const GU_CD_BY_NAME = Object.fromEntries(Object.entries(GU_ALL).map(([cd, nm]) => [nm, cd]));

// ── 공통 유틸 ────────────────────────────────────────────────
// keepAlive 필수. 수천 건을 연달아 요청하면 Windows 에서 임시 포트가 고갈돼
// 조용히 실패한다. 실측: 에이전트 없이 돌렸을 때 지오코딩 성공률이 91.7% -> 81.0% 로
// 떨어졌는데, 같은 주소를 순차로 부르면 205/205 로 전부 성공했다.
// 호스트별로 에이전트를 분리한다. 한 에이전트를 공유하면 한쪽(data.go.kr)에서 막힌
// 소켓이 다른 쪽(vworld.kr) 요청까지 큐에 세울 수 있다.
const agents = new Map();
function agentFor(url) {
  const host = (url.match(/^https:\/\/([^/]+)/) || [, 'x'])[1];
  let a = agents.get(host);
  if (!a) { a = new https.Agent({ keepAlive: true, keepAliveMsecs: 3000, maxSockets: 8 }); agents.set(host, a); }
  return a;
}

const REQ_TIMEOUT_MS = 15000;

function httpGet(url, tries = 3) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      // 한 번의 시도는 한 번만 마무리된다. req.destroy() 가 error 핸들러도 깨우므로
      // 이 가드가 없으면 타임아웃 때 재시도가 두 번 걸려 요청이 배로 늘어난다.
      let settled = false;
      let req = null;
      const settle = (retry, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        try { if (req) req.destroy(); } catch (e) {}
        if (!retry) return resolve(value);
        if (n < tries) setTimeout(() => attempt(n + 1), 400 * n);
        else resolve('');
      };
      const finish = (v) => settle(false, v);
      const retryOrGiveUp = () => settle(true);

      // 하드 데드라인. req.setTimeout 만으로는 부족하다 — 그건 소켓이 배정된 뒤에야 시작되므로,
      // 에이전트 풀이 막혀 큐에서 대기하는 요청은 영구히 끊기지 않는다.
      // 실측(소켓 상한 2에 요청 4개): 앞 2개는 1.5초에 끊겼지만 큐의 2개는 3.1초에야 끊겼다.
      // 실제 수집에서 이 때문에 같은 지점에서 두 번 멈췄다(40분, 그리고 4시간).
      // 아래 setTimeout 은 소켓 상태와 무관하게 발동하므로 어떤 경우에도 워커가 풀린다.
      const deadline = setTimeout(retryOrGiveUp, REQ_TIMEOUT_MS);

      req = https.get(url, { agent: agentFor(url), headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        // setEncoding 이 없으면 한글이 깨진다. 응답은 Buffer 로 쪼개져 오는데,
        // 청크마다 문자열로 이어붙이면 3바이트 한글이 청크 경계에 걸릴 때 손상된다.
        // 실측: 이것 없이 수집했을 때 23,726건 중 40건(0.17%)에 U+FFFD 가 섞였고
        //       '다세대'가 '다세__' 처럼 갈라져 유형 사전이 3개에서 8개로 늘었다.
        res.setEncoding('utf8');
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
          // data.go.kr 은 간헐적으로 500 을 뱉는다. 빈 본문도 실패로 보고 재시도한다.
          if (res.statusCode !== 200 || !d) return retryOrGiveUp();
          finish(d);
        });
        res.on('error', retryOrGiveUp);
      });
      req.on('error', retryOrGiveUp);
    };
    attempt(1);
  });
}

// item 과 totalCount 를 한 번의 문자열 스캔으로 뽑는다. 예전엔 parseItems(전체 스캔) 뒤에
// xml.match(/<totalCount>/) 로 문자열을 한 번 더 훑었는데, 페이지 XML(~200KB)당 이중 스캔을 줄인다.
// ⚠️ 2026-08-22: 이 함수가 **오류 응답도 조용히 0건으로 반환**해서 데이터를 통째로 잃었다.
// data.go.kr 은 쿼터 초과·스로틀링에도 HTTP 200 에 오류 XML 을 실어 보낸다. 예전 구현은
// <item> 이 없으면 그냥 {items:[], total:0} 을 돌려주고, fetchAll 은 그걸 "그 구·그 달은
// 거래가 없다"로 해석해 break 했다. 결과: 비주거 첫 수집에서 **서울 12개 구·경기 34개 지역이
// 통째로 누락**됐는데 스크립트는 exit 0 으로 정상 종료했다(로그의 누적 건수가 100개 작업 동안
// 5,412 에서 멈춰 있던 것이 유일한 흔적).
// → 오류를 err 로 구분해 올려보내고, fetchAll 이 재시도하고 그래도 실패하면 **크게 실패**한다.
function parseItems(xml) {
  const out = [];
  let total = 0;
  const s = String(xml || '');
  // resultCode 는 정상이 '00'/'000'. errMsg/returnAuthMsg 는 게이트웨이 오류(쿼터·미신청 등).
  const rc = s.match(/<resultCode>([^<]*)<\/resultCode>/);
  const em = s.match(/<errMsg>([^<]*)<\/errMsg>/) || s.match(/<returnAuthMsg>([^<]*)<\/returnAuthMsg>/);
  if (em) return { items: [], total: 0, err: em[1].trim() };
  if (rc && !/^0+$/.test(rc[1].trim())) {
    const rm = s.match(/<resultMsg>([^<]*)<\/resultMsg>/);
    return { items: [], total: 0, err: 'resultCode=' + rc[1].trim() + (rm ? ' ' + rm[1].trim() : '') };
  }
  // 응답 껍데기조차 아니면(빈 본문·HTML 오류페이지) 그것도 오류다 — 0건과 구분해야 한다.
  if (!/<response|<items|<totalCount/.test(s)) {
    return { items: [], total: 0, err: '응답 형식 불명(' + s.slice(0, 60).replace(/\s+/g, ' ') + ')' };
  }
  const re = /<item>([\s\S]*?)<\/item>|<totalCount>(\d+)<\/totalCount>/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1] !== undefined) {
      const o = {};
      const r2 = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
      let t;
      while ((t = r2.exec(m[1]))) o[t[1]] = t[2].trim();
      out.push(o);
    } else if (m[2] !== undefined) {
      total = Number(m[2]);
    }
  }
  return { items: out, total };
}

// 기준월을 실행 시점에서 계산한다. 예전엔 new Date(2026, 6, 1) 로 하드코딩돼 있어
// 2026-07 이후 거래가 영구히 수집되지 않았다(2026-08-14 코드리뷰로 발견 — 그날 기준
// 7월·8월 거래가 통째로 빠져 있었다). 재현이 필요하면 BASE_YM=YYYYMM 으로 고정할 수 있다.
// i=0 부터 도는 이유: 이번 달(진행 중)도 포함해야 최신 거래가 반영된다.
function recentMonths(n) {
  const out = [];
  const bym = String(process.env.BASE_YM || '');
  const now = /^\d{6}$/.test(bym)
    ? new Date(Number(bym.slice(0, 4)), Number(bym.slice(4, 6)) - 1, 1)
    : new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}

// ── 빈/축소 결과로 기존 파일을 덮어쓰지 않는 안전 저장 (2026-08-14 코드리뷰) ──
// data.go.kr 은 키 오류·쿼터 초과일 때도 HTTP 200 에 오류 XML 을 실어 보낸다. 그러면
// 파싱 결과가 0건이 되는데, 예전엔 그대로 저장돼 멀쩡한 파일이 rows:[] 로 바뀌었다.
// (실제로 realprice_apt.json 이 빈 채로 배포돼 프론트가 매 로드마다 2MB 구버전으로
//  폴백하고 있었다.) 0건이거나 기존 대비 절반 미만이면 저장을 거부한다.
// 의도한 축소면 --force 로 넘긴다. 저장은 tmp+rename 으로 원자적으로 한다.
function writeSafe(outPath, obj, count, label) {
  const FORCE = process.argv.includes('--force');
  let prev = 0;
  try {
    if (fs.existsSync(outPath)) {
      const old = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      prev = Array.isArray(old) ? old.length : (old.rows ? old.rows.length : Object.keys(old).length);
    }
  } catch (e) { /* 기존 파일이 깨져 있으면 비교 대상 없음 */ }
  if (!count) throw new Error(`${label}: 수집 0건 — 기존 파일(${prev.toLocaleString()}건) 보존하고 중단. API 오류/쿼터 초과 의심.`);
  if (prev && count < prev * 0.5 && !FORCE) {
    throw new Error(`${label}: ${count.toLocaleString()}건 — 기존 ${prev.toLocaleString()}건의 절반 미만이라 중단. 의도한 변화면 --force.`);
  }
  const tmp = outPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, outPath);
  console.log(`  ${label} 저장 — ${count.toLocaleString()}건 / ${(fs.statSync(outPath).size / 1048576).toFixed(2)}MB`);
}

const eok = (amt) => Math.round(Number(String(amt).replace(/[,\s]/g, '')) / 10000 * 10) / 10;
const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 10) / 10; };

// ── 전세 시세 수집 ───────────────────────────────────────────
// 전세가율(전세보증금 / 매매가)은 갭투자 판단의 핵심 지표다.
// 전월세 API 에서 monthlyRent 가 0 인 건이 전세이고, deposit 이 보증금(만원)이다.
// 매매 쪽과 똑같은 키로 묶어야 짝이 맞는다. 그런데 묶는 단위가 유형별로 다르다.
//   아파트      : 주소|단지명|전용면적  (같은 단지도 평형별 전세가율이 크게 다름)
//   연립다세대  : 주소|건물명           (건물 단위로 묶었으므로 면적을 넣으면 짝이 안 맞음)
// withArea 로 이 차이를 흡수한다.
async function fetchJeonse(pathSeg, label, nameField, withArea) {
  const rows = await fetchAll(pathSeg, label);
  const byKey = new Map();
  let jeonseCnt = 0;
  for (const r of rows) {
    if (String(r.monthlyRent || '').replace(/[,\s]/g, '') !== '0') continue;  // 월세 제외
    if (!r.jibun || /\*/.test(r.jibun)) continue;
    const dep = eok(r.deposit);
    if (!(dep > 0)) continue;
    jeonseCnt++;
    const area = Math.round((Number(r.excluUseAr) || 0) * 10) / 10;
    const base = `${SIDO(r._sgg)} ${r._gu} ${r.umdNm} ${r.jibun}|${r[nameField] || ''}`;
    const key = withArea ? `${base}|${area}` : base;
    let arr = byKey.get(key);
    if (!arr) { arr = []; byKey.set(key, arr); }
    arr.push(dep);
  }
  console.log(`  [${label}] 전세 ${jeonseCnt.toLocaleString()}건 · 단지·평형 조합 ${byKey.size.toLocaleString()}개`);
  const out = new Map();
  for (const [k, deps] of byKey) out.set(k, median(deps));
  return out;
}

// ── 1) 국토부 수집 ───────────────────────────────────────────
async function fetchAll(pathSeg, label) {
  const months = recentMonths(MONTHS_BACK);
  const rows = [];
  const failed = [];
  let done = 0;
  const jobs = [];
  for (const cd of Object.keys(GU)) for (const ym of months) jobs.push([cd, ym]);

  const CONC = 6;
  let idx = 0;
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (idx < jobs.length) {
      const [cd, ym] = jobs[idx++];
      let page = 1;
      for (;;) {
        const url = `https://apis.data.go.kr/1613000/${pathSeg}?serviceKey=${KEY}&LAWD_CD=${cd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}&_type=xml`;
        // 오류(쿼터·스로틀링)는 '거래 0건'과 절대 같지 않다. 재시도하고, 끝까지 실패하면 기록해 둔다.
        // 간격을 넉넉히 두는 이유: 스로틀링은 잠깐 멈춰야 풀린다 — 바로 재시도하면 구멍을 더 깊게 판다.
        let res = null;
        for (const wait of [0, 3000, 9000, 20000]) {
          if (wait) await sleep(wait);
          res = parseItems(await httpGet(url));
          if (!res.err) break;
        }
        if (res.err) { failed.push(`${GU[cd]}(${cd}) ${ym} p${page}: ${res.err}`); break; }
        const { items, total } = res;
        for (const r of items) rows.push(Object.assign(r, { _gu: GU[cd], _sgg: cd }));
        if (page * 1000 >= total || !items.length) break;
        page++;
      }
      done++;
      if (done % 50 === 0) console.log(`  [${label}] ${done}/${jobs.length} (누적 ${rows.length.toLocaleString()}건)`);
    }
  }));
  if (failed.length) {
    // 부분 수집 결과를 저장하면 "그 지역은 거래가 없다"로 굳어진다(실측 사고: 서울 12개 구 누락).
    // 그래서 조용히 넘기지 않고 크게 실패한다 — 기존 파일은 그대로 보존된다.
    console.error(`\n  [${label}] ❌ ${failed.length}개 요청이 API 오류로 실패했다:`);
    failed.slice(0, 15).forEach((f) => console.error('    ' + f));
    if (failed.length > 15) console.error(`    … 외 ${failed.length - 15}건`);
    throw new Error(`${label}: API 오류 ${failed.length}건 — 부분 결과를 저장하지 않고 중단한다.`
      + ' 쿼터·스로틀링이 의심되면 다른 data.go.kr 수집기를 동시에 돌리지 않았는지 확인할 것'
      + '(계정당 인증키가 공용이다). 잠시 후 다시 실행하면 이어서 채워진다.');
  }
  console.log(`  [${label}] 완료 — 거래 ${rows.length.toLocaleString()}건`);
  return rows;
}

// ── 2) V-World 지오코딩 ──────────────────────────────────────
// V-World 지오코더는 속도 제한이 엄격하다. 넘기면 502 Bad Gateway / ECONNRESET 을 던진다.
// 실측(각 300건, 차단 회복 후 측정):
//    동시8 지속        -> 1,200건 중 1,193건 차단
//    동시2 간격0ms     -> 100% 차단
//    동시3 간격100ms   -> 11% 차단
//    동시2 간격150ms   -> 0% 차단, 8.8건/s   <= 채택
//    동시1 간격50ms    -> 0% 차단, 7.9건/s
// 처음엔 동시8로 돌려 성공률이 75%까지 떨어졌는데, 그 25%는 잘못된 주소가 아니라
// 전부 차단이었다. 느려도 이 속도를 지켜야 데이터가 온전해진다.
const GEO_CONC = 2;
const GEO_GAP_MS = 150;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 체크포인트. 23,710건을 8.8건/s 로 처리하면 45분이 걸리는데, 중간에 프로세스가
// 죽으면 통째로 날아간다(실제로 3,000건 지점에서 세션 재시작에 한 번 잃었다).
// 좌표는 변하지 않는 값이므로 파일에 쌓아두고 다음 실행에서 그대로 이어받는다.
const CKPT = path.join(__dirname, '.geocache.json');
const geoCache = new Map();
try {
  if (fs.existsSync(CKPT)) {
    const saved = JSON.parse(fs.readFileSync(CKPT, 'utf8'));
    for (const [k, v] of Object.entries(saved)) geoCache.set(k, v);
    console.log(`체크포인트에서 좌표 ${geoCache.size.toLocaleString()}건 복원\n`);
  }
} catch (e) { console.log('체크포인트 읽기 실패 — 처음부터 시작합니다'); }

let ckptDirty = 0;
function saveCheckpoint(force) {
  if (!force && ++ckptDirty < 500) return;
  ckptDirty = 0;
  try { fs.writeFileSync(CKPT, JSON.stringify(Object.fromEntries(geoCache))); } catch (e) {}
}

async function geocode(addr) {
  // 캐시 히트도 호출부와 같은 모양으로 돌려줘야 한다. 좌표 배열을 그대로 반환하면
  // 호출부의 { pt, blocked } 구조분해가 깨져서, 이어받기 실행이 '성공 0%' 로 잘못 보고된다.
  // cached 플래그가 필요한 이유: 캐시 히트는 네트워크를 쓰지 않으므로 속도 제한 대기를
  // 걸 필요가 없다. 안 그러면 재실행 때 2.4만건 × 150ms = 약 1시간을 헛되게 기다린다.
  if (geoCache.has(addr)) return { pt: geoCache.get(addr), blocked: false, cached: true };
  // CI(GitHub Actions, 해외 IP)에서 V-World가 TCP 차단(ECONNRESET)하므로(2026-08-15 실측,
  // TROUBLESHOOTING §19) VWORLD_PROXY(= Supabase Edge Function vworld-geocode)가 설정돼
  // 있으면 그걸 경유한다. 로컬(한국 IP)은 직접 호출이 낫다. collect_auction.js 와 동일 정책.
  let pt = null, blocked = false;
  const attempt = async (url) => {
    const body = await httpGet(url, 1);
    let parsed = null;
    try { parsed = JSON.parse(body); } catch (e) {}
    const status = parsed && parsed.response && parsed.response.status;
    if (status === 'OK') {
      try {
        const p = parsed.response.result.point;
        pt = [Number(Number(p.y).toFixed(6)), Number(Number(p.x).toFixed(6))];
      } catch (e) {}
      return 'OK';
    }
    if (status === 'NOT_FOUND') return 'NOT_FOUND';
    return 'BLOCKED';
  };
  // NOT_FOUND 는 확정 실패라 재시도하지 않는다. 차단(502/RST)만 물러섰다가 다시 시도한다.
  for (let i = 1; i <= 4; i++) {
    let st;
    if (process.env.VWORLD_PROXY) {
      const body = await httpGet(`${process.env.VWORLD_PROXY}?address=${encodeURIComponent(addr)}&type=PARCEL`, 1);
      try {
        const j = JSON.parse(body);
        if (j.status === 'OK') { pt = [Number(j.lat), Number(j.lng)]; st = 'OK'; }
        else if (j.status === 'NOT_FOUND') st = 'NOT_FOUND';
        else st = 'BLOCKED';
      } catch (e) { st = 'BLOCKED'; }
    } else {
      st = await attempt(`https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0`
        + `&crs=EPSG:4326&type=PARCEL&format=json&key=${VWORLD_KEY}&address=${encodeURIComponent(addr)}`);
    }
    if (st === 'OK' || st === 'NOT_FOUND') { blocked = false; break; }
    blocked = true;
    await sleep(400 * i * i);  // 차단이면 점점 크게 물러선다
  }
  // 실패 캐시 정책(2026-08-15 코드리뷰 조치): 차단으로 끝난 null 은 캐시하지 않는다.
  // 예전엔 geoCache.set(addr, null) 을 해서, 일시 차단을 영구 실패로 고정시켰다 —
  // CI 의 actions/cache 로 .geocache.json 이 이어받아지면 오염이 누적돼 해당 레코드가
  // 영영 좌표를 못 얻었다(실측: 이번 수집에서 216건). 차단은 다음 실행에서 재시도된다.
  // NOT_FOUND 는 확정 실패(주소가 실제로 없음)라 캐시를 유지해 재시도 낭비를 막는다.
  if (pt || !blocked) { geoCache.set(addr, pt); saveCheckpoint(); }
  return { pt, blocked };
}

async function geocodeAll(addrs) {
  const list = [...addrs];
  let done = 0, hit = 0, blockedCnt = 0;
  let i = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: GEO_CONC }, async () => {
    while (i < list.length) {
      const a = list[i++];
      const { pt, blocked, cached } = await geocode(a);
      if (pt) hit++;
      if (blocked) blockedCnt++;
      done++;
      if (done % 500 === 0) {
        const sec = (Date.now() - t0) / 1000;
        const eta = Math.round((list.length - done) / (done / sec) / 60);
        console.log(`  [지오코딩] ${done}/${list.length} · 성공 ${hit} (${(hit / done * 100).toFixed(1)}%) · 차단잔여 ${blockedCnt} · 남은시간 약 ${eta}분`);
      }
      // 캐시 히트는 네트워크를 안 썼으므로 속도 제한 대기를 건너뛴다
      if (!cached && GEO_GAP_MS) await sleep(GEO_GAP_MS);
    }
  }));
  saveCheckpoint(true);
  console.log(`  [지오코딩] 완료 ${done}건 중 성공 ${hit}건 (${(hit / done * 100).toFixed(1)}%) · 끝내 차단 ${blockedCnt}건`);
}

// ── RENT_ONLY 모드 ──────────────────────────────────────────
// RENT_ONLY=1 로 실행하면 매매(연립·아파트·단독)를 다시 수집하지 않고
// ① 단독·다가구 전월세(동 단위) ② 기존 단독 매매 house.json 에 동 좌표 보강
// ③ 오피스텔 전월세(건물 단위) 만 처리한다. 동/건물 좌표는 V-World 로 지오코딩한다.
async function collectRentOnly() {
  console.log(`수집 기간: 최근 ${MONTHS_BACK}개월 · 서울+경기 ${Object.keys(GU).length}개 지역 (전월세 전용)\n`);

  // ① 단독·다가구 전월세 — 지번이 마스킹돼 동 단위 집계만 가능하다 (매매와 같은 이유)
  console.log('[1/3] 단독·다가구 전월세 수집 (동 단위 집계)');
  const shr = await fetchAll('RTMSDataSvcSHRent/getRTMSDataSvcSHRent', '단독다가구 전월세');
  const dong = new Map();
  for (const r of shr) {
    const k = `${r._gu}|${r.umdNm}`;
    let d = dong.get(k);
    if (!d) { d = { gu: r._gu, dong: r.umdNm, jd: [], rd: [], rm: [] }; dong.set(k, d); }
    const dep = eok(r.deposit);
    const mon = Math.round(Number(String(r.monthlyRent).replace(/[,\s]/g, '')));
    if (mon > 0) { if (dep > 0) d.rd.push(dep); d.rm.push(mon); }
    else if (dep > 0) d.jd.push(dep);
  }
  const dAddrs = [...dong.values()].map((d) => `${SIDO(GU_CD_BY_NAME[d.gu])} ${d.gu} ${d.dong}`);
  console.log(`  동 ${dong.size}개 · 지오코딩`);
  await geocodeAll(dAddrs);
  const hr = {};
  for (const d of dong.values()) {
    const pt = geoCache.get(`${SIDO(GU_CD_BY_NAME[d.gu])} ${d.gu} ${d.dong}`);
    hr[`${d.gu} ${d.dong}`] = {
      jc: d.jd.length, jmed: median(d.jd), jmin: d.jd.length ? Math.min(...d.jd) : 0, jmax: d.jd.length ? Math.max(...d.jd) : 0,
      rc: d.rd.length, rmed: median(d.rm), rdep: median(d.rd),
      ...(pt ? { lat: Number(pt[0].toFixed(5)), lng: Number(pt[1].toFixed(5)) } : {}),
    };
  }
  writeSafe(path.join(OUT_DIR, `realprice_house_rent${SUFFIX}.json`), hr, Object.keys(hr).length, 'realprice_house_rent.json');
  console.log(`  realprice_house_rent.json 저장 — ${Object.keys(hr).length}개 동 / ${(fs.statSync(path.join(OUT_DIR, `realprice_house_rent${SUFFIX}.json`)).size / 1024).toFixed(0)}KB`);

  // ② 기존 단독 매매 house.json 에 동 좌표 보강 — 키 형식이 ① 과 같아 레이어에서 좌표를 쓸 수 있다
  const housePath = path.join(OUT_DIR, `realprice_house${SUFFIX}.json`);
  if (fs.existsSync(housePath)) {
    const house = JSON.parse(fs.readFileSync(housePath, 'utf8'));
    const hAddrs = Object.keys(house).map((k) => `${SIDO(GU_CD_BY_NAME[k.split(' ')[0]])} ${k}`);
    console.log('\n[2/3] 단독·다가구 매매 동 좌표 보강');
    await geocodeAll(hAddrs);
    for (const k of Object.keys(house)) {
      const pt = geoCache.get(`${SIDO(GU_CD_BY_NAME[k.split(' ')[0]])} ${k}`);
      if (pt) { house[k].lat = Number(pt[0].toFixed(5)); house[k].lng = Number(pt[1].toFixed(5)); }
    }
    writeSafe(housePath, house, Object.keys(house).length, 'realprice_house.json (좌표 보강)');
    console.log(`  realprice_house.json 좌표 보강 — ${Object.values(house).filter((h) => h.lat).length}/${Object.keys(house).length} 동`);
  } else {
    console.log('\n[2/3] realprice_house.json 없음 — 건너뜀 (먼저 매매 수집 실행 필요)');
  }

  // ③ 오피스텔 전월세 — 지번이 마스킹되지 않아 건물(지번) 단위로 지오코딩한다
  console.log('\n[3/3] 오피스텔 전월세 수집 (건물 단위)');
  const offi = await fetchAll('RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent', '오피스텔 전월세');
  const bld = new Map();
  for (const r of offi) {
    if (!r.jibun || /\*/.test(r.jibun)) continue;
    const addr = `${SIDO(r._sgg)} ${r._gu} ${r.umdNm} ${r.jibun}`;
    let b = bld.get(addr);
    if (!b) { b = { addr, name: r.offiNm || r.umdNm, gu: r._gu, dong: r.umdNm, deals: [] }; bld.set(addr, b); }
    b.deals.push({
      dep: eok(r.deposit), mon: Math.round(Number(String(r.monthlyRent).replace(/[,\s]/g, ''))),
      a: Number(r.excluUseAr) || 0, f: Number(r.floor) || 0, y: Number(r.buildYear) || 0,
      ym: `${r.dealYear}.${r.dealMonth}`,
    });
  }
  console.log(`  고유 건물 ${bld.size.toLocaleString()}개`);
  console.log('  지오코딩');
  await geocodeAll(new Set([...bld.values()].map((b) => b.addr)));
  const F = ['name', 'gu', 'dong', 'lat', 'lng', 'dep', 'mon', 'area', 'floor', 'build', 'ymd', 'cnt', 'depMin', 'depMax'];
  const gus = [], dongs = [];
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const rows = [];
  for (const b of bld.values()) {
    const pt = geoCache.get(b.addr);
    if (!pt) continue;
    b.deals.sort((x, y) => (y.ym > x.ym ? 1 : -1));
    const latest = b.deals[0];
    const ds = b.deals.map((d) => d.dep).filter((d) => d > 0);
    rows.push([
      b.name, idx(gus, b.gu), idx(dongs, b.dong),
      Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5)),
      latest.dep, latest.mon, Math.round(latest.a * 10) / 10, latest.f, latest.y, latest.ym,
      b.deals.length, ds.length ? Math.min(...ds) : 0, ds.length ? Math.max(...ds) : 0,
    ]);
  }
  writeSafe(path.join(OUT_DIR, `realprice_officel${SUFFIX}.json`), { fields: F, gus, dongs, rows }, rows.length, 'realprice_officel.json');
  console.log(`  realprice_officel.json 저장 — ${rows.length.toLocaleString()}건 / ${(fs.statSync(path.join(OUT_DIR, `realprice_officel${SUFFIX}.json`)).size / 1048576).toFixed(2)}MB`);

  console.log('\n완료.');
}

// ── NONRES_ONLY 모드 — 비주거(상업업무용·오피스텔매매·공장창고) 매매 ──────
// 왜 필요한가: 지금까지 실거래는 **주거용만** 있었다(아파트·연립·단독·오피스텔전월세).
// 그래서 상가 건물을 클릭해도 "이 건물이 얼마에 거래됐나"를 못 봤고, 경매 물건에 근린생활
// 시설이 많은데 비교 기준이 없었다(TROUBLESHOOTING §52-0 약점 A).
//
// ── 지오코딩을 하지 않는다 (의도) ────────────────────────────────
// 팝업은 이미 V-World 지적에서 **지번**을 갖고 있다. 그래서 `구 동 지번` 을 키로 만들어 두면
// 팝업이 좌표 없이 바로 조회할 수 있다. 마커를 새로 뿌리는 게 목적이 아니라 **클릭한 건물의
// 거래 이력을 보여주는 것**이 목적이므로, V-World 지오코더(속도 제한이 엄격하다)를 전혀 부르지
// 않는다. 실행이 훨씬 빠르고 차단 위험도 없다.
// 나중에 마커가 필요해지면 그때 좌표를 붙이면 된다(키에 지번이 있으니 언제든 가능).
//
// ── 지번 마스킹 실측 (2026-08-22) ───────────────────────────────
// 첫 행만 보고 "상업업무용은 지번이 마스킹된다"고 단정했다가 틀렸다. 여러 구로 재측정한 값:
//   상업업무용   관악 19건 중 4건(21%) · 강남 68건 중 11건(16%) 마스킹 → 79~84% 는 지번이 온다
//   오피스텔매매 관악·강남 0% 마스킹
//   공장창고     금천·강서 0% 마스킹
// → 셋 다 건물 단위로 쓸 수 있다. 마스킹된 행만 건너뛴다(연립다세대와 같은 처리).
async function collectNonRes() {
  console.log('[비주거 매매] 최근 ' + MONTHS_BACK + '개월 · ' + Object.keys(GU).length + '개 지역\n');
  const SRC = [
    ['RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade', '상업업무용', 'nrg'],
    ['RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade', '오피스텔', 'offi'],
    ['RTMSDataSvcInduTrade/getRTMSDataSvcInduTrade', '공장창고', 'indu'],
  ];
  const bld = new Map();
  let masked = 0, total = 0;

  for (const [seg, label, kind] of SRC) {
    const rows = await fetchAll(seg, label);
    for (const r of rows) {
      total++;
      if (!r.jibun || /\*/.test(String(r.jibun))) { masked++; continue; }
      // 키는 `구 동 지번` — 팝업이 갖고 있는 값과 같은 형태다. 시도는 붙이지 않는다:
      // 구 이름이 서울+경기 전체에서 유일해 필요 없고, 키가 짧아 파일이 작아진다.
      const key = r._gu + ' ' + r.umdNm + ' ' + r.jibun;
      let b = bld.get(key);
      if (!b) { b = []; bld.set(key, b); }
      const deal = {
        k: kind,
        p: eok(r.dealAmount),
        ym: r.dealYear + '.' + String(r.dealMonth).padStart(2, '0'),
        y: Number(r.buildYear) || 0,
      };
      // 면적 필드가 유형마다 다르다 — 상업업무용·공장창고는 buildingAr(건물면적),
      // 오피스텔은 excluUseAr(전용면적). 의미가 달라 한 칸에 넣고 구분자(k)로 해석한다.
      const a = Number(r.buildingAr) || Number(r.excluUseAr) || 0;
      if (a) deal.a = Number(a.toFixed(2));
      // ⚠️ floor 를 그대로 믿지 말 것 — 원본에 이상값이 섞여 있다(우리 파싱 버그가 아니다).
      // 실측 2026-08-22: 관악구 봉천동 862-1, buildingAr 7.33㎡ · 판매 · 2,250만원인데 floor=80.
      // 그 건물은 실제로 **지상 15층·지하 8층**이다(사용자 확인). 상가 내 부스/호 번호가
      // 층 칸에 들어간 것으로 보인다.
      //
      // 여기서는 원본을 그대로 싣는다 — 수집기는 건물의 실제 층수를 모르므로 임의 임계값으로
      // 자르면 진짜 고층 거래까지 버린다. **걸러내는 일은 프론트가 한다**: land.html 의
      // nonresFloorOk() 가 같은 건물의 건축물대장 지상층수와 비교해 초과하면 층을 숨긴다.
      const f = parseInt(r.floor, 10);
      if (Number.isFinite(f) && f !== 0) deal.f = f;
      if (r.buildingUse) deal.u = String(r.buildingUse).trim();
      // '(863-9)' 처럼 지번을 괄호로 감싼 자동생성 이름은 정보가 없으므로 버린다.
      if (r.offiNm && !/^\(/.test(String(r.offiNm))) deal.n = String(r.offiNm).trim();
      b.push(deal);
    }
  }

  // 최신 거래가 먼저 오도록 정렬해 둔다 — 프론트가 다시 정렬하지 않게.
  const out = {};
  for (const [k, arr] of bld) {
    arr.sort((x, y2) => (x.ym < y2.ym ? 1 : x.ym > y2.ym ? -1 : 0));
    out[k] = arr;
  }
  const kept = total - masked;
  const pct = total ? Math.round(masked / total * 100) : 0;
  console.log('\n  건물 ' + bld.size.toLocaleString() + '곳 / 거래 ' + kept.toLocaleString()
    + '건 (지번 마스킹 ' + masked.toLocaleString() + '건 제외, ' + pct + '%)');
  writeSafe(path.join(OUT_DIR, 'realprice_nonres' + SUFFIX + '.json'), out, Object.keys(out).length, 'realprice_nonres.json');
  const kb = fs.statSync(path.join(OUT_DIR, 'realprice_nonres' + SUFFIX + '.json')).size / 1024;
  console.log('  realprice_nonres.json 저장 — ' + Object.keys(out).length.toLocaleString() + '곳 / ' + kb.toFixed(0) + 'KB');
  console.log('\n완료.');
}

// ── 3) 메인 ─────────────────────────────────────────────────
(async () => {
  if (process.env.RENT_ONLY === '1') {
    await collectRentOnly();
    return;
  }
  if (process.env.NONRES_ONLY === '1') {
    await collectNonRes();
    return;
  }
  console.log(`수집 기간: 최근 ${MONTHS_BACK}개월 · 서울+경기 ${Object.keys(GU).length}개 지역\n`);

  // 연립다세대 — 건물(지번) 단위로 묶는다
  console.log('[1/3] 연립다세대 매매 수집');
  const rh = await fetchAll('RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade', '연립다세대');
  const bld = new Map();
  for (const r of rh) {
    if (!r.jibun || /\*/.test(r.jibun)) continue;
    const addr = `${SIDO(r._sgg)} ${r._gu} ${r.umdNm} ${r.jibun}`;
    const key = addr + '|' + (r.mhouseNm || '');
    let b = bld.get(key);
    if (!b) { b = { addr, name: r.mhouseNm || r.umdNm, gu: r._gu, dong: r.umdNm, type: r.houseType || '연립다세대', deals: [] }; bld.set(key, b); }
    b.deals.push({
      p: eok(r.dealAmount), a: Number(r.excluUseAr) || 0, f: Number(r.floor) || 0,
      y: Number(r.buildYear) || 0, ym: `${r.dealYear}.${r.dealMonth}`,
    });
  }
  console.log(`  고유 건물 ${bld.size.toLocaleString()}개`);

  console.log('\n[2/3] 지오코딩');
  await geocodeAll(new Set([...bld.values()].map((b) => b.addr)));

  // 압축 포맷 3단 적용 — 3만건 규모라 바이트가 그대로 초기 로딩 시간이 된다.
  //  (1) 키 이름을 한 번만 적고 값은 배열로  (2) 반복되는 문자열은 사전 인덱스로
  //  (3) 좌표는 소수 5자리(약 1m)로 자른다 — 지도 표시에는 6자리가 불필요
  // 연립다세대 전세 시세 (건물 단위 — 매매를 건물 단위로 묶었으므로 면적은 키에 넣지 않는다)
  console.log('\n[전세] 연립다세대');
  const rhJeonse = await fetchJeonse('RTMSDataSvcRHRent/getRTMSDataSvcRHRent', '연립다세대 전월세', 'mhouseNm', false);

  const F = ['name', 'gu', 'dong', 'type', 'lat', 'lng', 'price', 'area', 'floor', 'build', 'ymd', 'cnt', 'pmin', 'pmax', 'jeonse', 'jrate'];
  const gus = [], dongs = [], types = [];
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const villa = [];
  for (const b of bld.values()) {
    const pt = geoCache.get(b.addr);
    if (!pt) continue;
    b.deals.sort((x, y) => (y.ym > x.ym ? 1 : -1));
    const latest = b.deals[0];
    const ps = b.deals.map((d) => d.p).filter((p) => p > 0);
    const jeonse = rhJeonse.get(`${b.addr}|${b.name === b.dong ? '' : b.name}`) || rhJeonse.get(`${b.addr}|${b.name}`) || 0;
    villa.push([
      b.name, idx(gus, b.gu), idx(dongs, b.dong), idx(types, b.type),
      Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5)),
      latest.p, Math.round(latest.a * 10) / 10, latest.f, latest.y, latest.ym,
      b.deals.length, ps.length ? Math.min(...ps) : 0, ps.length ? Math.max(...ps) : 0,
      jeonse, jeonse && latest.p ? Math.round(jeonse / latest.p * 100) : 0,
    ]);
  }
  writeSafe(path.join(OUT_DIR, `realprice_villa${SUFFIX}.json`), { fields: F, gus, dongs, types, rows: villa }, villa.length, 'realprice_villa.json');
  console.log(`  realprice_villa.json 저장 — ${villa.length.toLocaleString()}건 / ${(fs.statSync(path.join(OUT_DIR, `realprice_villa${SUFFIX}.json`)).size / 1048576).toFixed(2)}MB`);

  // ── 아파트 ──────────────────────────────────────────────────
  // 기존 realprice_seoul_gg.json 은 좌표 출처가 불명확해서 클릭 지점과 건물이 어긋났다.
  // Dev 엔드포인트가 지번(jibun)을 주므로 연립다세대와 같은 방식으로 정확히 찍는다.
  // 묶는 단위는 '단지 + 전용면적' 이다. 아파트는 같은 단지라도 평형별 시세가 크게 다르므로
  // 건물 단위로 뭉치면 정보가 뭉개진다.
  if (process.env.WITH_APT === '1') {
    console.log('\n[추가] 아파트 매매 수집 (Dev — 지번 포함)');
    const ap = await fetchAll('RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', '아파트');
    const unit = new Map();
    for (const r of ap) {
      const jibun = r.jibun || (r.bonbun ? String(Number(r.bonbun)) + (Number(r.bubun) ? '-' + Number(r.bubun) : '') : '');
      if (!jibun || /\*/.test(jibun)) continue;
      const addr = `${SIDO(r._sgg)} ${r._gu} ${r.umdNm} ${jibun}`;
      const area = Math.round((Number(r.excluUseAr) || 0) * 10) / 10;
      const key = `${addr}|${r.aptNm}|${area}`;
      let u = unit.get(key);
      if (!u) { u = { addr, name: r.aptNm, gu: r._gu, dong: r.umdNm, area, deals: [] }; unit.set(key, u); }
      u.deals.push({
        p: eok(r.dealAmount), f: Number(r.floor) || 0, y: Number(r.buildYear) || 0,
        ym: `${r.dealYear}.${r.dealMonth}`,
        // 투자 판단에 쓰이는 부가 정보 (Dev 엔드포인트만 제공)
        gbn: r.dealingGbn || '', buyer: r.buyerGbn || '', seller: r.slerGbn || '',
        cancel: (r.cdealType || '').trim(), lease: (r.landLeaseholdGbn || '').trim(),
      });
    }
    console.log(`  단지·평형 조합 ${unit.size.toLocaleString()}개 · 고유 주소 ${new Set([...unit.values()].map((u) => u.addr)).size.toLocaleString()}개`);

    console.log('  지오코딩');
    await geocodeAll(new Set([...unit.values()].map((u) => u.addr)));

    // 아파트 전세 시세 (평형까지 맞춰 묶는다 — 같은 단지도 평형별 전세가율 차이가 크다)
    console.log('  [전세] 아파트');
    const aptJeonse = await fetchJeonse('RTMSDataSvcAptRent/getRTMSDataSvcAptRent', '아파트 전월세', 'aptNm', true);

    const AF = ['name', 'gu', 'dong', 'lat', 'lng', 'price', 'area', 'floor', 'build', 'ymd', 'cnt', 'pmin', 'pmax', 'gbn', 'cancel', 'lease', 'jeonse', 'jrate'];
    const agus = [], adongs = [], agbns = [];
    const aidx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
    const apt = [];
    for (const u of unit.values()) {
      const pt = geoCache.get(u.addr);
      if (!pt) continue;
      u.deals.sort((x, y) => (y.ym > x.ym ? 1 : -1));
      const latest = u.deals[0];
      const ps = u.deals.map((d) => d.p).filter((p) => p > 0);
      const jeonse = aptJeonse.get(`${u.addr}|${u.name}|${u.area}`) || 0;
      apt.push([
        u.name, aidx(agus, u.gu), aidx(adongs, u.dong),
        Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5)),
        latest.p, u.area, latest.f, latest.y, latest.ym,
        u.deals.length, ps.length ? Math.min(...ps) : 0, ps.length ? Math.max(...ps) : 0,
        aidx(agbns, latest.gbn), latest.cancel ? 1 : 0, latest.lease === 'Y' ? 1 : 0,
        jeonse, jeonse && latest.p ? Math.round(jeonse / latest.p * 100) : 0,
      ]);
    }
    writeSafe(path.join(OUT_DIR, `realprice_apt${SUFFIX}.json`),
      { fields: AF, gus: agus, dongs: adongs, gbns: agbns, rows: apt }, apt.length, 'realprice_apt.json');
  }

  // 단독다가구 — 지번이 마스킹돼 개별 좌표 불가. 동 단위 집계만.
  console.log('\n[3/3] 단독다가구 매매 수집 (동 단위 집계)');
  const sh = await fetchAll('RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade', '단독다가구');
  const dong = new Map();
  for (const r of sh) {
    const k = `${r._gu}|${r.umdNm}`;
    let d = dong.get(k);
    if (!d) { d = { gu: r._gu, dong: r.umdNm, prices: [], plots: [], areas: [], years: [] }; dong.set(k, d); }
    const p = eok(r.dealAmount);
    if (p > 0) d.prices.push(p);
    if (Number(r.plottageAr)) d.plots.push(Number(r.plottageAr));
    if (Number(r.totalFloorAr)) d.areas.push(Number(r.totalFloorAr));
    if (Number(r.buildYear)) d.years.push(Number(r.buildYear));
  }
  const house = {};
  for (const d of dong.values()) {
    house[`${d.gu} ${d.dong}`] = {
      cnt: d.prices.length, med: median(d.prices),
      min: d.prices.length ? Math.min(...d.prices) : 0, max: d.prices.length ? Math.max(...d.prices) : 0,
      plot: median(d.plots), area: median(d.areas), build: median(d.years),
    };
  }
  writeSafe(path.join(OUT_DIR, `realprice_house${SUFFIX}.json`), house, Object.keys(house).length, 'realprice_house.json');
  console.log(`  realprice_house.json 저장 — ${Object.keys(house).length}개 동 / ${(fs.statSync(path.join(OUT_DIR, `realprice_house${SUFFIX}.json`)).size / 1024).toFixed(0)}KB`);

  console.log('\n완료.');
})();
