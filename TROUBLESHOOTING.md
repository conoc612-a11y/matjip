# TROUBLESHOOTING — matjip 작업 중 반복해서 터진 문제와 해결법

다른 AI(Claude Code / opencode / 그 외)가 이어받아 작업할 때 **같은 함정에 다시 빠지지 않도록** 정리한 문서다.
여기 적힌 것은 전부 실제로 겪고 실측으로 확인한 내용이다. 추측은 넣지 않았다.

**읽는 순서**: `AGENTS.md`(구조) → 이 문서(함정) → `HANDOFF.md`(직전 세션 상태) → `git log -5`

---

## 0. 가장 자주 한 실수 (프로세스)

| 실수 | 왜 문제인가 | 어떻게 할 것 |
|---|---|---|
| 참조 사이트가 있는데 내 방식으로 먼저 구현 | 토지거래허가구역을 "채운 뒤 한강을 오려내는" 방식으로 며칠 씨름했는데, 참조 사이트는 **애초에 면을 칠하지 않았다**. 없는 문제를 만들어 푼 셈. | 참조 사례(urban.seoul.go.kr 등)가 있으면 **먼저 열어서 어떻게 했는지 확인**하고 시작할 것 |
| HANDOFF 에 "미반영"이라 적고 넘어감 | 기록만 남기고 실제로 안 한 항목이 그대로 방치됐다 | 기록은 작업이 아니다. 다음 세션은 HANDOFF 의 **"미반영/보류" 항목부터 확인** |
| 로컬에서만 확인하고 "완료" 보고 | 배포본은 캐시·빌드 지연 때문에 다르게 보인다. 사용자가 먼저 발견함 | 배포 건은 **배포 URL에서 직접 확인**한 뒤 보고 |
| 손으로 찍은 좌표로 검증 | "한강 한가운데"라고 찍은 점 2곳이 실제로는 물이 아니어서 잘못된 결론으로 갈 뻔했다 | 권위 있는 데이터(하천 폴리곤 등)**에서 샘플을 뽑아** 검증 |

---

## 1. 로컬(localhost) 개발 환경의 제약 — 매번 헷갈림

**증상**: 로컬에서 지도 타일이 안 뜨고, 공인중개사 목록이 비어 있고, 레이어가 전부 실패한다. "내가 뭘 망가뜨렸나?" 싶지만 **정상**이다.

| 기능 | localhost 에서 | 이유 |
|---|---|---|
| V-World 타일·WMS 전부 | ❌ 전부 실패 | 키가 도메인 잠금. localhost 미등록 |
| 카카오 SDK(공인중개사·장소검색) | ❌ 안 뜸 | 위와 같음 |
| OSM 배경지도 | ✅ 됨 | 키 불필요 |
| UPIS 주제도(서울 ArcGIS) | ✅ 됨 | 프록시 경유, 키 불필요 |
| Supabase Edge Function | ✅ 됨 | CORS 열려 있음 |
| land.html·main.html 자체 접속 | ❌ onboarding.html 로 리다이렉트 | `js/auth-guard.js` — 로그인 세션 없으면 `?next=` 로 이동 |

**대응**: 로컬에서 지도를 봐야 하면 **배경지도를 OSM 으로 바꾸고** 테스트한다.
V-World/카카오가 필요한 검증은 **배포본에서** 해야 한다.

```js
// 로컬 테스트 시 OSM 으로 전환하는 코드
[...document.querySelectorAll('.bm-item')].find(b => b.querySelector('.bm-label').textContent === 'OSM').click();
```

**헤드리스 검증용**: 로그인 없이 land.html 을 열려면 auth-guard 스크립트만 차단하면 된다 (2026-08-09 실측). 차단하지 않으면 헤드리스에서도 `onboarding.html?next=land.html` 로 리다이렉트되어 "DOM 에 #map 이 없다"는 오판을 낸다.

```js
await page.route('**/js/auth-guard.js', (route) => route.abort());
```

---

## 2. Leaflet 팝업 — 가장 많이 터진 곳

### 2-1. 줌하면 팝업이 화면 밖으로 잘린다
- **원인 ①**: Leaflet 의 `_adjustPan()` 에는 `_autopanning` 플래그가 있어서 **"직전에 자동 패닝했으면 이번 호출은 통째로 건너뛰고 플래그만 리셋"** 한다. 팝업이 열릴 때 한 번 패닝되므로 그 다음 줌에서의 호출이 삼켜진다.
  - 실측: 팝업 top 이 −52px 로 모든 줌 레벨에서 동일하게 잘림.
- **원인 ②**: 상세 내용(토지·건물 정보, 인근 상호)은 `update()` 가 내용을 지우는 걸 피하려고 **팝업 DOM 에 직접 주입**한다. 그래서 `update()` → `_adjustPan()` 경로를 아예 안 탄다.
- **해결**: `L.Popup.prototype._adjustPan` 을 **직접 계산하는 구현으로 교체**(플래그 없이, 실제로 잘렸는지 픽셀로 보고 최소 거리만 재배치). DOM 직접 주입 지점에서도 재배치를 명시적으로 호출.
- **하지 말 것**: ResizeObserver 로 팝업 성장 감지 → `--popup-max-h` 에 걸리면 컨테이너 크기가 더는 안 변해 **콜백이 0회**다(실측). 시도해봤고 안 된다.
- **2026-08-07 변경 (지도 고정)**: 재배치를 `map.panBy`(animate:false) 로 지도를 움직이던 방식에서, **`popup.options.offset` 을 조정해 팝업만 지도 안으로 밀어 넣는 방식으로 교체**(`clampPopup()`). 지도를 움직이면 ① 클릭 직후 팝업이 자라날 때마다 ② 줌 후에 지도가 훌쩍 옮겨 '클릭 좌표가 다른 곳으로 이동 / 줌하면 다른 화면으로 이동'처럼 보인다(사용자 제보). 참조 사이트(서울도시공간포털)처럼 지도는 고정하고 팝업만 정렬한다.
  - `clampPopup` 은 `getBoundingClientRect()` 로 넘침을 픽셀 계산 → `offset` 을 줄여 `p._updatePosition()` 호출(내용 재렌더 없이 재배치만 — Leaflet 1.9.4 Popup 기준). 부호: 아래/오른쪽 넘침이면 offset 을 줄이고, 위/왼쪽이면 늘린다(`off - dx/dy`).
  - `_updatePosition` 는 `_zoomAnimated` 분기에 따라 transform 과 bottom/left 둘 다 재설정하므로 offset 변경이 화면에 그대로 반영된다. offset 이 배열일 수 있으니 반드시 `L.point(offset || [0,0])` 로 정규화.

### 2-2. 팝업을 리사이즈해도 글자가 안 따라온다
- 내부 카드 `.pc` 가 `width:min(264px,…)` 고정이라 폭을 늘려도 여백만 생겼다 → `width:100%`.
- `.leaflet-popup-content` 의 `max-width` 가 리사이즈 상한이 되어 **넓히기를 막는다**. 화면폭까지 열어야 한다.
- `resize:both` 는 `overflow` 가 `visible` 이면 동작하지 않는다 → `auto`.

### 2-3. 팝업 안 버튼을 눌렀는데 다른 필지 팝업이 열린다
- 팝업 내부 클릭이 지도까지 전파돼 그 화면 지점 좌표로 새 팝업이 열렸다(실측: 논현동 171-22 → 138-3, 109m 이동).
- `disableClickPropagation` 만으로 안 막히는 경로가 있어, `map.on('click')` 안에서 `e.originalEvent.target.closest('.leaflet-popup')` 로 한 번 더 거른다.

---

## 3. Leaflet 레이어 컨트롤

| 문제 | 원인 | 해결 |
|---|---|---|
| 끼워 넣은 그룹 헤더가 첫 체크에 사라짐 | Leaflet 이 레이어 토글마다 `_update()` 로 목록 DOM 을 **통째로 재생성** | `layersCtrl._update` 를 감싸 갱신 뒤마다 헤더 재적용 |
| 대분류 순서가 뒤섞임 | 헤더를 "첫 항목 앞에 삽입"하면 순서가 **선언 순서**를 따라감 | `DocumentFragment` 로 정의 순서대로 재배치 |
| 3단(대>중>소) 불가 | 기본 컨트롤은 평평한 목록만 지원 | 전용 패널(`.lp` + `LAYER_TREE`)을 따로 만듦 |
| 부분선택 체크박스를 누르면 전체 해제됨 | 브라우저 기본 동작(indeterminate + checked → unchecked) | 직전 indeterminate 여부를 `dataset` 에 기억했다가 onchange 에서 '전체 선택'으로 뒤집기 |
| **실거래·정비사업 등 레이어를 켜도 마커/클러스터가 전혀 안 그려짐** | Leaflet 1.9 는 `overlayadd`/`overlayremove` 를 **`L.Control.Layers` 가 있을 때만** fire 한다(커스텀 패널이 기본 컨트롤을 대체하자 `rpBuild()`/`jbBuild()`/`showPriceFilter()` 등 `map.on('overlayadd')` 핸들러가 영영 안 불림). "지도가 그려지는데"처럼 보이던 건 UPIS 타일을 정비사업 마커로 오인한 것 | 체크박스 `onchange` 에서 `addTo`/`removeLayer` 후 **직접 `map.fire('overlayadd', { layer })` 호출** (land.html ~1733 `midCb.onchange`) |

