#!/usr/bin/env node
/**
 * CCTV 표준데이터 수집기 — ITS(고속도로·국도) + data.go.kr 표준데이터 병합
 *
 * 사용법:
 *   node tools/collect_cctv.js                        # ITS + 표준데이터(키 필요)
 *   node tools/collect_cctv.js --its-only             # ITS만
 *   node tools/collect_cctv.js --standard-only        # 표준데이터만
 *
 * 산출물: cctv_static.json — [{ name, purpose, lat, lng, source, ... }, ...]
 *   source: "its" | "standard"
 *   ITS: 실시간 영상 URL 포함 (cctvurl)
 *   standard: 전국 CCTV 표준데이터 (위치+목적+관리기관+카메라대수 등)
 *
 * 참고:
 *   - ITS API: openapi.its.go.kr:9443/cctvInfo (무료 공개, 브라우저 직접 호출)
 *   - 표준데이터 API: apis.data.go.kr/1741000/cctv_info/info (data.go.kr, 자동승인)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'cctv_static.json');
const ITS_KEY = process.env.ITS_KEY || '143145cd464a4522b3a9347a9d768d4f';

// data.go.kr 키: keys.env에서 읽기 시도, 없으면 환경변수
function loadDgkKey() {
  try {
    const envFile = fs.readFileSync(path.resolve(__dirname, '..', 'keys.env'), 'utf8');
    const m = envFile.match(/^DGK=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return process.env.DGK || '';
}
const DGK_KEY = loadDgkKey();
// data.go.kr 은 계정당 인증키가 공용이다 — 같은 키를 쓰는 수집기가 동시에 돌면
// 합계가 일 한도를 넘겨 데이터가 조용히 비워진다(2026-08-22 서울 12개 구 유실, §54).
require('./dgk_lock')('collect_cctv');


const ITS_ONLY = process.argv.includes('--its-only');
const STANDARD_ONLY = process.argv.includes('--standard-only');

// 서울시 경계 (대략적)
const SEOUL = { minY: 37.413, maxY: 37.715, minX: 126.734, maxX: 127.269 };

function fetchJson(url, retries = 2) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'matjip-cctv/1.0' }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, retries).then(resolve, reject);
      }
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('JSON parse failed: ' + d.slice(0, 200))); }
      });
    }).on('error', (e) => {
      if (retries > 0) {
        setTimeout(() => fetchJson(url, retries - 1).then(resolve, reject), 1000);
      } else {
        reject(e);
      }
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── ITS (고속도로 + 국도) ──
async function fetchIts(minX, maxX, minY, maxY) {
  const call = (type) => fetchJson(
    `https://openapi.its.go.kr:9443/cctvInfo?apiKey=${ITS_KEY}&type=${type}&cctvType=2` +
    `&minX=${minX}&maxX=${maxX}&minY=${minY}&maxY=${maxY}&getType=json`
  ).then((j) => (j?.response?.data || [])).catch(() => []);
  const [ex, its] = await Promise.all([call('ex'), call('its')]);
  return [...ex, ...its].map((d) => ({
    name: d.cctvname || '',
    lat: Number(d.coordy),
    lng: Number(d.coordx),
    url: d.cctvurl || '',
    format: d.cctvformat || '',
    purpose: '교통정보',
    source: 'its',
  }));
}

// ── data.go.kr 표준데이터 (행정안전부 CCTV) ──
async function fetchStandard(apiKey) {
  const BASE = 'https://apis.data.go.kr/1741000/cctv_info/info';
  const PER_PAGE = 100;
  const results = [];

  // 먼저 totalCount 확인
  const firstUrl = `${BASE}?serviceKey=${apiKey}&pageNo=1&numOfRows=1&returnType=json`;
  const first = await fetchJson(firstUrl);
  const header = first?.response?.header;
  if (header?.resultCode !== '0') {
    console.error(`[표준데이터] API 오류: ${header?.resultMsg || '알 수 없음'}`);
    return [];
  }
  const total = first?.response?.body?.totalCount || 0;
  console.log(`[표준데이터] 전국 ${total.toLocaleString()}건 중 서울 필터링...`);

  const totalPages = Math.ceil(total / PER_PAGE);
  let fetched = 0;

  for (let page = 1; page <= totalPages; page++) {
    const url = `${BASE}?serviceKey=${apiKey}&pageNo=${page}&numOfRows=${PER_PAGE}&returnType=json`;
    try {
      const data = await fetchJson(url);
      const items = data?.response?.body?.items?.item || [];
      if (!Array.isArray(items)) continue;

      for (const it of items) {
        const lat = parseFloat(it.WGS84_LAT);
        const lng = parseFloat(it.WGS84_LOT);
        if (!lat || !lng) continue;
        // 서울시 필터: 좌표 박스 + 주소 검증
        // - 좌표 박스 밖 → 무조건 스킵
        // - 좌표 박스 안인데 주소가 있고 '서울'로 안 시작 → 스킵 (광명시·김포시 등)
        // - 좌표 박스 안인데 주소 없거나 '서울' 시작 → 통과
        const addr = it.LCTN_ROAD_NM_ADDR || it.LCTN_LOTNO_ADDR || '';
        const inBox = lat >= SEOUL.minY && lat <= SEOUL.maxY && lng >= SEOUL.minX && lng <= SEOUL.maxX;
        if (!inBox) continue;
        if (addr && !addr.startsWith('서울')) continue;

        results.push({
          name: it.FCLT_NM || it.MNG_NO || '',
          lat,
          lng,
          purpose: it.INSTL_PRPS_SE_NM || '',
          address: it.LCTN_ROAD_NM_ADDR || it.LCTN_LOTNO_ADDR || '',
          agency: it.MNG_INST_NM || '',
          phone: it.MNG_INST_TELNO || '',
          camCount: it.CAM_CNTOM || '',
          camPixel: it.CAM_PIXEL_CNT || '',
          angle: it.SHT_ANGLE_INFO || '',
          keepDays: it.KPNG_DAY_CNT || '',
          installDate: it.INSTL_YM || '',
          source: 'standard',
        });
      }

      fetched += items.length;
      if (page % 50 === 0 || page === totalPages) {
        console.log(`[표준데이터] ${page}/${totalPages} 페이지 (${fetched.toLocaleString()}/${total.toLocaleString()}), 서울 ${results.length}건`);
      }
    } catch (e) {
      console.error(`[표준데이터] 페이지 ${page} 실패: ${e.message}`);
    }
    // rate limit: 100ms 간격 (10,000 req/day → 초당 약 28건 여유)
    await sleep(100);
  }

  return results;
}

// ── 서울시 경계 내 필터 ──
function filterSeoul(items) {
  return items.filter((d) =>
    d.lat >= SEOUL.minY && d.lat <= SEOUL.maxY &&
    d.lng >= SEOUL.minX && d.lng <= SEOUL.maxX
  );
}

async function main() {
  const results = [];

  if (!STANDARD_ONLY) {
    console.log('[ITS] 서울시 범위 조회 중...');
    const its = await fetchIts(SEOUL.minX, SEOUL.maxX, SEOUL.minY, SEOUL.maxY);
    const seoul = filterSeoul(its);
    console.log(`[ITS] 전체 ${its.length}건, 서울 ${seoul.length}건`);
    results.push(...seoul);
  }

  if (!ITS_ONLY) {
    if (DGK_KEY) {
      console.log('[표준데이터] data.go.kr CCTV 조회 중...');
      const standard = await fetchStandard(DGK_KEY);
      console.log(`[표준데이터] 서울 ${standard.length}건`);
      results.push(...standard);
    } else {
      console.log('[표준데이터] DGK 키 없음 — 건너뜀. keys.env에 DGK=... 설정 필요.');
    }
  }

  // dedup by lat|lng (소수점 4자리 = 약 11m)
  const seen = new Set();
  const deduped = results.filter((d) => {
    const key = `${d.lat.toFixed(4)}|${d.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // 소스별 통계
  const bySrc = {};
  deduped.forEach((d) => { bySrc[d.source] = (bySrc[d.source] || 0) + 1; });
  console.log(`\n[결과] 소스별: ${JSON.stringify(bySrc)}`);
  console.log(`[총 ${deduped.length}건 저장] → ${OUT}`);
  fs.writeFileSync(OUT, JSON.stringify(deduped, null, 2));
  console.log('완료.');
}

main().catch((e) => { console.error(e); process.exit(1); });
