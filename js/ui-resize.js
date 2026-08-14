// 공용 리사이즈 드래그 헬퍼 (2026-08-12)
// 화면에 흩어져 있던 6개 크기조절 구현(Leaflet 팝업·레이어 컨트롤·경매 패널·우측 목록 패널·
// 거리뷰 오버레이·푸터)의 드래그 로직을 한 곳으로 모은다. 크기조절 버그가 날 때마다
// 위치별로 따로 고치던 문제가 이 파일 하나를 고치는 것으로 바뀐다.
// - 포인터 이벤트 + setPointerCapture: 마우스·터치 공용, 드래그가 창 밖으로 나가도 유지
// - rAF 배칭: 매 move 마다 레이아웃(offsetWidth) 재계산을 하지 않는다
// - min/max 제약: 옵션(숫자 또는 함수)이 없으면 target 의 computed style 을 읽는다
// - 위치별 특수 동작(파노라마 setSize, 팝업 _updateLayout, localStorage 저장)은
//   onStart/onResize/onEnd 콜백으로 연결한다 — 헬퍼 안에 if-분기로 넣으면 오히려 복잡해진다.
(function () {
  'use strict';
  window.makeResizable = function (grip, target, opts) {
    if (!grip || !target) return;
    opts = opts || {};
    // armed: dragThreshold 를 쓸 때 "눌렀지만 아직 드래그로 인정되진 않은" 상태.
    // 임계값 이상 움직여야 drag 로 승격된다 — 그래야 같은 손잡이가 클릭도 겸할 수 있다.
    // pressed/downPt: 손잡이를 누른 사실과 그 지점(드래그 허용 여부와 무관). 클릭 판정에 쓴다 —
    // 임계값 넘게 움직였으면 드래그가 실제로 일어났든 아니든 클릭으로 치지 않는다.
    var drag = null, armed = null, pressed = false, downPt = null, moved = false, raf = 0, lastEv = null;

    function num(v, dflt) {
      var n = (typeof v === 'function') ? v() : v;
      return (typeof n === 'number' && n > 0) ? n : dflt;
    }
    function bounds() {
      var cs = getComputedStyle(target);
      return {
        minW: num(opts.minW, parseFloat(cs.minWidth) || 150),
        maxW: num(opts.maxW, parseFloat(cs.maxWidth) || window.innerWidth - 40),
        minH: num(opts.minH, parseFloat(cs.minHeight) || 120),
        maxH: num(opts.maxH, window.innerHeight - 120)
      };
    }
    function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

    function apply(ev) {
      var b = bounds();
      var w = clamp(drag.w + (opts.reverseW ? drag.sx - ev.clientX : ev.clientX - drag.sx), b.minW, b.maxW);
      var h = clamp(drag.h + (opts.reverseH ? drag.sy - ev.clientY : ev.clientY - drag.sy), b.minH, b.maxH);
      if (opts.applyStyle !== false) {
        if (opts.axis !== 'h') target.style.width = w + 'px';
        if (opts.axis !== 'w') target.style.height = h + 'px';
      }
      if (opts.onResize) opts.onResize(w, h);
    }

    grip.addEventListener('pointerdown', function (e) {
      // 그립 "안에 든" 버튼을 누른 건 드래그가 아니라 그 버튼의 클릭이다. 안 걸러내면
      //   ① preventDefault() 가 뒤따르는 click 이벤트를 아예 없애고
      //   ② setPointerCapture() 가 mouseup/click 의 target 을 그립으로 바꿔
      // 버튼 onclick 이 영원히 안 불린다(2026-08-14 실측).
      // 단, 그립 자신이 버튼인 경우(클릭 겸 드래그 손잡이)는 예외 — 그건 아래에서 처리한다.
      var btn = e.target && e.target.closest && e.target.closest('button');
      if (btn && btn !== grip) return;

      if (opts.dragThreshold) {
        // 클릭 겸 드래그 손잡이. 여기서 preventDefault 하면 click 이 안 뜨므로 하지 않고,
        // 임계값을 넘게 움직인 순간(pointermove)에야 드래그로 승격시킨다.
        pressed = true;
        downPt = { x: e.clientX, y: e.clientY };
        moved = false;
        // dragEnabled 가 false 면 드래그만 막고 클릭은 살린다(예: 접힌 패널은 폭 조절 불가,
        // 하지만 눌러서 다시 펴는 건 돼야 한다).
        armed = (opts.dragEnabled && !opts.dragEnabled())
          ? null
          : { sx: e.clientX, sy: e.clientY, w: target.offsetWidth, h: target.offsetHeight };
        try { grip.setPointerCapture(e.pointerId); } catch (err) {}
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      drag = { sx: e.clientX, sy: e.clientY, w: target.offsetWidth, h: target.offsetHeight };
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      if (opts.bodyClass) document.body.classList.add(opts.bodyClass);
      if (opts.gripClass) grip.classList.add(opts.gripClass);
      if (opts.onStart) opts.onStart(e);
    });
    grip.addEventListener('pointermove', function (e) {
      // 드래그가 허용되지 않는 상황(dragEnabled false)이라도 '움직였다'는 사실은 기록해서,
      // 손을 뗄 때 클릭으로 오인하지 않게 한다.
      if (pressed && downPt && !moved && opts.dragThreshold
        && (Math.abs(e.clientX - downPt.x) >= opts.dragThreshold
          || Math.abs(e.clientY - downPt.y) >= opts.dragThreshold)) moved = true;
      if (armed && !drag) {
        // 임계값 안이면 아직 '클릭 후보' — 손 떨림으로 드래그가 되지 않게 한다.
        if (Math.abs(e.clientX - armed.sx) < opts.dragThreshold
          && Math.abs(e.clientY - armed.sy) < opts.dragThreshold) return;
        drag = armed;
        armed = null;
        e.preventDefault();
        if (opts.bodyClass) document.body.classList.add(opts.bodyClass);
        if (opts.gripClass) grip.classList.add(opts.gripClass);
        if (opts.onStart) opts.onStart(e);
      }
      if (!drag) return;
      lastEv = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var ev = lastEv; lastEv = null;
        if (ev) apply(ev);
      });
    });
    function end(e, allowClick) {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (lastEv) { var ev = lastEv; lastEv = null; apply(ev); }
      var wasDrag = !!drag;
      if (drag) {
        drag = null;
        if (opts.bodyClass) document.body.classList.remove(opts.bodyClass);
        if (opts.gripClass) grip.classList.remove(opts.gripClass);
        if (opts.onEnd) opts.onEnd();
      }
      var wasPressed = pressed, wasMoved = moved;
      armed = null;
      pressed = false;
      downPt = null;
      moved = false;
      // 임계값을 못 넘고 손을 뗐으면 = 클릭. click 이벤트에 기대지 않고 여기서 직접 알린다
      // (setPointerCapture 때문에 click 의 target 이 흔들릴 수 있어 이 편이 확실하다).
      if (allowClick && opts.dragThreshold && !wasDrag && !wasMoved && wasPressed && opts.onClick) opts.onClick(e);
    }
    grip.addEventListener('pointerup', function (e) { end(e, true); });
    grip.addEventListener('pointercancel', function (e) { end(e, false); });
  };
})();