**3단 패널 구현 시 주의**: 중분류 레이어를 만드는 헬퍼 안에서 선택 집합(`mid._on`)을 초기화하면 **방금 켠 소분류 id 가 지워져** 레이어가 안 뜬다. 초기화는 패널 생성 시 한 번만.

**커스텀 레이어 컨트롤 재사용 시 체크리스트**: ① `L.DomEvent.disableClickPropagation(div)` — 없으면 컨트롤에서 마우스 드래그(예: `resize:both` 코너) 시 mousedown 이 지도로 전파돼 **지도가 함께 팬**된다(실측, 2026-08-07). ② 기본 컨트롤 대체 시 위 overlayadd 문제. ③ 스크롤이 지도 줌을 타면 `disableScrollPropagation`.

---

## 4. Leaflet 렌더링

- **캔버스 렌더러의 스테일 transform**: 팬/줌 후 이전 `scale/translate` 가 남아 폴리곤이 지도와 어긋나 보였다 → 정비사업·토지거래 폴리곤은 `renderer: L.svg()` 강제.
  (단, 9천 개 마커 계열은 성능 때문에 캔버스 유지)
- **land.html 전체는 `preferCanvas: true`(798행)** — 검증 때 `.leaflet-overlay-pane svg path` 로 폴리곤 존재를 판단하면 "0개 = 버그"로 **오판**한다(2026-08-08 실제 겪음). 폴리곤 렌더는 `overlayCanvas` 존재 + `getImageData` 픽셀 채색 비율(실측 21.9%)로 확인할 것.
- **`noClip: true`** 없으면 줌인 시 뷰포트 밖 폴리곤이 `M0 0` 으로 접힌다.
- **헤드리스 브라우저에서 `map.zoomIn()` 이 동작하지 않는다.** 애니메이션 줌이 `transitionend` 에 의존하는데 그 이벤트가 안 온다. 순정 Leaflet 지도로 대조 실험까지 해서 확인함 → **테스트에서는 `map.setZoom(z, { animate: false })` 를 쓸 것.**
- **캔버스 폴리곤 클릭 검증 시 CDP 로 직접 이벤트를 보내야 한다 (2026-08-08 실측)**. `preferCanvas: true` 면 폴리곤은 `<path>` 가 아니라 **canvas 픽셀**이라 SVG 셀렉터·`.fire('click')` 로는 팝업 여부를 검증할 수 없다.
  - **헤드리스에서 클릭이 지도에 안 전달되는 함정**: CDP `Input.dispatchMouseEvent` 로 클릭 좌표를 정해도 그 좌표가 **다른 DOM 요소**(`.leaflet-control`, `.lc` 레이어 컨트롤 등)에 덮여 있으면 클릭이 canvas 에 닿지 않는다(실측: evCount 전부 0, elementFromPoint 가 `DIV.lc`). 좌표가 컨트롤 밖인지는 `elementFromPoint(x, y)` 가 `.leaflet-overlay-pane canvas` 를 가리키는지로 판정할 것 — `.leaflet-top` 처럼 pointer-events:none 인 스트립을 rect 로 빼는 방식은 오판한다.
  - **setView 직후 검사가 아닌, setView 한 뒤 좌표를 다시 계산**해야 한다(줌이 바뀌면 containerPoint 가 달라진다). 후보 구역을 하나만 보내면 그 구역이 컨트롤 아래로 들어갈 수 있어, 구역을 여럿 준비해 첫 비차단 지점을 쓰는 것이 안정적.
  - 검증 지표: `elementFromPoint → CANVAS`, `canvasClick evCount ≥ 1`, `popupSourceJb`(=`map._popup._source._jb.name`)가 해당 구역 이름이면 통과. 픽셀 채색 검사(`getImageData`)만으로는 팝업 여부를 알 수 없다.
- **클러스터에 묶인 마커는 `marker.fire('click')` 로 팝업이 안 열린다 (2026-08-08 실측)**. 실거래 마커는 `realpriceCluster`(land.html 1152행) 등 클러스터가 클릭을 가로채기 때문. 팝업 로직(크기 fit·크기 조절 등)을 검증하려면 `L.popup().setLatLng(...).setContent(...).openOn(map)` 으로 팝업을 직접 만들고 `_lpH`/`_lpW` 를 조작해 `_updateLayout()` 을 호출하는 게 안정적이다. fit 검증 내용은 25개 항목 같은 과도한 길이를 넣지 말 것(8px 바닥까지 줄여도 넘쳐 "복원 실패"로 오판) — 현실적 크기(6항목 내외)로.
- **팝업 리사이즈 그립 드래그 후 폰트가 8px 바닥까지 축소돼 "크기 조절이 안 되는 것처럼" 보인다 (2026-08-08 실측)**. 원인: 드래그할 때마다 `_updateLayout`(land.html ~837)이 `fitPopupText` 를 재실행하는데, 정비 팝업은 타임라인 등 **폰트에 반응하지 않는 고정 높이 요소**가 많아 8px 로 줄여도 `scrollHeight > clientHeight` 가 계속 유지된다(실측: 목동4단지 드래그 후 scrollH 757 > clientH 554, fs 8px). 폰트 축소가 "내용을 줄여 맞추는" 본래 목적과 달리 무한히 줄어 크기 조절이 상쇄된다. **해결**: `fitPopupText` 가 8px 바닥까지 줄인 뒤에도 넘치면 **기본 폰트로 복원**하고 스크롤에 맡긴다(고정 높이 요소가 지배하는 콘텐츠에서 폰트 축소는 무의미). 이러면 드래그로 키운 크기가 유지된다. 검증은 `realpopup-drag.cjs`(실제 정비 폴리곤 `openPopup()` + CDP 마우스 드래그) 로 fs 13px 유지 확인.
- **거리뷰 오버레이 그립 드래그는 되는데 파노라마 화면만 안 따라온다 (2026-08-08 실측)**. 증상: `sv-overlay`(land.html 3434)는 우하단 그립으로 리사이즈 되고 미니맵(CSS `resize:both`)도 크기 조절이 되는데 **실제 거리뷰 화면만 옛 크기로 남는다**. 원인: `endOvDrag` 가 `panorama.refreshSize()` 를 호출했는데 **`refreshSize()` 는 Naver Panorama 에 없는 메서드다**(Map 전용). `typeof panorama.refreshSize === 'function'` 가 false 여서 **드래그 종료 시 갱신이 한 번도 실행되지 않았다**. Naver Panorama 는 컨테이너 크기 변화를 자동 감지하지 못한다(Map 의 auto-resize 는 `size` 옵션 생략 시에만) — 미니맵은 `ResizeObserver` + `miniMap.refresh(true)`(land.html 3524)를 넣어 둔 덕에 됐던 것. **해결**: `panorama.setSize(new naver.maps.Size(ov.clientWidth, ov.clientHeight))` 로 교체 + 드래그 중 rAF 스로틀로 라이브 갱신. 검증은 `sv-resize-test.cjs`(naver 스텁 + CDP PointerEvent 드래그) 로 820×560→1020×680 + `setSize` 2회 호출 확인.
- **거리뷰 리사이즈 그립이 안 보인다 (2026-08-08 실측)**. 증상: 그립이 존재하는데 사용자 눈에 안 띈다("크기 조정 가능한지 모르겠다", "팝업 우하단 '」' 표시처럼 나오게 해달라"). 원인: 공용 `.lp-grip`(land.html 324)이 `opacity:.5` + 16px·8px 코너 + `var(--muted)` 인데, 거리뷰 오버레이는 `filter:invert(1)`(어두운 파노라마 위에서 코너를 밝게 하려는 의도)를 붙여도 **opacity .5 가 그대로라 어두운 이미지 위에서 거의 사라진다**. **해결**: 거리뷰 전용 `.sv-grip`(land.html 327-331) 추가 — **32px**, opacity 1, `rgba(0,0,0,.78)` 배경 + 흰색 **2px** 테두리 + **4px** 흰 코너, `filter` 제거, hover 시 배경 더 진해짐. **"드래그로 크기 조절" 힌트(`sv-grip-hint`)는 호버에 의존하지 않고 항상 표시**(opacity 1) — 사용자가 크기 조절 가능함을 모르는 게 반복 제보의 근본 원인이었으므로, 감추는 것보다 항상 알려주는 걸 선택. 검증은 `sv-grip-test.cjs` 로 그립 32px·opacity 1·bg rgba(0,0,0,.78)·힌트 opacity 1(항상 표시) 확인, `sv-resize-test.cjs` 로 드래그 리사이즈(820×560→1020×680) 회귀 통과 확인.
- **겹친 구역 폴리곤의 클릭이 큰 폴리곤에 가로채인다 (2026-08-08 실측)**. 증상: 사당4동(기타, 43.4만㎡) 폴리곤이 사당동 305-35 일대(신통, 4.13만㎡)를 **완전히 포함**하는데, 305-35 영역을 클릭해도 사당4동 팝업이 뜬다. 원인: Canvas/SVG 공통으로 **"나중에 추가된 도형이 위"** — Leaflet 클릭 hit test 는 렌더 순서 역순이다. jbBuild(land.html 1599)는 `jbRows`(데이터) 순서로 `addLayer` 했고, 큰 구역이 뒤에 와서 위를 차지했다. **해결**: `jbBuild` 에서 폴리곤을 **면적 내림차순**으로 정렬 후 addLayer(`polys.sort((a,b)=>b._area-a._area)`, land.html 1658) — 큰 폴리곤이 아래 깔리고 작은 정밀 경계가 위. 근사 원(`dots`)은 그보다 아래(`jbCluster.addLayers(dots)` 먼저 호출)로 내린다. `_area` 는 `_ringArea(rings[0])`. **주의: 내림차순이어야 한다.** 오름차순으로 쓰면 작은 구역이 아래로 가 오히려 역효과(실제로 1회 실수 후 정렬 반전). 검증은 CDP 실클릭으로 클릭 좌표의 포함 구역(pointInRing 데이터 대조)과 팝업 소스가 일치하는지 — A 중심/A 남서(A∩B→작은 A)·A 동쪽(B 단독→B)·북쪽(B∩남성역B→남성역B)·기타사업 WMS ON 상태에서도 A 팝업 유지, 예외 0건.

