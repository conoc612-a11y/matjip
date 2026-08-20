# 🔒 LOCKED — 팝업 확정본 (위치·크기·클릭 + 버튼·스크롤바)

> **다루는 범위**: 건물 팝업 / CCTV 팝업 / 정비·실거래 등 모든 Leaflet 팝업의
> ① 위치·크기(§1~2) ② 드래그/클릭 구분(§2 BLOCK-E) ③ 닫기·접기 버튼 위치(§6) ④ 스크롤바·그립 겹침(§6).
> 이 네 가지는 **각각 3회 이상 재작업된 이력**이 있다. 손대기 전에 §3·§6-6 금지 목록을 먼저 볼 것.
>
> **이 파일은 "정본(single source of truth)"이다.** 팝업의 위치·크기·드래그·버튼·스크롤바에 관해
> 다른 문서(`TROUBLESHOOTING.md`, `HANDOFF.md`, 코드 주석, `land.backup-*.html`)와 내용이 어긋나면
> **무조건 이 파일이 맞다.** 다른 문서는 과거 시도의 기록이며 그중 일부는 기각된 접근법이다.

**확정 상태**: 2026-08-20, 사용자 육안 검증 완료
- 위치·크기·드래그 3가지 — 사용자 확인 "3가지 다 고쳐졌어"
- 닫기·접기 버튼 + 스크롤바 — 사용자 확인 "현재 코드가 해당 문제 모두 해결한 상태"

**확정 커밋**: `ecca2af`(위치·크기·드래그 수정) 및 그 이전부터 유지된 버튼·스크롤바 코드
**대상 파일**: `land.html` 단일 파일. 다른 파일은 건드리지 않는다.
**검증 환경**: 지도 컨테이너 높이 728px, Leaflet 1.9.4

---

## 0. 이 파일을 읽어야 하는 상황

다음 중 하나라도 해당하면 **코드를 만지기 전에 이 파일을 끝까지 읽어라.**

- 건물 팝업이 지도 상단 `일반지도 / 위성지도 / 위성+라벨 / OSM` 썸네일 줄을 덮는다
- 지도를 드래그해서 옮기는데 팝업이 열린다
- 팝업 크기가 줌 레벨에 비해 너무 크거나 작다
- `.ctl-row`, `.leaflet-popup-pane`, `--popup-max-h`, `autoPanPadding`, `map.on('click')` 근처를 수정하려 한다
- `z-index` 를 조정하려 한다

**사용자가 "예전 상태로 복원해줘"라고 하면 §2 의 코드 블록 5개를 그대로 되돌려 넣으면 된다.**

---

## 1. 확정된 동작 명세 (이게 "정상"이다)

| # | 요구사항 | 실측 기준 |
|---|---|---|
| 1 | 팝업은 **어떤 경우에도** 상단 컨트롤 줄(`.ctl-row`)을 덮지 않는다 | 세로 겹침 **0px** |
| 2 | 팝업 상단은 컨트롤 줄 하단보다 **최소 8px 아래**에서 시작 | 컨트롤 하단 191 → 팝업 상단 198~199 |
| 3 | 줌아웃하면 팝업도 작아진다 | z12 = 지도높이의 46% / z17 = 종전 수준 |
| 4 | 지도를 6px 초과 드래그하면 팝업이 열리지 않는다 | 드래그 100px → 안 열림 |
| 5 | 제자리 클릭은 정상적으로 팝업을 연다 | 이동 0px → 열림 |

**z-index 3단 순서 — 이게 전부다:**

```
.lp-body (레이어 트리 패널, 1000)  <  .leaflet-popup-pane (1200)  <  .ctl-row (1300)
```

세 값 중 **하나만 바꿔도** 과거 버그 둘 중 하나가 반드시 재발한다:
- 팝업을 `.lp-body` 아래로 내리면 → 레이어 패널이 팝업 닫기·스크롤바·그립을 덮는다 (2026-08-16 버그)
- 팝업을 `.ctl-row` 위로 올리면 → 팝업이 배경지도 썸네일을 덮는다 (2026-08-20 버그)

⚠️ **`.lp-body` 의 1000 은 CSS 에 선언돼 있지 않다.** Leaflet 이 컨트롤 컨테이너
(`.leaflet-top` / `.leaflet-right` 등)에 주는 기본값이며, `.lp-body` 규칙에는 `z-index` 가 없다
(실측 2026-08-20). **"순서를 맞추려면 `.lp-body` 에 `z-index:1000` 을 명시해야 한다"고 오해해
CSS 를 추가하지 말 것** — 스택 문맥이 바뀌어 오히려 어긋날 수 있다.
직접 선언한 값은 `.leaflet-popup-pane`(1200)과 `.ctl-row`(1300) **둘뿐**이다.

---

## 2. 복원용 코드 (verbatim — 그대로 붙여넣으면 된다)

