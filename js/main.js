/* ============================================================================
 * 맛집 탐방 — main.html 전용 스크립트
 * 구조: ①상수·상태  ②유틸  ③테마·최근본  ④지도 초기화  ⑤식당 카드·정보창
 *       ⑥지도 도구  ⑦길찾기(출발/도착)  ⑧검색(네이버/카카오)  ⑨추천·목록 렌더
 *       ⑩마커 클러스터링  ⑪정비사업  ⑫데이터 로드  ⑬이벤트·초기화
 * ==========================================================================*/

// ── ① 상수·키·상태 ─────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://bhgijvaxxjnocgfnaaeu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_rYaGd3kk5UuFBe3TSpFA8g_uGHWwkqM';
const ODSAY_KEY = 'H4Vo/z04g/E+AUShnTQIiQ'; // ODsay 대중교통(웹 도메인 잠금 키)
// 네이버 실시간 장소검색은 Supabase Edge Function(quick-handler)이 서버에서 중계
// (네이버 지역검색 API는 Client Secret+CORS 때문에 브라우저 직접 호출 불가).
const NAVER_SEARCH_FN = 'https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/quick-handler';
const RECENT_KEY = 'mj_recent';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const $ = (id) => document.getElementById(id);

let searchEngine = 'naver';               // 'naver' | 'kakao'
let kakaoReady = false;
if (window.kakao) kakao.maps.load(function () { kakaoReady = true; });

let restaurants = [];
let restIndex = [];                       // 검색용 소문자 인덱스 (buildRestIndex에서 생성)
let taste = null;
let user = null;
let query = '';
let panelMode = 'recommend';              // 'recommend'(인근 추천) | 'favorites'(즐겨찾기)
let favCat = '전체';
const savedIds = new Set();
let savedRev = 0;                         // 즐겨찾기 변경 감지용 (render 캐시 키)
let lastRenderKey = null;

// ── ② 유틸 ─────────────────────────────────────────────────────────────────
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const stripB = (s) => String(s || '').replace(/<\/?b>/g, '');
const latLng = (lat, lng) => new naver.maps.LatLng(Number(lat), Number(lng));
const hav = (a, b) => { // 두 지점 거리(m) — 좌표는 naver LatLng
  const R = 6371000, t = (d) => d * Math.PI / 180;
  const dLa = t(b.lat() - a.lat()), dLo = t(b.lng() - a.lng());
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(t(a.lat())) * Math.cos(t(b.lat())) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};
const fmtDist = (m) => m >= 1000 ? (m / 1000).toFixed(2) + 'km' : Math.round(m) + 'm';
// 여러 좌표에 맞춰 지도 이동 (1개면 확대, 여러 개면 영역에 맞춤)
function fitToPoints(pts) {
  if (!pts.length) return;
  if (pts.length === 1) { map.setCenter(latLng(pts[0][0], pts[0][1])); map.setZoom(16); return; }
  const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
  const sw = latLng(Math.min(...lats), Math.min(...lngs));
  const ne = latLng(Math.max(...lats), Math.max(...lngs));
  map.fitBounds(new naver.maps.LatLngBounds(sw, ne));
}
// 네이버 지도 인증 실패 시(도메인 미등록/키 오류) 조용히 죽지 않고 안내 ──
window.navermap_authFailure = function () {
  const b = $('banner');
  if (b) b.innerHTML = '⚠️ 네이버 지도 인증 실패 — NCP 콘솔의 Web 서비스 URL에 <b>https://conoc612-a11y.github.io</b> 가 등록됐는지 확인해 주세요.';
};

// ── ③ 테마·최근 본 곳 (localStorage) ───────────────────────────────────────
function applyTheme(dark) { document.documentElement.classList.toggle('dark', dark); const b = $('theme-btn'); if (b) b.textContent = dark ? '☀️' : '🌙'; }
function initThemeBtn() { const b = $('theme-btn'); if (b) b.addEventListener('click', () => { const dark = !document.documentElement.classList.contains('dark'); localStorage.setItem('mj_theme', dark ? 'dark' : 'light'); applyTheme(dark); }); }

function loadRecent() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch (e) { return []; } }
function pushRecent(item) { let a = loadRecent().filter((x) => x.key !== item.key); a.unshift(item); a = a.slice(0, 8); try { localStorage.setItem(RECENT_KEY, JSON.stringify(a)); } catch (e) {} renderRecent(); }
function renderRecent() {
  const a = loadRecent(), el = $('recent'); if (!el) return;
  if (!a.length) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.innerHTML = '🕘 최근 본 곳: ' + a.map((x, i) => `<span class="recent-chip" data-i="${i}" style="cursor:pointer;">${esc(x.name)} <b class="recent-del" data-i="${i}" title="삭제" style="cursor:pointer;color:#e03131;margin-left:1px;">✕</b></span>`).join('') + ` <a href="#" class="recent-clear" style="color:var(--muted);font-size:11px;">전체삭제</a>`;
  el.querySelectorAll('.recent-chip').forEach((c) => c.addEventListener('click', (e) => {
    if (e.target.closest('.recent-del')) return;
    e.preventDefault(); const x = a[Number(c.dataset.i)];
    if (x && x.lat != null) { map.setCenter(latLng(x.lat, x.lng)); map.setZoom(16); openInfo(latLng(x.lat, x.lng), restaurantCard(restaurants.find((r) => r.id == x.id) || x)); }
  }));
  el.querySelectorAll('.recent-del').forEach((d) => d.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); const b = loadRecent(); b.splice(Number(d.dataset.i), 1); try { localStorage.setItem(RECENT_KEY, JSON.stringify(b)); } catch (er) {} renderRecent(); }));
  const cl = el.querySelector('.recent-clear'); if (cl) cl.addEventListener('click', (e) => { e.preventDefault(); try { localStorage.removeItem(RECENT_KEY); } catch (er) {} renderRecent(); });
}

// ── ④ 네이버 지도 초기화 ───────────────────────────────────────────────────
const map = new naver.maps.Map('map', {
  center: new naver.maps.LatLng(37.5665, 126.9780),
  zoom: 12,
  mapTypeControl: true,
  mapTypeControlOptions: { style: naver.maps.MapTypeControlStyle.BUTTON, position: naver.maps.Position.TOP_RIGHT },
});
// 공통 InfoWindow(팝업) 하나 재사용. anchor는 마커 또는 좌표(LatLng) 모두 허용.
const infoWindow = new naver.maps.InfoWindow({ borderWidth: 1, borderColor: '#e6e8eb', anchorSize: new naver.maps.Size(0, 0) });
function openInfo(anchor, html) { infoWindow.setContent(`<div style="padding:7px 11px;font-size:13px;line-height:1.4;">${html}</div>`); infoWindow.open(map, anchor); }

// 네이버 지도용 커스텀 마커(초록 별 핀 — 실제 네이버 지도 스타일). color로 구분.
function starIcon(color) {
  return {
    content: `<div style="width:26px;height:26px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;line-height:1;">★</div>`,
    anchor: new naver.maps.Point(13, 13),
  };
}
function highlightCard(id, on) { const c = $('rec-list').querySelector(`.rec[data-id="${id}"]`); if (c) c.style.outline = on ? '2px solid var(--accent)' : ''; }
// 맛집 하나를 지도에 표시 + 정보창 + 최근 목록 기록 (클릭·자동완성·최근목록 공용)
function showRestaurant(r) {
  if (r.lat == null) return;
  map.setCenter(latLng(r.lat, r.lng)); map.setZoom(16);
  openInfo(latLng(r.lat, r.lng), restaurantCard(r));
  pushRecent({ key: 'r' + r.id, id: r.id, name: r.name, lat: r.lat, lng: r.lng });
}

