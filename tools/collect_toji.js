#!/usr/bin/env node
/**
 * 토지거래계약에관한허가구역 수집기 — 서울도시공간포털(urban.seoul.go.kr) ArcGIS
 *
 * 사용법:  node tools/collect_toji.js
 *          (polygon-clipping 필요: npm i --no-save polygon-clipping)
 * 산출물:  toji_heoga.geojson  (land.html 의 '토지거래허가구역' 레이어가 그대로 읽는다)
 *
 * 왜 이 소스인가 (2026-08-06 실측):
 *  - 기존 파일은 "지정 동 전체를 칠하는 근사치"였다. 서울 행정동 경계는 한강 수면까지
 *    포함하므로 압구정·성수·여의도 일대에서 한강이 통째로 칠해지는 문제가 있었다.
 *  - V-World 의 lt_c_upisuq175 도 검토했으나 서울 데이터가 아예 없다(실측: 경기 23·
 *    인천 11·파주 2건뿐, 서울 0건). 서울은 시가 자체 지정하므로 국토부 전국 레이어에
 *    안 들어간다. 그래서 서울시 UPIS 레이어를 직접 쓴다.
 *  - UPIS 레이어 92 = UPIS_C_UQ175. 실제 경계 420건(25개 자치구 전부).
 *
 * 한강을 빼는 이유:
 *  - 2026-07-20 자로 강남·서초·송파·용산 등 '자치구 전역' 지정이 들어와 있다(실측:
 *    서초 46.9㎢, 강남 39.5㎢ 등 10건이 구 면적과 거의 같음). 자치구 경계는 한강
 *    중앙선까지 가므로 원본 그대로 칠하면 한강 수면이 통째로 덮인다.
 *  - 행정적으로는 맞는 경계지만 부동산 지도에서는 노이즈라 하천을 빼고 저장한다.
 *
 * 하천 소스를 둘 다 쓰는 이유 (2026-08-06 실측):
 *  - UPIS_SHP_RIVER(레이어 239) 하나만으로 빼면 물 위 샘플의 38.9%가 여전히 덮였다
 *    (영등포·용산·마포 구간에 구멍이 있다). V-World lt_c_wkmstrm 도 성수대교·여의도
 *    북측 일부를 안 덮는다. 두 데이터의 빈 구간이 서로 달라, 합집합으로 빼야 메워진다.
 *  - 검증은 손으로 찍은 좌표가 아니라 '하천 폴리곤 내부에서 뽑은 샘플점'으로 한다
 *    (tools 밖 스크립트였지만 방법은 이 주석에 남긴다 — 샘플 0% 덮임이 목표).
 *
 * 정비사업 수집기(collect_redevelop.js)와 같은 프록시·같은 MapServer 를 쓴다.
 */

const fs = require('fs');
const path = require('path');
const pc = require('polygon-clipping');

const PROXY = 'https://urban.seoul.go.kr/proxy/proxy.jsp?';
const WMS = 'http://98.33.2.225:6080/arcgis/rest/services/UPIS/20200526_WMS/MapServer';
const LAYER_ID = 92;   // UPIS_C_UQ175 (토지거래계약에관한허가구역)
const RIVER_ID = 239;  // UPIS_SHP_RIVER (한강 등 하천 폴리곤)
// V-World 하천(면). WFS MAXFEATURES 상한이 1000이라 그 안에서 받는다(서울 구간 114건).
const VWORLD_KEY = process.env.VWORLD_KEY || '';
const VW_WFS = 'https://api.vworld.kr/req/wfs';
const VW_DOMAIN = process.env.VWORLD_DOMAIN || 'https://conoc612-a11y.github.io';
const OUT = path.resolve(__dirname, '..', 'toji_heoga.geojson');
// 좌표 소수 6자리 ≈ 0.1m. 원본은 float 전체 자리라 파일이 5.5MB까지 커진다.
const PRECISION = 6;

// SIGNGU_SE(자치구 코드) → 이름. collect_redevelop.js 와 동일 표.
const SIGNGU = {
  11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구',
  11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구',
  11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구',
  11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구',
  11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구',
};