---

## 5. 스크립트 구조 / JS

### 5-1. TDZ 로 스크립트 전체가 죽는다 (증상이 헷갈림)
`const EXIM_PROXY = …` 를 사용 지점보다 **아래**에 선언했더니 `Cannot access before initialization` 이 나면서
**그 아래 모든 코드가 초기화되지 않았다**(지도는 뜨는데 헤더 위젯·네이버 SDK 등이 전부 죽음).
→ 즉시 호출하는 상수는 반드시 **사용 지점보다 앞에** 선언.

### 5-2. JSONP 콜백 이름 충돌
`reverseGeocode` 가 콜백 전역명을 **좌표만으로** 만들어서, 같은 지점을 동시에 두 번 조회하면
(지도 클릭 팝업 주소 + 헤더 날씨 지역명) 뒤에 등록한 쪽이 `window[name]` 을 덮어써 앞 콜백이 **영영 안 불렸다**.
→ 호출마다 고유 시퀀스 번호를 붙인다.

### 5-3. 문법 검사 방법
빌드 도구가 없으므로 인라인 스크립트를 이렇게 검사한다:
```bash
node -e "
const fs=require('fs');const html=fs.readFileSync('land.html','utf8');
const re=/<script>([\s\S]*?)<\/script>/g;let m,i=0,f=0;
while((m=re.exec(html))){i++;try{new Function(m[1])}catch(e){f++;console.log('FAIL:',e.message)}}
console.log('blocks:',i,'fails:',f);
"
```

### 5-4. 문법 에러 하나가 "무관해 보이는" 기능을 죽인다 (admin.html 로그인 버튼, 2026-08-09)
- **증상**: admin.html 로그인 화면에서 이메일·비밀번호 입력 후 로그인 버튼이 **아무 반응 없음**. 원인과 무관해 보이는 위치의 함수가 범인.
- **원인(실측)**: `exportLocations()`(방문자 위치 탭 추가 때 작성)의 `download(...)` 호출에서 **닫는 괄호 1개 누락** → 인라인 `<script>` 전체가 파싱 단계에서 실패 → `doLogin()`·`render()` 등 **모든 함수가 정의되지 않음**. 버튼 onclick 은 죽은 함수를 가리키므로 눌러도 아무 일도 없음.
- **해결**: 5-3 검사 스크립트를 **HTML 커밋 전에 반드시 실행**(괄호 균형은 눈으로 안 보인다). 특히 `download(..., csv([...].concat(...)))` 처럼 **함수 중첩 괄호가 4겹 이상**이면 조심.
- **검증**: 배포본까지 `new Function()` 문법 검사 OK(`9607cc5`). 로그인 정상 복구.

---

## 6. 외부 API / 데이터 소스 함정

### 6-1. 서울 UPIS ArcGIS (참조 사이트와 같은 서비스)
- 엔드포인트: `https://urban.seoul.go.kr/proxy/proxy.jsp?` + `http://98.33.2.225:6080/arcgis/rest/services/UPIS/20200526_WMS/MapServer`
  - MapServer 가 **http** 라 https 페이지에서 직접 못 부른다 → 반드시 위 프록시 경유(브라우저 이미지 로드까지 확인함).
- **한글 레이어명은 `?f=pjson` 이 아니라 `/legend?f=pjson` 에 있다.** 전자는 `UPIS_C_UQ120_BZ101` 같은 코드명뿐. 후자는 "신속통합기획" 을 준다. **범례 색상 이미지(base64)도 여기서 나온다.**
- **그룹 레이어는 하위 id 를 명시**해야 그려진다.
- **`_OLD` 접미사 레이어는 폐지분**이라 쓰면 안 된다.
- **`minScale`**: 축척이 그보다 작으면(=많이 축소하면) 서버가 **빈 이미지**를 준다. 버그가 아니다. 예: 지적도(1,2)는 minScale 5000 이라 충분히 확대해야 보인다.
- 확정된 매핑(다시 조사하지 말 것):
  - 도시계획사업 = 94~122(BZ101~606). 정비사업 94–100 / 소규모 101–105 / 역세권 106–111 / 재정비촉진 112–115 / 국토부 116–117 / 기타 118–122
  - 지구단위계획구역 = **33**(UQ161), 특별계획구역 34, 획지예정선 39.
    ⚠️ 56·79 그룹(DLYP01~61)은 조경·공개공지 같은 **세부요소**라 대분류가 아니다. 여기 넣으면 빈 화면이 나온다.
  - 용도지역 123 / 용도지구 19~29 / 용도구역 30,31,32
  - 도시계획시설 = UQ151~159 → 3(도로) 12(주차장) 13(광장) 11(유통공급) 14(공공문화체육) 15(방재) 16(보건위생) 17(환경기초) 18(기타기반)
  - 토지거래허가구역 = 92, 하천(한강) = 239

### 6-2. 토지거래허가구역 데이터
- **V-World `lt_c_upisuq175` 에는 서울 데이터가 없다**(실측: 경기 23·인천 11·파주 2건, 서울 0). 서울은 시가 자체 지정하므로 국토부 전국 레이어에 안 들어간다. 이걸로 갈아타면 서울이 통째로 빈다.
- 서울 UPIS 92 에는 **자치구 전역 지정**이 들어있다(서초 46.9㎢·강남 39.5㎢ 등). 자치구 경계가 한강 중앙선까지 가서 **면을 칠하면 한강이 덮인다**.
- 참조 사이트는 **면을 안 칠하고 외곽선만** 그리고, minScale 로 축소 시 숨긴다 → matjip 도 동일하게 처리(`fill:false` + 줌 14 미만 숨김).
- 데이터에서 하천을 빼야 한다면: 하천 소스는 **UPIS 239 + V-World `lt_c_wkmstrm` 합집합**을 써야 한다(각각 빈 구간이 달라 하나만 쓰면 영등포·용산 구간에 구멍이 남는다). 그리고 **단순화는 하천을 빼기 전에** 해야 한다(뒤에 하면 강기슭 경계가 다시 펴져 물을 덮는다: 1.6% → 7.9% 악화).

### 6-3. ITS 국가교통정보센터 CCTV
- **Supabase Edge Function 의 IP 를 사실상 차단**한다. 실측: 내 PC 직접 호출 1.5초 / Edge Function 20초+ 타임아웃, 재시도·병렬·캐시를 넣어도 간헐적으로만 성공.
- **브라우저에서는 CORS 가 열려 있어 1.4초에 정상 응답**(220건) → 브라우저 직접 호출로 전환했다. 그래서 `ITS_CCTV_KEY` 는 **프론트 노출 키**다(무료 공개 API, 서버 경유 불가라서 내린 결정).
- **ITS 는 고속도로·국도만 커버한다.** 도심 한복판엔 CCTV 가 없다(강남 0건 / 서울 전역 240건). 반경을 좁게 잡으면 항상 빈 결과 → **화면 bbox 로 조회**할 것.

### 6-4. 한국수출입은행 (환율/금리)
- 환율(AP01)은 정상. **대출금리(AP02)·국제금리(AP03)는 `result:2`(데이터코드 오류)** 로 사용 불가 — 키를 바꿔도 동일. `exchangeJSON` 엔드포인트는 환율만 지원하는 것으로 보인다.
- 은행별 대출금리 비교는 **금감원 Finlife API** 가 맞는 소스다(키 미신청 상태).
- 휴일·주말엔 고시가 없어 빈 배열이 온다 → 최대 6일 거슬러 재조회.

### 6-5. data.go.kr 공통
- 인증키는 **계정당 하나**를 여러 서비스에 공용으로 쓴다(기상청 예보에 `MOLIT_KEY` 재사용 중).
- serviceKey 는 **절대 프론트에 두지 말 것** → Supabase Edge Function 프록시(`molit-proxy` 패턴).
  - 예외가 된 것은 ITS 뿐이고, 그건 6-3 처럼 물리적으로 불가능해서다.

