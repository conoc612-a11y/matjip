// 푸터 위아래 세로 크기 조절 — 상단 손잡이를 드래그. 크기는 localStorage에 저장.
// 드래그 로직은 js/ui-resize.js 의 공용 makeResizable() 을 쓴다 (리사이즈 버그 수정 지점 통일).
(function () {
  var footer = document.getElementById('site-footer');
  var handle = document.getElementById('footer-resize');
  if (!footer || !handle) return;
  var KEY = 'mj-footer-height';
  var saved = parseInt(localStorage.getItem(KEY), 10);
  if (saved >= 24 && saved <= window.innerHeight * 0.6) footer.style.height = saved + 'px';

  makeResizable(handle, footer, {
    axis: 'h',
    reverseH: true,        // 핸들이 위쪽에 있으므로 위로 끌면 커진다
    minH: 24,
    maxH: function () { return window.innerHeight * 0.6; },
    onEnd: function () {
      try { localStorage.setItem(KEY, String(footer.offsetHeight)); } catch (e) {}
    }
  });
})();
