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
    var drag = null, raf = 0, lastEv = null;

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
      e.preventDefault();
      e.stopPropagation();
      drag = { sx: e.clientX, sy: e.clientY, w: target.offsetWidth, h: target.offsetHeight };
      try { grip.setPointerCapture(e.pointerId); } catch (err) {}
      if (opts.bodyClass) document.body.classList.add(opts.bodyClass);
      if (opts.gripClass) grip.classList.add(opts.gripClass);
      if (opts.onStart) opts.onStart(e);
    });
    grip.addEventListener('pointermove', function (e) {
      if (!drag) return;
      lastEv = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var ev = lastEv; lastEv = null;
        if (ev) apply(ev);
      });
    });
    function end() {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (lastEv) { var ev = lastEv; lastEv = null; apply(ev); }
      if (drag) {
        drag = null;
        if (opts.bodyClass) document.body.classList.remove(opts.bodyClass);
        if (opts.gripClass) grip.classList.remove(opts.gripClass);
        if (opts.onEnd) opts.onEnd();
      }
    }
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  };
})();