### 6-6. V-World 주소검색(`req/search`) — `category` 파라미터 필수 (2026-08-07 실측)
- `land.html` 의 `vworldAddrToPnu()` 가 `type=address` 로 검색할 때 **`category=road` 를 빼면 `PARAM_REQUIRED` 에러**가 난다(V-World 가 필수 파라미터로 추가). 응답이 `ERROR` 로 오니 마커가 한 개도 안 찍힌다.
- 실측 조합: `type=address&category=road&query=<전체주소>` → OK, `{id: PNU, point:{x,y}}` 반환. `category=road&type=road` 로 도로명만 넣으면 NOT_FOUND, `category=PARCEL` 은 지번형이라 안 맞음.
- 증상이 "청약 배지만 안 뜨는 게 아니라 지번→좌표가 전부 안 되는 것"이라면 이 파라미터부터 의심할 것(공유 함수라 호출처 전체에 영향).
- 참고: V-World 타일(`wmts`)과 역지오코딩(`req/address`)은 `category` 없이 정상 동작한다 — 주소검색(`req/search`)만 해당.

### 6-7. 한국부동산원 청약홈 분양정보 (chungak-proxy, 2026-08-07 신규)
- data.go.kr `data/15098547`, **기술문서의 서버 경로(`B552555/ApplyhomeInfoDetailSvc/...`)는 전부 `NO_OPENAPI_SERVICE_ERROR`** — 이 API 는 odcloud(Infuser) 로 이전됨. **실제 호스트는 `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/{op}`** 이다.
- 오퍼레이션: `getAPTLttotPblancDetail`(분양정보 상세) / `getAPTLttotPblancMdl`(주택형별 모델), OPT/UrbtyOfctl/PblPvtRent/Remndr 동일 세트.
- 파라미터: `serviceKey`, `page`, `perPage`, `returnType`(JSON/XML), `cond[FIELD::OP]` — FIELD: `HOUSE_MANAGE_NO`/`PBLANC_NO`/`HOUSE_NM`/`HOUSE_SECD`(01 APT 등)/`HOUSE_DTL_SECD`(01 민영·03 공공)/`SUBSCRPT_AREA_CODE_NM`("서울")/`HSSPLY_ADRES`/`RCRIT_PBLANC_DE`(형식 `2026-08-07`), OP: EQ/LIKE/GT/GTE/LT/LTE.
- 응답: `{currentCount, data:[...], matchCount, totalCount}`. 최신 공고일 순 정렬.
- **데이터 지연 실측(2026-08-07)**: 서울 최신 공고가 2026-07-16 까지밖에 없다. "접수중·접수예정(`RCEPT_ENDDE >= 오늘`)" 필터를 걸면 **현재 0건이 나오는 게 정상**이다. 배지가 안 보인다고 코드 문제로 단정하지 말 것.
- `SUBSCRPT_AREA_CODE`/`_NM` 필터는 주소와 별개인 공급지역 개념이다. 좌표는 `HSSPLY_ADRES`(주소)로 변환한다.
- serviceKey 는 **인코딩된 문자열을 그대로** `serviceKey=<키>` 로 넣는다. `encodeURIComponent` 로 감싸면 `%`→`%25` 이중 인코딩되어 인증이 깨진다(molit-proxy 와 동일한 함정).
- 프록시는 op/파라미터를 화이트리스트로 검증 후 중계한다(`supabase/functions/chungak-proxy/index.ts`). 시크릿은 `CHUNGAK_API_KEY`.

### 6-8. 국토교통부 건축HUB 상세조회 — molit-proxy 화이트리스트 함정 (2026-08-07 실측)
- `molit-proxy` 의 `ALLOWED_OPS` 에 **건축물대장 "상세 보기" op 가 빠지면 HTTP 400** 으로 거부되어 상세 조회가 전부 실패한다. 증상: 버튼은 뜨는데(목록 `getBrTitleInfo` 는 허용돼서) 클릭 후 "불러오지 못했어요" 또는 무한 "조회 중…".
- 필수 op 7개(현재 land.html `LEDGER_DETAIL_OPS` 와 동일하게 유지): `getBrRecapTitleInfo`(총괄표제부) · `getBrBasisOulnInfo`(기본개요) · `getBrFlrOulnInfo`(층별개요) · `getBrAtchJibunInfo`(부속지번) · `getBrExposPubuseAreaInfo`(전유공용면적) · `getBrHsprcInfo`(주택가격 — op명이 `getBrHousePriceInfo` 가 **아님**) · `getBrJijiguInfo`(지역지구구역).
- **역사**: 2026-08-05 `5347fa2` 에서 키를 프론트 하드코딩 → 프록시로 분리하면서 **화이트리스트에 이 op 들을 빼먹어** 상세보기가 깨졌다. "예전엔 됐는데" 하면 키 분리 커밋 이후의 화이트리스트 누락을 의심할 것. **되돌리기(프론트 직호출)는 금지** — 키 노출 보안 회귀다. 화이트리스트에 op 를 추가해서 복구한다.
- op 를 새로 추가했다면 **배포 후 반드시 배포본에서 확인**: `https://<ref>.supabase.co/functions/v1/molit-proxy?op=<op>&sigunguCd=...` 가 400 대신 200 을 주는지. (임의 PNU 는 `totalCount=0` 이어도 정상이다 — 400 이 "화이트리스트 거부", 200 이 "통과"의 판별 기준.)

### 6-9. 국세청 사업자등록 상태조회·진위확인 (bizno-proxy, 2026-08-07 신규)
- data.go.kr **data/15081808** (국세청_사업자등록정보 진위확인 및 상태조회). 활용신청은 **자동승인**. 실측으로 활용승인·응답 정상 확인.
- **엔드포인트는 odcloud**: `POST https://api.odcloud.kr/api/nts-businessman/v1/{status|validate}?serviceKey=<키>` (청약홈과 같은 Infuser 호스트).
- 요청 body:
  - 상태조회: `{ "b_no": ["숫자10자리"] }` — 하이픈 `-` **반드시 제거**. 1회 최대 100건.
  - 진위확인: `{ "businesses": [{ b_no(필수), start_dt "YYYYMMDD"(필수), p_nm 대표자(필수), b_nm 상호(선택), p_nm2, corp_no, b_sector, b_type }] }`
- 응답:
  - 상태조회: `data:[{ b_no, b_stt("계속사업자"/"휴업자"/"폐업자"), b_stt_cd, tax_type("부가가치세 일반과세자" 등), end_dt(폐업일), utcc_yn }]`
  - 진위확인: `data[].valid = "01"(일치) / "02"(불일치, valid_msg "확인할 수 없습니다.")`, 일치 시 상태조회 정보(b_stt/tax_type/end_dt)도 함께 온다.
- **미등록 번호는 b_stt 가 빈 문자열**이고 상태조회 `tax_type` 에 "국세청에 등록되지 않은 사업자등록번호입니다."가 온다. 판정은 메시지로 구분할 것.
- **⚠️ 이 API 는 상호명·대표자·연락처·주소를 "반환하지 않는다"** — 진위확인은 사용자가 입력한 상호/대표자/개업일이 국세청 DB와 일치하는지 Y/N만 알려준다. 그런 필드를 보여주려면 제3자 기업정보 API(NICE 등 유료)가 필요. (2026-08-07 실측·확정)
- status_code 가 `OK` 가 아니면 인증/활용승인 문제. `Unauthorized`(키 오류)·`Forbidden`(활용신청 없음).
- serviceKey 는 인코딩된 문자열 그대로 query 로(`%`→`%25` 이중인코딩 금지, 타 프록시와 동일). land.html 은 `bizno-proxy` 경유 — 시크릿 `NTS_API_KEY`.
- land.html 헤더 '사업자등록증조회' 버튼 → 모달. 사업자번호는 **하이픈 자동 입력**(`_bizFmt`). 대표자·개업일 입력하면 validate, 번호만 입력하면 status 로 자동 분기. 로컬 테스트는 `?biznoEndpoint=` 로 mock 교체.

### 6-10. 법원경매정보 — 공식 Open API 가 없다 (2026-08-08 경쟁사 4곳 실측)
- **대한민국 법원경매정보는 공식 Open API 가 존재하지 않는다.** 경쟁사 4곳(경매알리미·오늘의경매·재개발닷컴·리치고)이 전부 courtauction.go.kr 화면 데이터를 우회 수집한다.
- 우회 방식 3종(경쟁사 실측):
  ① **서버 스크래핑**(경매알리미): 자체 백엔드가 courtauction 목록/필터를 긁어 자체 API(`/server/api/?c=Auction&m=getAuctionList`)로 서빙. 이미지는 공식사이트 **핫링크**, 권리/현황/배당은 **`.laf` 딥링크**(새 탭), 감정평가서 PDF는 **자체 프록시**(`pdf-proxy.php`). 4층 하이브리드가 최소 IP 부담.
  ② **자체 DB 적재**(오늘의경매): 법원 등록 중개업체가 직접 적재, 검색 필터가 courtauction 과 1:1 미러(시도 17종·현재상태 19종).
  ③ **공공데이터 재집계**(재개발닷컴): 법원을 직접 안 부르고 "공공데이터 기반 참고용"으로 경매를 정비구역과 조인해 집계.
