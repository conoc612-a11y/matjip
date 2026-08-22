#!/usr/bin/env node
/**
 * 법원경매 데이터 갱신 — **로컬 전용 통합 실행기**
 *
 * 사용법:
 *   node tools/update_auction.js                # 목록(진행+예정) → 사건별(부족한 것만)
 *   node tools/update_auction.js --max 500      # 사건별 수집을 500건으로 제한(회당 약 3시간)
 *   node tools/update_auction.js --list-only    # 목록만 갱신하고 끝
 *   node tools/update_auction.js --case-only    # 사건별만 (목록 갱신 건너뜀)
 *   node tools/update_auction.js --commit       # 끝나고 자동 커밋·푸시
 *
 * ── 왜 로컬 전용인가 (2026-08-22 실측) ──────────────────────────────────
 * courtauction.go.kr 은 **GitHub Actions(해외 IP)에서 접속이 안 된다.**
 * 실패 로그: `page.goto: Timeout 30000ms exceeded` ×3 → 수집 실패.
 * 2026-08-15~21 매일 실패/취소했고 **성공 이력이 0회**다. V-World 가 해외 IP 에서 차단되는
 * 것과 같은 계열의 문제다(TROUBLESHOOTING §19). 그래서 이 수집은 **한국 IP(로컬)** 에서만 된다.
 * collect-auction.yml 은 그래서 삭제했다 — 다시 추가하지 말 것.
 *
 * ── 왜 하나로 묶었나 ────────────────────────────────────────────────────
 * 2026-08-22 사고: 목록 수집기와 사건별 수집기가 **동시에** 돌아
 *   ① 같은 사이트를 두 배로 긁어 IP 차단 위험을 키우고
 *   ② 둘 다 auction_detail.json 을 통째로 덮어써 **서로의 결과를 지웠다**
 * (각 프로세스가 시작 시점 사본을 메모리에 들고 매 사건마다 전체를 쓰기 때문).
 * 이 파일이 **유일한 입구**가 되어 순차 실행을 보장하고, 아래 잠금으로 중복 실행을 막는다.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LOCK = path.join(__dirname, '.update_auction.lock');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const LIST_ONLY = flag('--list-only');
const CASE_ONLY = flag('--case-only');
const DO_COMMIT = flag('--commit');
const MAX = opt('--max', '');

const ts = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`[${ts()}] ${m}`);

// ── 중복 실행 잠금 ──────────────────────────────────────────────────────
// 같은 사이트를 두 프로세스가 긁는 사고를 구조적으로 막는다. 잠금 파일에 PID 를 적고,
// 그 PID 가 실제로 살아 있는지 확인한다(강제 종료로 남은 잠금은 무시해야 하므로).
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
if (fs.existsSync(LOCK)) {
  const prev = Number(String(fs.readFileSync(LOCK, 'utf8')).trim());
  if (prev && prev !== process.pid && alive(prev)) {
    console.error(`✖ 이미 실행 중이다 (PID ${prev}). 같은 사이트를 동시에 긁으면 IP 차단 위험 +`);
    console.error('  두 프로세스가 같은 JSON 을 덮어써 서로의 결과를 지운다. 끝날 때까지 기다릴 것.');
    console.error(`  정말 죽은 프로세스라면 이 파일을 지워라: ${LOCK}`);
    process.exit(1);
  }
  fs.unlinkSync(LOCK);   // 죽은 프로세스가 남긴 잠금
}
fs.writeFileSync(LOCK, String(process.pid));
const unlock = () => { try { fs.unlinkSync(LOCK); } catch (e) {} };
process.on('exit', unlock);
process.on('SIGINT', () => { unlock(); process.exit(130); });

function run(label, args) {
  log(`▶ ${label}`);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  const ok = r.status === 0;
  log(`${ok ? '✔' : '✖'} ${label} (exit ${r.status})`);
  return ok;
}

(async () => {
  log('법원경매 갱신 시작 — 로컬 전용(한국 IP 필요)');
  const t0 = Date.now();
  const done = [];

  // 1) 목록 — 진행(매각기일 오늘~+2주)
  // 2) 목록 — 매각예정(오늘~+2개월). 법원이 화면을 둘로 나눠 놔서 둘 다 받아야 전체가 된다.
  //    ⚠️ 반드시 순차. 같은 사이트를 동시에 긁지 않는다.
  if (!CASE_ONLY) {
    if (run('목록(진행)', ['tools/collect_auction.js'])) done.push('목록(진행)');
    if (run('목록(매각예정)', ['tools/collect_auction.js', '--sched'])) done.push('목록(예정)');
  }

  // 3) 사건별 — 사진·상세·당사자·감정평가정보를 **한 번 방문**에 모두.
  //    목록이 갱신된 뒤에 돌려야 새 사건이 대상에 포함된다(그래서 순서가 이렇다).
  if (!LIST_ONLY) {
    const args = ['tools/collect_auction_case.js'];
    if (MAX) args.push('--max', MAX);
    if (run(`사건별(사진·상세·당사자·감정정보)${MAX ? ` --max ${MAX}` : ''}`, args)) done.push('사건별');
  }

  const mins = Math.round((Date.now() - t0) / 60000);
  log(`완료 — ${done.join(' · ') || '수행한 단계 없음'} (${mins}분)`);

  // 사진이 새로 생겼으면 R2 업로드가 필요하다. 안 하면 사이트에서 404 가 난다.
  const needUpload = (() => {
    const r = spawnSync('git', ['status', '--porcelain', 'auction_photos.json'], { cwd: ROOT, encoding: 'utf8' });
    return !!(r.stdout || '').trim();
  })();
  if (needUpload) {
    log('사진 메타가 바뀌었다 → R2 업로드 실행');
    run('R2 업로드', ['tools/upload_r2.mjs']);
  }

  if (DO_COMMIT) {
    const files = ['auction.json', 'auction_sched.json', 'auction_detail.json', 'auction_photos.json', 'tools/.geocache.json'];
    const st = spawnSync('git', ['status', '--porcelain', ...files], { cwd: ROOT, encoding: 'utf8' });
    if (!(st.stdout || '').trim()) { log('변경 없음 — 커밋 생략'); return; }
    spawnSync('git', ['add', ...files], { cwd: ROOT, stdio: 'inherit' });
    const msg = `chore(auction): 경매 데이터 갱신 (${new Date().toISOString().slice(0, 10)})`;
    if (spawnSync('git', ['commit', '-m', msg], { cwd: ROOT, stdio: 'inherit' }).status === 0) {
      spawnSync('git', ['push'], { cwd: ROOT, stdio: 'inherit' });
      log('커밋·푸시 완료 — GitHub Pages 배포는 자동');
    }
  } else {
    log('커밋은 하지 않았다. 확인 후 직접 커밋하거나 --commit 으로 실행할 것.');
  }
})();
