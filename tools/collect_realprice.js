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

const KEY = process.env.DGK;
if (!KEY) {
  console.error('DGK 환경변수에 data.go.kr 인증키를 넣어 실행하세요.');
  process.exit(1);
}
const VWORLD_KEY = process.env.VWORLD_KEY || 'B2CDEEDD-D622-311B-883B-CC7890E50822';
const OUT_DIR = path.resolve(__dirname, '..');
const MONTHS_BACK = Number(process.env.MONTHS || 12);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

const GU_ALL = {
  11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구',
  11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구',
  11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구',
  11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구',
  11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구',
};
// ONLY_GU=11620,11440 처럼 지정하면 일부 구만 수집한다 (전체 실행 전 점검용).
// SUFFIX=_test 를 주면 산출 파일명 뒤에 붙어 실제 데이터를 덮어쓰지 않는다.
const ONLY = (process.env.ONLY_GU || '').split(',').map((s) => s.trim()).filter(Boolean);
const GU = ONLY.length
  ? Object.fromEntries(Object.entries(GU_ALL).filter(([cd]) => ONLY.includes(cd)))
  : GU_ALL;
const SUFFIX = process.env.SUFFIX || '';

// ── 공통 유틸 ────────────────────────────────────────────────
// keepAlive 필수. 수천 건을 연달아 요청하면 Windows 에서 임시 포트가 고갈돼
// 조용히 실패한다. 실측: 에이전트 없이 돌렸을 때 지오코딩 성공률이 91.7% -> 81.0% 로
// 떨어졌는데, 같은 주소를 순차로 부르면 205/205 로 전부 성공했다.
const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 3000, maxSockets: 8 });

function httpGet(url, tries = 3) {
  return new Promise((resolve) => {
    const attempt = (n) => {
      const retryOrGiveUp = () => (n < tries ? setTimeout(() => attempt(n + 1), 400 * n) : resolve(''));
      https.get(url, { agent, headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        // setEncoding 이 없으면 한글이 깨진다. 응답은 Buffer 로 쪼개져 오는데,
        // 청크마다 문자열로 이어붙이면 3바이트 한글이 청크 경계에 걸릴 때 손상된다.
        // 실측: 이것 없이 수집했을 때 23,726건 중 40건(0.17%)에 U+FFFD 가 섞였고
        //       '다세대'가 '다세��' 처럼 갈라져 유형 사전이 3개에서 8개로 늘었다.
        res.setEncoding('utf8');
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
          // data.go.kr 은 간헐적으로 500 을 뱉는다. 빈 본문도 실패로 보고 재시도한다.
          if (res.statusCode !== 200 || !d) return retryOrGiveUp();
          resolve(d);
        });
      }).on('error', retryOrGiveUp);
    };
    attempt(1);
  });
}

function parseItems(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const o = {};
    const r2 = /<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = r2.exec(m[1]))) o[t[1]] = t[2].trim();
    out.push(o);
  }
  return out;
}

function recentMonths(n) {
  const out = [];
  const now = new Date(2026, 6, 1); // 수집 기준월. 실행 시점에 맞춰 조정 가능.
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}

const eok = (amt) => Math.round(Number(String(amt).replace(/[,\s]/g, '')) / 10000 * 10) / 10;

