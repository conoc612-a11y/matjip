#!/usr/bin/env node
/**
 * 정비사업 구역 전체 수집기 — 서울도시공간포털(urban.seoul.go.kr) ArcGIS WMS
 *
 * 사용법:  node tools/collect_redevelop.js
 *
 * 산출물:
 *   redevelop_seoul.json     전체 정비사업 구역 메타 (UQ120, 2,964건) + cafe 보존 매칭
 *   redevelop_polygons.json  구역 폴리곤 (PRESENT_SN → [lat,lng] 링 배열)
 *
 * 데이터 소스 (2026-08-05 실측):
 *   - 레이어: https://urban.seoul.go.kr/proxy/proxy.jsp?<내부 ArcGIS WMS>/20200526_WMS/MapServer/<id>/query
 *   - 레이어 94~122 (UPIS_C_UQ120_BZ101~BZ606) = UQ120 정비사업 전체, 유형(BZ)별 분리
 *   - outSR=4326 → WGS84(lon/lat). GeoJSON 좌표를 [lat,lng]로 스왑해 저장 (기존 파일 포맷 유지)
 *   - 진행단계: bsns/getPropelCdByCd.json (POST {"propelCd":""}) → PROPEL_CD 코드명 매핑
 *
 * cafe(정보공개 링크)는 기존 redevelop_seoul.json과 자치구+이름으로 매칭해 보존한다.
 * (새 데이터는 cleanup cafe 필드가 없으므로, 매칭 안 되면 cafe 없음 → land.html은 링크 미노출)
 */

const fs = require('fs');
const path = require('path');

const PROXY = 'https://urban.seoul.go.kr/proxy/proxy.jsp?';
const WMS = 'http://98.33.2.225:6080/arcgis/rest/services/UPIS/20200526_WMS/MapServer';
const OUT_DIR = path.resolve(__dirname, '..');

// SIGNGU_SE(자치구 코드) → 이름
const SIGNGU = {
  11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구',
  11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구',
  11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구',
  11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구',
  11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구',
};

// BZ 유형코드 → gubun(기존 matjip 분류와 호환) + 표시용 유형명
const BZ = {
  BZ101: ['신통', '신속통합기획'],
  BZ102: ['재개발', '재개발(도시정비형)'],
  BZ103: ['재개발', '재개발(주택정비형)'],
  BZ104: ['재건축', '재건축(단독)'],
  BZ105: ['재건축', '재건축(공동)'],
  BZ107: ['지역주택', '주거환경개선(도시형)'],
  BZ108: ['지역주택', '주거환경개선(다가구형)'],
  BZ201: ['모아', '모아타운'],
  BZ202: ['모아', '가로주택정비'],
  BZ203: ['모아', '자율주택'],
  BZ204: ['모아', '소규모재개발'],
  BZ205: ['모아', '소규모재건축'],
  BZ301: ['기타', '역세권(주택복합)'],
  BZ302: ['기타', '역세권(도시정비형)'],
  BZ303: ['기타', '역세권(주택정비형)'],
  BZ304: ['기타', '역세권(공공지원임대)'],
  BZ305: ['기타', '역세권(공공지원임대)'],
  BZ306: ['기타', '역세권(주택복합 등)'],
  BZ401: ['재개발', '재정비촉진지구'],
  BZ402: ['재개발', '재정비촉진'],
  BZ403: ['재개발', '재정비촉진'],
  BZ404: ['재개발', '재정비촉진(존치관리)'],
  BZ501: ['기타', '노후계획도시'],
  BZ502: ['기타', '노후계획도시'],
  BZ601: ['기타', '기타'],
  BZ602: ['기타', '기타'],
  BZ603: ['기타', '기타'],
  BZ604: ['기타', '기타'],
  BZ606: ['기타', '기타'],
};