// ── ⑤ 식당 카드·정보창 ─────────────────────────────────────────────────────
// 마커/리스트 클릭 시 뜨는 카드(네이버 지도 스타일). 사진·리뷰는 검색 API 미제공 → '네이버지도' 링크로 열림.
function restaurantCard(r) {
  const tags = (r.tags || []).slice(0, 4).map((t) =>
    `<span style="font-size:11px;background:#f1f3f5;border-radius:10px;padding:2px 8px;margin:3px 3px 0 0;display:inline-block;">${esc(t)}</span>`).join('');
  const nq = encodeURIComponent(r.name);
  const saved = savedIds.has(Number(r.id));
  return `<div style="min-width:210px;max-width:250px;">
    <div style="font-weight:700;font-size:15px;">${esc(r.name)}</div>
    <div style="font-size:12px;color:#8a9099;margin:3px 0 2px;">${esc(r.category || '')}${r.address ? ' · ' + esc(r.address) : ''}</div>
    <div>${tags}</div>
    <div style="display:flex;gap:6px;margin-top:9px;">
      <a href="detail.html?id=${r.id}" style="flex:1;text-align:center;font-size:12px;padding:7px 0;border-radius:6px;background:#e8590c;color:#fff;text-decoration:none;">상세·길찾기</a>
      <a href="https://map.naver.com/p/search/${nq}" target="_blank" rel="noopener" style="flex:1;text-align:center;font-size:12px;padding:7px 0;border-radius:6px;border:1px solid #e6e8eb;color:#1c1e21;text-decoration:none;">네이버지도</a>
    </div>
    ${r.lat != null ? `<div style="display:flex;gap:6px;margin-top:6px;">
      <button onclick="setRoutePt('s',${r.lat},${r.lng})" style="flex:1;font:inherit;font-size:12px;padding:6px 0;border:1px solid #2f9e44;color:#2f9e44;background:#fff;border-radius:6px;cursor:pointer;">🚩 출발</button>
      <button onclick="setRoutePt('e',${r.lat},${r.lng})" style="flex:1;font:inherit;font-size:12px;padding:6px 0;border:1px solid #e03131;color:#e03131;background:#fff;border-radius:6px;cursor:pointer;">🏁 도착</button>
    </div>` : ''}
    <button onclick="handleSave(this)" data-id="${r.id}" style="width:100%;margin-top:6px;font:inherit;font-size:12px;font-weight:700;padding:7px 0;border-radius:6px;cursor:pointer;${saved ? 'background:#2f9e44;border:1px solid #2f9e44;color:#fff;' : 'background:#fff;border:1px solid #2f9e44;color:#2f9e44;'}">${saved ? '★ 저장됨' : '☆ 즐겨찾기 저장'}</button>
  </div>`;
}

// ── [Reverse Geocoding] 좌표 → 주소 (네이버 geocoder 서브모듈, 브라우저 안전) ──
function showAddress(coord, label) {
  if (!(naver.maps.Service && naver.maps.Service.reverseGeocode)) return;
  naver.maps.Service.reverseGeocode({
    coords: coord,
    orders: [naver.maps.Service.OrderType.ROAD_ADDR, naver.maps.Service.OrderType.ADDR].join(','),
  }, (status, res) => {
    const a = (status === naver.maps.Service.Status.OK) ? res.v2.address : null;
    const addr = a ? (a.roadAddress || a.jibunAddress || '(주소 없음)') : '(주소 못 찾음)';
    const la = coord.lat(), lo = coord.lng();
    openInfo(coord, `${label}<br><b>${esc(addr)}</b><div style="margin-top:7px;display:flex;gap:6px;"><button onclick="setRoutePt('s',${la},${lo})" style="font:inherit;font-size:12px;padding:5px 10px;border:1px solid #2f9e44;color:#2f9e44;background:#fff;border-radius:6px;cursor:pointer;">🚩 출발</button><button onclick="setRoutePt('e',${la},${lo})" style="font:inherit;font-size:12px;padding:5px 10px;border:1px solid #e03131;color:#e03131;background:#fff;border-radius:6px;cursor:pointer;">🏁 도착</button></div>`);
  });
}

// ── ⑥ 지도 도구: 거리뷰 / 거리 / 반경 / 공유 / GPS ──────────────────────────
let mapMode = null;                 // null | 'street' | 'dist' | 'radius'
let measurePts = [], measureLine = null, measureCircle = [];
function clearMeasure() { measurePts = []; if (measureLine) { measureLine.setMap(null); measureLine = null; } measureCircle.forEach((o) => o.setMap(null)); measureCircle = []; }
function setMode(mode) {
  mapMode = (mapMode === mode) ? null : mode;
  ['street', 'dist', 'radius'].forEach((m) => $('tool-' + m).classList.toggle('on', mapMode === m));
  $('tool-clear').style.display = mapMode ? '' : 'none';
  clearMeasure();
  const hint = { street: '지도에서 거리뷰 볼 지점을 클릭하세요', dist: '클릭할 때마다 거리가 누적됩니다', radius: '중심 클릭 → 반경 끝점 클릭' };
  $('banner').textContent = mapMode ? ('🛠️ ' + hint[mapMode]) : '';
}
function addDistPoint(coord) {
  measurePts.push(coord);
  if (measureLine) measureLine.setMap(null);
  measureLine = new naver.maps.Polyline({ map, path: measurePts, strokeColor: '#e8590c', strokeWeight: 4, strokeOpacity: 0.9 });
  let total = 0; for (let i = 1; i < measurePts.length; i++) total += hav(measurePts[i - 1], measurePts[i]);
  $('banner').textContent = `📏 총 거리 ${fmtDist(total)} · 점 ${measurePts.length}개 (✖ 지우기로 초기화)`;
}
function addRadiusPoint(coord) {
  measurePts.push(coord);
  if (measurePts.length === 1) { $('banner').textContent = '⭕ 반경 끝점을 클릭하세요'; return; }
  const r = hav(measurePts[0], measurePts[1]);
  measureCircle.forEach((o) => o.setMap(null));
  measureCircle = [new naver.maps.Circle({ map, center: measurePts[0], radius: r, strokeColor: '#e8590c', strokeWeight: 2, fillColor: '#e8590c', fillOpacity: 0.12 })];
  $('banner').textContent = `⭕ 반경 ${fmtDist(r)}`;
  measurePts = [];
}
// 거리뷰(파노라마) 모달 — panorama 서브모듈 사용
function openStreetView(coord) {
  let modal = $('sv-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'sv-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = '<div style="position:relative;width:92%;max-width:820px;height:72%;background:#fff;border-radius:12px;overflow:hidden;"><div id="sv-pano" style="width:100%;height:100%;"></div><button id="sv-close" style="position:absolute;top:10px;right:10px;z-index:3;background:#fff;border:1px solid #ddd;border-radius:7px;padding:7px 11px;cursor:pointer;font:inherit;">✖ 닫기</button></div>';
    document.body.appendChild(modal);
    $('sv-close').addEventListener('click', () => { modal.style.display = 'none'; });
    modal.addEventListener('click', (ev) => { if (ev.target === modal) modal.style.display = 'none'; });
  }
  modal.style.display = 'flex';
  if (window.__pano) window.__pano.setPosition(coord);
  else window.__pano = new naver.maps.Panorama('sv-pano', { position: coord, pov: { pan: 0, tilt: 0, fov: 100 } });
}
// 공유 링크(?lat&lng&z) 적용
function applyShareParams() {
  const p = new URLSearchParams(location.search);
  const lat = parseFloat(p.get('lat')), lng = parseFloat(p.get('lng')), z = parseInt(p.get('z'), 10);
  if (!isNaN(lat) && !isNaN(lng)) { map.setCenter(new naver.maps.LatLng(lat, lng)); if (!isNaN(z)) map.setZoom(z); }
}

