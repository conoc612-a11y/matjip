// 공용 경로선 렌더러 — 테두리 + 진행방향 꺾쇠 (js/route-line.js, 2026-09-03)
//
// 왜 만들었나: 길찾기 선이 세 페이지(land.html·detail.html·main.html)에 각자 복붙돼
// 있었고, 셋 다 L.polyline / naver.maps.Polyline 한 줄짜리 민선이었다. 특히 대중교통은
// 출발→도착을 **직선 점선 하나로** 이어 놓고 있었다(실제 노선을 안 그렸다).
//
// 설계 요점
// - 3겹 구조: ①흰 테두리(casing) ②구간색 본선 ③흰 꺾쇠(진행방향).
//   land.html 지도는 실거래가 마커가 빽빽해서, 테두리가 없으면 주황 본선이 가격 배지
//   (--c-price:#d9480f, 같은 주황 계열)와 섞여 어느 게 경로인지 구분이 안 된다.
// - 꺾쇠는 **화면 픽셀 등간격**으로 놓는다(위경도 등간격이 아니다). 줌을 당기든 밀든
//   화살표 밀도가 같아야 방향이 읽힌다 → zoom/move 마다 다시 계산한다.
// - 화살표는 채워진 삼각형이 아니라 얇은 꺾쇠이고 간격도 성기다. 도보는 화살표 대신
//   흐르는 점선으로 방향을 준다 — 기성 지도앱과 같은 그림이 되지 않게 한 선택이다.
// - 지도 라이브러리가 페이지마다 다르다(land/detail = Leaflet, main = 네이버 지도).
//   그래서 그리기 로직은 하나로 두고 어댑터만 둘로 나눈다.
(function () {
  'use strict';

  // 구간색 — 주황 계열로 통일한다(2026-09-03 사용자 결정).
  // 지하철(#d9480f)과 자차(#e8590c)가 가깝지만 두 모드는 동시에 그려지지 않는다.
  var PALETTE = {
    subway: { color: '#d9480f', weight: 6 },
    bus:    { color: '#f76707', weight: 6 },
    walk:   { color: '#ffa94d', weight: 5, dashed: true },
    car:    { color: '#e8590c', weight: 6 }
  };
  var CASING = { color: '#ffffff', add: 5, opacity: 0.95 };
  var DASH = '1 11';       // 도보 점선 — 점 하나 + 간격. 테두리와 본선이 같은 값을 써야 겹친다.
  var ARROW_GAP_PX = 78;   // 꺾쇠 간격(화면 픽셀). 촘촘하면 선이 지저분해진다.
  var ARROW_MAX = 80;      // 긴 경로에서 마커가 무한정 늘지 않게 상한을 둔다.

  function style(type) { return PALETTE[type] || PALETTE.car; }

  // 흰 꺾쇠 한 개. rotate 는 화면 기준 각도(도)다.
  function chevronHTML(deg) {
    return '<svg width="16" height="16" viewBox="0 0 16 16" style="display:block;transform:rotate(' + deg + 'deg);'
      + 'filter:drop-shadow(0 0 1px rgba(0,0,0,.35));">'
      + '<path d="M5 3 L10.5 8 L5 13" fill="none" stroke="#fff" stroke-width="2.6" '
      + 'stroke-linecap="round" stroke-linejoin="round" opacity=".97"/></svg>';
  }

  // 구간 경계(환승 지점) 점. 흰 링 안에 다음 구간색을 채운다.
  function nodeHTML(color) {
    return '<div style="width:13px;height:13px;border-radius:50%;background:' + color
      + ';border:3px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);box-sizing:border-box;"></div>';
  }

  // 화면 좌표 폴리라인 위에 gap 픽셀 간격으로 점+각도를 찍는다.
  // carry: 앞 구간에서 남은 거리를 다음 구간으로 넘긴다 — 꼭짓점마다 간격이
  // 리셋되면 꺾이는 곳에서 화살표가 뭉친다.
  function spacePoints(pts, gap) {
    var out = [], carry = gap * 0.5, i, a, b, dx, dy, len, ang, d;
    for (i = 0; i < pts.length - 1; i++) {
      a = pts[i]; b = pts[i + 1];
      dx = b.x - a.x; dy = b.y - a.y;
      len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-6) continue;
      ang = Math.atan2(dy, dx) * 180 / Math.PI;
      d = carry;
      while (d <= len) {
        out.push({ x: a.x + dx * d / len, y: a.y + dy * d / len, ang: ang });
        d += gap;
        if (out.length >= ARROW_MAX) return out;
      }
      carry = d - len;
    }
    return out;
  }

  // 흐르는 점선 애니메이션 — Leaflet 은 polyline 에 className 을 줄 수 있어서 CSS 로 붙인다.
  // (네이버 Polyline 은 className 을 못 받는다 → main.html 은 정적 점선으로 떨어진다.)
  function injectCSS() {
    if (document.getElementById('mj-rl-css')) return;
    var s = document.createElement('style');
    s.id = 'mj-rl-css';
    s.textContent = '.mj-rl-flow{animation:mj-rl-flow 1.1s linear infinite;}'
      + '@keyframes mj-rl-flow{to{stroke-dashoffset:-20;}}'
      + '.mj-rl-arrow,.mj-rl-node{pointer-events:none!important;background:none!important;border:none!important;}'
      + '@media (prefers-reduced-motion:reduce){.mj-rl-flow{animation:none;}}';
    document.head.appendChild(s);
  }

  // ── Leaflet 어댑터 ──────────────────────────────────────────────
  function leafletAdapter(map) {
    var layer = null, segs = [], onView = null;
    // 🔴 land.html 은 `preferCanvas: true` 다(마커 9천개·정점 4.2만개 때문). 그대로 두면
    //    경로선이 캔버스에 그려져 ①흐르는 점선 CSS 가 안 먹고 ②DOM 검사로 확인할 수 없다.
    //    경로선은 정점이 100여 개뿐이라 SVG 로 그려도 부담이 없다 — 렌더러를 명시한다.
    var svgR = L.svg({ padding: 0.4 });

    function drawArrows() {
      if (!layer) return;
      // 화살표만 지운다(본선·테두리는 그대로) — 매 줌마다 전부 다시 그리면 깜빡인다.
      var kill = [];
      layer.eachLayer(function (l) { if (l._mjArrow) kill.push(l); });
      kill.forEach(function (l) { layer.removeLayer(l); });
      var pad = map.getBounds().pad(0.15), placed = 0;
      segs.forEach(function (s) {
        if (s.type === 'walk') return;             // 도보는 흐르는 점선이 방향을 맡는다
        if (placed >= ARROW_MAX) return;
        var pts = s.coords.map(function (c) { return map.latLngToLayerPoint(L.latLng(c[0], c[1])); });
        spacePoints(pts, ARROW_GAP_PX).forEach(function (p) {
          if (placed >= ARROW_MAX) return;
          var ll = map.layerPointToLatLng(L.point(p.x, p.y));
          if (!pad.contains(ll)) return;           // 화면 밖 화살표는 만들지 않는다
          var mk = L.marker(ll, {
            interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'mj-rl-arrow', html: chevronHTML(p.ang), iconSize: [16, 16], iconAnchor: [8, 8] })
          });
          mk._mjArrow = true;
          mk.addTo(layer);
          placed++;
        });
      });
    }

    return {
      draw: function (segments) {
        injectCSS();
        this.clear();
        segs = segments || [];
        layer = L.layerGroup().addTo(map);
        segs.forEach(function (s) {
          var st = style(s.type);
          var lls = s.coords.map(function (c) { return [c[0], c[1]]; });
          if (lls.length < 2) return;
          // 테두리도 본선과 **같은 점선 패턴**을 쓴다. 통짜 흰 선을 깔면 도보 구간이
          // 흰 띠 위에 점을 얹은 꼴이 돼 지저분하다(2026-09-03 캡처로 확인).
          // 같은 패턴이면 점 하나하나에 흰 테가 둘러진다.
          L.polyline(lls, { renderer: svgR, color: CASING.color, weight: st.weight + CASING.add,
            opacity: CASING.opacity, lineCap: 'round', lineJoin: 'round', interactive: false,
            smoothFactor: 0.5, dashArray: st.dashed ? DASH : null,
            className: st.dashed ? 'mj-rl-flow' : '' }).addTo(layer);
          L.polyline(lls, {
            renderer: svgR, color: st.color, weight: st.weight, opacity: 0.95,
            lineCap: 'round', lineJoin: 'round', interactive: false, smoothFactor: 0.5,
            dashArray: st.dashed ? DASH : null,
            className: st.dashed ? 'mj-rl-flow' : ''
          }).addTo(layer);
        });
        // 구간 경계(환승 지점) — 구간이 2개 이상일 때만 의미가 있다
        for (var i = 1; i < segs.length; i++) {
          var prev = segs[i - 1].coords;
          if (!prev || !prev.length) continue;
          var c = prev[prev.length - 1];
          L.marker([c[0], c[1]], { interactive: false, keyboard: false,
            icon: L.divIcon({ className: 'mj-rl-node', html: nodeHTML(style(segs[i].type).color), iconSize: [13, 13], iconAnchor: [7, 7] })
          }).addTo(layer);
        }
        drawArrows();
        onView = function () { drawArrows(); };
        map.on('zoomend moveend', onView);
        return this;
      },
      bounds: function () {
        var all = [];
        segs.forEach(function (s) { s.coords.forEach(function (c) { all.push([c[0], c[1]]); }); });
        return all.length ? L.latLngBounds(all) : null;
      },
      clear: function () {
        if (onView) { map.off('zoomend moveend', onView); onView = null; }
        if (layer) { map.removeLayer(layer); layer = null; }
        segs = [];
      }
    };
  }

  // ── 네이버 지도 어댑터 ──────────────────────────────────────────
  // 네이버는 Polyline 에 CSS class 를 못 붙인다 → 도보는 정적 dot 스타일로 떨어진다.
  function naverAdapter(map) {
    var objs = [], arrows = [], segs = [], listener = null;

    function proj() { return map.getProjection(); }

    function drawArrows() {
      arrows.forEach(function (o) { o.setMap(null); });
      arrows = [];
      var b = map.getBounds(), placed = 0;
      segs.forEach(function (s) {
        if (s.type === 'walk' || placed >= ARROW_MAX) return;
        var pts = s.coords.map(function (c) { return proj().fromCoordToOffset(new naver.maps.LatLng(c[0], c[1])); });
        spacePoints(pts, ARROW_GAP_PX).forEach(function (p) {
          if (placed >= ARROW_MAX) return;
          var ll = proj().fromOffsetToCoord(new naver.maps.Point(p.x, p.y));
          if (!b.hasLatLng(ll)) return;
          arrows.push(new naver.maps.Marker({ map: map, position: ll, clickable: false,
            icon: { content: chevronHTML(p.ang), anchor: new naver.maps.Point(8, 8) } }));
          placed++;
        });
      });
    }

    return {
      draw: function (segments) {
        this.clear();
        segs = segments || [];
        segs.forEach(function (s) {
          var st = style(s.type);
          var path = s.coords.map(function (c) { return new naver.maps.LatLng(c[0], c[1]); });
          if (path.length < 2) return;
          objs.push(new naver.maps.Polyline({ map: map, path: path, strokeColor: CASING.color,
            strokeWeight: st.weight + CASING.add, strokeOpacity: CASING.opacity,
            strokeLineCap: 'round', strokeLineJoin: 'round', clickable: false }));
          objs.push(new naver.maps.Polyline({ map: map, path: path, strokeColor: st.color,
            strokeWeight: st.weight, strokeOpacity: 0.95, strokeLineCap: 'round', strokeLineJoin: 'round',
            strokeStyle: st.dashed ? 'dot' : 'solid', clickable: false }));
        });
        for (var i = 1; i < segs.length; i++) {
          var prev = segs[i - 1].coords;
          if (!prev || !prev.length) continue;
          var c = prev[prev.length - 1];
          objs.push(new naver.maps.Marker({ map: map, position: new naver.maps.LatLng(c[0], c[1]), clickable: false,
            icon: { content: nodeHTML(style(segs[i].type).color), anchor: new naver.maps.Point(7, 7) } }));
        }
        drawArrows();
        listener = naver.maps.Event.addListener(map, 'idle', drawArrows);
        return this;
      },
      bounds: function () {
        var la = [], lo = [];
        segs.forEach(function (s) { s.coords.forEach(function (c) { la.push(c[0]); lo.push(c[1]); }); });
        if (!la.length) return null;
        return new naver.maps.LatLngBounds(
          new naver.maps.LatLng(Math.min.apply(null, la), Math.min.apply(null, lo)),
          new naver.maps.LatLng(Math.max.apply(null, la), Math.max.apply(null, lo)));
      },
      clear: function () {
        if (listener) { naver.maps.Event.removeListener(listener); listener = null; }
        objs.concat(arrows).forEach(function (o) { o.setMap(null); });
        objs = []; arrows = []; segs = [];
      }
    };
  }

  window.RouteLine = {
    PALETTE: PALETTE,
    leaflet: leafletAdapter,
    naver: naverAdapter
  };
})();