// ── 1) 국토부 수집 ───────────────────────────────────────────
async function fetchAll(pathSeg, label) {
  const months = recentMonths(MONTHS_BACK);
  const rows = [];
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
        const xml = await httpGet(`https://apis.data.go.kr/1613000/${pathSeg}?serviceKey=${KEY}&LAWD_CD=${cd}&DEAL_YMD=${ym}&numOfRows=1000&pageNo=${page}&_type=xml`);
        const its = parseItems(xml);
        for (const r of its) rows.push(Object.assign(r, { _gu: GU[cd], _sgg: cd }));
        const tot = Number((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [, 0])[1]);
        if (page * 1000 >= tot || !its.length) break;
        page++;
      }
      done++;
      if (done % 50 === 0) console.log(`  [${label}] ${done}/${jobs.length} (누적 ${rows.length.toLocaleString()}건)`);
    }
  }));
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
  if (geoCache.has(addr)) return { pt: geoCache.get(addr), blocked: false };
  const url = `https://api.vworld.kr/req/address?service=address&request=getcoord&version=2.0`
    + `&crs=EPSG:4326&type=PARCEL&format=json&key=${VWORLD_KEY}&address=${encodeURIComponent(addr)}`;
  let pt = null, blocked = false;
  // NOT_FOUND 는 확정 실패라 재시도하지 않는다. 차단(502/RST)만 물러섰다가 다시 시도한다.
  for (let attempt = 1; attempt <= 4; attempt++) {
    const body = await httpGet(url, 1);
    let status = null;
    try { status = JSON.parse(body).response.status; } catch (e) { status = null; }
    if (status === 'OK') {
      try {
        const p = JSON.parse(body).response.result.point;
        pt = [Number(Number(p.y).toFixed(6)), Number(Number(p.x).toFixed(6))];
      } catch (e) {}
      blocked = false;
      break;
    }
    if (status === 'NOT_FOUND') { blocked = false; break; }
    blocked = true;
    await sleep(400 * attempt * attempt);  // 차단이면 점점 크게 물러선다
  }
  geoCache.set(addr, pt);
  saveCheckpoint();
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
      const { pt, blocked } = await geocode(a);
      if (pt) hit++;
      if (blocked) blockedCnt++;
      done++;
      if (done % 1000 === 0) {
        const sec = (Date.now() - t0) / 1000;
        const eta = Math.round((list.length - done) / (done / sec) / 60);
        console.log(`  [지오코딩] ${done}/${list.length} · 성공 ${hit} (${(hit / done * 100).toFixed(1)}%) · 차단잔여 ${blockedCnt} · 남은시간 약 ${eta}분`);
      }
      if (GEO_GAP_MS) await sleep(GEO_GAP_MS);
    }
  }));
  saveCheckpoint(true);
  console.log(`  [지오코딩] 완료 ${done}건 중 성공 ${hit}건 (${(hit / done * 100).toFixed(1)}%) · 끝내 차단 ${blockedCnt}건`);
}

// ── 3) 메인 ─────────────────────────────────────────────────
(async () => {
  console.log(`수집 기간: 최근 ${MONTHS_BACK}개월 · 서울 ${Object.keys(GU).length}개 구\n`);

  // 연립다세대 — 건물(지번) 단위로 묶는다
  console.log('[1/3] 연립다세대 매매 수집');
  const rh = await fetchAll('RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade', '연립다세대');
  const bld = new Map();
  for (const r of rh) {
    if (!r.jibun || /\*/.test(r.jibun)) continue;
    const addr = `서울특별시 ${r._gu} ${r.umdNm} ${r.jibun}`;
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
  const F = ['name', 'gu', 'dong', 'type', 'lat', 'lng', 'price', 'area', 'floor', 'build', 'ymd', 'cnt', 'pmin', 'pmax'];
  const gus = [], dongs = [], types = [];
  const idx = (arr, v) => { let i = arr.indexOf(v); if (i < 0) { i = arr.length; arr.push(v); } return i; };
  const villa = [];
  for (const b of bld.values()) {
    const pt = geoCache.get(b.addr);
    if (!pt) continue;
    b.deals.sort((x, y) => (y.ym > x.ym ? 1 : -1));
    const latest = b.deals[0];
    const ps = b.deals.map((d) => d.p).filter((p) => p > 0);
    villa.push([
      b.name, idx(gus, b.gu), idx(dongs, b.dong), idx(types, b.type),
      Number(pt[0].toFixed(5)), Number(pt[1].toFixed(5)),
      latest.p, Math.round(latest.a * 10) / 10, latest.f, latest.y, latest.ym,
      b.deals.length, ps.length ? Math.min(...ps) : 0, ps.length ? Math.max(...ps) : 0,
    ]);
  }
  fs.writeFileSync(path.join(OUT_DIR, `realprice_villa${SUFFIX}.json`), JSON.stringify({ fields: F, gus, dongs, types, rows: villa }));
  console.log(`  realprice_villa.json 저장 — ${villa.length.toLocaleString()}건 / ${(fs.statSync(path.join(OUT_DIR, `realprice_villa${SUFFIX}.json`)).size / 1048576).toFixed(2)}MB`);

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
  const med = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return Math.round(s[s.length >> 1] * 10) / 10; };
  const house = {};
  for (const d of dong.values()) {
    house[`${d.gu} ${d.dong}`] = {
      cnt: d.prices.length, med: med(d.prices),
      min: d.prices.length ? Math.min(...d.prices) : 0, max: d.prices.length ? Math.max(...d.prices) : 0,
      plot: med(d.plots), area: med(d.areas), build: med(d.years),
    };
  }
  fs.writeFileSync(path.join(OUT_DIR, `realprice_house${SUFFIX}.json`), JSON.stringify(house));
  console.log(`  realprice_house.json 저장 — ${Object.keys(house).length}개 동 / ${(fs.statSync(path.join(OUT_DIR, `realprice_house${SUFFIX}.json`)).size / 1024).toFixed(0)}KB`);

  console.log('\n완료.');
})();