// ── ⑦ 길찾기: 출발/도착 → 도보·자차(OSRM) / 대중교통(ODsay) ──────────────────
let rStart = null, rEnd = null, rStartMk = null, rEndMk = null, rLine = null, rMode = 'transit';
function rMarker(la, lo, color, label) {
  return new naver.maps.Marker({ position: latLng(la, lo), map, icon: { content: `<div style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:3px 8px;border-radius:11px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35);white-space:nowrap;">${label}</div>`, anchor: new naver.maps.Point(24, 13) } });
}
function modeBar() {
  const label = { walk: '🚶도보', transit: '🚌대중교통', car: '🚗자차' };
  return ' <span style="display:inline-flex;gap:4px;margin:0 4px;">' + ['walk', 'transit', 'car'].map((m) =>
    `<a href="#" onclick="setRouteMode('${m}');return false;" style="padding:2px 7px;border-radius:10px;text-decoration:none;border:1px solid ${rMode === m ? '#e8590c' : '#ddd'};background:${rMode === m ? '#e8590c' : '#fff'};color:${rMode === m ? '#fff' : '#555'};">${label[m]}</a>`).join('') + '</span>';
}
const clrLink = ' <a href="#" onclick="clearRoute();return false;">✖ 초기화</a>';
function pathBounds(path) { const la = path.map((p) => p.lat()), lo = path.map((p) => p.lng()); return new naver.maps.LatLngBounds(latLng(Math.min(...la), Math.min(...lo)), latLng(Math.max(...la), Math.max(...lo))); }
window.setRoutePt = function (w, la, lo) {
  infoWindow.close();
  if (w === 's') { if (rStartMk) rStartMk.setMap(null); rStart = { la, lo }; rStartMk = rMarker(la, lo, '#2f9e44', '🚩 출발'); }
  else { if (rEndMk) rEndMk.setMap(null); rEnd = { la, lo }; rEndMk = rMarker(la, lo, '#e03131', '🏁 도착'); }
  if (rStart && rEnd) computeRoute();
  else $('banner').textContent = rStart ? '🏁 도착지를 지도/마커에서 [도착]으로 지정하세요.' : '🚩 출발지를 [출발]로 지정하세요.';
};
window.setRouteMode = function (m) { rMode = m; computeRoute(); };
async function computeRoute() {
  if (!(rStart && rEnd)) return;
  if (rLine) { rLine.setMap(null); rLine = null; }
  $('banner').innerHTML = '경로 계산 중…' + modeBar() + clrLink;
  try {
    if (rMode === 'transit') {
      rLine = new naver.maps.Polyline({ map, path: [latLng(rStart.la, rStart.lo), latLng(rEnd.la, rEnd.lo)], strokeColor: '#378add', strokeWeight: 4, strokeStyle: 'shortdash', strokeOpacity: 0.9 });
      map.fitBounds(pathBounds([latLng(rStart.la, rStart.lo), latLng(rEnd.la, rEnd.lo)]));
      const url = `https://api.odsay.com/v1/api/searchPubTransPathT?SX=${rStart.lo}&SY=${rStart.la}&EX=${rEnd.lo}&EY=${rEnd.la}&apiKey=${encodeURIComponent(ODSAY_KEY)}`;
      const j = await (await fetch(url)).json();
      const p = j.result && j.result.path && j.result.path[0];
      if (p) {
        const i = p.info, ICON = { 1: '🚇', 2: '🚌', 3: '🚶' };
        const steps = (p.subPath || []).filter((s) => s.trafficType !== 3 || s.sectionTime > 0).map((s) => {
          if (s.trafficType === 3) return `🚶 도보 ${s.sectionTime}분`;
          const lane = (s.lane && s.lane[0]) || {};
          const name = s.trafficType === 1 ? (lane.name || '지하철') : (lane.busNo ? lane.busNo + '번 버스' : '버스');
          return `${ICON[s.trafficType]} <b>${esc(name)}</b> · ${esc(s.startName)}→${esc(s.endName)} (${s.stationCount}정거장)`;
        });
        $('banner').innerHTML = `<div style="font-weight:700;">🚌 ${i.totalTime}분 · 환승 ${i.busTransitCount + i.subwayTransitCount}회 · ${i.payment.toLocaleString()}원</div><ol style="margin:4px 0;padding-left:18px;line-height:1.6;">${steps.map((x) => `<li>${x}</li>`).join('')}</ol>` + modeBar() + clrLink;
      }
      else $('banner').innerHTML = '가까워서 대중교통 경로가 없어요(도보 권장).' + modeBar() + clrLink;
    } else {
      const url = `https://router.project-osrm.org/route/v1/driving/${rStart.lo},${rStart.la};${rEnd.lo},${rEnd.la}?overview=full&geometries=geojson`;
      const j = await (await fetch(url)).json();
      const rt = j.routes && j.routes[0];
      if (!rt) { $('banner').innerHTML = '경로를 찾지 못했어요.' + modeBar() + clrLink; return; }
      const path = rt.geometry.coordinates.map((c) => latLng(c[1], c[0]));
      const color = rMode === 'walk' ? '#2f9e44' : '#e8590c';
      rLine = new naver.maps.Polyline({ map, path, strokeColor: color, strokeWeight: 5, strokeOpacity: 0.85 });
      map.fitBounds(pathBounds(path));
      const km = rt.distance / 1000;
      if (rMode === 'walk') {
        $('banner').innerHTML = `🚶 도보 약 <b>${Math.round(km / 4.5 * 60)}분</b> · ${km.toFixed(1)}km <span style="color:#999;">(4.5km/h 추정)</span>` + modeBar() + clrLink;
      } else {
        const taxi = Math.round((4800 + Math.max(0, km - 1.6) * 770) / 100) * 100; // 서울 중형 거리 기준 추정(시간요금 제외)
        $('banner').innerHTML = `🚗 자차 약 <b>${Math.round(rt.duration / 60)}분</b> · ${km.toFixed(1)}km · 🚕 예상 택시요금 ≈ <b>${taxi.toLocaleString()}원</b> <span style="color:#999;">(추정)</span>` + modeBar() + clrLink;
      }
    }
  } catch (e) { $('banner').innerHTML = '경로 조회 실패(네트워크).' + modeBar() + clrLink; }
}
window.clearRoute = function () { rStart = rEnd = null; [rStartMk, rEndMk, rLine].forEach((o) => o && o.setMap(null)); rStartMk = rEndMk = rLine = null; render(); };

// ── ⑧ 검색: 네이버 / 카카오 엔진 + 자동완성 ────────────────────────────────
let searchMarkers = [];
function clearSearchMarkers() { searchMarkers.forEach((m) => m.setMap(null)); searchMarkers = []; }
// 외부 검색 결과 → 추천 목록으로 복귀 (클러스터 복원)
function backToList() { clearSearchMarkers(); setClusterVisible(markersOn); render(); }

function runSearch() {
  const q = $('search').value.trim();
  if (!q) { alert('검색어를 입력해 주세요.'); return; }
  if (searchEngine === 'naver') runNaverSearch(q);
  else runKakaoSearch(q);
}

