// IE 는 ES6 를 파싱하지 못해 인라인 스크립트가 죽으므로, ES5 + documentMode 로 감지해 안내문만 띄운다.
// 왜 별도 파일인가: 5개 페이지에 문자 그대로 중복돼 있던 블록을 한 곳으로 모은 것 (2026-08-12).
if (document.documentMode) {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#e8590c;color:#fff;text-align:center;padding:8px 12px;font-size:13px;line-height:1.5;font-family:sans-serif;';
  el.textContent = '이 사이트는 인터넷 익스플로러(IE)를 지원하지 않습니다. Chrome·Edge·Safari 등 최신 브라우저를 이용해 주세요.';
  document.body.appendChild(el);
}