> ⚠️ **줄번호는 참고용이다.** `land.html` 은 43만 자가 넘고 편집마다 줄이 밀린다
> (2026-08-20 실측 기준으로 갱신했다). **줄번호로 찾지 말고 아래 식별자로 grep 하라** —
> 그게 항상 맞다: `.ctl-row {`, `leaflet-popup-pane { z-index`, `POPUP_H_CAP`,
> `nudgePopupIntoSafeArea`, `_pointerDownAt`.

### BLOCK-A — `.ctl-row` z-index (CSS, `land.html` 427행 근처)

```css
    /* z-index 는 팝업 페인(1200)보다 높다. 팝업은 앵커에서 위로 자라기 때문에 지도 가운데를
       클릭하면 팝업 상단이 이 줄까지 올라와 '일반지도/위성지도/…' 썸네일을 덮었다
       (사용자 지적 2026-08-20). 배경지도 선택은 항상 조작 가능해야 하므로 팝업 위에 둔다.
       위치·크기 차원의 해결(팝업이 이 줄 아래로만 들어가게)은 syncPopupMaxHeight 참고. */
    .ctl-row { position:absolute; top:10px; left:50%; transform:translateX(-50%); z-index:1300;
      display:flex; align-items:stretch; gap:6px; margin:0; }
```

### BLOCK-B — 팝업 페인 z-index (CSS, `land.html` 538행 근처)

```css
    .leaflet-popup-pane { z-index: 1200; }
```

### BLOCK-C — 팝업 최대 높이 + 줌 비례 축소 (JS, `land.html` 1271행 근처)

```js
    const POPUP_H_CAP = 420;
    function popupZoomFactor() {
      const z = map.getZoom();
      if (z >= 16) return 1;
      if (z <= 11) return 0.5;
      return 0.5 + (z - 11) * 0.1;
    }
    function syncPopupMaxHeight() {
      // getSize() 는 캐시값이라 레이아웃이 잡히기 전엔 0 이 나온다. 그때는 실제 DOM 높이를 쓴다.
      const el = map.getContainer();
      const h = map.getSize().y || el.clientHeight || 0;
      if (h < 120) return;   // 아직 레이아웃 전 — 기본값(CSS)을 그대로 둔다
      const row = el.querySelector('.ctl-row');
      // top:10px + 컨트롤 높이 + 여유 8px. 컨트롤이 아직 없으면 0.
      const reserve = row ? Math.round(row.getBoundingClientRect().height) + 18 : 0;
      // 팝업 껍데기(래퍼 padding 28+28, tip, 여백)에 약 90px 쓰이므로 그만큼 더 뺀다.
      // 150px 하한 — 이보다 작으면 제목 한 줄도 안 보인다. 부족한 만큼은 스크롤로 본다.
      const avail = Math.max(150, Math.round(Math.min(h - reserve - 90, POPUP_H_CAP) * popupZoomFactor()));
      document.documentElement.style.setProperty('--popup-max-h', avail + 'px');
      // autoPan 여백은 팝업이 열릴 때마다 프로토타입 옵션에서 읽히므로 여기서 갱신해두면
      // 개별 bindPopup 호출을 전부 고치지 않아도 모든 팝업에 적용된다.
      L.Popup.prototype.options.autoPanPaddingTopLeft = L.point(12, reserve + 6);
      L.Popup.prototype.options.autoPanPaddingBottomRight = L.point(12, 12);
    }
    map.on('resize zoomend', syncPopupMaxHeight);
```

### BLOCK-D — 지도 위 UI(상단 컨트롤·왼쪽 패널) 회피 (JS, BLOCK-C 바로 뒤)

2026-08-21 확장: 상단 컨트롤 줄 외에 **왼쪽 패널(`.left-panels`)** 도 피한다. 패널은
`z-index:2000` 으로 팝업(1200)보다 위라 팝업이 그 아래로 들어가면 내용이 안 보인다.
그래서 함수명이 `nudgePopupBelowControls` → `nudgePopupIntoSafeArea` 로 바뀌었다.