// ── 네이버 검색 (Edge Function 프록시 경유) ──
async function runNaverSearch(q) {
  $('banner').textContent = '🔎 네이버 검색 중…';
  try {
    const r = await fetch(`${NAVER_SEARCH_FN}?query=${encodeURIComponent(q)}`, {
      headers: { Authorization: 'Bearer ' + SUPABASE_KEY },
    });
    const j = await r.json();
    renderNaver(j.items || []);
  } catch (e) { alert('네이버 검색에 실패했어요: ' + e); }
}
function naverPt(p) { return { lat: Number(p.mapy) / 1e7, lng: Number(p.mapx) / 1e7 }; }
function renderNaver(items) {
  setClusterVisible(false);
  clearSearchMarkers();
  const back = '<button class="kakao-back" id="s-back">← 추천 목록으로</button>';
  if (!items.length) {
    $('rec-list').innerHTML = back + '<div style="text-align:center;color:var(--muted);padding:24px 0;">네이버 검색 결과가 없어요.</div>';
    $('s-back').addEventListener('click', backToList); return;
  }
  $('rec-list').innerHTML = back + items.map((p, i) => {
    const name = stripB(p.title);
    const cat = (p.category || '').split('>').pop().trim();
    const addr = p.roadAddress || p.address || '';
    return `<div class="rec" data-i="${i}">
      <h3>${esc(name)}</h3>
      <div class="meta">${esc(cat)} · ${esc(addr)}</div>
      <div class="actions">
        <button class="save nsave" data-i="${i}">내 목록에 저장</button>
        <a href="https://map.naver.com/p/search/${encodeURIComponent(name)}" target="_blank" rel="noopener">네이버지도</a>
      </div>
    </div>`;
  }).join('');
  const pts = [];
  items.forEach((p) => {
    const { lat, lng } = naverPt(p);
    const m = new naver.maps.Marker({ position: latLng(lat, lng), map, title: stripB(p.title), icon: starIcon('#e8590c') });
    naver.maps.Event.addListener(m, 'click', () => openInfo(m, `<b>${esc(stripB(p.title))}</b>`));
    searchMarkers.push(m); pts.push([lat, lng]);
  });
  fitToPoints(pts);
  $('s-back').addEventListener('click', backToList);
  $('rec-list').querySelectorAll('.rec').forEach((card) => card.addEventListener('click', (e) => {
    if (e.target.closest('.actions')) return;
    const { lat, lng } = naverPt(items[Number(card.dataset.i)]); map.setCenter(latLng(lat, lng)); map.setZoom(16);
  }));
  $('rec-list').querySelectorAll('.nsave').forEach((btn) => btn.addEventListener('click', (e) => {
    e.stopPropagation(); saveNaverPlace(items[Number(btn.dataset.i)], btn);
  }));
}
async function saveNaverPlace(p, btn) {
  if (!user) { alert('로그인 후 저장할 수 있어요.'); location.href = 'onboarding.html'; return; }
  const name = stripB(p.title);
  const { lat, lng } = naverPt(p);
  btn.disabled = true; btn.textContent = '저장 중…';
  const { data: found } = await sb.from('mj_restaurants').select('id').eq('name', name).limit(1);
  let rid = found && found[0] && found[0].id;
  if (!rid) {
    const { data: ins, error } = await sb.from('mj_restaurants').insert({
      name, address: p.roadAddress || p.address || null,
      lat, lng, category: (p.category || '').split('>').pop().trim() || null, tags: [],
    }).select('*').single();
    if (error) { btn.disabled = false; btn.textContent = '실패'; return; }
    rid = ins.id;
    restaurants.push(ins); buildRestIndex(); // 전체 재조회 대신 새 행만 추가
  }
  const { error: se } = await sb.from('saved_restaurants').upsert({ user_id: user.id, restaurant_id: rid }, { onConflict: 'user_id,restaurant_id' });
  btn.textContent = se ? '실패' : '저장됨 ✓';
  if (!se) { btn.style.background = 'var(--ok)'; savedIds.add(rid); savedRev++; } // 검색 결과 화면 유지, 다음 render에 반영
}

// ── 카카오 검색 (kakao.maps.services.Places 직접 호출) ──
function runKakaoSearch(q) {
  if (!kakaoReady) { alert('카카오 SDK가 로딩 중이에요. 잠시 후 다시 시도해 주세요.'); return; }
  $('banner').textContent = '🔎 카카오 검색 중…';
  const ps = new kakao.maps.services.Places();
  ps.keywordSearch(q, function (data, status) {
    if (status !== kakao.maps.services.Status.OK || !data.length) {
      setClusterVisible(false); clearSearchMarkers();
      $('rec-list').innerHTML = '<button class="kakao-back" id="s-back">← 추천 목록으로</button><div style="text-align:center;color:var(--muted);padding:24px 0;">카카오 검색 결과가 없어요.</div>';
      var sb2 = document.getElementById('s-back'); if (sb2) sb2.addEventListener('click', backToList);
      return;
    }
    renderKakao(data);
  });
}
function renderKakao(items) {
  setClusterVisible(false);
  clearSearchMarkers();
  var back = '<button class="kakao-back" id="s-back">← 추천 목록으로</button>';
  $('rec-list').innerHTML = back + items.map(function (p, i) {
    var name = p.place_name || '';
    var cat = (p.category_name || '').split('>').pop().trim();
    var addr = p.road_address_name || p.address_name || '';
    return '<div class="rec" data-i="' + i + '">' +
      '<h3>' + esc(name) + '</h3>' +
      '<div class="meta">' + esc(cat) + ' · ' + esc(addr) + '</div>' +
      '<div class="actions">' +
      '<button class="save psave" data-i="' + i + '">내 목록에 저장</button>' +
      (p.place_url ? '<a href="' + esc(p.place_url) + '" target="_blank" rel="noopener">카카오맵</a>' : '') +
      '</div></div>';
  }).join('');
  var pts = [];
  items.forEach(function (p) {
    var lat = Number(p.y), lng = Number(p.x);
    var m = new naver.maps.Marker({ position: latLng(lat, lng), map: map, title: p.place_name || '', icon: starIcon('#fEE500') });
    naver.maps.Event.addListener(m, 'click', function () { openInfo(m, '<b>' + esc(p.place_name || '') + '</b>'); });
    searchMarkers.push(m); pts.push([lat, lng]);
  });
  fitToPoints(pts);
  var sBack = document.getElementById('s-back'); if (sBack) sBack.addEventListener('click', backToList);
  $('rec-list').querySelectorAll('.rec').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('.actions')) return;
      var idx = Number(card.dataset.i);
      if (items[idx]) map.setCenter(latLng(Number(items[idx].y), Number(items[idx].x))); map.setZoom(16);
    });
  });
  $('rec-list').querySelectorAll('.psave').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); saveKakaoPlace(items[Number(btn.dataset.i)], btn);
    });
  });
}
async function saveKakaoPlace(p, btn) {
  if (!user) { alert('로그인 후 저장할 수 있어요.'); location.href = 'onboarding.html'; return; }
  btn.disabled = true; btn.textContent = '저장 중…';
  var { data: found } = await sb.from('mj_restaurants').select('id').eq('name', p.place_name).limit(1);
  var rid = found && found[0] && found[0].id;
  if (!rid) {
    var { data: ins, error } = await sb.from('mj_restaurants').insert({
      name: p.place_name, address: p.road_address_name || p.address_name || null,
      lat: Number(p.y), lng: Number(p.x),
      category: (p.category_name || '').split('>').pop().trim() || null, tags: [],
    }).select('*').single();
    if (error) { btn.disabled = false; btn.textContent = '실패'; return; }
    rid = ins.id;
    restaurants.push(ins); buildRestIndex(); // 전체 재조회 대신 새 행만 추가
  }
  var { error: se } = await sb.from('saved_restaurants').upsert({ user_id: user.id, restaurant_id: rid }, { onConflict: 'user_id,restaurant_id' });
  btn.textContent = se ? '실패' : '저장됨 ✓';
  if (!se) { btn.style.background = 'var(--ok)'; savedIds.add(rid); savedRev++; } // 검색 결과 화면 유지, 다음 render에 반영
}

// ── ⑨ 추천·목록 렌더 ──────────────────────────────────────────────────────
// 규칙기반 추천 점수는 js/recommend.js의 window.score(r, taste) 사용.
let LIST_MAX = 50; // 목록 상위 N개만 렌더(전체 1,300+ 카드 렌더 금지)

