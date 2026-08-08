#!/usr/bin/env node
/**
 * 환경부 전기차 충전소 수집기
 *
 * 사용법:  DGK=<data.go.kr 인증키> node tools/collect_evcharger.js
 *          SUFFIX=_test 를 주면 산출 파일명 뒤에 붙어 실제 데이터를 덮어쓰지 않는다.
 *
 * 산출물:
 *   evcharger.json   충전소 단위 (좌표 포함, 압축 배열 포맷)
 *
 * 왜 이 구조인가 (실측 근거)
 *  - B552584/EvCharger/getChargerInfo 는 충전기 단위로 내려온다. 서울 12개월치가
 *    75,924 건에 이르러 마커가 충전소(statId)별로 묶어야 겹치지 않는다.
 *  - 충전 상태(stat)는 실시간 값이라 정적 JSON 에 담아도 순간 스냅샷일 뿐이므로
 *    담지 않는다. 대신 충전기 수·급속 여부·주차 무료 여부·이용시간 등 변하지 않는 속성을 담는다.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const KEY = process.env.DGK;
if (!KEY) {
  console.error('DGK 환경변수에 data.go.kr 인증키를 넣어 실행하세요.');
  process.exit(1);
}
const OUT_DIR = path.resolve(__dirname, '..');
const SUFFIX = process.env.SUFFIX || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36';

const agent = new https.Agent({ keepAlive: true, keepAliveMsecs: 3000, maxSockets: 6 });

function httpGet(url, tries = 3) {
  return new Promise((resolve) => {
    const attempt = (n) => {
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
      const deadline = setTimeout(retryOrGiveUp, 15000);

      req = https.get(url, { agent, headers: { 'User-Agent': UA, Accept: '*/*' } }, (res) => {
        res.setEncoding('utf8');
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => {
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

(async () => {
  console.log('전기차 충전소 수집 — 서울 전 지역\n');
  const rows = [];
  let page = 1;
  let total = Infinity;
  for (;;) {
    const url = `https://apis.data.go.kr/B552584/EvCharger/getChargerInfo?serviceKey=${KEY}&zcode=11&numOfRows=1000&pageNo=${page}`;
    const xml = await httpGet(url);
    const its = parseItems(xml);
    for (const r of its) rows.push(r);
    total = Number((xml.match(/<totalCount>(\d+)<\/totalCount>/) || [, 0])[1]);
    console.log(`  페이지 ${page} · 누적 ${rows.length.toLocaleString()}건 / 전체 ${total.toLocaleString()}`);
    if (!its.length || page * 1000 >= total) break;
    page++;
  }
  console.log(`수집 완료 — 충전기 ${rows.length.toLocaleString()}건`);

  // 충전소(statId) 단위로 묶는다. 같은 충전소의 여러 충전기는 한 마커로.
  const byId = new Map();
  for (const r of rows) {
    const id = r.statId;
    if (!id) continue;
    let s = byId.get(id);
    if (!s) {
      s = {
        name: r.statNm || '', addr: r.addr || '', lat: Number(r.lat) || 0, lng: Number(r.lng) || 0,
        useTime: r.useTime || '', parkingFree: (r.parkingFree || '').toUpperCase() === 'Y',
        kind: r.kind || '', chargers: [],
      };
      byId.set(id, s);
    }
    s.chargers.push({
      t: r.chgerType || '', out: r.output || '', m: r.method || '', maker: r.maker || '',
    });
  }

  // F(급속 전용 코드) vs S(완속/혼합) — 충전기 종류 코드로 분류
  // chgerType: 01 DC차데모, 02 AC완속, 03 DC차데모+AC3상, 04 DC콤보, 05 DC차데모+DC콤보,
  //            06 DC콤보(완속동시), 07 AC3상, 08 DC콤보(과금형) — 급속여부는 output 값으로 판단
  const F = ['name', 'addr', 'lat', 'lng', 'useTime', 'parkingFree', 'kind', 'cnt', 'fast'];
  const rowsOut = [];
  for (const s of byId.values()) {
    if (!s.lat || !s.lng) continue;
    const fast = s.chargers.filter((c) => Number(c.out) >= 50).length;
    rowsOut.push([
      s.name, s.addr,
      Number(s.lat.toFixed(5)), Number(s.lng.toFixed(5)),
      s.useTime, s.parkingFree ? 1 : 0, s.kind,
      s.chargers.length, fast,
    ]);
  }
  rowsOut.sort((a, b) => b[7] - a[7] || (a[0] > b[0] ? 1 : -1));
  const out = { fields: F, rows: rowsOut };
  const file = path.join(OUT_DIR, `evcharger${SUFFIX}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`\nevcharger.json 저장 — 충전소 ${rowsOut.length.toLocaleString()}개 / ${(fs.statSync(file).size / 1048576).toFixed(2)}MB`);
})();