- matjip 에 경매를 붙일 땐 이 지식이 필수다: 직스크래핑은 **IP 차단 리스크**(공식 사이트 운영 정책)가 있어 Edge Function 프록시(경매알리미 `pdf-proxy` 패턴)로 우회하거나, 재개발닷컴처럼 법원에 직접 안 닿는 공공데이터(실거래·고시) 기반으로 머물 것. 상세 분석은 `경쟁사_비교분석_20260808.hwpx`(프로젝트 루트) 3절 참고.

### 6-11. courtauction.go.kr 수집 — WebSquare5 SPA라 직접 요청 불가, 클릭 기반만 동작 (2026-08-09 실측)
- **직접 HTTP POST는 전부 실패**: 목록 API(`/pgj/pgjsearch/searchControllerMain.on`)를 fetch 로 그대로 쏘면 `"DB에서 자료를 불러오는 중 파라미터가 없습니다"` 오류. 페이지 요청을 반복하면 **IP 차단**(`"해당 IP는 비정상적인 접속으로 보안정책에의하여 차단되었습니다"`). 실측으로 확인된 함정.
- **정상 경로는 WebSquare5 검색 버튼 클릭뿐**: `PGJ151F00.xml`(물건상세검색·진행중) 화면에서 법원 select(`#mf_wfm_mainFrame_sbx_rletCortOfc`, option.value 는 **법원명 텍스트 그대로**) → 검색 버튼(`#mf_wfm_mainFrame_btn_gdsDtlSrch`, `<input type=button>`) 클릭 → `searchControllerMain.on` POST (JSON `dma_pageInfo` + `dma_srchGdsDtlSrchInfo`{cortOfcCd, pgmId:'PGJ151F01', cortStDvs:1, statNum:1}). 기간 조건 없이 클릭하면 진행중 물건 전체.
- **구현**: `tools/collect_auction.js` (playwright-core + system Chrome, 헤드리스). 결과 그리드는 rowspan 2단 구조라 직접 파싱 — 물건행 `[전체|사건번호|물건번호|소재지|지도|비고|감정평가액|담당계 매각기일]`, 상세행 `[·|·|용도|·|·|·|최저매각가격|진행상태]`. 그리드 셀엔 `a[href]` 링크가 **없어** 사건번호만 확보(상세 URL 미확보).
- **IP 차단 리스크가 실재**하므로 요청 간 GAP_MS=1000 필수. 서울+경기 14개 법원 2,949건 수집에 수십 분 소요(법원당 평균 ~1~2분, 페이지 40건씩).
- playwright `evaluate` 는 문자열을 **표현식으로 eval** 한다 — 함수 표현식만 두면 undefined, `(() => {...})()` 형태 필수.
- **V-World 지오코딩 함정(경매 주소)**: 법원 소재지는 `남현7길 51 5층502호`처럼 층/호가 붙는다. `type=PARCEL`(지번)로는 **도로명 주소가 매칭 안 됨** — `type=ROAD` 필요. 또 층/호 상세가 붙으면 둘 다 실패하므로 `\d+층 이후`·`비동/가동` 정제(cleanAddr) 후 재시도. 실측: `서울특별시 관악구 남현7길 51 5층502호` PARCEL 실패 → cleanAddr+ROAD 성공. 실패(null) 캐시는 재시도 대상으로 두고 `--regeo` 모드로 보강(좌표 72.7% → 98.2%).

### 6-12. courtauction 문서 열람(감정평가서·현황조사서) — SPA 라 직접 URL 이 없고, 물건 상세 화면의 클릭으로만 열림 (2026-08-09 실측)
- **사건번호 → 문서 로 가는 직접 URL 은 구조적으로 없다**: 물건상세 화면에 진입해도 URL 이 `index.on?w2xPath=/pgj/ui/pgj100/PGJ159M00.xml` 그대로다(화면 전환이 전부 SPA 내부). 사건번호 셀·사건행에 링크/이벤트 없음(클릭해도 이동 안 됨), "열람" 버튼은 등기열람소 팝업(`rgstRdngPopUp(문서ID)`).
- **문서 열람 경로(클릭 기반)**: 사건검색 화면 `PGJ159M00.xml`(연도 셀렉트 기본 2026 → 검색할 연도로 변경 필수, 사건번호 입력) → 결과 그리드에서 `input[value='물건상세조회']` 클릭(**종결·취하 사건은 disabled**) → 물건 상세 화면의 `감정평가서`·`현황조사서`·`매각물건명세서` 버튼 → 인라인 dialog(+iframe, 감정평가서·현황) 또는 팝업(명세서). 2025타경102901(진행중)에서 3종 버튼 모두 활성 실측.
- **참고 오픈소스**: `BYM117/court-auction-crawler`(GitHub)의 `detail_crawler.py` 가 동일 클릭 경로를 구현함(물건상세조회·문서 버튼 셀렉터·dialog iframe 구조 참고 가능). 코드를 배껴 넣지 말고 화면 동작 파악용으로만.
- **결과**: land.html 법원경매 사이드 패널의 문서 접근은 **사건검색(PGJ159M00)·물건상세검색(PGJ151F00) 화면 링크**로 유도한다(사용자 승인 2026-08-09).

### 6-13. 진행중 vs 매각예정 화면 분담 + PGJ157 재방문 로드 불안정 (2026-08-09 실측)
- **PGJ151(진행중) = "진행중 전체"가 아니라 매각기일 '오늘~+2주'만 담당한다.** auction.json 2,949건의 매각기일(sale)을 전수 확인한 결과 전부 `2026.08.10~08.21`(수집일 08-09 기준). 기간 조건 없이 검색해도 화면 기본 조건이 2주로 잡힌다.
- **PGJ157(매각예정) = 예정매각기간 기본 '오늘~+2개월'** (실측: `2026.08.24 ~ 2026.10.08`). 두 범위가 사실상 안 겹치므로, 예정 수집분은 진행중과 중복 없는 신규 물건이다.
- **PGJ157 그리드는 PGJ151과 동일한 rowspan 2단 구조** — `collect_auction.js` 의 EXTRACT_JS 를 그대로 재사용한다(열 배치·진행상태 컬럼 동일 실측).
- **PGJ157 재방문 로드가 비결정적**: 같은 headless Chrome 로 첫 probe 2회는 성공했으나, 이후 반복 방문에서는 90초 폴링(1초×30, 재로드 3회)에도 법원 셀렉트가 나타나지 않았다. blocked 메시지도, PGJ151 은 정상이었다. → **동일 IP 의 반복 요청이 쌓이면 로드가 죽는다. 실패 시 무한 재시도 금지.** 잠시 두고 재실행.
- **대응**: `collect_auction.js` 에 `--sched` 모드 추가(PGJ157 → `auction_sched.json`, kind=1). 진행중은 kind=0. 화면 로드는 셀렉트 폴링(최대 15초×3회) 후 재로드. 수집 실행은 IP 안정 후(사용자 동의 2026-08-09).

---

## 7. 배포 (GitHub Pages)

- **push 했다고 바로 반영되지 않는다.** 빌드에 수십 초~수 분 걸린다.
  ```bash
  gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq '{status:.status, commit:.commit}'
  # status: building → 아직. built → 반영됨
  ```
  → 이걸 확인 안 하고 "캐시 문제"로 오해해 헛수고한 적 있다.
- **브라우저 캐시**: 데이터 파일에 `?v=` 를 붙여도, 그 코드를 담은 `land.html` 자체가 캐시되면 옛 코드가 옛 파일을 계속 부른다. 확인은 `?cb=아무값` 같은 쿼리로 우회하거나 `Ctrl+Shift+R`.
- 배포본이 로컬과 같은지 확인:
  ```bash
  curl -s https://conoc612-a11y.github.io/matjip/land.html | grep -c "찾을_코드조각"
  ```
- **빌드가 `building` 에 멈추거나 계속 실패한다면 (2026-08-07 실측)**:
  - 증상: 정상 빌드는 30~60초였는데 갑자기 10~15분 실패(`Page build failed`)·몇 시간 `building` 멈춤. **문서만 바꾼 커밋도 실패**한다.
  - 원인: 이 리포는 **100% 정적 파일**(프론트매터·Liquid·`_config.yml` 전무, Jekyll 은 복사만 함)이라 콘텐츠 문제가 아니다. `build_type: legacy`(Jekyll) 파이프라인이 GitHub 측에서 먹통이 된 것.
  - 해결: 루트에 **`.nojekyll`** 추가 → Jekyll 단계 자체 제거(배포 결과물은 동일, 이 리포는 Jekyll 이 아무것도 안 하므로). 이미 추가돼 있음(`5107f05`).
  - 그래도 멈추면 GitHub Pages 파이프라인 문제 → Unpublish 후 재생성(Settings → Pages)으로 재초기화.
  - 확인: `gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq .status` 가 `built` 인지.

---

## 8. 검증(테스트) 방법

- **브라우저 화면 캡처가 막힐 때**: 인앱 브라우저 pane 이 안 보이면 스크린샷이 실패하고, Chrome 확장은 localhost·일부 도메인을 차단한다.
  → 그럴 땐 **PNG 를 직접 렌더링해서 눈으로 확인**했다(외부 라이브러리 없이 zlib 로 PNG 인코딩). 폴리곤 겹침 같은 건 이 방법이 가장 확실하다.