// 검색용 소문자 인덱스 — 매 keystroke마다 1,300건 join+toLowerCase 하는 비용 제거
function buildRestIndex() {
  restIndex = restaurants.map((r) => `${r.name} ${r.category || ''} ${(r.tags || []).join(' ')}`.toLowerCase());
}
function matchRestaurants(q) {
  const out = [];
  for (let i = 0; i < restaurants.length; i++) if (restIndex[i].includes(q)) out.push(restaurants[i]);
  return out;
}

function render() {
  const center = map.getCenter(); // 한 번만 계산
  const q = (query || '').trim().toLowerCase();
  // 입력이 (쿼리·탭·카테고리·지도중심·취향·즐겨찾기) 모두 같으면 재렌더 생략
  const key = [panelMode, favCat, q, center.lat().toFixed(4), center.lng().toFixed(4), taste ? 1 : 0, savedRev, user ? 1 : 0].join('|');
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  let base = q ? matchRestaurants(q) : restaurants;
  if (panelMode === 'favorites') { base = base.filter((r) => savedIds.has(Number(r.id))); if (favCat !== '전체') base = base.filter((r) => (r.category || '').includes(favCat)); }
  // 점수는 전체 계산(Set 캐시로 저렴). 거리 hav()는 정렬 비교 시 메모이제이션으로 필요한 만큼만 계산.
  const distMemo = new Map();
  const distOf = (r) => { if (r.lat == null) return Infinity; let v = distMemo.get(r); if (v === undefined) { v = hav(center, latLng(r.lat, r.lng)); distMemo.set(r, v); } return v; };
  const scored = base.map((r) => {
    const { score: s, hits } = window.score(r, taste);
    return { r, score: s, hits };
  });
  if (panelMode === 'recommend') {
    if (!taste) scored.sort((a, b) => distOf(a.r) - distOf(b.r)); // 취향 없으면 지도 중심 가까운 순
    else scored.sort((a, b) => b.score - a.score || distOf(a.r) - distOf(b.r));
  } else scored.sort((a, b) => a.r.name.localeCompare(b.r.name));

  // 배너
  if (panelMode === 'favorites') {
    $('banner').textContent = user ? '⭐ 저장한 식당 목록이에요.' : '로그인하면 즐겨찾기를 쓸 수 있어요.';
  } else if (!user) {
    $('banner').innerHTML = '📍 지도 중심 인근 추천이에요. 로그인하면 취향까지 반영돼요. <a href="onboarding.html">로그인 →</a>';
  } else if (!taste) {
    $('banner').innerHTML = '📍 내 위치 인근 추천. <a href="onboarding.html">취향 입력하면 더 정확 →</a>';
  } else {
    $('banner').textContent = `📍 ${user.email} 님 취향 + 내 위치 인근 추천.`;
  }

  // 리스트 — 상위 LIST_MAX개만 렌더. 지도 이동은 입력 중 하지 않고 Enter/자동완성/카드 클릭 시에만.
  const shown = scored.slice(0, LIST_MAX).map((x) => {
    const dist = x.r.lat != null ? distOf(x.r) : null;
    return { r: x.r, score: x.score, hits: x.hits, dist };
  });
  $('rec-list').innerHTML = shown.map(({ r, score: s, hits, dist }) => {
    const tagsHtml = (r.tags || []).map((t) =>
      `<span class="tag${hits.includes(t) ? ' hit' : ''}">${esc(t)}</span>`).join('');
    const why = taste && hits.length ? `✓ 취향 일치: ${hits.join(', ')}` : '';
    const dl = dist != null ? `📍 ${fmtDist(dist)} · 🚶 ${Math.max(1, Math.round(dist / 1000 / 4.5 * 60))}분` : '';
    const saved = savedIds.has(Number(r.id));
    return `<div class="rec" data-id="${r.id}">
      <div class="rec-header">
        <h3 style="margin:0;">${esc(r.name)}</h3>
        ${dl ? `<span class="dist-badge">${dl}</span>` : (taste && s > 0 ? `<span class="score">${s}점</span>` : '')}
      </div>
      <div class="meta" style="margin-top:3px;">${esc(r.category || '')}${r.address ? ' · ' + esc(r.address) : ''}</div>
      ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
      ${why ? `<div class="why">${esc(why)}</div>` : ''}
      <div class="actions">
        <button class="save" data-id="${r.id}" style="${saved ? 'background:var(--ok);' : ''}">${saved ? '저장됨 ✓' : '저장'}</button>
        <a href="detail.html?id=${r.id}">상세 · 길찾기</a>
      </div>
    </div>`;
  }).join('') + (scored.length > LIST_MAX ? `<div style="text-align:center;color:var(--muted);font-size:12px;padding:10px 0;">가까운 ${LIST_MAX}곳만 표시 중 · 전체 ${scored.length}곳 (검색으로 좁혀보세요)</div>` : '');
  if (!scored.length) $('rec-list').innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px 0;">검색 결과가 없어요.</div>';
}

async function handleSave(btn) {
  const id = Number(btn.dataset.id);
  if (!user) { alert('로그인 후 저장할 수 있어요.'); location.href = 'onboarding.html'; return; }
  if (btn.disabled) return;
  const isSaved = savedIds.has(id);
  btn.disabled = true;
  let ok = false;
  if (isSaved) { // 취소: 저장 삭제
    const { error } = await sb.from('saved_restaurants').delete().eq('user_id', user.id).eq('restaurant_id', id);
    ok = !error;
    if (ok) { savedIds.delete(id); savedRev++; }
  } else { // 저장
    const { error } = await sb.from('saved_restaurants').upsert({ user_id: user.id, restaurant_id: id }, { onConflict: 'user_id,restaurant_id' });
    ok = !error;
    if (ok) { savedIds.add(id); savedRev++; }
  }
  btn.disabled = false;
  if (!ok) { btn.textContent = '실패'; return; }
  // 지도 팝업 버튼 즉시 갱신 (목록은 render()가 savedRev로 다시 그림)
  btn.textContent = isSaved ? '☆ 즐겨찾기 저장' : '★ 저장됨';
  btn.style.background = isSaved ? '#fff' : 'var(--ok)';
  btn.style.border = isSaved ? '1px solid #2f9e44' : '1px solid var(--ok)';
  btn.style.color = isSaved ? '#2f9e44' : '#fff';
  render();
}
window.handleSave = handleSave; // 지도 팝업/정보창의 인라인 onclick에서 사용

// ── ⑩ 마커 클러스터링 (뷰포트 기반 커스텀) ────────────────────────────────
// 네이버 MarkerClustering은 마커 1,300개를 전부 생성+재계산해 느리다.
// 여기서는 현재 지도 뷰포트 안의 식당만 격자 버킷으로 묶어 마커를 만들고,
// 팬/줌이 끝날 때마다(idle) 화면 밖 마커는 제거·새로 추가만 한다.
let clusterPool = new Map();  // 버킷키 -> 마커
let clusterReady = false;     // 데이터 로드 완료 전에는 그리지 않음
let markersOn = true;         // 맛집 마커 표시 여부