async function query(layerId) {
  const url = `${WMS}/${layerId}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;
  const r = await fetch(PROXY + url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' (layer ' + layerId + ')');
  return (await r.json()).features || [];
}

// V-World 하천(면) — 키가 없으면 조용히 건너뛴다(UPIS 하천만으로도 대부분은 빠진다).
async function vworldStreams() {
  if (!VWORLD_KEY) {
    console.warn('VWORLD_KEY 없음 — V-World 하천 생략(한강 일부가 남을 수 있음). 예: VWORLD_KEY=... node tools/collect_toji.js');
    return [];
  }
  const q = `SERVICE=WFS&VERSION=1.1.0&REQUEST=GetFeature&TYPENAME=lt_c_wkmstrm`
    + `&BBOX=37.40,126.75,37.72,127.25&SRSNAME=EPSG:4326&OUTPUT=application/json`
    + `&MAXFEATURES=1000&KEY=${VWORLD_KEY}&DOMAIN=${encodeURIComponent(VW_DOMAIN)}`;
  const r = await fetch(`${VW_WFS}?${q}`);
  const text = await r.text();
  if (text.trim().startsWith('<')) { console.warn('V-World 하천 응답이 XML(오류) — 생략'); return []; }
  try { return JSON.parse(text).features || []; } catch (e) { console.warn('V-World 하천 파싱 실패 — 생략'); return []; }
}

// GeoJSON geometry → polygon-clipping 이 쓰는 다중폴리곤 좌표 배열
const toMulti = (geom) => (geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates]);
const round = (n) => Number(n.toFixed(PRECISION));

// Douglas–Peucker 단순화. 원본은 필지 경계라 정점이 19만 개(4.3MB)까지 나오는데,
// 이 레이어는 도시 스케일에서 손으로 켜는 오버레이라 그 정밀도가 화면에 보이지 않는다.
// TOLERANCE 는 도(度) 단위 — 위도 1e-5° ≈ 1.1m.
const TOLERANCE = 2e-5; // 약 2m
function simplifyRing(ring) {
  if (ring.length <= 4) return ring;
  const sqSegDist = (p, a, b) => {
    let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx !== 0 || dy !== 0) {
      const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; }
    }
    return (p[0] - x) ** 2 + (p[1] - y) ** 2;
  };
  const keep = new Array(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack = [[0, ring.length - 1]];
  const tol2 = TOLERANCE * TOLERANCE;
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = sqSegDist(ring[i], ring[s], ring[e]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tol2 && idx > 0) { keep[idx] = true; stack.push([s, idx], [idx, e]); }
  }
  const out = ring.filter((_, i) => keep[i]);
  // 링이 삼각형 미만으로 뭉개지면 원본을 쓴다(면이 사라지는 것보단 낫다).
  return out.length >= 4 ? out : ring;
}
// 주의: 단순화는 반드시 '하천을 빼기 전'에 해야 한다. 클리핑 뒤에 단순화하면
// 강기슭을 따라 생긴 정교한 경계가 다시 직선으로 펴지면서 물 위를 덮는다
// (실측: 물 위 샘플 커버율 1.6% → 7.9% 로 악화). 그래서 두 단계를 분리했다.
const simplifyMulti = (mp) => mp
  .map((poly) => poly.map((ring) => simplifyRing(ring)))
  .filter((poly) => poly[0] && poly[0].length >= 4);
const roundMulti = (mp) => mp
  .map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)])))
  .filter((poly) => poly[0] && poly[0].length >= 4);

async function main() {
  const [src, river, vwRiver] = await Promise.all([query(LAYER_ID), query(RIVER_ID), vworldStreams()]);
  console.log('허가구역 원본:', src.length, '건 / UPIS 하천:', river.length, '건 / V-World 하천:', vwRiver.length, '건');
  if (!src.length) throw new Error('피처 0건 — 레이어 ID나 서비스 주소를 다시 확인할 것');

  // 두 하천 데이터의 빈 구간이 서로 달라 합집합으로 만들어야 한강이 온전히 메워진다.
  const riverMulti = [...river, ...vwRiver].filter((f) => f.geometry).flatMap((f) => toMulti(f.geometry));
  const riverUnion = riverMulti.length ? pc.union(riverMulti) : null;

  // 같은 구역이 여러 번 고시되어 완전히 겹치는 중복이 있다(실측: 강남구 39,497,148㎡ 3건 등).
  // 그대로 두면 반투명 채움이 겹쳐 진해지고 파일만 커지므로 면적+구 기준으로 중복을 없앤다.
  const seen = new Set();
  let dupes = 0, clipped = 0, dropped = 0;

  const features = [];
  for (const f of src) {
    if (!f.geometry) continue;
    const p = f.properties || {};
    const gu = SIGNGU[p.SIGNGU_SE] || String(p.SIGNGU_SE || '');
    const areaM2 = Math.round(Number(p.DGM_AR) || 0);
    const key = gu + '|' + areaM2 + '|' + Math.round(Number(p.DGM_LT) || 0);
    if (seen.has(key)) { dupes++; continue; }
    seen.add(key);

    let mp = simplifyMulti(toMulti(f.geometry));
    if (riverUnion) {
      try {
        const diff = pc.difference(mp, riverUnion);
        if (!diff || !diff.length) { dropped++; continue; } // 전부 수면이면 버린다
        if (JSON.stringify(diff) !== JSON.stringify(mp)) clipped++;
        mp = diff;
      } catch (e) {
        // 자기교차 등으로 클리핑이 실패하면 원본을 그대로 쓴다(칠해지는 게 안 보이는 것보단 낫다).
        console.warn('  클리핑 실패, 원본 사용:', p.PRESENT_SN, e.message);
      }
    }

    features.push({
      type: 'Feature',
      properties: {
        // land.html 이 properties.name 을 툴팁에 쓰므로 그 형태를 유지한다.
        name: gu + (areaM2 ? ` · ${areaM2.toLocaleString()}㎡` : ''),
        sgg: gu,
        area: areaM2,
        sn: p.PRESENT_SN || '',
        // CREATE_DAT 은 epoch(ms). 지정/갱신 시점 파악용으로 날짜만 남긴다.
        create: p.CREATE_DAT ? new Date(p.CREATE_DAT).toISOString().slice(0, 10) : '',
      },
      geometry: { type: 'MultiPolygon', coordinates: roundMulti(mp) },
    });
  }

  const byGu = {};
  features.forEach((f) => { byGu[f.properties.sgg] = (byGu[f.properties.sgg] || 0) + 1; });
  console.log('중복 제거:', dupes, '건 / 한강 잘라냄:', clipped, '건 / 전부 수면이라 제외:', dropped, '건');
  console.log('구별:', JSON.stringify(byGu));

  fs.writeFileSync(OUT, JSON.stringify({ type: 'FeatureCollection', features }));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log('저장 완료:', OUT, '(' + features.length + '건, ' + kb.toLocaleString() + 'KB)');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
