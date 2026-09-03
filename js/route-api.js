// 길찾기 경로 조회 — 실제 도로/노선 좌표를 가져온다 (js/route-api.js, 2026-09-03)
//
// 왜 만들었나: 세 페이지가 각자 ODsay·OSRM 을 부르고 있었는데, 대중교통은 좌표를
// 아예 안 받아오고 **출발→도착 직선**을 그렸다. ODsay 가 노선 좌표를 주는데도 안 썼다.
//
// 실측(2026-09-03, 은천교→사당):
//   searchPubTransPathT → info.mapObj = "2:2:228:226@4:2:433:432"
//   loadLane?mapObject=0:0@{mapObj} → lane[0] 45점(2호선) + lane[1] 14점(4호선) = 59점
//   → 이 좌표가 도로/선로를 따라간다.
//
// 함정 두 가지
//  1) 🔴 `router.project-osrm.org` 는 **프로필을 무시한다.** `/route/v1/foot/` 로 불러도
//     자동차와 완전히 같은 값을 준다(3937.1m·340.7초 — driving 과 동일, 실측). 그래서
//     도보는 보행자 전용 서버(routing.openstreetmap.de/routed-foot)로 부른다.
//     같은 구간이 3490.6m·46분으로 **다르게** 나온다(보행 전용길·횡단보도 반영).
//  2) 🔴 ODsay 의 도보 구간(trafficType 3)에는 **좌표 필드가 아예 없다**
//     (`distance`·`sectionTime`·`trafficType` 뿐 — 실측). 그래서 도보 구간의 양 끝은
//     앞뒤 교통수단 구간의 좌표(가능하면 지하철 출구 startExitX/Y)에서 유도한다.
(function () {
  'use strict';

  var OSRM_CAR  = 'https://router.project-osrm.org/route/v1/driving/';
  var OSRM_FOOT = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  var OSRM_CAR_ALT = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/';   // 자차 대체 서버

  // 🔴 타임아웃이 반드시 있어야 한다. 없으면 응답이 안 올 때 화면이 '경로 계산 중…' 에서
  //    **영원히** 멈춘다(2026-09-03 실측: 공개 라우팅 서버 요청이 20초 넘게 pending 인 채
  //    끝나지 않는 상황을 봤다. 옛 코드에는 타임아웃이 없어 빠져나올 길이 없었다).
  //    끊기면 호출자가 null 을 받아 '경로를 찾지 못했어요' 로 떨어진다.
  //    ⚠️ 1차 + 대체서버가 **직렬**이라 둘을 더한 값이 사용자가 기다리는 시간이다.
  //    9초+9초=18.3초는 멈춘 것과 다름없어(실측) 7초+4초로 줄였다 — 최악 약 11초.
  var TIMEOUT_MS = 7000;
  var TIMEOUT_ALT_MS = 4000;   // 대체 서버는 더 짧게 — 여기서 또 오래 끌면 의미가 없다
  function jget(url, ms) {
    var opt = {};
    // AbortSignal.timeout 이 없는 브라우저는 AbortController 로 같은 일을 한다.
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) {
      opt.signal = AbortSignal.timeout(ms || TIMEOUT_MS);
    } else if (typeof AbortController !== 'undefined') {
      var ac = new AbortController();
      opt.signal = ac.signal;
      setTimeout(function () { try { ac.abort(); } catch (e) {} }, ms || TIMEOUT_MS);
    }
    return fetch(url, opt).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  // OSRM 한 구간. o/d 는 {lat,lng}. 실패하면 null 을 돌려주고 호출자가 직선으로 떨어진다.
  // profile: 'foot' | 'car'
  function osrm(profile, o, d) {
    var base = profile === 'foot' ? OSRM_FOOT : OSRM_CAR;
    var url = base + o.lng + ',' + o.lat + ';' + d.lng + ',' + d.lat + '?overview=full&geometries=geojson';
    return jget(url).then(function (j) {
      var rt = j && j.routes && j.routes[0];
      if (!rt) return null;
      return {
        coords: rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
        distance: rt.distance,
        duration: rt.duration
      };
    }).catch(function () {
      // 한쪽이 죽거나 느리면 다른 쪽으로 넘어간다. 둘 다 무료 공개 서버라 언제든 흔들린다.
      var alt = profile === 'foot' ? OSRM_CAR : OSRM_CAR_ALT;
      return jget(alt + o.lng + ',' + o.lat + ';' + d.lng + ',' + d.lat + '?overview=full&geometries=geojson', TIMEOUT_ALT_MS)
        .then(function (j) {
          var rt = j && j.routes && j.routes[0];
          if (!rt) return null;
          return {
            coords: rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }),
            distance: rt.distance,
            // 도보를 차량 서버로 대체했을 때는 소요시간을 그대로 쓸 수 없다 — 4.5km/h 로 환산한다.
            duration: profile === 'foot' ? rt.distance / 1.25 : rt.duration,
            approx: profile === 'foot'      // 차량 도로 기하로 대체했다는 표시
          };
        }).catch(function () { return null; });
    });
  }

  // ── ODsay 호출 캐시 ─────────────────────────────────────────────
  // 왜: 대중교통 1회 조회에 ODsay 호출이 **2번** 든다(searchPubTransPathT + loadLane).
  //     Basic(무료) 한도가 1,000회/일이라 하루 500회 조회분이다. 게다가 사용자가
  //     도보↔대중교통↔자차 를 오갈 때마다 같은 경로를 매번 새로 물어보고 있었다.
  //     ⚠️ 한 번에 받는 방법은 없다 — 공식 문서상 mapObj 는 "보간점 API 를 호출하기 위한
  //     파라미터"이고 geometry 를 응답에 포함시키는 옵션이 없다. 그래서 호출 수 자체는
  //     못 줄이고, **같은 것을 다시 묻지 않는 것**으로 줄인다.
  //  · 노선 선형(loadLane)은 거의 안 변한다 → 길게 보관(7일).
  //  · 경로 탐색(searchPubTransPathT)은 소요시간·요금이 바뀔 수 있다 → 짧게(30분).
  // 🔴 프리픽스에 **판(version)** 을 붙인다. 캐시에 담는 모양을 바꿨는데 키를 그대로 두면,
  //    이미 옛 형식을 담아 둔 브라우저가 그걸 새 모양으로 읽어 길찾기가 통째로 깨진다.
  //    (실제로 겪었다 — 응답 전체를 담던 판에서 { info, subPath } 판으로 바꾼 뒤,
  //     옛 항목이 남은 브라우저에서 '대중교통 경로를 찾지 못했어요' 가 떴다.)
  //    ⚠️ 담는 모양을 바꾸면 이 숫자를 반드시 올려라.
  var CACHE_PREFIX = 'mj_odsay2_';
  var CACHE_PREFIX_OLD = ['mj_odsay_'];   // 옛 판 — 처음 한 번 쓸어 담아 지운다
  var CACHE_MAX = 40;            // localStorage 를 무한정 먹지 않게 개수 상한
  var CACHE_MAX_BYTES = 60000;   // 항목 하나의 상한. 이보다 크면 캐시하지 않는다
  var TTL_LANE = 7 * 24 * 3600e3;
  var TTL_PATH = 30 * 60e3;
  var stats = { net: 0, hit: 0 };   // 검증용 — 캐시가 실제로 먹는지 눈으로 센다

  // 옛 판 찌꺼기를 지운다(파일이 로드될 때 한 번).
  (function sweepOld() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k) continue;
        for (var j = 0; j < CACHE_PREFIX_OLD.length; j++) {
          if (k.indexOf(CACHE_PREFIX_OLD[j]) === 0) { kill.push(k); break; }
        }
      }
      kill.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) {}
  })();

  // shape: 담긴 값이 기대한 모양인지 확인하는 함수(선택). 아니면 캐시 없음으로 친다 —
  // 판을 올리는 걸 잊어도 길찾기가 깨지지는 않게 하는 두 번째 안전판이다.
  function cacheGet(key, shape) {
    try {
      var raw = localStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.exp || Date.now() > o.exp) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
      if (shape && !shape(o.v)) { localStorage.removeItem(CACHE_PREFIX + key); return null; }
      stats.hit++;
      return o.v;
    } catch (e) { return null; }   // 사파리 프라이빗 등에서 던진다 — 캐시 없음으로 취급
  }
  function cacheSet(key, val, ttl) {
    try {
      // 상한을 넘으면 가장 오래된 것부터 버린다(만료시각 기준).
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(CACHE_PREFIX) === 0) keys.push(k);
      }
      if (keys.length >= CACHE_MAX) {
        keys.map(function (k) {
          var e = 0;
          try { e = (JSON.parse(localStorage.getItem(k)) || {}).exp || 0; } catch (x) {}
          return { k: k, e: e };
        }).sort(function (a, b) { return a.e - b.e; })
          .slice(0, keys.length - CACHE_MAX + 1)
          .forEach(function (x) { try { localStorage.removeItem(x.k); } catch (e) {} });
      }
      var body = JSON.stringify({ exp: Date.now() + ttl, v: val });
      // 🔴 저장소는 즐겨찾기(mj_saved_props·mj_saved_agents)와 **같이 쓴다.** 경로 캐시가
      //    다 먹으면 사용자가 저장을 못 하게 된다. 큰 것은 아예 캐시하지 않는다.
      if (body.length > CACHE_MAX_BYTES) return;
      localStorage.setItem(CACHE_PREFIX + key, body);
    } catch (e) {}   // 용량 초과 등 — 캐시는 있으면 좋은 것이지 필수가 아니다
  }
  // 출발·도착을 소수점 4자리(약 11m)로 뭉갠다 — 몇 m 차이로 캐시를 놓치지 않게.
  function odKey(o, d) {
    var r = function (n) { return Number(n).toFixed(4); };
    return 'p_' + r(o.lat) + ',' + r(o.lng) + '_' + r(d.lat) + ',' + r(d.lng);
  }

  // 도보 구간 캐시 — 대중교통 1회 조회에 OSRM 이 최대 3번 나간다(구간마다 한 번).
  // 보도는 거의 안 변하니 길게 보관한다. 좌표를 소수점 4자리(약 11m)로 뭉개 키를 만든다.
  var TTL_WALK = 7 * 24 * 3600e3;
  function osrmWalkCached(a, b) {
    var r = function (n) { return Number(n).toFixed(4); };
    var k = 'w_' + r(a.lat) + ',' + r(a.lng) + '_' + r(b.lat) + ',' + r(b.lng);
    var hit = cacheGet(k, function (v) { return v && v.coords && v.coords.length > 1; });
    if (hit) return Promise.resolve(hit);
    return osrm('foot', a, b).then(function (w) {
      if (w && w.coords && w.coords.length > 1) cacheSet(k, w, TTL_WALK);
      return w;
    });
  }

  // 지하철은 출구 좌표가 있으면 그쪽이 실제로 걸어가는 지점이다.
  function legStart(s) {
    return { lat: Number(s.startExitY || s.startY), lng: Number(s.startExitX || s.startX) };
  }
  function legEnd(s) {
    return { lat: Number(s.endExitY || s.endY), lng: Number(s.endExitX || s.endX) };
  }

  // 대중교통 경로 + 실제 노선 좌표.
  // 반환: { info, steps, segments } — segments 는 RouteLine 이 그대로 먹는 형식이다.
  function transit(o, d) {
    var base = 'https://api.odsay.com/v1/api/';
    var key = encodeURIComponent(window.ODSAY_KEY || (typeof ODSAY_KEY !== 'undefined' ? ODSAY_KEY : ''));
    var url = base + 'searchPubTransPathT?SX=' + o.lng + '&SY=' + o.lat + '&EX=' + d.lng + '&EY=' + d.lat + '&apiKey=' + key;

    // 🔴 응답 전체를 캐시하면 안 된다 — searchPubTransPathT 는 경로를 **21개** 돌려주는데
    //    우리가 쓰는 건 path[0] 뿐이다(실측 77KB). info·subPath 만 남겨 담는다.
    var pKey = odKey(o, d);
    var cachedPath = cacheGet(pKey, function (v) { return v && v.info && v.subPath; });
    var pathP = cachedPath ? Promise.resolve(cachedPath) : (stats.net++, jget(url).then(function (j) {
      var p0 = j && j.result && j.result.path && j.result.path[0];
      if (!p0) return null;
      var slim = { info: p0.info, subPath: p0.subPath };
      cacheSet(pKey, slim, TTL_PATH);
      return slim;
    }));

    return pathP.then(function (p) {
      if (!p) return null;
      var mapObj = p.info && p.info.mapObj;
      if (!mapObj) return { info: p.info, subPath: p.subPath, lanes: [] };
      // loadLane 은 호출을 한 번 더 쓴다(무료 쿼터). 그래서 선을 실제로 그릴 때만 부르고,
      // mapObj 를 키로 캐시한다 — 같은 경로를 다시 그릴 땐 호출이 0 이다.
      var lKey = 'l_' + mapObj, cachedLane = cacheGet(lKey, function (v) { return v && v.length; });
      if (cachedLane) return { info: p.info, subPath: p.subPath, lanes: cachedLane };
      stats.net++;
      return jget(base + 'loadLane?mapObject=' + encodeURIComponent('0:0@' + mapObj) + '&apiKey=' + key)
        .then(function (lj) {
          var lanes = (lj && lj.result && lj.result.lane) || [];
          if (lanes.length) cacheSet(lKey, lanes, TTL_LANE);   // 오류는 캐시하지 않는다
          return { info: p.info, subPath: p.subPath, lanes: lanes };
        })
        .catch(function () { return { info: p.info, subPath: p.subPath, lanes: [] }; });
    }).then(function (r) {
      if (!r) return null;
      return buildSegments(o, d, r).then(function (segments) {
        return { info: r.info, subPath: r.subPath, segments: segments };
      });
    });
  }

  // subPath 순서대로 구간을 만든다. 교통수단 구간은 loadLane 좌표를, 도보 구간은
  // 앞뒤 좌표를 잡아 OSRM 보행 경로로 채운다.
  function buildSegments(o, d, r) {
    var subs = r.subPath || [], lanes = r.lanes || [];
    var laneIdx = 0, out = [], walkJobs = [];

    // 1차: 교통수단 구간을 먼저 채워 넣는다(도보 구간의 양 끝을 알아야 하기 때문).
    subs.forEach(function (s) {
      if (s.trafficType === 3) { out.push({ type: 'walk', coords: [], sub: s }); return; }
      var lane = lanes[laneIdx++];
      var coords = [];
      if (lane && lane.section) {
        lane.section.forEach(function (sec) {
          (sec.graphPos || []).forEach(function (g) { coords.push([g.y, g.x]); });
        });
      }
      // loadLane 이 비면(한도 초과·옛 노선 등) **1차 응답에 이미 들어 있는 정류장 좌표**를 쓴다.
      // 공짜다(추가 호출 없음). 다만 정류장 사이를 직선으로 이으므로 코너가 잘린다 —
      // 실측(2026-09-03): 버스 관악06 11정류장 기준 2,789m 로 실제 3,272m 보다 483m(17%) 짧고,
      // 지하철 2호선은 실제 선형에서 최대 186m 벗어난다. 그래서 대체용일 뿐 상시로는 안 쓴다.
      if (coords.length < 2) {
        var st = (s.passStopList && s.passStopList.stations) || [];
        coords = st.map(function (x) { return [Number(x.y), Number(x.x)]; })
                   .filter(function (c) { return isFinite(c[0]) && isFinite(c[1]); });
      }
      if (coords.length < 2) {
        var a = legStart(s), b = legEnd(s);
        if (isFinite(a.lat) && isFinite(b.lat)) coords = [[a.lat, a.lng], [b.lat, b.lng]];
      }
      out.push({ type: s.trafficType === 1 ? 'subway' : 'bus', coords: coords, sub: s });
    });

    // 2차: 도보 구간의 양 끝을 이웃에서 유도한다.
    out.forEach(function (seg, i) {
      if (seg.type !== 'walk') return;
      var prev = null, next = null, k;
      for (k = i - 1; k >= 0; k--) { if (out[k].coords.length) { prev = out[k].coords[out[k].coords.length - 1]; break; } }
      for (k = i + 1; k < out.length; k++) { if (out[k].coords.length) { next = out[k].coords[0]; break; } }
      var from = prev ? { lat: prev[0], lng: prev[1] } : { lat: o.lat, lng: o.lng };
      var to   = next ? { lat: next[0], lng: next[1] } : { lat: d.lat, lng: d.lng };
      var straight = kmBetween(from, to) * 1000;   // m
      var line = [[from.lat, from.lng], [to.lat, to.lng]];

      // 🔴 **역내 환승은 OSRM 을 부르면 안 된다.** ODsay 가 `distance: 0` 으로 알려주는
      //    구간은 지하 환승통로 이동이다. OSRM 은 통로를 모르니 지상 도로로 빙 돌린다 —
      //    실측(2026-09-03, 사당역 2호선→4호선): 직선 37m 인데 **670m** 를 돌리고
      //    직선에서 **최대 309m** 벗어난다. 그림이 통째로 틀린다.
      //    부르지 않으면 호출도 하나 준다(경로당 3회 → 2회).
      if (seg.sub && Number(seg.sub.distance) === 0) { seg.coords = line; return; }
      // 몇 미터짜리는 불러 봐야 그림이 안 달라진다.
      if (straight < 30) { seg.coords = line; return; }

      walkJobs.push(osrmWalkCached(from, to).then(function (w) {
        // 🔴 결과를 그대로 믿지 않는다. 지하 통로·구름다리처럼 보행 데이터에 없는 길이
        //    끼면 OSRM 이 엉뚱하게 돌린다. 직선의 3배 + 100m 를 넘으면 버리고 직선을 쓴다.
        //    (실측 기준: 정상 구간은 1.45~1.50배였고, 틀린 환승 구간이 18배였다.)
        var ok = w && w.coords && w.coords.length > 1 && w.distance <= straight * 3 + 100;
        seg.coords = ok ? w.coords : line;
      }));
    });

    return Promise.all(walkJobs).then(function () {
      return out.filter(function (s) { return s.coords.length >= 2; });
    });
  }

  function kmBetween(a, b) {
    var R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    var s = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // 대중교통 안내 문구 — 세 페이지가 같은 문장을 쓰도록 여기에 둔다.
  function transitSteps(subPath, escFn) {
    var e = escFn || function (x) { return String(x); };
    return (subPath || []).filter(function (s) { return s.trafficType !== 3 || s.sectionTime > 0; }).map(function (s) {
      if (s.trafficType === 3) return '도보 ' + s.sectionTime + '분';
      var lane = (s.lane && s.lane[0]) || {};
      var name = s.trafficType === 1 ? (lane.name || '지하철') : (lane.busNo ? lane.busNo + '번 버스' : '버스');
      return (s.trafficType === 1 ? '지하철' : '버스') + ' <b>' + e(name) + '</b> · '
        + e(s.startName) + '→' + e(s.endName) + ' (' + s.stationCount + '정거장)';
    });
  }

  window.RouteAPI = { osrm: osrm, transit: transit, transitSteps: transitSteps, kmBetween: kmBetween,
    stats: stats };   // { net, hit } — 캐시가 먹는지 확인용
})();