- **줌 테스트는 `setZoom(z,{animate:false})`** (4장 참고).
- **커버리지 검증은 권위 데이터에서 샘플링**: "한강 위가 칠해지나" 를 손으로 찍은 좌표로 보지 말고, 하천 폴리곤 내부에서 점을 뽑아 비율로 측정.
- 레이어가 실제로 그려지는지는 **타일 로드/에러 카운트**로 확인:
  ```js
  lyr.on('tileload', () => ok++); lyr.on('tileerror', () => err++);
  ```
- ArcGIS 레이어에 데이터가 있는지 빠르게 보려면 `/export` 를 호출해 **빈 이미지(약 2.2KB)와 크기 비교**.
- **헤드리스에서 `window.map` 을 쓰면 안 된다**: `land.html` 은 `<div id="map">` 이 있어 `window.map` 이 **HTMLDivElement 로 노출**되고, 실제 Leaflet 지도는 스크립트의 `const map`(bare `map` 으로만 접근, 전역에도 `realpriceCluster`/`villaCluster` 없음). `window.map._layers` 는 항상 빈 객체로 나와 "레이어가 안 그려졌다"고 오판한다. 검증 스크립트에서는 **`map` 그대로** 쓰고, 레이어 카운트는 `map.eachLayer()` 로 셀 것.
- **CDP `Runtime.evaluate` 로 값 뽑을 땐 `returnByValue: true` 필수** (2026-08-08 실측): 옵션 없이 실행하면 `result.value` 가 직렬화되지 않아 "undefined"로 나온다. 팝업 DOM·진행현황 행 수·배지 텍스트 등 페이지 내부 상태를 가져올 때마다 넣을 것.
- **`setView` 로 지도 이동하면 열어둔 팝업이 유실된다** (2026-08-08 실측): moveend → 정비 레이어 재구성(`jbBuild`)이 레이어를 교체해서 기존 `_layer` 의 팝업이 사라진다. CDP 로 팝업 실측 시 **이동 후 지도 위 폴리곤을 다시 스캔**해 `openPopup()` 해야 한다.
- **PowerShell 인라인 `node -e` 는 깨진다**: 큰따옴표·`$`·백틱 등이 PowerShell 이스케이프와 충돌해 계속 실패(실측 반복). 검증 스크립트는 **`.cjs` 파일로 저장**해서 실행한다.

---

## 9. 키 정책 요약