function gridCellSize(zoom) { return 0.015 * Math.pow(2, 14 - zoom); } // 줌 12≈6.6km, 줌 17≈208m
function clusterCountIcon(px, count) {
  return {
    content: `<div style="width:${px}px;height:${px}px;line-height:${px - 4}px;background:#2f9e44;border:2px solid #fff;border-radius:50%;color:#fff;text-align:center;font-weight:700;font-size:${px > 40 ? 15 : 12}px;box-shadow:0 1px 5px rgba(0,0,0,.4);">${count}</div>`,
    size: new naver.maps.Size(px, px),
    anchor: new naver.maps.Point(px / 2, px / 2),
  };
}
function buildClusters() {
  if (!clusterReady) return;
  if (!markersOn) { clusterPool.forEach((m) => m.setMap(null)); clusterPool.clear(); return; }
  const g = gridCellSize(map.getZoom());
  const b = map.getBounds(), sw = b.getSW(), ne = b.getNE();
  const latLo = sw.lat() - g, latHi = ne.lat() + g, lngLo = sw.lng() - g, lngHi = ne.lng() + g;

  // 뷰포트(+1셀 여유) 안 식당만 버킷에 담는다
  const want = new Map();
  for (const r of restaurants) {
    if (r.lat == null || r.lng == null) continue;
    if (r.lat < latLo || r.lat > latHi || r.lng < lngLo || r.lng > lngHi) continue;
    const k = Math.round(r.lat / g) + ':' + Math.round(r.lng / g);
    const a = want.get(k); if (a) a.push(r); else want.set(k, [r]);
  }
  // 화면 밖이거나 줌이 바뀐 버킷 제거
  for (const [k, m] of clusterPool) if (!want.has(k) || m.__g !== g) { m.setMap(null); clusterPool.delete(k); }
  // 신규 버킷만 생성 (같은 줌에서 팬하면 기존 마커 재사용 → 깜빡임 없음)
  want.forEach((group, k) => {
    if (clusterPool.has(k)) return;
    let m;
    if (group.length === 1) {
      const r = group[0];
      m = new naver.maps.Marker({ position: latLng(r.lat, r.lng), map, title: r.name, icon: starIcon('#2f9e44') });
      naver.maps.Event.addListener(m, 'click', () => { openInfo(m, restaurantCard(r)); pushRecent({ key: 'r' + r.id, id: r.id, name: r.name, lat: r.lat, lng: r.lng }); });
      naver.maps.Event.addListener(m, 'mouseover', () => highlightCard(r.id, true));
      naver.maps.Event.addListener(m, 'mouseout', () => highlightCard(r.id, false));
    } else {
      const la = group.reduce((s, x) => s + x.lat, 0) / group.length;
      const lo = group.reduce((s, x) => s + x.lng, 0) / group.length;
      const px = Math.min(60, 30 + Math.round(Math.log2(group.length) * 6));
      m = new naver.maps.Marker({ position: latLng(la, lo), map, title: group.length + '곳', icon: clusterCountIcon(px, group.length) });
      naver.maps.Event.addListener(m, 'click', () => { map.setCenter(latLng(la, lo)); map.setZoom(map.getZoom() + 1); openClusterList(group, la, lo); });
    }
    m.__g = g;
    clusterPool.set(k, m);
  });
}
// 클러스터 팝업: 내부 식당 목록 표시 (동일 좌표 식당은 아무리 확대해도 분리되지 않으므로,
// 줌인과 함께 목록을 열어 개별 식당 정보에 접근할 수 있게 한다)
function openClusterList(group, la, lo) {
  const rows = group.slice(0, 10).map((r) =>
    `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid #f1f3f5;">
      <div style="min-width:0;">
        <div style="font-weight:700;font-size:13px;">${esc(r.name)}</div>
        <div style="font-size:11px;color:#8a9099;">${esc(r.category || '')}${r.address ? ' · ' + esc(r.address) : ''}</div>
      </div>
      <a href="detail.html?id=${r.id}" style="white-space:nowrap;font-size:11px;color:#e8590c;text-decoration:none;">상세→</a>
    </div>`).join('');
  openInfo(latLng(la, lo),
    `<div style="font-weight:700;font-size:13px;margin-bottom:3px;">이 근처 ${group.length}곳</div>${rows}${group.length > 10 ? `<div style="font-size:11px;color:#8a9099;padding:5px 0;">+ ${group.length - 10}곳 더 (확대해서 보세요)</div>` : ''}`);
}
function setClusterVisible(v) { clusterPool.forEach((m) => m.setMap(v ? map : null)); }

// ── ⑪ 정비사업 (재개발·재건축 1,100여 구역, 정보몽땅 공식자료) ─────────────
// 대분류 구조는 서울도시공간포털 도시계획사업 메뉴(BZ1xx 정비 / BZ2xx 소규모 / BZ3xx 역세권 / BZ4xx 재정비 / BZ5xx 국토부 / BZ6xx 기타)를 따름
const JB_COLOR = { '신통': '#e8590c', '재개발': '#e03131', '재건축': '#7048e8', '지역주택': '#1c7ed6', '재정비촉진': '#f08c00', '모아': '#2f9e44', '역세권': '#0c8599', '노후계획도시': '#5c7cfa', '기타': '#868e96' };
function jbGroup(d) { const bz = (d && d.bz) || ''; const g = (d && d.gubun) || (typeof d === 'string' ? d : '') || ''; const n = (d && d.name) || ''; if (bz) { if (bz.indexOf('BZ101') === 0) return '신통'; if (bz.indexOf('BZ2') === 0) return '모아'; if (bz.indexOf('BZ3') === 0) return '역세권'; if (bz.indexOf('BZ4') === 0) return '재정비촉진'; if (bz.indexOf('BZ5') === 0) return '노후계획도시'; if (bz.indexOf('BZ6') === 0) return '기타'; if (g.indexOf('지역주택') >= 0) return '지역주택'; if (g.indexOf('재건축') >= 0) return '재건축'; return '재개발'; } if (n && /신속통합기획|신통|통합구역/.test(n)) return '신통'; if (g.indexOf('신통') >= 0) return '신통'; if (g.indexOf('가로') >= 0 || g.indexOf('소규모') >= 0 || g.indexOf('모아') >= 0) return '모아'; if (g.indexOf('재건축') >= 0) return '재건축'; if (g.indexOf('재개발') >= 0) return '재개발'; if (g.indexOf('지역주택') >= 0) return '지역주택'; return '기타'; }
function jbIcon(color) { return { content: `<div style="width:22px;height:22px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.5);"></div>`, anchor: new naver.maps.Point(11, 11) }; }
const jbCIcon = (px) => ({ content: `<div style="cursor:pointer;width:${px}px;height:${px}px;line-height:${px - 4}px;background:#495057;border:2px solid #fff;border-radius:50%;color:#fff;text-align:center;font-weight:700;font-size:13px;box-shadow:0 1px 5px rgba(0,0,0,.4);"></div>`, size: new naver.maps.Size(px, px), anchor: new naver.maps.Point(px / 2, px / 2) });
const jbClusterIcons = [jbCIcon(34), jbCIcon(42), jbCIcon(50), jbCIcon(58)];
function jbCard(d) {
  const g = jbGroup(d), c = JB_COLOR[g];
  return `<div style="min-width:195px;"><span style="display:inline-block;background:${c};color:#fff;font-size:11px;padding:2px 7px;border-radius:10px;">${g}</span> <b style="font-size:11px;color:#555;">${esc(d.stage || '')}</b><div style="font-weight:700;font-size:14px;margin:4px 0 2px;">${esc(d.name)}</div><div style="font-size:12px;color:#8a9099;">${esc(d.gu)} ${esc(d.jibun)}${d.approx ? ' (동 근사)' : ''}</div><div style="font-size:11px;color:#999;margin-top:3px;">사업구분: ${esc(d.gubun)}${d.method ? ' · ' + esc(d.method) : ''}</div>${(d.rc || d.cafe) ? `<div style="display:flex;gap:6px;margin-top:7px;">${d.rc ? `<a href="https://urban.seoul.go.kr/view/map/mapPopup.html?recordCode=${encodeURIComponent(d.rc)}" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:6px;border:1px solid #7048e8;color:#7048e8;border-radius:6px;text-decoration:none;font-size:12px;">🗺️ 경계지도</a>` : ''}${d.cafe ? `<a href="https://cleanup.seoul.go.kr/cafe/mainIndx.do?cafeUrl=${encodeURIComponent(d.cafe)}" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:6px;border:1px solid #1c7ed6;color:#1c7ed6;border-radius:6px;text-decoration:none;font-size:12px;">📂 정보공개</a>` : ''}</div>` : ''}<div style="display:flex;gap:6px;margin-top:8px;"><button onclick="setRoutePt('s',${d.lat},${d.lng})" style="flex:1;font:inherit;font-size:12px;padding:5px 0;border:1px solid #2f9e44;color:#2f9e44;background:#fff;border-radius:6px;cursor:pointer;">🚩 출발</button><button onclick="setRoutePt('e',${d.lat},${d.lng})" style="flex:1;font:inherit;font-size:12px;padding:5px 0;border:1px solid #e03131;color:#e03131;background:#fff;border-radius:6px;cursor:pointer;">🏁 도착</button></div></div>`;
}
let jbRows = null, jbClustering = null, jbOn = false, jbPolys = null, jbPolysNaver = [];
const jbFilter = { '신통': true, '재개발': true, '재건축': true, '지역주택': true, '재정비촉진': true, '모아': true, '역세권': true, '노후계획도시': true, '기타': true };
function jbBuildNaver() {
  if (jbClustering) { jbClustering.setMap(null); jbClustering = null; }
  jbPolysNaver.forEach((p) => p.setMap(null)); jbPolysNaver = [];
  if (!jbRows || !jbOn) return;
  const arr = [];
  jbRows.forEach((d) => {
    if (d.lat == null || d.lng == null) return;
    if (!jbFilter[jbGroup(d)]) return;
    const c = JB_COLOR[jbGroup(d)];
    if (d.rc && jbPolys && jbPolys[d.rc]) {
      const paths = jbPolys[d.rc].map((ring) => ring.map((p) => latLng(p[0], p[1])));
      const poly = new naver.maps.Polygon({ map, paths, fillColor: c, fillOpacity: 0.28, strokeColor: c, strokeWeight: 2, strokeOpacity: 0.9 });
      naver.maps.Event.addListener(poly, 'click', (e) => { infoWindow.setContent('<div style="padding:7px 11px;font-size:13px;line-height:1.4;">' + jbCard(d) + '</div>'); infoWindow.open(map, e.coord); });
      jbPolysNaver.push(poly);
    } else {
      const m = new naver.maps.Marker({ position: latLng(d.lat, d.lng), icon: jbIcon(c), title: d.name });
      naver.maps.Event.addListener(m, 'click', () => openInfo(m, jbCard(d)));
      arr.push(m);
    }
  });
  jbClustering = new MarkerClustering({ minClusterSize: 2, maxZoom: 15, map, markers: arr, disableClickZoom: false, gridSize: 100, icons: jbClusterIcons, indexGenerator: [10, 50, 200], stylingFunction: (cm, count) => { const dv = cm.getElement().querySelector('div'); if (dv) dv.textContent = count; } });
}
function initJbCats() {
  $('jb-cats').innerHTML = Object.keys(JB_COLOR).map((g) => `<button class="fav-cat active" data-g="${g}" style="display:inline-flex;align-items:center;gap:5px;"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${JB_COLOR[g]};"></span>${g}</button>`).join('');
  $('jb-cats').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { const g = b.dataset.g; jbFilter[g] = !jbFilter[g]; b.classList.toggle('active', jbFilter[g]); jbBuildNaver(); }));
}