```js
    const CTL_GAP = 8;          // 겹침 회피 시 확보할 최소 여백(px)
    let _nudging = false;
    // 지도 위에 떠 있는 UI(상단 컨트롤 줄, 왼쪽 패널)를 팝업이 가리지 않도록 지도를 밀어낸다.
    // 둘 다 z-index 가 팝업(1200)보다 높아(.ctl-row 1300, .left-panels 2000) 팝업이 그 아래로
    // 들어가면 내용이 그냥 안 보인다. clampPopup 은 '지도 경계'만 보므로 이 둘은 모른다(§5-1).
    function nudgePopupIntoSafeArea(pop) {
      if (_nudging || !pop || !pop._map) return;
      const el = pop.getElement();
      const mc = map.getContainer();
      if (!el || !mc) return;
      const pr = el.getBoundingClientRect(), mr = mc.getBoundingClientRect();
      let dx = 0, dy = 0;

      // ① 상단 컨트롤 줄(줌 + 배경지도 썸네일). 가로 중앙에만 있으므로 가로로 겹칠 때만 본다.
      const row = mc.querySelector('.ctl-row');
      if (row) {
        const rr = row.getBoundingClientRect();
        if (Math.min(pr.right, rr.right) - Math.max(pr.left, rr.left) > 0) {
          const need = Math.round(rr.bottom + CTL_GAP - pr.top);
          if (need > 1) dy = need;
        }
      }

      // ② 왼쪽 패널(.left-panels). 컨테이너는 pointer-events:none 이고 폭이 자식(열린 패널)에서
      //    나오므로, 패널이 하나도 없으면 폭 0 이 되어 자동으로 건너뛴다. 패널은 폭 조절이 가능해
      //    고정값을 쓰지 않고 매번 실제 오른쪽 끝을 잰다.
      const panels = document.querySelector('.left-panels');
      if (panels) {
        const lr = panels.getBoundingClientRect();
        if (lr.width > 1 && pr.left < lr.right + CTL_GAP) {
          const need = Math.round(lr.right + CTL_GAP - pr.left);
          // 오른쪽으로 더 갈 수 있는 여유. 팝업이 패널 오른쪽 공간보다 넓으면(좁은 화면)
          // 완전히 피할 수는 없다 — 그때도 여유만큼은 밀어 가림을 줄인다. 전부 포기하는 것보다
          // 낫고, 지도 밖으로 밀어내 clampPopup 과 서로 당기는 일도 없다.
          const room = Math.round(mr.right - CTL_GAP - pr.right);
          if (need > 1 && room > 1) dx = Math.min(need, room);
        }
      }

      if (!dx && !dy) return;
      _nudging = true;
      // panBy 는 뷰를 그만큼 옮기므로 내용은 반대로 움직인다 → 부호를 뒤집어 준다.
      map.panBy([-dx, -dy], { animate: false });
      // panBy 가 유발하는 move/resize 연쇄에 다시 끌려들어가지 않게 한 프레임 뒤 해제한다.
      requestAnimationFrame(() => { _nudging = false; });
    }
    let _popRO = null;
    map.on('popupopen', (ev) => {
      const pop = ev.popup;
      const el = pop && pop.getElement();
      if (!el) return;
      nudgePopupIntoSafeArea(pop);
      if (typeof ResizeObserver !== 'function') return;
      if (_popRO) _popRO.disconnect();
      let raf = 0;
      _popRO = new ResizeObserver(() => {
        // rAF 로 묶는다 — 내용이 여러 번 갱신되면 옵저버가 연달아 불린다.
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; nudgePopupIntoSafeArea(pop); });
      });
      _popRO.observe(el);
    });
    map.on('popupclose', () => { if (_popRO) { _popRO.disconnect(); _popRO = null; } });
    // 초기 로드 때는 지도가 아직 레이아웃되지 않아(높이 <120) 위 함수가 조기 반환하고,
    // 그 뒤 resize/zoomend 가 한 번도 안 오면 상단 예약 높이가 반영되지 않은 채 남는다
    // (실측 2026-08-20: 첫 로드 후 --popup-max-h 가 비어 있었다). 레이아웃이 안정될 때까지
    // 몇 번 더 시도한다. getBoundingClientRect 한 번씩이라 비용은 무시할 수준.
    [0, 400, 1500].forEach((ms) => setTimeout(syncPopupMaxHeight, ms));
```

### BLOCK-E — 드래그/클릭 구분 가드 (JS, `map.on('click')` 바로 앞, 4966행 근처)

```js
    // ── 드래그를 클릭으로 오인하지 않게 하는 가드 (2026-08-20) ──────────
    let _pointerDownAt = null, _pointerDragged = false;
    const DRAG_SLOP = 6;   // px. 손떨림·트랙패드 미세 이동은 클릭으로 인정한다.
    {
      const mc = map.getContainer();
      mc.addEventListener('pointerdown', (ev) => {
        if (!ev.isPrimary) return;
        _pointerDownAt = [ev.clientX, ev.clientY];
        _pointerDragged = false;
      }, true);
      mc.addEventListener('pointermove', (ev) => {
        if (!_pointerDownAt || !ev.isPrimary) return;
        if (Math.abs(ev.clientX - _pointerDownAt[0]) > DRAG_SLOP
          || Math.abs(ev.clientY - _pointerDownAt[1]) > DRAG_SLOP) _pointerDragged = true;
      }, true);
      mc.addEventListener('pointerup', () => { _pointerDownAt = null; }, true);
      // 포인터가 지도 밖에서 떨어지면 pointerup 이 안 올 수 있다 — 그때도 상태를 정리한다.
      mc.addEventListener('pointercancel', () => { _pointerDownAt = null; _pointerDragged = false; }, true);
    }
```

그리고 `map.on('click', (e) => {` **첫 두 줄**이 반드시 이래야 한다:

```js
      if (_pointerDragged) { _pointerDragged = false; return; }
      syncPopupMaxHeight();
```

---

## 3. ⛔ 하지 말 것 (전부 실측으로 실패 확인됨)

