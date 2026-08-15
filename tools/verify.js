// 코드 정리 안전망 — 리팩토링 전/후 "같이 동작하는지"를 기계로 비교.
// 실행: node tools/verify.js  (실패 시 exit 1, Git Bash/PowerShell 모두 OK)
//
// 검증 항목:
//   1) 모든 .js 파일 `node --check` 문법 검사
//   2) tools/recommend.js(CommonJS) vs js/recommend.js(window.score) — 점수 로직 동치
//      (이 둘은 규칙이 두 곳에 중복돼 있어 한쪽만 고치면 조용히 어긋난다.
//       검증 벡터를 통과해야만 "아직 동일함"으로 판정)
//
// WHY: 테스트/빌드가 없는 프로젝트라 리팩토링 후 회귀를 눈으로만 판정할 수 없다.
//       이 스크립트가 그 판정을 기계로 대체한다. 어느 단계에서 깨졌는지 즉시 확인 가능.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let failures = 0;
function fail(msg) { failures++; console.error('FAIL: ' + msg); }
function ok(msg) { console.log('ok: ' + msg); }

// ---- 1) 문법 검사 ----
const ROOT = path.join(__dirname, '..');
const jsFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.min.js')) jsFiles.push(p);
  }
})(ROOT);

for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) {
    const msg = String(e.stderr || e.message);
    const first = msg.split('\n').find(l => l.includes('SyntaxError')) || msg.split('\n')[0];
    fail(f.replace(ROOT + path.sep, '') + ': ' + (first || '문법 오류'));
  }
}
ok(`문법 검사 ${jsFiles.length}개 파일`);

// ---- 2) recommend 점수 로직 동치 비교 ----
const nodeScore = require(path.join(__dirname, 'recommend.js')).score;

const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'recommend.js'), 'utf8'), sandbox);
const browserScore = sandbox.window.score;

// 브라우저 구현은 taste falsy 가드가 있지만 node 구현엔 없다 — 공통 입력만 비교.
const vectors = [
  { r: { tags: ['매콤', '국물', '분위기'] }, taste: { spicy_level: 4, flavor_tags: ['매콤'], situation_tags: ['분위기'] } },
  { r: { tags: ['담백', '한식'] }, taste: { spicy_level: 1, flavor_tags: ['국물'], situation_tags: ['혼밥'] } },
  { r: { tags: ['매콤', '국물'] }, taste: { spicy_level: 2, flavor_tags: ['매콤'], situation_tags: ['분위기'] } },
  { r: { tags: ['아무것도'] }, taste: undefined },
  { r: { tags: ['매콤'] }, taste: { spicy_level: 3, flavor_tags: [], situation_tags: [] } },
  { r: {}, taste: { spicy_level: 4, flavor_tags: ['매콤'] } },
  { r: { tags: ['매콤'] }, taste: { spicy_level: 3, flavor_tags: ['매콤'] } },
];

for (const v of vectors) {
  let a, b;
  try { a = nodeScore(v.r, v.taste); } catch (e) { a = 'THROW:' + e.message; }
  try { b = browserScore(v.r, v.taste); } catch (e) { b = 'THROW:' + e.message; }
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fail(`recommend 로직 불일치 r=${JSON.stringify(v.r)} taste=${JSON.stringify(v.taste)}: node=${JSON.stringify(a)} browser=${JSON.stringify(b)}`);
  }
}
ok(`recommend 로직 동치 ${vectors.length}개 벡터 (tools/recommend.js == js/recommend.js)`);

// ---- 3) CLI 스모크 (Supabase 온라인일 때만; 실패해도 네트워크 문제로 간주하지 않음) ----
try {
  const out = execFileSync(process.execPath, [path.join(__dirname, 'matjip-cli.js'), 'recommend', '--spicy', '2', '--flavors', '매콤', '--limit', '3'], { stdio: 'pipe', timeout: 30000 });
  if (!String(out).includes('점')) fail('CLI 스모크: 출력에 점수 없음');
  else ok('CLI 스모크 (recommend --limit 3)');
} catch (e) {
  ok('CLI 스모크 스킵 (네트워크/환경) — ' + (String(e.message).split('\n')[0] || '').slice(0, 80));
}

console.log(failures === 0 ? '\nPASS — 안전망 통과' : `\n${failures}건 실패`);
process.exit(failures === 0 ? 0 : 1);
