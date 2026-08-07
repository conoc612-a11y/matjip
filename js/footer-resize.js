// 푸터 위아래 세로 크기 조절 — 상단 손잡이를 드래그. 크기는 localStorage에 저장.
(function () {
  var footer = document.getElementById('site-footer');
  var handle = document.getElementById('footer-resize');
  if (!footer || !handle) return;
  var KEY = 'mj-footer-height';
  var saved = parseInt(localStorage.getItem(KEY), 10);
  if (saved >= 24 && saved <= window.innerHeight * 0.6) footer.style.height = saved + 'px';

  handle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    var startY = e.clientY, startH = footer.offsetHeight;
    function onMove(ev) {
      var h = startH + (startY - ev.clientY);
      h = Math.max(24, Math.min(h, window.innerHeight * 0.6));
      footer.style.height = h + 'px';
    }
    function onUp() {
      localStorage.setItem(KEY, String(footer.offsetHeight));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();