아래는 **이미 시도해서 실패한 접근법**이다. 코드를 싣지 않는다 — 베껴 쓸 수 없게 하려는 의도다.
"이렇게 해보면 될 것 같다"는 생각이 들면 아래 목록에 있는지 먼저 확인하라.

| 시도 | 결과 | 왜 실패했나 |
|---|---|---|
| `popup._adjustPan()` 을 다시 호출 | **실패** | **이 프로젝트가 `L.Popup.prototype._adjustPan` 을 `clampPopup` 으로 통째로 교체해 뒀다**(§5-1 참고). 즉 Leaflet 코드가 아니고, `clampPopup` 은 지도 경계만 보고 `.ctl-row` 겹침은 보지 않는다. `map.panBy` 로 직접 밀어야 한다 |
| `ResizeObserver` 로 **content** 관찰 | **콜백 0회** | `--popup-max-h` 상한에 걸리면 content 크기가 더 안 변한다. **래퍼(`.leaflet-popup`)를 관찰해야 한다** — 현재 코드가 그렇게 한다 |
| `popup.update()` 호출 | **금지** | innerHTML 을 재렌더해 비동기로 채운 내용을 지운다 |
| `autoPanPaddingTopLeft` 만 주고 끝내기 | **불충분** | autoPan 은 open 시점 1회만 돈다. 팝업은 그 뒤 내용이 채워지며 위로 자란다 |
| `--popup-max-h` 를 `vh` 로 고정 | **실패** | 지도가 화면 일부일 때 팝업이 지도 밖으로 넘친다 |
| `.ctl-row` z-index 를 1000 으로 되돌리기 | **버그 재발** | 팝업이 썸네일을 덮는다 |
| `.leaflet-popup-pane` z-index 를 700(기본)으로 되돌리기 | **버그 재발** | 레이어 패널이 팝업 컨트롤을 덮는다 |
| `map.dragging.moved()` 로만 드래그 판정 | **불충분** | dragend 에서 `_moved` 가 리셋된 뒤 click 이 도착하는 경우가 있다 |
| capture 아닌 bubble 단계에서 포인터 감시 | **실패 예상** | Leaflet 이 먼저 이벤트를 소비한다. capture(`true`) 필수 |
| 팝업 리사이즈를 스트립 핸들 + window 캡처 click 차단으로 구현 | **기각됨** | TROUBLESHOOTING §30 에 기록돼 있으나 §30-1 에서 되돌려졌다. 현재는 `makeResizable`(pointer capture) 방식 |
| 그립을 `bottom:-12px` 로 매달기 | **금지** | "팝업 창을 넘어가고 삐뚤어짐" 사용자 신고. §37 참고 |

### DRAG_SLOP 관련 주의

`DRAG_SLOP = 6` 은 Leaflet 내장 `Draggable.clickTolerance`(3px)보다 **관대해야 한다.**
6 → 3 이하로 줄이면 정상 클릭까지 막기 시작한다.

참고: **3px 이하 미세 이동 시 팝업이 안 열리는 것은 이 가드 탓이 아니다.**
Leaflet 이 자체 `clickTolerance` 로 `map` 의 `click` 을 아예 발생시키지 않는다(실측 확인:
가드보다 앞단에서 click 도달 횟수 0). 이걸 "버그"로 보고 이 가드를 고치면 안 된다.

---

## 4. 검증 방법 (수정했다면 반드시 이걸로 재확인)

`land.html` 은 `js/auth-guard.js` 로 Supabase 로그인을 요구하므로 자동 검증이 막힌다.
그 script 태그만 제거한 사본을 만들어 로컬 서버로 연다(`.gitignore` 가 `_mockup_*.html` 커버):

```bash
sed 's#<script[^>]*js/auth-guard\.js[^>]*></script>##' land.html > _mockup_land_test.html
node tools/static-server.js   # 포트 8181
```

브라우저에서 `http://localhost:8181/_mockup_land_test.html` 을 열고 콘솔에서:

```js
// ① 겹침 0px 확인 — 지도 여러 지점을 클릭해 반복
(async () => {
  const mc = document.querySelector('.leaflet-container');
  const r = mc.getBoundingClientRect();
  const cx = r.left + r.width*0.45, cy = r.top + r.height*0.30;
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click'])
    mc.dispatchEvent(new MouseEvent(t,{clientX:cx,clientY:cy,bubbles:true,cancelable:true,view:window,buttons:1,isPrimary:true}));
  await new Promise(s => setTimeout(s, 4500));
  const p = document.querySelector('.leaflet-popup').getBoundingClientRect();
  const c = mc.querySelector('.ctl-row').getBoundingClientRect();
  console.log('겹침', Math.max(0, Math.min(p.bottom,c.bottom) - Math.max(p.top,c.top)), '← 0 이어야 정상');
})();

// ② 줌별 크기 — z12 는 지도높이의 절반 이하여야 한다
for (const z of [11,12,13,16,17]) { map.setZoom(z);
  console.log(z, getComputedStyle(document.documentElement).getPropertyValue('--popup-max-h')); }
// 기대값: 11→210px 12→252px 13→294px 16→420px 17→420px (지도높이 728 기준)
```