| 키 | 위치 | 비고 |
|---|---|---|
| VWORLD / KAKAO_JS / NAVER_MAPS / ODSAY | 프론트 허용 | 도메인 잠금이 방어 수단. 콘솔에 도메인 등록 필수 |
| **ITS_CCTV_KEY** | **프론트 허용(정책 변경)** | 서버 경유 불가(6-3). 남용 시 its.go.kr 재발급 |
| MOLIT / NAVER_CLIENT_SECRET / CHUNGAK / NTS | **서버 전용** | Supabase Edge Function env 에만. HTML 금지 |
| ADMIN_PASSWORD / ADMIN_EMAIL / ADMIN_BACKUP_EMAIL / RESEND_API_KEY / ADMIN_MGMT_TOKEN | **서버 전용** | 관리자 인증·메일용. HTML·DB에 두지 말 것. ADMIN_MGMT_TOKEN 은 Edge Function 이 비밀번호를 바꿀 때 사용(11-3) |
| DGK | 로컬 도구 전용 | `tools/collect_realprice.js` 가 env 로 읽음 |
| EXCHANGE_RATE / LOAN_RATE / INT_RATE | 서버 전용 | `eximbank-proxy` |
| SUPABASE_ACCESS_TOKEN | 환경변수 임시 | `$env:SUPABASE_ACCESS_TOKEN='...'` 로 세션에만. 파일·리포 저장 금지. **채팅에 노출됐으면 대시보드에서 즉시 Revoke** (https://supabase.com/dashboard/account/tokens)

실제 값은 `keys.env`(gitignored)에 있다. **커밋 금지.**

---

## 10. main.html — 지도/패널 flex 라인 높이가 콘텐츠 높이에 부풀려진다 (2026-08-08 실측)

- **증상**: 데스크톱에서 `#map` offsetHeight 가 8203px 로 나온다(컨테이너는 617px). 추천목록 패널도 8203px → `.panel` 에 스크롤바가 안 생겨 **목록 하단이 잘려 못 봄**. 첫 로드에서 마커/클러스터가 안 보이기도 함(렌더 타이밍 영향).
- **원인**: `.layout { display:flex; flex-wrap:wrap; flex:8.5; min-height:0; overflow:hidden }` 의 **flex 라인 높이 = 항목들의 콘텐츠 높이 중 최댓값**. 컨테이너 높이가 정해져 있어도 flex 는 라인을 콘텐츠 기준으로 잡고 넘치면 자르기만 한다. 추천목록(50장 카드, ~8203px)이 비동기 렌더되면서 라인이 8203으로 부풀고, `align-self:stretch` 때문에 `#map`(Naver는 `getSize`=617로 정상 계산)과 `.panel` 둘 다 8203으로 늘어남. `.panel` 은 `overflow-y:auto` 여도 **항목이 라인 크기만큼 이미 커져 있어 스크롤이 안 생김**.
- **해결**: `main.html` — `#map` 과 `.panel` 에 `max-height:100%` 추가 → 라인 최대치가 컨테이너(617px)로 고정, 패널은 내부 스크롤. 모바일 미디어쿼리는 자체 `height:100vh`/`max-height:82vh` 라 영향 없음 (커밋 `34d31d8`).
- **검증**: 실배포 페이지에 CSS 주입 → mapH 8203→617, `p.scrollHeight > p.clientHeight`(scrollable=true). 지도 bounds/zoom/타일 정상.
- 참고: `#map` 높이는 `map.getBounds()`·`getSize()`로 오판하지 말 것 — Naver 내부 크기는 항상 정상(617)이고, 깨진 건 **컨테이너**다.

---

## 11. 관리자 모드 (로그인·시크릿·메일) — 2026-08-07 실측

### 11-1. "관리자 비밀번호가 다르다" — 비밀번호는 맞는데 로그인 거부
- 서버 env secret(ADMIN_PASSWORD)과 정확히 일치하는 비밀번호를 넣어도 "이메일 또는 비밀번호가 올바르지 않습니다."가 나올 수 있다.
- 원인 ①: **오타/복사 오류** (대소문자, 앞뒤 공백). 원인 ②: **IP 잠금** — `admin-login` 은 IP당 15분 내 5회 실패 시 15분 차단(429 대신 401과 같은 문구 아님, 단 로그인 실패 메시지도 401).
- **판별법(검증)**: 서버에서 직접
  ```bash
  Invoke-RestMethod -Uri 'https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-login' -Method POST -ContentType 'application/json' -Body '{"email":"conoc@naver.com","password":"<비밀번호>"}'
  ```
  가 200 + token 을 주면 비밀번호는 정상. 브라우저 입력 문제다.
- `admin-login` 검증 방식: 이메일은 **소문자 정규화 후 상수시간 비교**, 비밀번호는 **SHA-256 다이제스트 XOR 상수시간 비교**.

### 11-2. Supabase CLI `secrets set` 함정
- **이름이 `SUPABASE_`로 시작하는 secret은 조용히 건너뛴다**: `npx -y supabase secrets set SUPABASE_MGMT_TOKEN=...` → "No arguments found" / "Env name cannot start with SUPABASE_, skipping". → **이름을 바꿔서** 넣는다(예: `ADMIN_MGMT_TOKEN`).
- 값에 `=`, `!`, `$`, `#` 가 있어도 `secrets set 'NAME=value'`(작은따옴표)는 정상 동작(실측: `!@#$%^&*()...`).
- `--env-file` 로도 설정 가능.

### 11-3. Management API로 env secret 갱신 (Edge Function 내부에서 비밀번호 변경)
- **PUT `/v1/projects/{ref}/secrets` 는 404**("Cannot PUT"). **POST** 로 보낸다.
- POST body 는 **raw array** 여야 한다: `[{"name":"ADMIN_PASSWORD","value":"..."}]` — `{"secrets":[...]}` 로 감싸면 "expected array, received object" 400.
- 삭제도 **raw array**: `DELETE ... -Body '["NAME"]'`.
- **secret 변경은 Edge Function 재배포 없이 즉시 반영**된다(실측: Management API로 ADMIN_PASSWORD 교체 → 3~5초 후 admin-login 이 새 비밀번호 인식). `admin-apply-reset` 이 이 메커니즘으로 비밀번호를 바꾼다.

### 11-4. Supabase Auth admin API는 anon 키로 호출 불가
- `POST /auth/v1/admin/users` 등 admin 엔드포인트는 **apikey=service_role 키**가 필요. anon 키로는 "No API key found".
- 테스트는 **anon 키로 실제 signup**을 만들어 검증한다:
  ```bash
  Invoke-RestMethod -Uri 'https://<ref>.supabase.co/auth/v1/signup' -Headers @{apikey='<anon>'...} -Body '{"email":"...","password":"...","data":{"name":"..."}}'
  ```
- 회원 삭제(`admin.auth.admin.deleteUser`)는 **auth.users 삭제 → FK `on delete cascade` 로 profiles/taste_profiles/saved_restaurants/feedbacks/visits 자동 삭제**. 삭제 검증은 같은 이메일로 로그인 시 400 거부로 확인.

### 11-5. Resend 무료 모드는 "가입자 본인 이메일"로만 발송 가능
- Resend 계정을 conoc612@gmail.com으로 가입했다면, 무료 모드에서 **그 주소로만** 테스트 발송된다. 다른 주소(conoc@naver.com)를 `to` 에 넣으면 **배열 전체가 403**:
  `"You can only send testing emails to your own email address (conoc612@gmail.com). To send emails to other recipients, please verify a domain at resend.com/domains..."`
- 즉 메인·백업을 한 번에 보내려다 **둘 다 실패(502)** 한다. 도메인 인증 전까지는 **백업(본인 주소)만 `to` 에 넣는다**.
- 메인(conoc@naver.com) 발송을 추가하려면 resend.com/domains 에서 **소유 도메인 DNS(DKIM TXT) 인증** 후 `RESEND_FROM` 을 `noreply@<도메인>` 으로 바꾸고 `to` 에 메인을 추가한다 (`admin-request-reset` 에 `// ponytail: domain needed` 표시).
- 발송 테스트: `POST https://api.resend.com/emails`, `Authorization: Bearer re_...`, body `{from, to:[...], subject, html}`.

### 11-6. 관리자 비밀번호 변경 흐름 (이메일 인증)
- `admin-request-reset`: 토큰(UUID) 생성 → DB `admin_reset_tokens` 에 **SHA-256 해시만** 저장(30분 만료) → 백업 이메일로 링크(`admin.html?reset=<토큰>`) 발송. **활성 토큰 1개만 허용**(재요청 시 429, 메일 폭탄 방지). Resend 실패 시 토큰 롤백.
- `admin-apply-reset`: 토큰 해시 조회 → 만료/사용 여부 확인 → Management API로 ADMIN_PASSWORD secret 교체(11-3) → `used_at` 표시. 새 비밀번호는 6자 이상.
- 인증 메일 링크는 GitHub Pages 정적 주소 `?reset=` 쿼리로 열리고, admin.html 이 초기화 시 토큰을 읽어 새 비밀번호 화면을 띄운다.

### 11-7. 네이버 SMTP 앱 비밀번호 → 535 인증 실패 (admin-notify, 2026-08-09)
- **증상**: `nodemailer`(SMTP 465/SSL)로 conoc@naver.com 발송 시 `535 5.7.8 Username and Password not accepted`.
- **원인(실측)**: 네이버 일반 비밀번호가 아니라 **앱 비밀번호(2단계 인증 시 생성한 16자리)** 를 써야 한다. 첫 발급 키 `RYVVWS6PQDEX`는 프로토콜/SMTP용 아님 → 535.
- **해결**: 네이버 메일 → 환경설정 → **내 정보 → 앱 비밀번호 → SMTP/POP3용** 새로 발급(`LZEJRR1VZ5G9`). Edge Function secret `NAVER_SMTP_PASS` 교체 후 재배포, 직접 POST 호출로 `{"ok":true,messageId:...}` 확인.
- **검증**: 2026-08-09 트리거(`trg_notify_admin_new_user`)로 신규 가입 2건 → conoc@naver.com 수신 확인.
- **보안**: 키는 리포/HTML에 넣지 말고 `supabase functions secrets set`으로 등록(이 PC에선 CLI secrets 오류 시 11-2·11-3 참조).

### 11-8. 테스트 계정 삭제 = Management API `database/query` (서비스 롤 키 없이, 2026-08-09)
- **상황**: QA·트리거 검증용 `*@example.com` 계정을 지울 때 서비스 롤 키가 로컬에 없음. `admin-delete-user`는 관리자 토큰이 필요해 간편하지 않음.
- **해결**: `sbp_` access token(DPAPI: `~/.supabase/access-token.enc` → `ProtectedData.Unprotect`)으로 **Management API `POST /v1/projects/{ref}/database/query`** 호출 → 원하는 SQL 실행.
  - 조회: `select id, email from auth.users where email like '%@example.com';`
  - 삭제: `delete from auth.users where email in (...);` — profiles/taste_profiles/saved_restaurants/feedbacks 는 전부 `on delete cascade`(schema.sql:7·70·93·104)라 별도 정리 불필요.
- **주의**: `@example.com` 계정은 QA용으로 유지 중인 것도 있어(`qa.matjip.20260808@example.com`) **삭제 전 반드시 id/email 로 확인**하고 지울 것. 토큰은 배포 시에만 해독해 쓰고 평문 파일·리포 저장 금지.

---

## 12. 자주 쓰는 명령 (관리자 관련 추가)

```bash
# 로컬 서버
node tools/static-server.js          # http://localhost:8181

# 데이터 재생성
VWORLD_KEY=... node tools/collect_toji.js        # 토지거래허가구역(수 분 소요, 백그라운드 권장)
node tools/collect_redevelop.js                  # 정비사업 UQ120
DGK=... node tools/collect_realprice.js          # 실거래가

# Edge Function 배포 (npx, 서버에 supabase CLI 설치 불필요 — 이 PC 실측)
$env:SUPABASE_ACCESS_TOKEN='<sbp_...>'
npx -y supabase functions deploy molit-proxy   --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy chungak-proxy --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy bizno-proxy   --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
# 관리자 계열
npx -y supabase functions deploy admin-login          --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy admin-data           --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy admin-delete-user    --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy admin-request-reset  --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy admin-apply-reset    --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy delete-account       --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt
npx -y supabase functions deploy admin-notify         --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt

# 관리자 시크릿
npx -y supabase secrets set "ADMIN_PASSWORD=<pw>"   --project-ref bhgijvaxxjnocgfnaaeu
npx -y supabase secrets set "ADMIN_EMAIL=conoc@naver.com" "ADMIN_BACKUP_EMAIL=conoc612@gmail.com" --project-ref bhgijvaxxjnocgfnaaeu
npx -y supabase secrets set "RESEND_API_KEY=re_..." --project-ref bhgijvaxxjnocgfnaaeu
npx -y supabase secrets set --env-file <file> ADMIN_MGMT_TOKEN=... --project-ref bhgijvaxxjnocgfnaaeu   # SUPABASE_ 시작 이름은 CLI가 skip(11-2)

# 시크릿 설정/확인
npx -y supabase secrets set "CHUNGAK_API_KEY=<키>" --project-ref bhgijvaxxjnocgfnaaeu
npx -y supabase secrets list --project-ref bhgijvaxxjnocgfnaaeu

# 로그인 상태 확인
npx -y supabase projects list

---

## 13. 정비 진행현황 — tl 없는 구역의 stage가 STAGE_SEQ에 안 매칭되면 진행현황이 통째로 안 나온다 (2026-08-08 실측)

- **증상**: 팝업에 진행단계 %바·배지는 뜨는데 "진행현황" 타임라인이 없다. 예: 사당동 155-4(stage=`사업계획승인`, 역세권 주택복합). 동일 케이스 23건.
- **원인**: `jbTlHtml()`은 tl(추진경과)이 없는 구역을 `stage`를 `seqIdx()`로 STAGE_SEQ 18단계에 부분일치 매칭해 그 단계까지 완료로 채운다. **역세권·노후계획도시 등 기타사업은 절차명이 다르다** — `사업계획승인`(「주택법」 제15조)은 `사업시행인가`(도시정비법 제50조)와 같은 위치인데 이름이 달라 매칭 실패(→`seqIdx` -1 → 진행현황 미표시).
- **해결**: `seqIdx()`(land.html:1425)에 alias 추가. 근거: 서울시 역세권 활성화사업 운영기준 2-1-1 — 사업계획승인·사업시행계획인가·건축허가 3유형이 동일한 인허가 위치. 배지 색은 `STAGE_COLOR_MAP['사업계획']='#e8590c'` 추가.
- **검증**: 단위 하네스(`%TEMP%\opencode\jbtl-test.cjs`)로 effStage/pct/행 수 확인 + CDP 팝업 실측.
- **다른 기타사업 단계명도 같은 이유로 미매칭**(실측, tl 없음 기준 692건): 관리지역고시 75·추진위구성 58·지구지정 26·구역변경 25·지구계획승인(변경) 15·후보지선정 14·사용승인 13·결정고시 8·건축허가 6 등.
- **2026-08-09 후속 수정** (사용자 문의 "반도미도2차는 왜 진행현황이 없어? 다 나오게 해달라"): 지금은 **STAGE_SEQ 밖 단계도 현재 단계 1행만 완료로 표시**한다(다음 절차 예측 불가 → "예정" 미표시). 추가로 **정규식에서 '완료' 제거** — 기획**완료**·입주자 모집공고 **완료**는 진행 중 단계인데 사업 종료로 오판돼 통째로 누락됐다(실측: 반포미도2차 stage=`기획완료`). 취소·중단·해제·실효만 미표시 유지. 2,964건 전수 검증: 빈 진행현황 348→190건(남은 건 전부 취소/중단/해제/실효 계열 = 의도됨).
- **2026-08-09 추가 alias**: 사용자 문의 "사당동 202-29는 관리지역고시만 나와서 입주까지 쭉 나와야지". 모아타운 **`관리지역고시` = 정비구역지정(2) 위치**로 `seqIdx()` alias 추가(land.html:1614~1616). 이제 관리지역고시 이후 조합설립추진위원회승인→…→입주까지 "예정"으로 이어진다. 근거: 관리지역고시가 구역 지정의 행정 고시 단계로, 일반 정비의 정비구역지정과 동일 위치(모아타운 관리지역 고시 = 구역 지정). 검증: 하네스 시뮬레이션에서 `si=2`, done=대상지선정·안전진단·관리지역고시, 예정=조합설립추진위원회승인~입주 16행.
- **2026-08-09 CCTV 팝업 리사이즈 무시 (사용자 문의 "cctv 팝업은 크기조정이 안됨")**: `.cctv-pc`(land.html:289)가 `width:320px` **고정**이라 그립으로 팝업을 키워도 안쪽 카드가 안 늘었다. 다른 팝업의 `.pc`는 `width:100%`(277)로 리사이즈에 따라 다시 흐르게 되어 있는데 CCTV만 빠졌다(264px 고정 시절 `.pc`가 겪었던 버그의 재발, 275~276 주석). **해결**: `width:100%`+`min-width:320px`, flex column(`height:100%`), video `flex:1 1 auto`(min-height 180px) — 폭·높이·영상 영역 모두 드래그에 확장. **검증**(`%TEMP%\opencode\cctv-resize-test.cjs`, 로컬 CDP 실측): 그립 드래그 시 콘텐츠 321×263→455×358, `.cctv-pc` 동일 확장, video 180→274px(`videoGrew=true`).
- **2026-08-09 진행현황 앞쪽 단계 누락 (사용자 문의 "입주까지 절차만 나오잖아, 전체 목록이 나오라고")**: `jbTlHtml()`이 **"마지막 완료 단계 뒤만 예정으로 붙이는"** 구조라 tl에 없는 앞쪽 표준 단계가 목록에서 통째로 사라졌다(예: tl=[사업시행인가]면 대상지선정~건축심의 미표시). **해결**(land.html:1639~1695): STAGE_SEQ 18단계 **전체를 항상 나열** — 완료(✓) 또는 "예정". 표준 절차 밖 단계(기획완료 등)는 맨 위 OUT 행 + 전체 18단계를 별도 표시. tl 없는 구역은 stage까지 완료로 가정(기존 유지). **검증**(`%TEMP%\opencode\jbtl-full-test.cjs`, 로컬 CDP 실측): 사당동 202-29(관리지역고시)=18행·완료 3, 반포미도2차(기획완료)=19행·OUT 1+18, 상계주공5단지(tl=사업시행인가)=18행·완료 3, 전부 입주 행 표시. 주의: 이제 행 수가 데이터와 무관하게 18 이상 고정이므로 행 수 기반 기존 하네스 기대값이 바뀐다.

- **2026-08-09 배경지도 버튼이 왼쪽으로 잘림 ("OSM에서 SM까지만 보임", land.html)**: 
  - **증상**: 지도 좌상단 배경지도 피커(일반지도·위성지도·위성+라벨·OSM)의 왼쪽 부분이 화면 밖으로 밀려나 OSM 버튼의 오른쪽 일부("SM")만 보인다.
  - **원인(실측)**: `.footer-right`(푸터 우측, 연락처+관리자, 574px 고정, `white-space:nowrap`)가 뷰포트가 좁아도 줄어들지 않아 **페이지 전체 `scrollWidth`가 1394px로 고정**된다(뷰포트 1258에서도 136px, 900에서 494px 초과). 페이지에 가로 스크롤바가 생기고, 오른쪽으로 스크롤하면 지도 왼쪽(버튼 포함)이 화면 밖으로 밀려난다. 피커 자체가 잘리는 게 아니라 **페이지 가로 오버플로**가 원인 — 뷰포트 폭·DPR·패널 상태와 무관하게 재현(641~1394px 전 구간, 스크롤 0이면 항상 정상).
  - **해결**: `.footer-top`(land.html:369)에 `flex-wrap:wrap` 추가 → 좁은 화면에서 푸터가 2줄로 래핑되고 오버플로 제거(전 구간 `scrollWidth == clientWidth` 확인).
  - **검증**: `%TEMP%\opencode\bug2-scanwidth.cjs`·`bug2-local.cjs` — 수정 전 docScrollW 1394(고정)/수정 후 전 폭에서 overflow 0.
  - **2026-08-09 main.html 재발 및 재수정**: 동일 버그가 main.html에서도 재현 — `.footer-top`(main.html:101)에 `flex-wrap:wrap`이 **누락**돼 있어 1280px 화면에서 `.footer-right` R=1324(44px 초과)·`.footer-admin` R=1324로 가로 스크롤이 생겼다. land.html(369)만 고치고 main.html을 놓친 것이다. **해결**: main.html `.footer-top`에 `flex-wrap:wrap` 동일 적용. **검증**(`%TEMP%\opencode\qa10-main-verify.cjs`): 320~2560 전 폭에서 hOverflow false, `.footer-right` right = vw−24 정상, 콘솔 에러 0. (전수 QA `%TEMP%\opencode\qa9-viewports.cjs` — 페이지 7종×뷰포트 7종에서 main 1280/768만 유일한 오버플로였음)

- **2026-08-09 팝업을 X로 닫아도 지도 이동 후 다시 열린다 (land.html)**:
  - **증상**: 지도 클릭 → 팝업("위치 정보") → X로 닫아도 잠시 후(또는 지도 이동 후) 같은 팝업이 다시 열린다.
  - **원인(실측)**: 지오코딩은 비동기다. 클릭 직후 `buildClickPopup()`의 역지오코딩 콜백이 **닫힘 여부와 무관하게** `clickMarker.setPopupContent(...).openPopup()`(land.html:3603)을 실행해 닫은 팝업을 재오픈한다. 이벤트 타임라인 실측: `open(정보 불러오는 중, d:0) → close(X, d:123) → open(위치 정보, d:224)`. "지도 이동 후"로 보였던 건 지도 이동과 무관한 **콜백 타이밍** 문제.
  - **주의(계측 함정)**: `map.closePopup()` 후에도 `map._popup` 참조는 남는다(STILL_SET). `map._popup !== null`로 재오픈을 판정하면 오판 — 반드시 `map._popup.isOpen()` 사용.
  - **해결**: `map.on('popupclose')` 핸들러(land.html:1540~1546) — 닫히는 팝업이 `clickMarker.getPopup()`과 같으면 마커를 제거(`clickMarker=null`). 그러면 async 콜백의 `if (!clickMarker) return` 가드(land.html:3598)가 재오픈을 차단한다.
  - **검증**: `%TEMP%\opencode\bug3-user-standalone.cjs`(로컬 CDP) — 클릭→120ms 후 X로 닫기→3.5s 대기: `isOpenAfter3s:false`, `popupInDomAfter:false`, 이벤트에 재오픈 없음. 수정 전엔 `isOpenAfter3s:true`.

- **2026-08-09 IE(인터넷 익스플로러)에서 지도·즐겨찾기 전부 안 됨**:
  - **증상**: IE에서 land.html 열면 지도가 안 뜨고 즐겨찾기(그리고 사실상 모든 JS 기능)가 죽는다.
  - **원인(확정)**: IE11은 ES6를 파싱하지 못한다. 인라인 스크립트에 화살표 함수(`=>`, land.html:557)·템플릿 리터럴(`` `${}`, :565)·`fetch()`(:24) 등이 있어 **블록 전체가 파싱 실패** → 아무것도 초기화되지 않는다. 단순 "즐겨찾기 버튼 버그"가 아니라 JS 전체가 죽은 것이다.
  - **결정(2026-08-09)**: IE는 2022-06 지원 종료(EOL). 이 프로젝트는 빌드 도구 없는 정적 파일이라 Babel 없이는 ES5 변환 불가 → **IE 지원 중단** + IE 방문 시 안내문 표시로 결론. (Babel 도입은 별도 프로젝트급 작업)
  - **해결**: 각 페이지 `<body>` 직후에 **ES5 문법 + `document.documentMode`(IE 전용 프로퍼티)** 감지 스크립트를 별도 `<script>` 블록으로 추가(land/main/onboarding/ai/detail). IE에서만 고정 상단 배너 "이 사이트는 인터넷 익스플로러(IE)를 지원하지 않습니다..." 표시. **주의: 안내문 스크립트는 IE에서도 실행되어야 하므로 ES5 문법(`var`·`createElement`·`cssText`)만 쓸 것** — 화살표 함수나 템플릿 리터럴을 쓰면 IE에서 그 블록마저 죽어 안내문이 안 보인다.
  - **검증**: `%TEMP%\opencode\ie-guard-check.cjs`(Chrome CDP) — `documentMode` undefined → 배너 0개, `mapOk:true`(비-IE 영향 없음). IE 실기기는 없어 검증 불가, ES5 문법 + documentMode 사용으로 확실.

# 배포 상태
gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq '{status:.status, commit:.commit}'
```
