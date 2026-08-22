/**
 * DGK(data.go.kr 인증키) 공유 잠금 — 같은 키를 쓰는 수집기가 동시에 돌지 못하게 막는다.
 *
 * ── 왜 만들었나 (2026-08-22 실제 사고) ──────────────────────────────
 * CCTV 수집기(전국 377,278건 → 3,773 요청)와 비주거 실거래 수집기(2,500+ 요청)를
 * **동시에** 돌렸다. data.go.kr 은 **계정당 인증키가 공용**이고 개발계정은 일 10,000건이라,
 * 합계가 한도를 밀어 중간 구간이 스로틀링을 맞았다.
 *
 * 그 결과 실거래 수집이 exit 0 으로 "정상 종료"했는데 **서울 12개 구(은평·서대문·마포·양천·
 * 강서·구로·금천·영등포·동작·관악·서초·강남)와 경기 34개 지역이 통째로 없었다.**
 * data.go.kr 이 오류를 HTTP 200 에 실어 보내기 때문에 수집기가 그걸 '거래 0건'으로 읽었다.
 * 전체 경위: TROUBLESHOOTING.md §54.
 *
 * ── 왜 문서가 아니라 코드인가 ───────────────────────────────────────
 * 같은 교훈이 이미 문서에 있었다 — 경매 스크레이퍼 2개를 동시에 돌려 서로의 데이터를 지운 사고.
 * 그런데 **그 기록을 읽고도** API 쿼터 버전으로 똑같이 반복했다. 규칙은 그 순간에 읽지 않으면
 * 소용이 없다. 그래서 실행 자체를 막는다.
 *
 * ── 쓰는 법 ────────────────────────────────────────────────────────
 * DGK 를 쓰는 수집기 맨 위(키를 읽은 직후)에 한 줄:
 *
 *     require('./dgk_lock')('collect_realprice');
 *
 * 이미 다른 수집기가 돌고 있으면 **어느 스크립트가 언제부터 돌고 있는지** 알려주고 exit 1 한다.
 * 정상 종료·Ctrl+C·예외 종료 모두에서 잠금이 풀린다.
 *
 * ⚠️ 이 잠금은 **한 대의 PC 안에서만** 유효하다. GitHub Actions 는 별개 머신이라
 *    워크플로가 여러 개 동시에 돌면 여전히 겹칠 수 있다 — 워크플로는 스케줄을 어긋나게 두거나
 *    한 잡 안에서 순차 실행할 것(collect-realprice.yml 이 그렇게 되어 있다).
 *
 * ⚠️ 우회가 필요하면 `DGK_LOCK_SKIP=1` 로 넘길 수 있다. **정말 다른 키를 쓸 때만** 써라.
 *    같은 키로 우회하면 이 사고를 그대로 재현한다.
 */

const fs = require('fs');
const path = require('path');

const LOCK = path.join(__dirname, '.dgk.lock');

// 프로세스 생존 확인 — signal 0 은 실제로 시그널을 보내지 않고 존재만 확인한다.
// EPERM 은 "있지만 내 권한으로 못 건드림"이므로 살아 있는 것으로 본다.
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

module.exports = function acquire(name) {
  if (process.env.DGK_LOCK_SKIP === '1') {
    console.warn('[DGK 잠금] DGK_LOCK_SKIP=1 — 잠금을 건너뛴다. 같은 키를 쓰는 다른 수집기가'
      + ' 돌고 있지 않은지 직접 확인했어야 한다(TROUBLESHOOTING §54).');
    return;
  }

  if (fs.existsSync(LOCK)) {
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(LOCK, 'utf8')); } catch (e) { /* 깨진 잠금 */ }
    if (prev && prev.pid && prev.pid !== process.pid && alive(prev.pid)) {
      const mins = prev.at ? Math.round((Date.now() - prev.at) / 60000) : '?';
      console.error('');
      console.error(`❌ [DGK 잠금] 이미 "${prev.name}" 가 돌고 있다 (pid ${prev.pid}, ${mins}분 경과).`);
      console.error('   data.go.kr 은 계정당 인증키가 공용이다. 동시에 돌리면 합계가 일 한도를 넘겨');
      console.error('   중간 구간이 조용히 비워진다 — 2026-08-22 에 서울 12개 구를 잃었다(§54).');
      console.error('');
      console.error('   그쪽이 끝난 뒤에 실행할 것.');
      console.error(`   정말 죽은 프로세스가 남긴 잠금이면 이 파일을 지워라: ${LOCK}`);
      console.error('');
      process.exit(1);
    }
    // 죽은 프로세스가 남긴 잠금은 조용히 걷어낸다(크래시·강제 종료 후 재실행을 막지 않기 위해).
    try { fs.unlinkSync(LOCK); } catch (e) {}
  }

  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, name, at: Date.now() }));
  const release = () => {
    // 내가 쥔 잠금만 지운다 — 남의 잠금을 지우면 보호가 무의미해진다.
    try {
      const cur = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      if (cur && cur.pid === process.pid) fs.unlinkSync(LOCK);
    } catch (e) {}
  };
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(130); });
  process.on('SIGTERM', () => { release(); process.exit(143); });
  console.log(`[DGK 잠금] 획득 — ${name} (pid ${process.pid})`);
};
