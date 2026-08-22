#!/usr/bin/env node
/**
 * 갱신 실행기 (로컬 전용) — matjip 의 "데이터 갱신" 버튼이 여는 페이지.
 *
 * 실행:  node tools/update_server.js        (또는 update.bat 더블클릭)
 * 접속:  http://localhost:8787
 *
 * ── 왜 이런 구조인가 ────────────────────────────────────────────────────
 * matjip 은 GitHub Pages 정적 사이트라 **브라우저에서 로컬 수집기를 직접 실행할 수 없다.**
 * 게다가 법원 사이트는 해외 IP(GitHub Actions)에서 접속이 막혀 클라우드로도 못 돌린다
 * (update_auction.js 헤더 참고). 그래서 '한국 IP 인 이 PC' 에서 도는 작은 서버를 두고,
 * matjip 버튼이 그 페이지를 **새 탭으로 열어** 거기서 실행·진행상황을 보게 한다.
 *
 * HTTPS(github.io) → http://localhost 는 **최상위 이동(navigation)은 허용**된다.
 * (fetch/XHR 는 mixed content 로 차단되므로 버튼이 직접 호출하는 방식은 불가능하다.)
 *
 * ── 보안 ────────────────────────────────────────────────────────────────
 *  - 127.0.0.1 에만 바인딩한다. 외부 네트워크에 절대 노출하지 않는다.
 *  - 실행은 POST + **서버 기동 시 생성한 1회용 토큰**을 요구한다. 토큰은 이 페이지에만
 *    심어 두므로 다른 사이트가 몰래 실행시킬 수 없다(CSRF 방지).
 *  - 실행하는 명령은 update_auction.js 하나로 고정 — 사용자 입력을 셸에 넘기지 않는다.
 */
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8787);
const TOKEN = crypto.randomBytes(16).toString('hex');   // 서버 기동마다 새로 생성

let job = null;              // { proc, log:[], startedAt, done, code, label }