// ── ⑫ 데이터 로드 (병렬) ──────────────────────────────────────────────────
// Supabase는 요청당 1,000행 제한 → 페이지네이션. 2페이지씩 병렬로 로드(왕복 절반).
async function loadAllRestaurants() {
  const all = [], size = 1000; let from = 0;
  for (;;) {
    const [a, b] = await Promise.all([
      sb.from('mj_restaurants').select('*').range(from, from + size - 1),
      sb.from('mj_restaurants').select('*').range(from + size, from + 2 * size - 1),
    ]);
    if (a.error) throw a.error;
    if (b.error) throw b.error;
    all.push(...(a.data || []), ...(b.data || []));
    if (!a.data || a.data.length < size) break;
    if (!b.data || b.data.length < size) break;
    from += 2 * size;
  }
  return all;
}
// 푸터 통계 3종(head count) — 방문자는 visits 테이블(페이지 로드마다 1건 기록)로 집계한다.
// visits 테이블이 아직 없으면(스키마 미실행) 조용히 넘어가고 '—'로 남는다.
async function loadFooterStats() {
  const today = new Date().toISOString().slice(0, 10);
  sb.from('visits').insert({ page: 'main' }).then(() => {}, () => {});
  const [mRes, tRes, totRes] = await Promise.allSettled([
    sb.from('taste_profiles').select('*', { count: 'exact', head: true }),
    sb.from('visits').select('*', { count: 'exact', head: true }).gte('created_at', today),
    sb.from('visits').select('*', { count: 'exact', head: true }),
  ]);
  const el = document.getElementById('f-members'); if (el && mRes.status === 'fulfilled' && mRes.value.count != null) el.textContent = mRes.value.count.toLocaleString();
  const et = document.getElementById('f-today'); if (et && tRes.status === 'fulfilled' && tRes.value.count != null) et.textContent = tRes.value.count.toLocaleString();
  const etot = document.getElementById('f-total'); if (etot && totRes.status === 'fulfilled' && totRes.value.count != null) etot.textContent = totRes.value.count.toLocaleString();
}
async function loadAll() {
  $('rec-list').innerHTML = Array(4).fill('<div class="skel-card"><div class="skel skel-h"></div><div class="skel skel-m"></div><div class="skel skel-s"></div></div>').join('');
  const { data: { session } } = await sb.auth.getSession();
  user = session ? session.user : null;
  if (user) { $('who').textContent = user.email; $('logout').style.display = ''; $('delete-account').style.display = ''; }
  loadFooterStats(); // 푸터 통계는 백그라운드로 병렬 진행
  // 사용자 취향·즐겨찾기 로드와 식당 로드를 동시에 (순차 대기 제거)
  const userJobs = user
    ? Promise.all([
        sb.from('taste_profiles').select('*').eq('user_id', user.id).maybeSingle(),
        sb.from('saved_restaurants').select('restaurant_id').eq('user_id', user.id),
      ])
    : Promise.resolve([null, null]);
  try {
    const [list, [tasteRes, savedRes]] = await Promise.all([loadAllRestaurants(), userJobs]);
    restaurants = list;
    if (user) {
      taste = (tasteRes && tasteRes.data) || null;
      savedIds.clear(); (savedRes && savedRes.data || []).forEach((s) => savedIds.add(Number(s.restaurant_id)));
      savedRev++;
    }
  } catch (e) {
    $('banner').textContent = '맛집을 불러오지 못했어요: ' + e.message;
    return;
  }
  buildRestIndex();
  clusterReady = true;
  buildClusters();
  render();
  renderRecent();
}