③ 드래그는 **실제 마우스로** 확인한다(합성 이벤트로도 되지만 육안이 확실하다):
건물 위를 잡아 끌면 팝업이 안 떠야 하고, 제자리 클릭은 떠야 한다.

**작업 후 임시 사본을 반드시 지운다**: `rm -f _mockup_land_test.html`

---

## 5. 이 파일과 다른 문서의 관계

- `TROUBLESHOOTING.md` §42(겹침) / §43(드래그) — 원인 분석. **코드는 이 파일이 정본.**
- `TROUBLESHOOTING.md` §30 — **기각된 접근법.** 헤더에 그렇게 표시해 뒀다. 구현을 베끼지 말 것.
- `TROUBLESHOOTING.md` §30-2 — **§37 로 대체됨.** `bottom:-12px` 는 현재 금지 값.
- `TROUBLESHOOTING.md` §37 / §40 — 그립·닫기버튼 관련. 이 파일이 다루는 범위와 다르지만
  같은 팝업이라 함께 읽을 것.
- `land.backup-*.html` — **과거 스냅샷.** 여기서 팝업 위치·크기 코드를 가져오면 안 된다.
  이 파일들에는 위 5개 블록이 없거나 옛 버전이다.

---

## 6. 🔒 팝업 닫기(×)/접기(−) 버튼 + 스크롤바·그립 (확정본)

**확정 상태**: 2026-08-20 사용자 확인 — "접기/닫기 버튼 위치, 스크롤바 위치 문제 모두 해결된 상태".
이 영역은 §29·§30·§30-2·§37·§40 에 걸쳐 **최소 4차례 수정·되돌림**이 있었다. 아래가 최종형이다.

### 6-1. 확정된 배치 (실측 기준)

| 요소 | 위치 | 어디서 정하나 |
|---|---|---|
| 닫기 `×` | `top:3px; right:3px; z-index:1100` | **JS 인라인 style** (CSS 아님) |
| 접기 `−` | `top:3px; right:30px; z-index:1100` | CSS `.lp-min-btn` |
| 리사이즈 그립 | `bottom:3px; right:3px` (코너 **안쪽**) | CSS `.leaflet-popup .ui-grip-corner` |
| 스크롤 영역 | 그립 **위에서 끝난다** | wrapper `padding-bottom:28px` |
| 상단 여백 | 버튼 줄과 내용이 안 겹치게 | wrapper `padding-top:28px` |

`×` 와 `−` 는 **같은 줄, 같은 높이**(둘 다 `top:3px`)여야 한다. 27px 간격(3 vs 30)이 24px 버튼 폭 + 여유.

### 6-2. 절대 원칙 — 컨트롤은 래퍼에 JS로 직접 붙인다

```
✅ el = popup.getElement()   → .leaflet-popup        (래퍼)  ← 여기에 appendChild
❌                             .leaflet-popup-content-wrapper (내용 껍데기)
```

**Leaflet 기본 닫기 버튼은 `.leaflet-popup-content-wrapper` 안에 들어간다.** 그래서 CSS 로
`right/top` 을 아무리 조정해도 `−`(래퍼에 붙은 것)와 **절대 같은 줄이 안 된다** — 서로 다른
레이어에 있고 content 패딩이 개입하기 때문이다. 그래서 기본 버튼은 숨기고 JS 로 다시 만든다:

```css
    /* 닫기 X는 JS에서 래퍼에 직접 추가(§40 원칙). Leaflet 기본 버튼은 숨긴다. */
    .leaflet-container a.leaflet-popup-close-button { display:none; }
```

```css
    .lp-min-btn { position:absolute; top:3px; right:30px; z-index:1100; }
    .leaflet-popup .ui-grip-corner { bottom: 3px; right: 3px; }
    .leaflet-popup .leaflet-popup-content-wrapper { padding-top: 28px; padding-bottom: 28px; }
```

### 6-3. 닫기 버튼 생성 코드 (건물 팝업 — `attachPopupControls` 안)

**중복 방지 검사가 반드시 있어야 한다.** CCTV 팝업은 자체 `setTimeout` 에서 먼저 닫기를 추가하므로,
검사가 없으면 `×` 가 두 개 겹쳐 붙는다.

```js
      // 닫기 버튼 — 래퍼에 직접 추가 (§40 원칙: Leaflet 기본 버튼은 숨기고 JS에서 추가)
      // CCTV 팝업은 별도 setTimeout에서 이미 추가했을 수 있으므로 중복 방지
      if (!el.querySelector('[aria-label="닫기"]')) {
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'ui-pop-btn';
        closeBtn.setAttribute('aria-label', '닫기');
        closeBtn.innerHTML = '&times;';
        closeBtn.style.cssText = 'position:absolute;top:3px;right:3px;z-index:1100';
        el.appendChild(closeBtn);
        closeBtn.onclick = () => map.closePopup(popup);
      }
```