function startJob(label, args) {
  if (job && !job.done) return false;
  job = { log: [], startedAt: Date.now(), done: false, code: null, label };
  const proc = spawn(process.execPath, ['tools/update_auction.js', ...args], { cwd: ROOT });
  job.proc = proc;
  const push = (s) => {
    for (const line of String(s).split(/\r?\n/)) if (line.trim()) job.log.push(line);
    if (job.log.length > 4000) job.log.splice(0, job.log.length - 4000);   // 메모리 보호
  };
  proc.stdout.on('data', push);
  proc.stderr.on('data', push);
  proc.on('close', (code) => { job.done = true; job.code = code; });
  return true;
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function pageHtml() {
  const running = job && !job.done;
  const mins = job ? Math.round((Date.now() - job.startedAt) / 60000) : 0;
  const btn = (label, args, primary) =>
    `<form method="POST" action="/run" style="display:inline">
       <input type="hidden" name="t" value="${TOKEN}">
       <input type="hidden" name="args" value="${esc(args)}">
       <button ${running ? 'disabled' : ''} class="${primary ? 'p' : ''}">${esc(label)}</button>
     </form>`;
  return `<!doctype html><meta charset="utf-8"><title>matjip 데이터 갱신</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
${running ? '<meta http-equiv="refresh" content="5">' : ''}
<style>
  :root{color-scheme:light dark}
  body{font:14px/1.6 system-ui,'Malgun Gothic',sans-serif;max-width:860px;margin:24px auto;padding:0 16px}
  h1{font-size:19px;margin:0 0 4px}
  .sub{color:#888;margin:0 0 18px}
  /* ⚠️ 색을 명시한다. color-scheme:dark 에서 background 만 흰색으로 두면 글자색이 밝은 쪽으로
     잡혀 **버튼 글자가 안 보인다**(실측으로 확인). 밝은 회색 배경 + 진한 글자는 라이트·다크
     양쪽에서 읽힌다. */
  button{font:inherit;padding:9px 16px;border:1px solid #b9bcc0;border-radius:8px;
    background:#f1f3f5;color:#212529;cursor:pointer;margin:0 6px 8px 0}
  button:hover:not(:disabled){background:#e2e6ea}
  button.p{background:#1971c2;color:#fff;border-color:#1971c2;font-weight:600}
  button.p:hover:not(:disabled){background:#1663ab}
  button:disabled{opacity:.45;cursor:not-allowed}
  pre{background:#111;color:#ddd;padding:12px;border-radius:8px;max-height:52vh;overflow:auto;white-space:pre-wrap;font-size:12.5px}
  .st{padding:9px 12px;border-radius:8px;margin:12px 0;font-weight:600}
  .run{background:#fff3bf;color:#664d03} .ok{background:#d3f9d8;color:#2b8a3e} .er{background:#ffe3e3;color:#c92a2a}
  .note{color:#888;font-size:13px;border-top:1px solid #ddd;margin-top:20px;padding-top:12px}
</style>
<h1>matjip 데이터 갱신</h1>
<p class="sub">법원경매 데이터는 <b>이 PC(한국 IP)</b>에서만 받을 수 있습니다. 해외 서버에서는 법원 사이트 접속이 막혀 있습니다.</p>

${job ? `<div class="st ${running ? 'run' : (job.code === 0 ? 'ok' : 'er')}">
  ${running ? `실행 중… (${mins}분 경과) — 5초마다 자동 새로고침` : (job.code === 0 ? '완료' : `종료 (코드 ${job.code})`)}
  &nbsp;·&nbsp;${esc(job.label)}
</div>` : ''}

<div>
  ${btn('빠른 갱신 (목록만, 약 10분)', '--list-only', true)}
  ${btn('보통 갱신 (목록 + 사건 500건, 약 3시간)', '--max 500')}
  ${btn('전체 갱신 (남은 것 전부, 최대 16시간)', '')}
</div>
<div>
  ${btn('목록만 + 자동 커밋', '--list-only --commit')}
  ${btn('사건 500건 + 자동 커밋', '--max 500 --commit')}
</div>

${job ? `<pre>${esc(job.log.slice(-400).join('\n')) || '(출력 대기 중…)'}</pre>` : '<p style="color:#888">아직 실행한 작업이 없습니다.</p>'}

<div class="note">
  <b>갱신되는 것</b>: 경매 목록(진행 2주 + 매각예정 2개월) → 사건별 사진·상세·당사자·감정평가 정보.<br>
  <b>커밋</b>: '자동 커밋' 버튼을 쓰면 끝나고 GitHub 에 올려 사이트에 반영합니다. 아니면 결과만 받고 멈춥니다.<br>
  <b>중복 실행</b>: 이미 돌고 있으면 버튼이 잠깁니다. 같은 사이트를 동시에 긁으면 IP 차단 위험이 있습니다.<br>
  창을 닫아도 작업은 계속됩니다. 다시 <code>localhost:${PORT}</code> 를 열면 진행 상황을 볼 수 있습니다.
</div>`;
}

const server = http.createServer((req, res) => {
  const send = (code, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) return send(200, pageHtml());

  if (req.method === 'POST' && req.url === '/run') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', () => {
      const p = new URLSearchParams(body);
      // 토큰 검증 — 다른 사이트가 몰래 실행시키는 것을 막는다
      if (p.get('t') !== TOKEN) return send(403, '<p>토큰이 올바르지 않습니다. localhost 페이지를 새로 열어 다시 시도하세요.</p>');
      const raw = (p.get('args') || '').trim();
      // 허용된 인자만 통과시킨다(셸을 쓰지 않지만 방어적으로 화이트리스트)
      const allowed = new Set(['--list-only', '--case-only', '--commit', '--max']);
      const args = raw ? raw.split(/\s+/) : [];
      for (let i = 0; i < args.length; i++) {
        if (allowed.has(args[i])) { if (args[i] === '--max') i++; continue; }
        if (/^\d+$/.test(args[i])) continue;
        return send(400, `<p>허용되지 않은 인자: ${esc(args[i])}</p>`);
      }
      const label = raw || '전체';
      if (!startJob(label, args)) return send(409, '<p>이미 실행 중입니다. <a href="/">돌아가기</a></p>');
      res.writeHead(303, { Location: '/' });
      res.end();
    });
    return;
  }
  send(404, '<p>없는 경로입니다. <a href="/">돌아가기</a></p>');
});

// update.bat 을 두 번 눌러 실행기가 이미 떠 있는 경우가 흔하다. 스택 트레이스를 던지면
// 사용자가 고장으로 오해하므로, 안내만 하고 조용히 끝낸다.
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.log(`이미 실행기가 켜져 있습니다 → http://localhost:${PORT}`);
    console.log('브라우저에서 위 주소를 열면 됩니다. (이 창은 닫아도 됩니다)');
    process.exit(0);
  }
  console.error('실행기를 띄우지 못했습니다:', e.message);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`갱신 실행기 준비됨 → http://localhost:${PORT}`);
  console.log('matjip 의 "데이터 갱신" 버튼을 누르면 이 페이지가 열립니다.');
  console.log('이 창을 닫으면 실행기가 꺼집니다. (127.0.0.1 에만 바인딩 — 외부 접속 불가)');
});
