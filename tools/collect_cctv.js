#!/usr/bin/env node
/**
 * CCTV 표준데이터 수집기 — ITS(고속도로·국도) + TOPIS(서울시) 병합
 *
 * 사용법:
 *   node tools/collect_cctv.js                        # ITS만 (키 불필요, 브라우저 직접 호출)
 *   TOPIS_KEY=xxx node tools/collect_cctv.js           # ITS + TOPIS 병합
 *   node tools/collect_cctv.js --topis-key=xxx         # 위와 동일
 *   node tools/collect_cctv.js --topis-only             # TOPIS만
 *
 * 산출물: cctv_static.json — [{ name, purpose, lat, lng, source, ... }, ...]
 *   source: "its" | "topis"
 *   ITS: 실시간 영상 URL 포함 (cctvurl)
 *   TOPIS: 서울시 도심 교통 CCTV (위치+목적)
 *
 * 참고:
 *   - ITS API: openapi.its.go.kr:9443/cctvInfo (무료 공개, 브라우저 직접 호출)
 *   - TOPIS API: data.seoul.go.kr OA-20477 등 (API키 필요, 자동승인)
 *   - 표준데이터 CSV: data.go.kr/15013094 (353,263건, 브라우저 다운로드 필요 — 향후 대상)
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = path.resolve(__dirname, '..', 'cctv_static.json');
const ITS_KEY = process.env.ITS_KEY || '143145cd464a4522b3a9347a9d768d4f';
const TOPIS_KEY = process.argv.find((a) => a.startsWith('--topis-key='))
  ? process.argv.find((a) => a.startsWith('--topis-key=')).split('=')[1]
  : process.env.TOPIS_KEY || '';
const TOPIS_ONLY = process.argv.includes('--topis-only');

// 서울시 경계 (대략적)
const SEOUL = { minY: 37.413, maxY: 37.715, minX: 126.734, maxX: 127.269 };

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'matjip-cctv/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location).then(resolve, reject);
      }
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error('JSON parse failed: ' + d.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

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

// ── TOPIS (서울시 교통 CCTV) ──
async function fetchTopis(apiKey) {
  // TOPIS CCTV API: data.seoul.go.kr OA-20477 (불법주정차) 또는 관련 서비스
  // 엔드포인트·파라미터는 API 신청 후 확정 — 여기서는 일반적인 구조로 작성
  const base = `http://openapi.seoul.go.kr:8088/${apiKey}/json`;
  // 예시: CCTV 교통정보 서비스 (서비스명은 신청 후 확인)
  const url = `${base}/CctvInfo/1/1000`;
  try {
    const data = await fetchJson(url);
    const rows = data?.CctvInfo || data?.row || [];
    return rows.map((r) => ({
      name: r.CCTV_NAME || r.fcltNm || r.name || '',
      lat: Number(r.CCTV_Y || r.lat || 0),
      lng: Number(r.CCTV_X || r.lng || 0),
      purpose: r.INSTALL_PURPOSE || r.purpose || '교통정보',
      address: r.ADDR || r.addr || '',
      source: 'topis',
    })).filter((d) => d.lat && d.lng);
  } catch (e) {
    console.error('[TOPIS] 조회 실패:', e.message);
    return [];
  }
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

  if (!TOPIS_ONLY) {
    console.log('[ITS] 서울시 범위 조회 중...');
    const its = await fetchIts(SEOUL.minX, SEOUL.maxX, SEOUL.minY, SEOUL.maxY);
    const seoul = filterSeoul(its);
    console.log(`[ITS] 전체 ${its.length}건, 서울 ${seoul.length}건`);
    results.push(...seoul);
  }

  if (TOPIS_KEY) {
    console.log('[TOPIS] 서울시 CCTV 조회 중...');
    const topis = await fetchTopis(TOPIS_KEY);
    console.log(`[TOPIS] ${topis.length}건`);
    results.push(...topis);
  } else if (!TOPIS_ONLY) {
    console.log('[TOPIS] 키 없음 — 건너뜀. 서울시 도심 CCTV 추가 시 TOPIS_KEY 설정 필요.');
  }

  // dedup by lat|lng (소수점 4자리 = 약 11m)
  const seen = new Set();
  const deduped = results.filter((d) => {
    const key = `${d.lat.toFixed(4)}|${d.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`[총 ${deduped.length}건 저장] → ${OUT}`);
  fs.writeFileSync(OUT, JSON.stringify(deduped, null, 2));
  console.log('완료.');
}

main().catch((e) => { console.error(e); process.exit(1); });