`aria-label="닫기"` 는 **중복 방지의 식별자로 쓰이므로 값을 바꾸면 안 된다.**

### 6-4. CCTV 팝업 (건물 팝업과 처리가 다름 — 통일하지 말 것)

CCTV 팝업은 `L.popup({ closeButton: false, ... })` 로 만들고, **`setTimeout(..., 0)` 안에서**
닫기 버튼을 직접 붙인다(영상 슬롯 마운트와 같은 타이밍). 좌표·클래스·z-index 는 §6-1 과 동일.

```js
          const popup = L.popup({ closeButton: false, maxWidth: 760 })
            .setLatLng([it.lat, it.lng]).setContent(html).openOn(map);
          setTimeout(() => {
            const node = popup.getElement();
            if (!node) return;
            const closeBtn = document.createElement('button');
            closeBtn.type = 'button';
            closeBtn.className = 'ui-pop-btn';
            closeBtn.setAttribute('aria-label', '닫기');
            closeBtn.innerHTML = '&times;';
            closeBtn.style.cssText = 'position:absolute;top:3px;right:3px;z-index:1100';
            node.appendChild(closeBtn);
            closeBtn.onclick = () => map.closePopup(popup);
            mountCctvVideo(node.querySelector('#cctv-video-slot'), it.url);
          }, 0);
```

CCTV 는 실시간 영상용(`maxWidth:760`)과 표준데이터 정보용(`maxWidth:400`) **두 갈래**가 있고
둘 다 같은 방식으로 닫기를 붙인다. 한쪽만 고치면 다른 쪽이 어긋난다.

### 6-5. 리사이즈 — `makeResizable`(pointer capture) 방식이 정답

```js
      makeResizable(grip, content, {
        applyStyle: false,
        minW: 220, minH: 120,
        maxW: () => map.getSize().x - 30,
        maxH: () => map.getSize().y - 50,
        // 드래그 중엔 autoPan 을 꺼 둬 지도가 함께 밀리지 않게 한다 (원래 값은 종료 시 복원)
        onStart: () => { autoPanPrev = popup.options.autoPan; popup.options.autoPan = false; },
        onResize: (w, h) => { popup._lpW = w; popup._lpH = h; popup._updateLayout(); popup._updatePosition(); },
        onEnd: () => { if (autoPanPrev != null) { popup.options.autoPan = autoPanPrev; autoPanPrev = null; } }
      });
```

`setPointerCapture()` 덕분에 드래그 후 합성 click 의 target 이 그립(=팝업 내부)에 머물러
`disableClickPropagation` 이 지도 click 을 막는다 → **"끌면 팝업이 재오픈되며 크기가 초기화"
문제가 구조적으로 발생하지 않는다.** `onStart/onEnd` 의 autoPan 토글도 반드시 유지할 것 —
빼면 드래그 중 지도가 함께 밀린다.

### 6-6. ⛔ 이 영역에서 하지 말 것

| 시도 | 결과 |
|---|---|
| Leaflet 기본 닫기 버튼을 CSS `right/top` 으로 재배치 | **실패** — content-wrapper 레이어를 벗어나지 못해 `−` 와 절대 같은 줄이 안 된다 |
| `×`/`−` 를 flex 헤더로 묶기 | **실패** — 서로 다른 레이어에 위치하게 된다 |
| 그립을 음수 `bottom` 으로 팝업 밖에 매달기 | **금지** — "팝업 창을 넘어가고 삐뚤어짐" 사용자 신고 |
| 겹침을 그립 `bottom` 값 조정으로 해결 | **금지** — 위치를 비틀면 팝업 밖으로 나가거나 재겹침, 둘 중 하나. wrapper `padding-bottom` 으로 스크롤 영역을 그립 위에서 끝내는 것이 유일한 구조적 해법 |
| content 에 `padding-right:36/48px` 로 스크롤바 밀기 | **실패** — 스크롤바 위치가 비틀려 "맨 우측에 없다" 신고 |
| 팝업 리사이즈를 스트립 핸들 + window 캡처 click 차단으로 구현 | **기각** — TROUBLESHOOTING §30. pointer capture 가 없어서 필요했던 우회책이었다 |
| CCTV 와 건물 팝업의 닫기 추가 방식을 하나로 합치기 | **위험** — 타이밍이 다르다(CCTV 는 영상 마운트와 같은 tick). 중복 방지 검사만 유지하면 공존한다 |
| `aria-label="닫기"` 문자열 변경 | **금지** — 중복 방지 식별자다 |

### 6-7. 그립 아이콘 색

`#C8C8C8` = 시스템 스크롤바 기본색(`HKCU\Control Panel\Colors` → `Scrollbar: 200 200 200`).
사용자 지시로 스크롤바와 통일했다. 팝업 스크롤바는 **오버레이**(hover 시에만 표시)라 화면
픽셀 실측이 불가해 레지스트리 값을 근거로 삼았다. 색을 바꾸려면 둘을 함께 맞춰야 한다.

