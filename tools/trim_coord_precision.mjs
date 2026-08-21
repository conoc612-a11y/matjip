/**
 * trim_coord_precision.mjs — 데이터 JSON 의 과다한 좌표 소수점을 잘라 전송량·파싱시간을 줄인다.
 *
 * 왜 필요한가:
 *  수집기가 만든 좌표가 소수점 14~15자리로 저장돼 있었다(예: 37.5427918959895).
 *  이건 나노미터급 정밀도로 아무 의미가 없다. 그런데 redevelop_polygons.json 은 좌표점이
 *  257,386개라, 점마다 낭비되는 문자가 파일 전체를 부풀렸다:
 *    9.67MB raw / 3.44MB gzip  →  5.66MB raw / 1.36MB gzip  (gzip 60% 감소)
 *  이 파일은 '정비사업 상세' 레이어가 켜져 있으면 페이지 열 때마다 받으므로 체감이 크다.
 *  raw 가 줄면 JSON.parse 시간도 같이 줄어든다(메인스레드 블로킹 감소).
 *
 * 왜 6자리가 안전한가:
 *  위도 소수 6자리 = 약 0.11m. 그런데 land.html 의 폴리곤은 이미 smoothFactor:1 로
 *  그려서 줌 17에서 최대 약 1.2m 를 허용한다(HANDOFF 기록의 실측값). 즉 6자리는
 *  이미 받아들이고 있는 렌더링 오차보다 10배 이상 정밀하다 — 화면상 차이가 없다.
 *
 * 사용법:
 *   node tools/trim_coord_precision.mjs --check     # 얼마나 줄어드는지만 출력(파일 수정 안 함)
 *   node tools/trim_coord_precision.mjs             # 기본 대상 전부 잘라서 저장
 *   node tools/trim_coord_precision.mjs --dp 7      # 자릿수 지정(기본 6)
 *   node tools/trim_coord_precision.mjs a.json b.json   # 지정한 파일만
 *
 * ⚠️ 수집기가 데이터를 갱신하면 좌표가 다시 15자리로 돌아온다. 그래서
 * `.github/workflows/collect-redevelop.yml` · `collect-realprice.yml` 의 수집 단계 직후에
 * 이 스크립트를 넣어 뒀다(안 넣으면 다음 자동 갱신에서 최적화가 되돌려진다 — 실제 위험이었음).
 * CI 에서는 그 워크플로가 커밋하는 파일만 인자로 넘겨, 무관한 파일이 수정된 채 남지 않게 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 좌표 소수점이 실제로 과다한 파일만 대상으로 한다(측정으로 확인된 것).
// 나머지 데이터 파일은 잘라도 이득이 없어 건드리지 않는다 — 불필요한 diff 를 만들지 않는다.
const DEFAULT_TARGETS = [
  'redevelop_polygons.json',
  'redevelop_seoul.json',
  'realprice_seoul_gg.json',
];

const argv = process.argv.slice(2);
const CHECK = argv.includes('--check');
// 플래그가 아닌 인자가 있으면 그 파일만 처리한다(CI 에서 워크플로별로 좁히는 용도).
const explicit = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--dp');
const TARGETS = explicit.length ? explicit : DEFAULT_TARGETS;
const DP = (() => {
  const i = argv.indexOf('--dp');
  const v = i >= 0 ? parseInt(argv[i + 1], 10) : 6;
  if (!Number.isFinite(v) || v < 4 || v > 9) {
    console.error('✖ --dp 는 4~9 사이여야 한다(6 권장 = 약 0.11m).');
    process.exit(1);
  }
  return v;
})();

const gzLen = (s) => zlib.gzipSync(Buffer.from(s), { level: 9 }).length;
const MB = (b) => (b / 1048576).toFixed(2) + 'MB';

// 텍스트 레벨에서 자른다 — 구조(배열/객체 어디에 좌표가 있든)에 의존하지 않는다.
// 소수점 (DP+2)자리 이상인 숫자만 대상: 이미 짧은 값(가격·연도 등)은 손대지 않는다.
const re = new RegExp(`-?\\d+\\.\\d{${DP + 2},}`, 'g');
const trim = (text) => text.replace(re, (m) => {
  const n = Number(m);
  if (!Number.isFinite(n)) return m;
  return String(Number(n.toFixed(DP)));
});

let totalBefore = 0, totalAfter = 0, changed = 0;
console.log(`좌표 소수점 ${DP}자리로 정리 (최대 오차 약 ${(111320 * Math.pow(10, -DP)).toFixed(3)}m)\n`);

for (const rel of TARGETS) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log(`- ${rel}: 없음, 건너뜀`); continue; }
  const before = fs.readFileSync(file, 'utf8');
  const after = trim(before);

  // 안전장치: 자른 결과가 JSON 으로 파싱되는지, 키 수가 같은지 확인한다.
  let ok = true, why = '';
  try {
    const a = JSON.parse(before), b = JSON.parse(after);
    const ka = Array.isArray(a) ? a.length : Object.keys(a).length;
    const kb = Array.isArray(b) ? b.length : Object.keys(b).length;
    if (ka !== kb) { ok = false; why = `항목 수 불일치 ${ka} → ${kb}`; }
  } catch (e) { ok = false; why = 'JSON 파싱 실패: ' + e.message; }
  if (!ok) { console.error(`✖ ${rel}: ${why} — 이 파일은 건너뛴다.`); continue; }

  const gb = gzLen(before), ga = gzLen(after);
  totalBefore += gb; totalAfter += ga;
  const cut = gb ? Math.round((1 - ga / gb) * 100) : 0;
  console.log(`${rel.padEnd(28)} raw ${MB(before.length)} → ${MB(after.length)}   gzip ${MB(gb)} → ${MB(ga)}  (-${cut}%)`);

  if (!CHECK && after !== before) { fs.writeFileSync(file, after); changed++; }
}

console.log('\n합계 gzip:', MB(totalBefore), '→', MB(totalAfter),
  `(${totalBefore ? Math.round((1 - totalAfter / totalBefore) * 100) : 0}% 감소, ${MB(totalBefore - totalAfter)} 절약)`);
console.log(CHECK ? '\n--check 모드 — 파일을 수정하지 않았다.' : `\n${changed}개 파일 저장 완료.`);
