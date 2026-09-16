// 푸터·헤더 세로 크기 조절 — 손잡이를 드래그. 크기는 localStorage에 저장.
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

// 헤더 세로 크기 조절 — 푸터와 같은 부품을 위아래만 뒤집은 것(2026-09-16 사용자 지시).
// 손잡이가 **아래쪽**에 있으므로 reverseH 를 쓰지 않는다 — 아래로 끌면 커진다.
(function () {
  var header = document.querySelector('header');
  var handle = document.getElementById('header-resize');
  if (!header || !handle) return;
  var KEY = 'mj-header-height';
  // ⛔ 모바일(≤640px)에서는 건드리지 않는다 — 거기선 header 가 height:auto 로 두 줄이 되고,
  //    인라인 height 를 박으면 내용이 잘린다. 손잡이도 CSS 에서 숨겨 둔다.
  var wide = function () { return window.matchMedia('(min-width:641px)').matches; };
  var saved = parseInt(localStorage.getItem(KEY), 10);
  if (wide() && saved >= 44 && saved <= 160) header.style.height = saved + 'px';

  makeResizable(handle, header, {
    axis: 'h',
    minH: 44,              // 34px 아이콘 버튼 + 상하 여백이 들어가는 최소값
    maxH: 160,
    onEnd: function () {
      try { localStorage.setItem(KEY, String(header.offsetHeight)); } catch (e) {}
    }
  });
})();

// 통계 띠 세로 크기 조절 — 지도와의 경계선. 헤더와 같은 부품·같은 방향이다.
// 손잡이가 띠 **아래**에 있으므로 reverseH 를 쓰지 않는다 — 아래로 끌면 커진다.
(function () {
  var bar = document.getElementById('stat-bar');
  var handle = document.getElementById('stat-resize');
  if (!bar || !handle) return;
  var KEY = 'mj-statbar-height';
  var wide = function () { return window.matchMedia('(min-width:641px)').matches; };
  var saved = parseInt(localStorage.getItem(KEY), 10);
  if (wide() && saved >= 18 && saved <= 60) bar.style.height = saved + 'px';

  makeResizable(handle, bar, {
    axis: 'h',
    minH: 18,              // 12.5px 글자가 잘리지 않는 최소값
    maxH: 60,
    onEnd: function () {
      try { localStorage.setItem(KEY, String(bar.offsetHeight)); } catch (e) {}
    }
  });
})();