### 6-8. 검증 스니펫

```js
// 닫기·접기가 같은 줄인지 + 그립이 스크롤 영역과 안 겹치는지
(() => {
  const el = document.querySelector('.leaflet-popup');
  const x = el.querySelector('[aria-label="닫기"]').getBoundingClientRect();
  const m = el.querySelector('.lp-min-btn').getBoundingClientRect();
  const g = el.querySelector('.ui-grip').getBoundingClientRect();
  const c = el.querySelector('.leaflet-popup-content').getBoundingClientRect();
  console.log('닫기 top', Math.round(x.top), '/ 접기 top', Math.round(m.top),
              '→ 같아야 정상 (차이', Math.round(Math.abs(x.top - m.top)), 'px)');
  console.log('닫기 개수', el.querySelectorAll('[aria-label="닫기"]').length, '← 1 이어야 정상');
  console.log('스크롤영역 하단', Math.round(c.bottom), '< 그립 상단', Math.round(g.top),
              '→', c.bottom < g.top ? '겹침 없음 OK' : '⚠️ 겹침');
})();
```

---

## 5-1. ⚠️ 반드시 알아야 할 구조 — 팝업 위치 로직은 **두 개**가 공존한다

이걸 모르고 한쪽을 "중복"이라 판단해 지우면 반대쪽 버그가 즉시 재발한다.

| | `clampPopup` (기존, 2026-08-07) | `nudgePopupIntoSafeArea` (신규, 2026-08-20) |
|---|---|---|
| 목적 | 팝업이 **지도 밖으로** 넘치지 않게 | 팝업이 **상단 컨트롤 줄**을 덮지 않게 |
| 판정 기준 | 지도 컨테이너 경계 (`POPUP_PAD = 12`) | `.ctl-row` 의 `getBoundingClientRect()` |
| 방식 | `popup.options.offset` 조정 (**지도는 안 움직임**) | `map.panBy` (**지도를 움직임**) |
| 호출 경로 | `L.Popup.prototype._adjustPan` **오버라이드** | `popupopen` + `ResizeObserver(래퍼)` |
| 삭제하면 | 팝업이 지도 밖으로 잘림 | 팝업이 배경지도 썸네일을 덮음 |

### `_adjustPan` 은 Leaflet 코드가 아니다

`land.html` 에서 이렇게 교체돼 있다:

```js
    if (L.Popup && L.Popup.prototype) {
      L.Popup.prototype._adjustPan = function () {
        if (!this.options.autoPan) return;
        clampPopup(this);
      };
    }
```

그래서 `popup._adjustPan()` 을 호출해도 **Leaflet 의 autoPan 이 아니라 `clampPopup` 이 돈다.**
`clampPopup` 은 지도 경계만 보므로 컨트롤 겹침은 해결되지 않는다.
2026-08-20 에 이걸 "Leaflet 내부 조기 반환 조건"이라고 **잘못 기록했다가 정정했다.**

### 설계 긴장 — 지도를 움직이는가

`clampPopup` 은 "**지도를 절대 움직이지 않는다**"는 원칙으로 도입됐다. 과거에 `map.panBy` 로
지도를 옮겼더니 ① 팝업이 자라날 때마다 ② 줌 후에 지도가 훌쩍 이동해
**"클릭한 좌표가 다른 곳으로 이동 / 줌하면 다른 화면으로 이동"** 이라는 사용자 제보가 있었다.

`nudgePopupIntoSafeArea` 는 그 원칙에 **반대로** `panBy` 를 쓴다. 타협점은 범위 제한이다:

- `.ctl-row` 와 **가로로 실제 겹칠 때만** 동작 (겹치지 않으면 즉시 반환)
- 겹친 **정확한 픽셀만큼만** 이동 (`need = ctlRow.bottom + 8 - popup.top`)
- `_nudging` 플래그 + rAF 로 연쇄 재진입 차단
- 결과적으로 팝업 1회당 대개 1번

**전면 `panBy` 로 되돌리지 말 것** — 과거 제보가 재발한다.
반대로 `nudge` 를 `offset` 방식으로 바꾸려는 시도도 권하지 않는다: 컨트롤을 피하려면
약 100px 을 내려야 하는데, `offset` 으로 그만큼 밀면 팝업 꼬리(tip)가 클릭 지점에서
시각적으로 떨어져 "엉뚱한 곳을 가리키는 팝업"이 된다. `clampPopup` 이 작은 보정에만
`offset` 을 쓰는 이유가 이것이다.

## 5-2. ⚠️ 2026-08-20 이전 커밋 해시는 전부 무효다

`git filter-repo` 로 히스토리를 재작성했다(경매 사진 제거). **모든 커밋 해시가 바뀌었다.**

