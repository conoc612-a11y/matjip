// 회귀 검증: 리사이즈·스크롤 UI 통일 (2026-08-12)
// 1) makeResizable 헬퍼 단위 검증(가짜 grip/target + PointerEvent 디스패치)
// 2) land.html 실제 화면에서 .lc-jb 그립 드래그 동작 검증
// 3) .ui-grip/.ui-scroll CSS 존재 확인
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const ROOT = path.resolve(process.argv[2] || '.');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 8798;
const CDPP = 9363;
const UD = path.join(process.env.TEMP, 'opencode', 'chrome-cdp-uires-' + Date.now());

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, url === '/' ? 'index.html' : url);
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--disable-extensions',
  '--window-size=1280,900', '--remote-debugging-port=' + CDPP, '--remote-allow-origins=*', '--user-data-dir=' + UD, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJson(url, method) {
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(url, { method: method || 'GET' }); if (r.ok) return await r.json(); } catch (e) {}
    await sleep(250);
  }
  throw new Error('devtools unreachable');
}

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const tab = await getJson(`http://127.0.0.1:${CDPP}/json/new?about:blank`, 'PUT');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  const exceptions = [];
  const send = (method, params) => new Promise((res) => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); return; }
    if (msg.method === 'Fetch.requestPaused') {
      const url = msg.params.request.url;
      if (url.includes('auth-guard.js')) send('Fetch.failRequest', { requestId: msg.params.requestId, errorReason: 'Aborted' });
      else send('Fetch.continueRequest', { requestId: msg.params.requestId });
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      exceptions.push(d && d.exception && d.exception.description ? d.exception.description : (d && d.text));
    }
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Fetch.enable', { patterns: [{ urlPattern: '*auth-guard.js*', requestStage: 'Request' }] });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/land.html` });
  await sleep(9000);

  const ev = await send('Runtime.evaluate', {
    expression: `(async () => {
      const out = { unit: [], css: {}, real: {} };
      const fail = (k, msg) => { out.unit.push({ k, ok: false, msg }); };
      const ok = (k) => out.unit.push({ k, ok: true });
      const fire = (el, type, x, y, pid) => {
        el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: pid, clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true }));
      };
      const rafWait = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));

      // 0) 헬퍼 존재
      if (typeof window.makeResizable !== 'function') return { fatal: 'makeResizable is not defined' };
      ok('helper-defined');

      // 1) 기본 리사이즈(both) + CSS min/max 클램프
      {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;width:200px;height:150px;min-width:100px;max-width:300px;min-height:80px;max-height:200px;';
        document.body.appendChild(t);
        const g = document.createElement('div');
        document.body.appendChild(g);
        makeResizable(g, t);
        const gr = g.getBoundingClientRect();
        const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
        fire(g, 'pointerdown', cx, cy, 10);
        fire(g, 'pointermove', cx + 400, cy + 300, 10);   // maxW 300, maxH 200 까지만
        fire(g, 'pointerup', cx + 400, cy + 300, 10);
        await rafWait();
        (Math.round(t.offsetWidth) === 300 && Math.round(t.offsetHeight) === 200) ? ok('unit-clamp-both') : fail('unit-clamp-both', t.offsetWidth + 'x' + t.offsetHeight);
        t.remove(); g.remove();
      }

      // 2) reverseW + axis 'w' — 왼쪽으로 끌면 넓어짐
      {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;width:200px;height:150px;min-width:100px;max-width:400px;';
        document.body.appendChild(t);
        const g = document.createElement('div');
        document.body.appendChild(g);
        makeResizable(g, t, { axis: 'w', reverseW: true, minW: 100, maxW: 400 });
        const gr = g.getBoundingClientRect();
        const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
        fire(g, 'pointerdown', cx, cy, 11);
        fire(g, 'pointermove', cx - 80, cy, 11);
        fire(g, 'pointerup', cx - 80, cy, 11);
        await rafWait();
        (Math.round(t.offsetWidth) === 280 && Math.round(t.offsetHeight) === 150) ? ok('unit-reverseW-axis-w') : fail('unit-reverseW-axis-w', t.offsetWidth + 'x' + t.offsetHeight);
        t.remove(); g.remove();
      }

      // 3) applyStyle:false — 스타일 안 쓰고 onResize 로 클램프된 w/h 전달
      {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;width:100px;height:100px;';
        document.body.appendChild(t);
        const g = document.createElement('div');
        document.body.appendChild(g);
        let got = null;
        makeResizable(g, t, { applyStyle: false, minW: 50, maxW: 300, minH: 50, maxH: 300, onResize: (w, h) => { got = { w, h }; } });
        const gr = g.getBoundingClientRect();
        const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
        fire(g, 'pointerdown', cx, cy, 12);
        fire(g, 'pointermove', cx + 30, cy + 20, 12);
        fire(g, 'pointerup', cx + 30, cy + 20, 12);
        await rafWait();
        const styleUntouched = t.style.width === '100px' && t.style.height === '100px';
        (got && got.w === 130 && got.h === 120 && styleUntouched) ? ok('unit-applyStyle-false') : fail('unit-applyStyle-false', JSON.stringify(got) + ' style=' + t.style.cssText);
        t.remove(); g.remove();
      }

      // 4) bodyClass/gripClass 토글 + 클릭만(이동 없음)이면 무변화
      {
        const t = document.createElement('div');
        t.style.cssText = 'position:fixed;width:100px;height:100px;';
        document.body.appendChild(t);
        const g = document.createElement('div');
        g.className = 'grip';
        document.body.appendChild(g);
        makeResizable(g, t, { bodyClass: 'tb-resizing', gripClass: 'dragging' });
        const gr = g.getBoundingClientRect();
        const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
        fire(g, 'pointerdown', cx, cy, 13);
        await rafWait();
        const during = document.body.classList.contains('tb-resizing') && g.classList.contains('dragging');
        fire(g, 'pointerup', cx, cy, 13);
        await rafWait();
        const after = !document.body.classList.contains('tb-resizing') && !g.classList.contains('dragging');
        const untouched = t.style.width === '100px' && t.style.height === '100px';
        (during && after && untouched) ? ok('unit-classes-and-click-noop') : fail('unit-classes-and-click-noop', JSON.stringify({ during, after, untouched }));
        t.remove(); g.remove();
      }

      // 5) CSS 존재 — buttons.css 의 .ui-grip / .ui-scroll / .ui-pop-btn / .footer-resize
      {
        const probe = (cls) => {
          const el = document.createElement('div');
          el.className = cls;
          document.body.appendChild(el);
          const s = getComputedStyle(el);
          const r = { display: s.display !== 'none' };
          el.remove();
          return r;
        };
        const gripCss = probe('ui-grip');
        out.css.uiGrip = gripCss.display;
        const sc = document.createElement('div'); sc.className = 'ui-scroll'; document.body.appendChild(sc);
        const hasScrollbarRule = [...document.styleSheets].some((ss) => {
          try { return [...ss.cssRules].some((r) => r.selectorText && r.selectorText.includes('ui-scroll')); } catch (e) { return false; }
        });
        sc.remove();
        out.css.hasScrollbarRule = hasScrollbarRule;
      }

      // 6) 실제 land.html — 정비 컨트롤(.lc-jb) 그립 존재 + 드래그 동작
      out.real.probe = { map: typeof map, jb: typeof jbCluster, lcInDom: !!document.querySelector('.lc-jb') };
      if (window.L) {
        try {
          const cb = [...document.querySelectorAll('.lp-midcb')].find((c) => c.closest('.lp-midhead') && c.closest('.lp-midhead').querySelector('.lp-name') && c.closest('.lp-midhead').querySelector('.lp-name').textContent === '정비사업 상세');
          if (cb) { cb.click(); await sleep2(400); }
        } catch (e) {}
        const waitFor = (fn, ms) => new Promise((res) => { const i = setInterval(() => { const v = fn(); if (v) { clearInterval(i); res(v); } }, 200); setTimeout(() => { clearInterval(i); res(null); }, ms); });
        const lc = await waitFor(() => document.querySelector('.lc-jb'), 6000);
        if (!lc) out.real.lc = 'lc-jb not found (leaflet?)';
        else {
          const grip = lc.querySelector('.ui-grip');
          const hasUiScroll = lc.classList.contains('ui-scroll');
          if (!grip) out.real.grip = 'missing .ui-grip in .lc-jb';
          else {
            const before = { w: lc.offsetWidth, h: lc.offsetHeight };
            const gr = grip.getBoundingClientRect();
            const cx = gr.left + gr.width / 2, cy = gr.top + gr.height / 2;
            fire(grip, 'pointerdown', cx, cy, 20);
            fire(grip, 'pointermove', cx + 120, cy + 80, 20);
            fire(grip, 'pointerup', cx + 120, cy + 80, 20);
            await rafWait();
            const after = { w: lc.offsetWidth, h: lc.offsetHeight };
            out.real.drag = { before, after, ok: after.w > before.w && after.h > before.h };
          }
          out.real.hasUiScroll = hasUiScroll;
        }
      } else {
        out.real.leaflet = 'L not loaded (network?) — 실 화면 검증 생략';
      }

      return out;
    })()`,
    awaitPromise: true, returnByValue: true,
  });

  if (ev.exceptionDetails) console.log('EVAL EXCEPTION:', ev.exceptionDetails.exception ? ev.exceptionDetails.exception.description : ev.exceptionDetails.text);
  else console.log(JSON.stringify(ev.result.value, null, 2));
  console.log('JS exceptions:', exceptions.length ? exceptions : 'none');

  chrome.kill();
  server.close();
  process.exit(0);
})().catch((e) => { console.error('FATAL', e); chrome.kill(); server.close(); process.exit(1); });