// ── ⑬ 이벤트 바인딩·초기화 ────────────────────────────────────────────────
function bindEvents() {
  applyTheme(localStorage.getItem('mj_theme') === 'dark');
  document.addEventListener('DOMContentLoaded', () => applyTheme(localStorage.getItem('mj_theme') === 'dark'));
  initThemeBtn();

  // 지도 도구
  $('tool-markers').addEventListener('click', () => {
    markersOn = !markersOn;
    $('tool-markers').classList.toggle('on', markersOn);
    if (markersOn) buildClusters(); else setClusterVisible(false);
  });
  $('tool-street').addEventListener('click', () => setMode('street'));
  $('tool-dist').addEventListener('click', () => setMode('dist'));
  $('tool-radius').addEventListener('click', () => setMode('radius'));
  $('tool-clear').addEventListener('click', clearMeasure);
  $('tool-share').addEventListener('click', () => {
    const c = map.getCenter();
    const url = `${location.origin}${location.pathname}?lat=${c.lat().toFixed(6)}&lng=${c.lng().toFixed(6)}&z=${map.getZoom()}`;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
      () => { $('banner').textContent = '🔗 현재 지도 위치 링크를 복사했어요!'; },
      () => { prompt('아래 링크를 복사하세요:', url); });
  });
  // 지도 클릭 → 모드별 동작 (모드 없으면 주소 표시) / 우클릭 → 팝업 닫기
  naver.maps.Event.addListener(map, 'click', (e) => {
    if (mapMode === 'street') return openStreetView(e.coord);
    if (mapMode === 'dist') return addDistPoint(e.coord);
    if (mapMode === 'radius') return addRadiusPoint(e.coord);
    showAddress(e.coord, '📍 클릭한 위치');
  });
  naver.maps.Event.addListener(map, 'rightclick', () => infoWindow.close());
  // 팬/줌이 끝날 때만 클러스터 갱신
  naver.maps.Event.addListener(map, 'idle', () => buildClusters());
  // 📍 내 위치에서 찾기 (GPS → 지도 이동 → 주소 표시)
  $('geo-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { alert('이 브라우저는 위치를 지원하지 않아요.'); return; }
    $('geo-btn').disabled = true; $('geo-btn').style.opacity = '.5';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('geo-btn').disabled = false; $('geo-btn').style.opacity = '';
        const ll = latLng(pos.coords.latitude, pos.coords.longitude);
        map.setCenter(ll); map.setZoom(15); showAddress(ll, '📍 내 위치');
        panelMode = 'recommend';
        document.querySelectorAll('.list-tab').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'recommend'));
        render();
      },
      () => { $('geo-btn').disabled = false; $('geo-btn').style.opacity = ''; alert('위치 권한이 필요해요.'); }
    );
  });

  // 로그아웃
  $('logout').addEventListener('click', async () => { await sb.auth.signOut(); location.href = 'index.html'; });
  // 회원 탈퇴
  $('delete-account').addEventListener('click', async () => {
    if (!confirm('정말 탈퇴하시겠습니까?\n회원 정보와 저장한 모든 데이터가 삭제되며 복구할 수 없습니다.')) return;
    const btn = $('delete-account');
    btn.disabled = true; btn.textContent = '🗑️ 탈퇴 처리 중…';
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { alert('로그인 정보가 없습니다.'); return; }
      const r = await fetch(SUPABASE_URL + '/functions/v1/delete-account', {
        method: 'POST', headers: { 'Authorization': 'Bearer ' + session.access_token, 'Content-Type': 'application/json' },
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
      location.href = 'index.html?deleted=1';
    } catch (e) {
      alert('탈퇴 실패: ' + (e.message || e) + '\n잠시 후 다시 시도해 주세요.');
      btn.disabled = false; btn.textContent = '🗑️ 회원 탈퇴';
    }
  });
  // 패널 목록 탭(즐겨찾기/인근추천) 전환
  document.querySelectorAll('.list-tab').forEach((t) => t.addEventListener('click', () => {
    document.querySelectorAll('.list-tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active'); panelMode = t.dataset.mode;
    $('fav-cats').classList.toggle('on', panelMode === 'favorites');
    render();
  }));
  document.querySelectorAll('.fav-cat').forEach((c) => c.addEventListener('click', () => {
    document.querySelectorAll('.fav-cat').forEach((x) => x.classList.remove('active'));
    c.classList.add('active'); favCat = c.dataset.cat; render();
  }));
  // 👤 내 정보 드롭다운
  $('profile-btn').addEventListener('click', (e) => { e.stopPropagation(); $('profile-menu').classList.toggle('on'); });
  document.addEventListener('click', () => $('profile-menu').classList.remove('on'));
  $('fav-link').addEventListener('click', (e) => { e.preventDefault(); $('profile-menu').classList.remove('on'); document.querySelector('.list-tab[data-mode="favorites"]').click(); });

  // 검색 입력: 목록 필터(디바운스) + 자동완성. 지도 이동은 Enter/자동완성 선택/카드 클릭 시에만.
  let searchDebounce = null;
  $('search').addEventListener('input', (e) => { query = e.target.value; renderAC(); clearTimeout(searchDebounce); searchDebounce = setTimeout(render, 140); });
  $('search').addEventListener('blur', () => setTimeout(() => { $('ac').className = 'ac'; }, 150));
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  // 모바일 하단 시트 열고/닫기
  (function initSheet() { const h = $('sheet-handle'), p = document.querySelector('.panel'); if (h && p) h.addEventListener('click', () => p.classList.toggle('sheet-open')); })();
  // 검색엔진 선택
  (function initEngineBar() {
    document.querySelectorAll('#engine-bar .tool-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#engine-bar .tool-btn').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on'); searchEngine = b.dataset.engine;
      });
    });
  })();
  // Kakao SDK autoload=false → DOMContentLoaded 후 초기화
  if (window.kakao && !kakaoReady) {
    document.addEventListener('DOMContentLoaded', function () { kakao.maps.load(function () { kakaoReady = true; }); });
  }

  // 리스트 이벤트 위임 (render마다 N개 리스너 재등록 대신 컨테이너에 1회 등록)
  const list = $('rec-list');
  list.addEventListener('click', (e) => {
    const saveBtn = e.target.closest('.save[data-id]');
    if (saveBtn) { e.stopPropagation(); handleSave(saveBtn); return; }
    const card = e.target.closest('.rec[data-id]');
    if (!card || e.target.closest('.actions')) return;
    const r = restaurants.find((x) => x.id == card.dataset.id);
    if (r) {
      showRestaurant(r);
      document.querySelector('.panel').classList.remove('sheet-open');
    }
  });
  list.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.rec[data-id]');
    if (!card || e.relatedTarget?.closest('.rec[data-id]') === card) return;
    highlightCard(card.dataset.id, true);
  });
  list.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.rec[data-id]');
    if (!card || e.relatedTarget?.closest('.rec[data-id]') === card) return;
    highlightCard(card.dataset.id, false);
  });

  // 정비사업 토글
  $('tool-jb').addEventListener('click', () => {
    jbOn = !jbOn;
    $('tool-jb').classList.toggle('on', jbOn);
    $('jb-cats').style.display = jbOn ? 'flex' : 'none';
    $('banner').textContent = jbOn ? '🏗️ 정비사업 구역(재개발·재건축 등)을 유형별로 표시 중이에요.' : '';
    if (jbOn && !jbRows) { Promise.all([fetch('redevelop_seoul.json?v=4').then((r) => r.json()), fetch('redevelop_polygons.json?v=2').then((r) => r.json()).catch(() => ({}))]).then(([rows, polys]) => { jbRows = rows; jbPolys = polys; jbBuildNaver(); }).catch(() => { $('banner').textContent = '정비사업 데이터를 불러오지 못했어요.'; }); }
    else jbBuildNaver();
  });
}

// 자동완성 (입력창 아래). 검색엔진 명은 선택된 엔진 기준으로 표시.
function renderAC() {
  const raw = $('search').value.trim(), q = raw.toLowerCase(), ac = $('ac');
  if (!q) { ac.className = 'ac'; ac.innerHTML = ''; return; }
  const engineLabel = searchEngine === 'naver' ? '네이버' : '카카오';
  const rs = matchRestaurants(q).slice(0, 6);
  ac.innerHTML = rs.map((r) => `<div class="ac-item" data-id="${r.id}"><span>🍜</span>${esc(r.name)}<span class="t">식당</span></div>`).join('')
    + `<div class="ac-item" data-search="1"><span>🔎</span>'${esc(raw)}' ${engineLabel} 검색<span class="t">검색</span></div>`;
  ac.className = 'ac on';
  ac.querySelectorAll('.ac-item').forEach((it) => it.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    if (it.dataset.search) { runSearch(); }
    else { const r = restaurants.find((x) => x.id == it.dataset.id); if (r) showRestaurant(r); $('search').value = r ? r.name : raw; query = $('search').value; render(); }
    ac.className = 'ac';
  }));
}

function init() {
  bindEvents();
  initJbCats();
  applyShareParams();
  loadAll();
}
init();