- `HANDOFF.md` 에 약 100개, `TROUBLESHOOTING.md` 에 6개의 옛 해시가 인용돼 있는데
  **2026-08-20 이전 것은 `git show` 가 전부 `unknown revision` 을 낸다.**
- **해시를 못 찾는다고 "그 수정은 실제로 안 됐다"거나 "기록을 신뢰할 수 없다"고 판단하지 말 것.**
  기록 자체는 유효하고, 해시만 죽었다.
- 옛 해시 → 새 해시 대응표:
  `C:\Users\conoc\matjip_backup_before_filter_20260820\_filter_repo_maps\commit-map` (369줄)
- 정리 이전 저장소 전체 백업: `C:\Users\conoc\matjip_backup_before_filter_20260820`
  (GitHub 브랜치 `pre-r2-migration-backup` 에도 동일 이력)

## 5-3. ⚠️ CCTV 팝업 — 닫기 버튼 중복 (2026-08-20 실측·수정)

`openCctvPopup` 은 `openOn(map)` 으로 팝업을 연다. `openOn` 은 `popupopen` 을 **동기 발생**시키므로
`attachPopupControls` 가 먼저 돌아 닫기·접기·그립을 붙인다. 그 **뒤에** 실행되는 `setTimeout(…, 0)`
에서 닫기를 또 만들면 **같은 좌표에 2개가 겹친다**(실측: `[aria-label="닫기"]` 2개, 둘 다 507,223).

- 육안·클릭으로는 정상처럼 보여 오래 발견되지 않았다.
- **위험**: 나중에 X 위치를 옮기면 한 개만 옮겨져 X 가 2개로 보인다 → §40 을 읽고
  "또 버튼 위치 문제"로 오진해 8커밋 재작업 사이클이 재시작된다.
- **수정**: CCTV 두 분기(영상 `maxWidth:760` / 정보 `maxWidth:400`) 모두에서 닫기 생성 코드를
  삭제했다. `setTimeout` 은 `mountCctvVideo` 때문에 유지. **팝업 컨트롤 추가는
  `attachPopupControls` 한 곳으로만 한다.**
- 검증: 두 분기 모두 닫기 1 / 접기 1 / 그립 1, 닫기 동작 정상, 영상 슬롯 유지.
- ⚠️ `TROUBLESHOOTING.md` §40 의 "CCTV 는 별도 setTimeout 에서 **먼저** 추가하므로
  `attachPopupControls` 에서 건너뜀"은 **순서가 반대로 적힌 오류**다.

## 6-9. 왼쪽 패널 회피 — 좁은 화면에서는 완전 회피가 불가능하다 (2026-08-21 실측)

`.left-panels`(`position:absolute; left:0; z-index:2000`)는 지도 위 오버레이이고 팝업보다
z-index 가 높다. 마커가 패널 뒤에 있으면 팝업이 패널에 가려진다.

**구조적 한계**: 팝업 폭 > (지도 폭 − 패널 폭) 이면 물리적으로 들어갈 자리가 없다.
실측(지도 546px / 패널 340px / 팝업 493px, 가용 206px):

| 상황 | 결과 |
|---|---|
| 팝업 493px, 가용 206px | 오른쪽 여유(8px 여백까지)를 **전부 소진해 밀림**. 겹침 299→295px. 완전 회피 불가 |
| 팝업 177px, 가용 206px | 팝업 좌측 348 / 패널 우측 340 → **겹침 0px**, 여백 정확히 8px |

즉 **로직은 정확하고, 공간이 있으면 완전히 회피한다.** 좁은 창에서 겹침이 남는 것은 버그가
아니라 자리 부족이다. 이때도 "전부 아니면 전무"로 포기하지 않고 **여유만큼은 민다**
(`dx = Math.min(need, room)`).

### ⛔ 이 문제를 이렇게 "고치지" 말 것

| 시도 | 왜 안 되나 |
|---|---|
| `.leaflet-popup-content` 의 `max-width` 를 안전영역 폭으로 제한 | `max-width` 는 **리사이즈 상한**이라 사용자가 팝업을 넓히는 걸 막는다(코드 주석에 명시된 의도). 좁은 화면을 위해 넓은 화면의 기능을 깎는 셈 |
| 지도 밖으로라도 밀어버리기 | `clampPopup` 이 지도 안으로 되당겨 서로 싸운다(§5-1). 그래서 `room` 으로 상한을 둔다 |
| `.left-panels` z-index 를 팝업 아래로 내리기 | 패널이 팝업에 가려져 목록·검색을 못 쓴다. 패널이 위인 건 의도다 |
| 패널 폭을 코드에 상수로 박기 | 패널은 사용자가 폭 조절 가능(200~640px)하고 접을 수도 있다. 매번 `getBoundingClientRect` 로 실측해야 한다 |

**좁은 창에서 겹침이 실제로 불편하면** 선택지는 두 가지다: 패널 폭을 줄이거나(드래그로 200px까지),
패널을 접는다(접기 탭). 코드로 강제하지 않는 이유는 위 표와 같다.