async function get(url) {
  const r = await fetch(PROXY + url);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

async function main() {
  // 1. 진행단계 코드명 매핑
  const propel = await fetch('https://urban.seoul.go.kr/bsns/getPropelCdByCd.json', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ propelCd: '' }),
  }).then((r) => r.json());
  const PROPEL = {};
  propel.forEach((v) => { PROPEL[v.propelCd] = v.propelCdNm; });
  console.log('진행단계 코드:', Object.keys(PROPEL).length, '개 매핑됨');

  // 2. UQ120 전체 수집 (WMS 레이어 94~122, BZ별)
  const meta = await get(WMS + '?f=pjson');
  const layers = meta.layers.filter((l) => /BZ\d{3}$/.test(l.name));
  const rows = [];
  const polys = {};
  for (const l of layers) {
    const code = l.name.match(/BZ(\d{3})$/)[0];
    const gj = await get(WMS + '/' + l.id + '/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson');
    for (const f of gj.features) {
      const p = f.properties || {};
      const sn = p.PRESENT_SN;
      // 폴리곤: GeoJSON [lng,lat] → [lat,lng] 스왑, rings 배열로
      const rings = [];
      const geo = f.geometry;
      const ringList = geo && geo.rings ? geo.rings
        : geo && geo.type === 'Polygon' ? geo.coordinates
        : geo && geo.type === 'MultiPolygon' ? geo.coordinates[0] : null;
      if (ringList) {
        ringList.forEach((ring) => {
          if (!ring || ring.length < 3) return;
          rings.push(ring.map((c) => [c[1], c[0]]));
        });
      }
      // 대표 좌표: 첫 링의 평균
      let lat = null, lng = null;
      if (rings.length && rings[0].length) {
        const r0 = rings[0];
        lat = r0.reduce((a, c) => a + c[0], 0) / r0.length;
        lng = r0.reduce((a, c) => a + c[1], 0) / r0.length;
      }
      const gubun = BZ[code] || ['기타', code];
      rows.push({
        gu: SIGNGU[p.SIGNGU_SE] || '',
        gubun: gubun[0],
        name: p.DGM_NM || '',
        jibun: p.DGM_LT ? p.DGM_LT + '㎡' : '',
        stage: PROPEL[p.PROPEL_CD] || p.PROPEL_CD || '',
        method: gubun[1],
        bz: code,
        lat, lng,
        approx: false,
        rc: sn,
        sn,
        area: p.DGM_AR || null,
        create: p.CREATE_DAT ? new Date(p.CREATE_DAT).toISOString().slice(0, 10) : '',
      });
      if (sn && rings.length) polys[sn] = rings;
    }
    console.log('수집:', l.name, gj.features.length, '건');
  }
  console.log('총 구역:', rows.length, '/ 폴리곤 보유:', Object.keys(polys).length);

  // 3. cafe 보존 — 기존 redevelop_seoul.json과 자치구+이름 정규화 매칭
  const oldPath = path.join(OUT_DIR, 'redevelop_seoul.json');
  let preserved = 0;
  if (fs.existsSync(oldPath)) {
    const norm = (s) => String(s || '').replace(/[\s,·()「」()（）/\\\-]/g, '');
    const oldRows = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
    const oldByName = new Map();
    oldRows.forEach((r) => {
      if (!r.cafe) return;
      const k = norm(r.gu) + '|' + norm(r.name);
      if (!oldByName.has(k)) oldByName.set(k, []);
      oldByName.get(k).push(r);
    });
    rows.forEach((r) => {
      const matches = oldByName.get(norm(r.gu) + '|' + norm(r.name));
      if (matches && matches.length) { r.cafe = matches[0].cafe; preserved++; }
    });
    console.log('cafe 보존 매칭:', preserved, '/', rows.length);
  }

  // 4. 저장
  fs.writeFileSync(path.join(OUT_DIR, 'redevelop_seoul.json'), JSON.stringify(rows));
  fs.writeFileSync(path.join(OUT_DIR, 'redevelop_polygons.json'), JSON.stringify(polys));
  console.log('저장 완료: redevelop_seoul.json(' + rows.length + ') / redevelop_polygons.json(' + Object.keys(polys).length + ')');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
