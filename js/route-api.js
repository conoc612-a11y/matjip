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

    return jget(url).then(function (j) {
      var p = j && j.result && j.result.path && j.result.path[0];
      if (!p) return null;
      var mapObj = p.info && p.info.mapObj;
      if (!mapObj) return { info: p.info, subPath: p.subPath, lanes: [] };
      // loadLane 은 호출을 한 번 더 쓴다(무료 쿼터). 그래서 선을 실제로 그릴 때만 부른다.
      return jget(base + 'loadLane?mapObject=' + encodeURIComponent('0:0@' + mapObj) + '&apiKey=' + key)
        .then(function (lj) {
          var lanes = (lj && lj.result && lj.result.lane) || [];
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
      // loadLane 이 비면(옛 노선·해외 등) 정류장 좌표 두 점으로라도 잇는다.
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
      // 몇 미터짜리 도보는 부르지 않는다 — 호출만 늘고 그림은 안 달라진다.
      if (kmBetween(from, to) < 0.03) { seg.coords = [[from.lat, from.lng], [to.lat, to.lng]]; return; }
      walkJobs.push(osrm('foot', from, to).then(function (w) {
        seg.coords = (w && w.coords && w.coords.length > 1)
          ? w.coords
          : [[from.lat, from.lng], [to.lat, to.lng]];   // 실패하면 직선(짧은 연결이라 오차가 작다)
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

  window.RouteAPI = { osrm: osrm, transit: transit, transitSteps: transitSteps, kmBetween: kmBetween };
})();
