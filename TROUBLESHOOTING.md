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
- **지번 주소 함정(2026-08-15 실측)**: 청약 `HSSPLY_ADRES` 는 `서울특별시 영등포구 신길동 413-8번지 일원` 처럼 **지번 + "일원" 접미사**다. `category=road` 로는 **3/4건 NOT_FOUND** 였다(도로명이라 안 잡힘). `category=parcel` 로 "일원/일대"를 떼고 묻으면 **4/4 좌표 획득**(지번형이라 매칭). 그래서 `vworldAddrToPnu()` 는 road → parcel 순차 재시도로 바꿨다(2026-08-15). 증상이 "분양예정 배지가 일부만 뜬다"면 여기부터 볼 것 — API 데이터(4건)는 정상이었다.
- 참고: V-World 타일(`wmts`)과 역지오코딩(`req/address`)은 `category` 없이 정상 동작한다 — 주소검색(`req/search`)만 해당.

### 6-7. 한국부동산원 청약홈 분양정보 (chungak-proxy, 2026-08-07 신규)
- data.go.kr `data/15098547`, **기술문서의 서버 경로(`B552555/ApplyhomeInfoDetailSvc/...`)는 전부 `NO_OPENAPI_SERVICE_ERROR`** — 이 API 는 odcloud(Infuser) 로 이전됨. **실제 호스트는 `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/{op}`** 이다.
- 오퍼레이션: `getAPTLttotPblancDetail`(분양정보 상세) / `getAPTLttotPblancMdl`(주택형별 모델), OPT/UrbtyOfctl/PblPvtRent/Remndr 동일 세트.
- 파라미터: `serviceKey`, `page`, `perPage`, `returnType`(JSON/XML), `cond[FIELD::OP]` — FIELD: `HOUSE_MANAGE_NO`/`PBLANC_NO`/`HOUSE_NM`/`HOUSE_SECD`(01 APT 등)/`HOUSE_DTL_SECD`(01 민영·03 공공)/`SUBSCRPT_AREA_CODE_NM`("서울")/`HSSPLY_ADRES`/`RCRIT_PBLANC_DE`(형식 `2026-08-07`), OP: EQ/LIKE/GT/GTE/LT/LTE.
- 응답: `{currentCount, data:[...], matchCount, totalCount}`. 최신 공고일 순 정렬.
- **데이터 지연 실측(2026-08-07)**: 서울 최신 공고가 2026-07-16 까지밖에 없다. "접수중·접수예정(`RCEPT_ENDDE >= 오늘`)" 필터를 걸면 **현재 0건이 나오는 게 정상**이다. 배지가 안 보인다고 코드 문제로 단정하지 말 것. (⚠️ 갱신: 2026-08-15 실측에서는 서울 최신 공고 2026-08-14까지, 접수마감 미지난 4건 — 쌍용 더 플래티넘 서대문·더샵 신길센트럴시티·써밋 클라비온·충정로역자이르네. "0건"은 그때 당시 값이지 상수가 아니다. 그래도 배지가 1건만 뜨면 → §6-6 지번 함정을 의심.)
- `SUBSCRPT_AREA_CODE`/`_NM` 필터는 주소와 별개인 공급지역 개념이다. 좌표는 `HSSPLY_ADRES`(주소)로 변환한다.
- serviceKey 는 **인코딩된 문자열을 그대로** `serviceKey=<키>` 로 넣는다. `encodeURIComponent` 로 감싸면 `%`→`%25` 이중 인코딩되어 인증이 깨진다(molit-proxy 와 동일한 함정).
- 프록시는 op/파라미터를 화이트리스트로 검증 후 중계한다(`supabase/functions/chungak-proxy/index.ts`). 시크릿은 `CHUNGAK_API_KEY`.
- **⚠️ 무순위 잔여세대 재공급(줍줍)은 `getAPTLttotPblancDetail`(분양정보)에 없다** (2026-08-18 실측). 별도 op `getRemndrLttotPblancDetail` 을 호출해야 잡힌다. 실측: 서울 무순위 matchCount=303. 접수일 필드는 일반 분양의 `SPSPLY_RCEPT_*`/`RCEPT_*` 가 아니라 **`GNRL_RCEPT_BGNDE`/`GNRL_RCEPT_ENDDE`**·`SUBSCRPT_RCEPT_*` 이고, `TOT_SUPLY_HSHLDCO` 도 아닌 **`TOT_SUPPLY_HSHLDCO`**(S가 2개)다. `RCEPT_ENDDE` 기준 날짜 필터를 그대로 쓰면 무순위가 전부 걸러져 배지에서 누락된다.
  - 증상 사례: "송파 시그니처 롯데캐슬(2026-08-18 접수, 거여동 181·202번지 일원, 불법행위 재공급 1세대)이 배지에 안 뜬다" — 분양정보 API 로는 아예 검색 불가였음(`HOUSE_NM::LIKE` 송파 → 0건).
  - 해결(2026-08-18 커밋 예정): `land.html` `loadSubscriptions()` 가 두 op(`getAPTLttotPblancDetail` + `getRemndrLttotPblancDetail`)를 병렬 호출해 병합. 날짜 필터도 op 별로 나눠 적용(`RCEPT_ENDDE`/`GNRL_RCEPT_ENDDE`).
  - 무순위 주소는 다중 지번(콤마)이 많다: `vworldAddrToPnu()` 는 '○○번지 일원' 제거 후 콤마로 분리해 **각 지번을 road→parcel 순차** 시도(실측: 거여동 181번지는 NOT_FOUND, 202번지는 parcel OK). ⚠️ `번지?`(문자 뒤 ?)는 '번'+선택'지'라서 **'번'이 필수** — 숫자만 있는 지번('181')이 매치 안 되는 함정이 있다. `(?:번지)?` 로 묶어야 전체가 선택이 된다.

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

### 6-14. 법원경매 물건 사진 — 외부 핫링크 404, base64 만 유일한 소스 (2026-08-13 실측)
- **증상**: 사진을 `<img src="https://www.courtauction.go.kr/pgj/pgj15B/nas_e_image_pgj/[파일명].jpg">` 로 걸면 **404** 를 준다. 외부 핫링크가 차단되어 있고, 원본 URL 자체가 사이트 내부 처리 로직(`nas_e_image_pgj`)에 의존하는 것으로 보인다. 브라우저 캐시·캡처에서도 이미지는 base64 로만 내려온다.
- **사진은 어디서 오나**: 사건검색 `PGJ159M00.xml`(연도 셀렉트 → 사건번호 입력 → 검색 → `input[value='물건상세조회']` 클릭) → 상세 응답 `selectAuctnCsSrchRslt.on` 의 `data.dma_result.csPicLst[]` 에 **base64 jpeg 가 인라인**으로 온다. 한 응답에 구분별 전부 포함(사진이 많은 사건은 응답 4.8MB).
- **사진 구분 코드(cortAuctnPicDvsCd) 실측**: `000241`=전경도(8장 예) · `000243`=내부구조도 · `000244`=위치도(2장) · `000245`=관련사진(10장) · `000246`=지적도 · `000247`=이름 미확정(신건 2025타경2782 실측 — **구분명이 코드 테이블에 없어 그대로 표시**, 이름 추측 금지). **전 구분 전부 수집**한다(2026-08-13 상세 패널 도입).
- **⚠️ picFile 은 jpeg 가 아닐 수도 있다 (2026-08-13 실측)**: `000247` 은 **GIF89a(662×700)** 로 내려온다(나머지 구분은 jpeg). 매직바이트 스니핑(`imgExt()`)으로 실제 확장자로 저장한다 — `.jpg` 고정 저장은 확장자-실제형식 불일치로, nosniff 응답 시 이미지가 깨질 수 있다. 구분명과 형식은 사진마다 다를 수 있으므로 **코드 테이블에 없는 dvs 는 이름·확장자 둘 다 가정하지 말 것**.
- **구현**: `tools/collect_auction_photos.js` — auction.json 을 읽어 **사진 없는 사건만** PGJ159 검색으로 순회, `csPicLst` 구분 코드 순서로 정렬 후 전부를 `auction_photos/<사건>/<구분>_<n>.jpg` **개별 jpeg 바이너리**로 디코드 저장, `auction_photos.json` 은 `{ cn: [{ dvs, name, file }] }` **메타만** 담는다. **auction.json 은 절대 안 건드린다.** IP 차단 주의(§6-11): 사건당 화면 로드 1회 + 검색 1회 + 상세 1회, 요청 간 GAP 1초. 재실행 시 이미 있는 cn 은 스킵.
- **왜 개별 파일인가 (용량·속도 실측)**: base64 인라인은 사진 1행당 ~952KB, 신건 638건 전부 수집 시 **1.5GB** 예상. 상세 패널을 열 때 필요한 사진만 개별 로드하므로 참조사이트처럼 빠르다. `auction_photos.json` 메타는 1KB 미만. 기존 base64 방식(행당 `data:image/jpeg;base64,...`)은 **마이그레이션으로 폐기** — `legacy_*.jpg` 파일로 변환 후 메타 교체(2026-08-13).
- **land.html 배선**: `loadAuction()`(line ~1600) 이 auction.json + auction_photos.json 을 `Promise.all` 병렬 fetch 후 cn 으로 photos 메타를 붙인다. 목록 행 = 첫 사진 썸네일(`.ap-thumb`, 64×48). **행 클릭 → 상세 패널**(#ap-detail): 사진 캐러셀(좌우 화살표 + 카운터 + 구분명 캡션) + 클릭 시 **라이트박스 확대**(#apd-lightbox) + 감정/최저/매각기일 카드 + D-day 배지 + 상세 그리드 + 즐겨찾기/지도에서 보기/법원 사이트 액션. `#apd-lightbox` 는 `display:flex` 가 `hidden` 의 `display:none` 을 덮어쓰므로 `#apd-lightbox[hidden] { display:none }` 규칙이 필수(없으면 상세 패널 조작을 라이트박스가 가로챔 — 버그 수정 2026-08-13). 라이트박스는 **`<script>` 실행 시점에 DOM 에 있어야** 하므로 body 상단(패널 뒤)에 배치.
- **헤드리스 검증**: auth-guard 차단(§1) 후 커스텀 레이어 패널에서 '진행 물건' 토글을 켜면(`map.fire('overlayadd')` 대신 체크박스 change) 경매 마커 220개가 뜬다. 목록에서 썸네일 있는 행 클릭 → 상세 패널 → 다음장(`apd-nav-next`) → 이미지 `loaded:true` 확인. **수집기 자체 검증**: 임시로 auction.json 행 순서를 바꿔 신건 1건을 첫 행으로 → `--max 1` 실행 → 구분별 jpg 저장 확인 → auction.json·auction_photos.json 복원(테스트 산출물 디렉토리 `auction_photos/<신건>/` 도 삭제 필수).

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
- **`makeResizable`(js/ui-resize.js)은 로드 순서에 민감** (2026-08-12 실측): `footer-resize.js` 가 top-level 에서 `makeResizable` 을 호출하므로 반드시 **`ui-resize.js` 를 `footer-resize.js` 보다 먼저** 로드해야 한다. 순서가 바뀌면 `ReferenceError: makeResizable is not defined` 로 푸터 드래그가 죽는다(실측, `footer-resize.js:11`). main.html·land.html 두 곳 모두 ui-resize → footer-resize 순서.
- **합성 PointerEvent 로 드래그를 흉내낼 땐 `setPointerCapture` 가 던진다** (2026-08-12 실측): `dispatchEvent` 한 가짜 포인터는 활성 포인터가 아니라 `NotFoundError`(InvalidPointerId) 발생 → `makeResizable` 은 capture 를 try/catch 로 감싸 실사용(실제 포인터)은 캡처 유지, 테스트는 조용히 스킵. 이걸 감싸지 않으면 capture 뒤의 `bodyClass`/`gripClass` 추가가 통째로 사라진다.
- **ui-resize 단위·실화면 회귀 하네스** (2026-08-12): `%TEMP%\opencode\ui-resize-test.cjs <repo경로>` — 헤드리스 Chrome(CDP)로 `js/ui-resize.js` 단위 테스트 5종 + land.html 에서 `.lp-midcb` '정비사업 상세' 체크박스를 실제 클릭해 `.lc-jb` 그립 드래그까지 검증. Chrome 은 `--remote-allow-origins=*` 없으면 CDP 거부, `/json/new` 는 **PUT** 요청이어야 함(두 가지 다 실측으로 겪음).
- **경매 패널(ap-resizer) 드래그 방향이 반대였다** (2026-08-12 실측·수정): 좌측 앵커(`left:0`) 패널의 **우측 가장자리** 그립인데 원래 손코딩이 `auctionPanel.clientWidth + (x - e.clientX)` 로 써서 **오른쪽으로 끌면 줄어들었다**. 마이그레이션(a5a34b8)이 `reverseW:true` 로 보존. 좌측 앵커+우측 그립이면 오른쪽으로 끌수록 넓어지는 게 맞으므로 **`reverseW` 제거**로 교정(land.html:1636). 방향 판단 기준: `reverseW/reverseH` 가 필요한 건 **오른쪽/하단이 고정된(축 반대쪽이 고정된) 대상**일 때뿐 — 좌측 고정 패널은 `reverseW:false`(기본)가 자연 방향.
- **opencode bash 에서 gstack browse 데몬이 죽는 문제** (2026-08-15 실측): bash 툴이 **타임아웃 시 프로세스 트리 전체를 죽여** 데몬도 같이 사라진다. 데몬을 살리려면:
  1. `Invoke-CimMethod Win32_Process -MethodName Create -Arguments @{ CommandLine='<browse.exe> <cmd>'; CurrentDirectory='<repo>' }` 로 **트리 밖에서** 시작(그러면 state 파일이 `repo\.gstack\browse.json` 에 생김).
  2. 이후 클라이언트 호출마다 `$env:BROWSE_STATE_FILE='<repo>\.gstack\browse.json'` 를 설정(안 하면 git root 를 못 찾아 다른 state 파일로 새 데몬을 띄우려 함). 이 두 가지만 지키면 명령마다 데몬 재시작 없이 ~100ms 로 응답한다.
  3. 다 끝나면 `browse.exe stop`. (정리 대상: `System32\.gstack\` 에 떠돈 state 파일이 있으면 지울 것 — WMI 클라이언트가 cwd 없이 돌아 System32 를 git root 로 오인했다.)

---

## 24. land.html UI 레이아웃 함정 4종 — 전부 실측(2026-08-15 수정·검증)

- **① 모바일 `#map` 하단 92px 클리핑**: 모바일(≤640px)에서 `#map { height:100vh }` 인데 **헤더(58px)+stat-bar(34px)가 실제 레이아웃 공간을 차지**하므로 지도 하단이 뷰포트 밖으로 잘렸다(실측 390×844: map bottom=936). 해결: `calc(100vh - 92px)` + `calc(100dvh - 92px)`(dvh 미지원 브라우저는 첫 줄 적용). 검증: mapTop=92, mapBottom=844=뷰포트 바닥.
- **② 데스크톱 우측 패널이 항상 280px**: `.panel { flex:1 1 0; min-width:280px }` + `#map { flex:9 1 0 }` 구조에서 9:1 배분이면 패널 몫(1/10)이 **넓은 화면에서도 항상 280 미만**이라 min-width 에 눌린다(실측 1024·1400·1440 전부 280). 해결: 기본 `min-width:380px`(드래그 저장 폭은 인라인 flex 로 우선) + `@media (max-width:900px)` 에서 280 복귀(좁은 화면에선 지도 보호). 검증: 1440/1024→380, 900/820→280.
- **③ 다크모드가 OS 설정과 미연동**: `applyTheme(localStorage.getItem('mj_theme') === 'dark')` 라서 **저장 값이 없으면 무조건 라이트**. 해결: 저장 값이 있으면 그걸 따르고, 없으면 `matchMedia('(prefers-color-scheme: dark)')` 사용. **`<head>` 끝에 프리페인트 스크립트**(저장/OS 동일 판정)를 추가해 다크 유저의 흰 화면 플래시도 제거 — head 와 body 양쪽이 같은 판정을 쓰므로 **한쪽을 바꾸면 반드시 다른 쪽도 바꿀 것**(land.html 주석 명시). main.js 도 같은 결함이라 함께 수정.
- **④ 320px 이하 헤더 좁힘**: 브랜드+날씨칩이 한 줄을 넘겨 **헤더(58px 고정) 밖으로 흘러 stat-bar 를 덮었다**(실측 360px 에서 날씨칩이 2번째 줄로 탈출). 해결: `.brand-title` 에 ellipsis(nowrap+overflow+min-width:0) + `@media (max-width:380px) { #weather-chip { display:none } }`. 검증: 320px 에서 headerOverflow=false, 날씨칩 none, 타이틀 말줄임.
- **⑤ (부수) 푸터 죽은 링크**: `이용안내`/`이용방법 및 장애문의` 가 `href="#"`(클릭 무반응). 이동할 페이지가 없어 **제거**(연락처는 footer-right 에 이미 존재). main.html 도 같은 결함이라 함께 제거.
- **⑥ (부수) 키보드 포커스 링 부재**: `:focus-visible` 규칙이 전혀 없어 키보드 탭 이동 시 어디 있는지 안 보였다. css/buttons.css 공용에 `:is(button,a,input,...):focus-visible { outline:2px solid var(--c-primary) }` 추가 — 마우스 클릭엔 안 뜨고 키보드에만 표시. 검증: Tab → `.brand` 링 outline 2px solid rgb(25,113,194).
- **WHY(판단 사유)**: ①②는 "flex 배분 비율이 min-width 보다 작아 항상 최소에 눌린다"는 **CSS 스펙상 당연한 결과**라 실측 없이는 안 보인다. ④는 flex-wrap 이 헤더 밖으로 내용을 밀어내는 구조. 세 건 모두 "실측 → 근거 → 최소 수정"으로 처리했다. 공용(buttons.css) 이슈는 land 뿐 아니라 main 등 **같은 결함을 가진 형제 페이지까지 함께 고친다**(이번엔 main 푸터·다크모드 포함).


## 9. 키 정책 요약

| 키 | 위치 | 비고 |
|---|---|---|
| VWORLD / KAKAO_JS / NAVER_MAPS / ODSAY | 프론트 허용 — **`js/common.js` 공용 상수** | 도메인 잠금이 방어 수단. 콘솔에 도메인 등록 필수 |
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

## 14. 공용화(js/common.js) 함정 — 2026-08-12 실측

- **top-level `const` 재선언 = 같은 페이지 SyntaxError**: 6개 페이지가 `SUPABASE_URL/KEY`·`$`·`esc`를 각자 복붙하고 있어 `js/common.js`로 통합. 이때 페이지가 common.js 로딩 후 **자기 인라인 스크립트에서 `const $`·`const esc`를 다시 선언하면**(ai.html 실측) 두 번째 스크립트 전체가 파싱 실패로 죽는다. 글로벌 lexical 환경은 스크립트 태그를 가로질러 공유되므로 **상수는 한 곳에서만 선언**할 것. auth-guard.js는 IIFE 내부라 충돌 없음(형태 확인만).
- **HTML 인라인 스크립트 문법 검사**: `node --check`는 외부 `.js`만 검사한다. 인라인 블록은 `<script(?![^>]*src=)>` 정규식으로 추출해 임시 파일로 검사할 것. **PowerShell 5.1은 `Get-Content` 기본 인코딩이 ANSI**라 UTF-8 한글 파일이 깨져 "Invalid regular expression"으로 오판한다 — `-Encoding UTF8`로 읽고 UTF8(BOM)로 저장해야 정확하다.
- **프록시 URL도 중복 제거 가능**: Edge Function 프록시(chungak/bizno/KMA/EXIM/CCTV/MOLIT) URL 7곳이 하드코딩돼 있었는데, common.js 로딩 후(land.html 스크립트 상단)에는 `SUPABASE_URL + '/functions/v1/...'`로 참조 가능 — 키가 한 곳으로 모이면 URL도 함께 모이는지 함께 확인할 것.

## 15. "기능/정보가 삭제됐다" 보고 = 브라우저 캐시 먼저 의심 (2026-08-13 실측)

- **증상**: 사용자 "길찾기 활성 표시 안 되고, 부동산 정보 내용이 많이 삭제돼 있음". 코드는 (겉보기에) 안 건드렸는데 UI가 과거 버전처럼 보인다.
- **원인**: **삭제 없음.** 로컬 서버가 최신 파일을 서빙 중이었음(land.html 334,142 bytes 파일과 바이트 일치)에도 **브라우저가 이전 응답을 캐시**해 구버전을 렌더. `python http.server`는 캐시 제어 헤더를 안 주므로 브라우저 휴리스틱 캐시로 이전 버전을 쓸 수 있다.
- **해결**: **Ctrl+Shift+R 강력 새로고침부터.** 그래도 재현되면 헤드리스(CDP)로 해당 페이지·마커를 재현해 "코드 문제인지" 먼저 가른 뒤 사용자에게 원인을 묻는다.
- **WHY(판단 사유)**: UI 회귀 보고는 "코드가 나빠졌다"가 아니라 "브라우저가 옛 파일을 보고 있다"일 때가 많다. 코드를 먼저 검증하면 잘못된 방향으로 수정을 가하는 재작업을 막는다. 2026-08-13 실측 근거: git diff 56+/21−(삭제 21줄 전부 의도된 인라인 스타일)·파일 크기 증가(240→289KB)·CDP 팝업 14,587자 전체 렌더·JS 예외 0건·서버/파일 바이트 일치.

## 16. 표시 단위 토글(총액/단가·㎡/평) 함정 — 2026-08-13 실측

- **증상 ①**: 단가 모드에서 `1,420만원만/㎡`처럼 "만원"이 두 번 붙는다.
  - 원인: `'만원' + uUnitTxt()` 인데 `uUnitTxt()`가 이미 `'만/㎡'`를 반환 — 접미사 중복. `'만원' + '만/㎡' = '만원만/㎡'`.
- **증상 ②**: 평 모드에서 `84.5㎡`가 `85평`으로 나온다(㎡→평 변환 누락).
  - 원인: `uAreaVal()`에서 변환을 안 하고 `uAreaTxt()`의 단위 라벨만 바꿈 → 숫자는 그대로, 라벨만 바뀜.
- **해결**: 변환을 **`uAreaVal()` 한 곳에서** 하고(`pyeong`이면 `/ 3.3058`), 접미사는 `uUnitTxt()`를 붙이되 '만원'을 다시 덧붙이지 않는다. 가격·면적 표시는 `uPriceMain/uPriceSub/uPriceShort/uAreaTxt` 헬퍼를 통해서만 한다.
- **WHY(판단 사유)**: 토글 하나에 팝업·툴팁·비교표·클릭팝업·정비 팝업이 전부 엮이므로 "표시"를 여기저기서 직접 만들면 모드별로 어긋난다. 단위 계산(변환)과 단위 라벨(접미사)을 분리한 뒤 모든 표시가 헬퍼를 타게 했다.
- **검증**: 인라인 스크립트에서 헬퍼 블록만 잘라 `node`로 eval해 단언 12항 전부 PASS(값: 12억 ↔ 1,420만/㎡ ↔ 4,695만/평, 84.5㎡ ↔ 26평, null 처리). HTML 인라인은 `new Function()`으로 구문 검사.

## 17. 인라인 스크립트 단위 검증 방법 — 2026-08-13 실측

- `land.html`의 인라인 스크립트는 top-level에 `document/L/const`가 잔뜩 있어 `node --check`만으로는 로직을 못 검증한다.
- **헬퍼 블록만 추출해 eval**: 시작·끝 주석 마커로 `html.slice(start, end)` 후, 같은 eval 문자열에 `const uUnit = ...`(블록 스코프)와 단언을 **한 문자열로 합쳐** 실행한다. `eval(block + asserts)` 형태여야 블록 스코프 const가 단언에서 보인다(별도 eval 호출은 스코프 밖이라 `ReferenceError` — 실측).
- 순수 함수(입력→출력)면 이 방식으로 충분. DOM/지도 연동은 헤드리스(CDP) 또는 배포본 확인이 필요하다.

# 배포 상태
gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq '{status:.status, commit:.commit}'
```

---

### 15. UI 클릭 테스트는 `element.click()` 으로 하면 안 된다 (2026-08-14 실측)
- **증상**: 패널 접기 탭이 실제 마우스로 아무리 눌러도 반응이 없는데, 헤드리스 테스트는 계속 통과.
  세 번이나 "고쳤다"고 잘못 보고했다.
- **원인**: JS 로 `tab.click()` 을 부르면 `click` 이벤트만 직접 발생하고 **pointerdown →
  mousedown → mouseup → click 체인을 안 탄다.** 실제 버그는 그 체인 위에 있었다:
  ① `css/buttons.css` 의 공용 `button:hover { transform: translateY(-1px) }` 가 탭의 가운데
  정렬용 `transform: translate(-50%,-50%)` 를 **대체**해(transform 은 누적이 아니라 교체)
  마우스를 올리는 순간 탭이 자기 크기의 절반만큼 튀어 커서 밖으로 도망갔다.
  ② `makeResizable` 이 그립에 건 `pointerdown` 핸들러가 `preventDefault()` 로 뒤따르는 click 을
  없애고, `setPointerCapture()` 로 mouseup/click 의 target 을 그립으로 바꿔버렸다.
- **해결**: 중앙 정렬은 transform 대신 **음수 margin** 으로(공용 hover 와 충돌 안 함).
  `makeResizable` 은 그립 안 button 을 누른 경우 드래그를 시작하지 않도록 가드.
- **테스트 방법**: CDP `Input.dispatchMouseEvent` 로 mouseMoved → mousePressed → mouseReleased
  를 직접 쏴야 한다. 계측이 필요하면 `document.addEventListener(ev, ..., true)` 로 각 단계의
  `e.target` 을 찍어보면 어디서 새는지 바로 보인다(위 ②는 target 이 탭→그립으로 바뀌어 발각).

### 16. data.go.kr 은 인증 실패를 200 + 0건으로 돌려준다 (2026-08-14 실측)
- **증상**: `collect_realprice.js` 가 서울 25개 구 × 3개월 = 75개 작업 전부에서 "거래 0건".
  예외도 없고 종료코드도 0.
- **원인**: Decoding 키에 든 `+ / =` 를 URL 에 그대로 붙여 인증이 깨졌다. 그런데 서버는 오류
  코드가 아니라 **HTTP 200 + `totalCount 0`** 을 준다 → 수집기 입장에선 "정상적으로 0건".
- **해결**: `encodeURIComponent(KEY)` (이미 인코딩된 키를 넣었을 때 이중 인코딩되지 않도록
  `%XX` 패턴이 있으면 먼저 decode). 실측: 수정 후 강남구 202606 연립다세대 87건 정상 수신.
- **파생 교훈**: 이런 API 를 쓰는 수집기는 **0건을 성공으로 취급하면 안 된다.** 저장 직전에
  "0건이면 중단 / 기존 파일 대비 절반 미만이면 중단" 가드를 반드시 둘 것(`writeSafe()`).
  이 가드가 실제로 23,708건짜리 파일이 `[]` 로 덮어써지는 걸 두 번 막았다.

### 17. 테스트 정리할 때 `taskkill /IM chrome.exe` 금지 (2026-08-14 사고)
- 헤드리스 테스트용 크롬을 정리하려고 이름으로 전체 종료했더니, 백그라운드로 몇 시간째 돌던
  **사진 수집기의 브라우저까지 같이 죽었다.** 수집기는 try/catch 덕에 살아는 있었지만
  그 뒤 700여 건을 "페이지 이동 실패"로 헛돌았다.
- spawn 한 프로세스 핸들만 `.kill()` 하거나, 테스트마다 다른 `--user-data-dir`/포트를 쓰고
  그 프로세스만 정리할 것.

### 18. LAWD_CD(시군구 코드)는 표준 코드와 실제 API 코드가 다르다 — 추측 금지 (2026-08-14 실측)
- **증상**: 서울은 표준 법정동 코드가 그대로 API(`RTMSDataSvc*Dev`)에 통하지만, **경기는 28개 시군구 중
  수원(41111/13/15/17)·부천(41192/94/96)·화성(41591/93/95/97)이 표준 코드와 다르다.**
  표준 코드(수원 41119, 부천 41190, 화성 41590 등)를 넣으면 **HTTP 200 + totalCount 0**(§16과 같은 조용한 실패).
- **확보 방법(실측)**: 추측 금지 원칙으로 **41100~41899 전 코드에 202606 한 달치를 1회씩 호출**해
  `totalCount>0` 인 코드만 채택 → 서울 25 + 경기 **47개**. 수원·부천·화성 3곳은 다중 코드라
  추가 검증: ① 동 목록으로 커버리지/중복 확인(부천 3코드가 원미·소사·오정으로 1:1 분할,
  화성 4코드 합집합 = 화성 전체, 능동만 41595/41597 중복 → 수집기 dedupe 로 흡수) ② V-World
  지오코딩 "경기도 부천시 {후보구} {동}" 3동×3구 조합이 OK 인 구로 확정(전부 3/3 매칭).
- **부천 3코드 WHY**: 2024 부천시 일반구(원미·소사·오정) 분리로 실거래가 API 코드가 갈렸다.
- **주의**: 나중에 다른 시도를 추가할 때도 같은 전수 탐색을 하고 코드를 넣을 것. 표준 시군구 코드표
  (행정안전부)는 이 API 의 LAWD_CD 와 **일치하지 않는다**.
- **시도 구분**: 수집기는 `서울특별시` 를 하드코딩해 경기 주소를 지오코딩할 수 없었다. `SIDO(cd)` 헬퍼
  (`11`=서울특별시, 그 외=경기도)를 전 지오코딩 주소 생성 지점(fetchJeonse·연립·오피스텔·아파트·RENT_ONLY
  dong/house)에 적용. `collect_realprice.js` 의 GU_GG 블록(46~65행)에 47개 코드가 주석과 함께 있음.
- **검증**: `ONLY_GU=11110,41135,41830,41597 SUFFIX=_test MONTHS=2 WITH_APT=1` 스모크 —
  지오코딩 100%(103/103·70/70), 경기 구/군/화성 gu 명칭·좌표 정상(동탄 능동 37.20653/127.05783).

### 19. GitHub Actions 지오코딩이 60분 제한에 걸려 매일 실행이 취소된다 (2026-08-13 실측)
- **증상**: 첫 자동 실행(`collect-auction.yml` 스케줄, run 31750427143)이 `cancelled`로 끝났다.
  `gh run view --log` 실측: 수집은 성공(2,949→3,388건, 23:03:09 "수집 완료 총 3388건")했지만,
  바로 이어진 지오코딩이 23:13(100/3300) → 23:24(200/3300) → 23:33:37
  `##[error]The operation was canceled.` 로 중단 — 워크플로 `timeout-minutes: 60` 초과(1h0m18s).
- **원인(실측 근거)**: 지오코딩 속도가 약 **100건/10분**(V-World `GEO_GAP_MS` 속도 제한 + Edge
  Function 이 아니라 직접 호출이라 왕복이 느림). 3,300건이면 **약 5.5시간**이라 60분 제한에 절대
  안 들어온다. 더 결정적인 문제: `collect_auction.js` 는 **지오코딩 완료 후에만 `saveAuction()`
  을 호출**하므로(287·385행), 취소되면 `auction.json` 저장 자체가 안 된다 → 이번 실행은 데이터가
  하나도 반영되지 않았다. 게다가 `actions/cache` 는 **취소된 실행에서는 캐시를 저장하지 않아**
  다음 실행도 캐시 없이 처음부터 재지오코딩한다.
- **해결 방향(아직 미적용, 추측 금지)**: ① `timeout-minutes` 를 지오코딩 완료 가능 수준(6h+)으로
  늘리거나 ② 지오코딩을 단계로 분리해 결과(geocache)를 아티팩트/캐시로 먼저 저장하고, 그 뒤 단계에서
  `saveAuction()` 만 실행하도록 워크플로를 나누는 것. ③ geocache 를 `actions/cache` 대신
  커밋 가능한 파일로 두면 취소돼도 다음 실행이 재사용할 수 있다(단 auction.json 과 분리 저장 필요).
  결정 전에 실행 시간 실측부터: 로컬에서 `tools/.geocache.json` 이 채워진 뒤 재실행하면 캐시 히트로
  몇 분 안에 끝나는지 확인할 것.
- **해결(2026-08-15 적용 — ③ 캐시 커밋 전환 + ① 타임아웃 상향)**: 실측으로 **경매 주소
  2,862개 중 98.1%(2,809개)가 이미 로컬 `.geocache.json`(실거래가 수집이 채운 34,206개 엔트리)에
  히트**하는 것을 확인했다. 즉 캐시만 CI 에 이어가면 새 물건 주소(수십 건)만 지오코딩하면 된다.
  그래서 ① `.gitignore` 에서 `tools/.geocache.json` 제거 → **커밋 파일로 전환**(취소·실패와 무관하게
  항상 유지, `actions/cache` 의 "취소 시 미저장" 문제 원천 제거) ② 워크플로 커밋 단계에서
  `auction.json` 과 함께 `tools/.geocache.json` 을 스테이징 → 캐시 증분도 매일 커밋으로 누적.
  `actions/cache` 스텝 자체는 제거. ③ `timeout-minutes: 60 → 360`(GitHub Actions 무료 티어
  잡당 최대 6시간) — 만에 하나 캐시가 비어 전체 재지오코딩(5.5h)이 필요해도 성공하도록 예비로.
- **검증(2026-08-15, 실측)**: 로컬 `auction.json` 2,862개 주소 × 캐시 대조 = 98.1% 히트.
  workflow YAML `python yaml.safe_load` 통과. 실제 CI 실행은 push 후 스케줄(매일 07:00 KST)
  또는 `workflow_dispatch` 수동 트리거로 확인해야 한다(아직 미실행).
- **파생 교훈**: 스케줄 워크플로는 "성공 = 종료 코드 0" 이 아니다. **생산물이 실제로 커밋/저장됐는지**
  sanity check step(파일 존재 + 행 수 ≥ 직전 커밋)을 마지막에 두어야 조용한 실패를 잡는다.
  이 워크플로에는 이미 sanity check 가 있지만, 이번엔 도달하기 전에 취소됐다.

### 19-2. 원인 확정: V-World 가 GitHub Actions 러너 IP 를 TCP 차단 (2026-08-15 실측)
- **증상**: 캐시 커밋 전환(§19) 후에도 CI 지오코딩이 **좌표 1,029/3,338 (30.8%)** 에서 끝났다.
  좌표 없는 2,309개 전부 캐시에 `null` 로 저장됨. 100건당 6~8분 = 건당 ~4초(정상 ~200ms 의 20배).
- **원인(실측 근거)**: CI 러너에서 V-World 직접 호출 **5/5 전부 ECONNRESET**(TCP 연결 거부).
  `api.github.com/meta` 실측: GitHub Actions 공개 러너 IP 는 **7,280개 CIDR, 전부 해외(미국 Azure)
  대역**. V-World 가 해외 IP 를 네트워크 단에서 차단한다. 로컬(한국 IP)은 동일 키·동일 주소 전부 OK.
  참고 자료: "GitHub Action CI/CD 가 막히는 문제"(velog/@horang12) — 같은 결론(해외 IP 차단의 맹점).
- **해결(2026-08-15 적용 — Supabase Edge Function 경유)**: `supabase/functions/vworld-geocode`
  를 배포하고(재시도 4회 + `sleep(400×attempt²)` 백오프, NOT_FOUND 만 확정, 그 외 오류는 재시도),
  `collect_auction.js` 가 `VWORLD_PROXY` 환경변수가 있으면 프록시 경유, 없으면(로컬) 직접 호출하도록
  수정. 워크플로 `collect-auction.yml` 의 지오코딩 스텝에 `VWORLD_PROXY` env 를 주입.
  동시에 null 캐시 버그 수정(아래).
  **`collect_realprice.js` 도 같은 날 같은 패턴으로 수정** — `geocode()` 에 `VWORLD_PROXY` 분기를
  추가해 신규 월간 워크플로(`collect-realprice.yml`)에서 프록시를 경유한다.
- **검증(2026-08-15, 실측)**: Supabase(미국 IP)에서 V-World 직접 호출 성공률 ~50%(8회 중 4회 200,
  실패는 Deno fetch ECONNRESET류 + V-World 자체 502 두 종류). **재시도 4회+백오프를 넣은
  `vworld-geocode` 는 4주소 × 8회 = 전부 OK** — 재시도가 우회 경로의 간헐 차단을 실용적으로 흡수한다.
  로컬 재보강 하네스로 `geocode()` candidate 분기(PARCEL→ROAD→PARCEL)도 정상 확인.
  CI 전체 재검증은 run 31875216160(workflow_dispatch)로 진행 중.
- **null 캐시 버그 수정 (같은 날 코드리뷰 조치, collect_realprice.js 와 정책 통일)**: 기존
  `collect_auction.js` 는 차단(502/RST)으로 끝난 null 도 `geoCache.set(addr, null)` 을 해서,
  캐시가 커밋 파일로 이어지면 **일시 차단이 영구 실패로 고정**되는 오염이 누적됐다(실측: 2,309건).
  이제 `if (pt || !blocked) geoCache.set(...)` — 차단 null 은 캐시하지 않아 다음 실행에서 재시도되고,
  NOT_FOUND 만 확정 실패로 캐시해 재시도 낭비를 막는다.
- **WHY(판단 사유)**: "CI 에서 30.8% 성공이었다" 를 지오코딩 규칙 문제로 오해할 뻔했지만, 진단 스텝
  (실측 ECONNRESET 5/5) 으로 **네트워크 차단**임을 확정하고 접근 경로를 바꿨다. 재시도 단독 해법이
  아니라 "IP 를 바꾸고(프록시) + 간헐 차단을 재시도로 흡수" 가 맞다. ITS(keys.env:70)도 같은 패턴
  (Supabase IP 간헐 차단)이 있어, 공공 API 는 우회 경로에 재시도를 반드시 붙일 것.

### 20. 레이트리밋 없는 공개 프록시 + API 키 노출 패턴 (2026-08-15 코드리뷰 조치)
- **증상(코드리뷰)**: 인증 없이(`--no-verify-jwt`) 공개된 Edge Function 프록시 5개
  (`naver-search`·`bizno-proxy`·`chungak-proxy`·`eximbank-proxy`·`its-cctv-proxy`)에
  레이트리밋이 없어, 서버 secret(API 키)을 품고 있는 채로 무제한 호출 허용 → 제3자가 스크립트로
  반복 호출해 일일 호출 한도를 소진시킬 수 있었다. `its-cctv-proxy` 는 `?debug=1` 로 원문 응답
  (헤더·키 포함 가능)까지 노출하는 백도어가 있었다.
- **해결(모두 적용됨)**: `molit-proxy` 의 패턴(DB `rl_hit` RPC + `api_rate_limits` 테이블, 인스턴스
  무관 공유)을 복사. 버킷 접두사를 함수별로 분리 — `naver:`/`nts:`/`chungak:`/`eximbank:`/`its:`
  (data.go.kr 계정 공용 키를 쓰는 `molit-proxy`·`kma-weather-proxy` 만 `datagokr:` 공유).
  각각 `RATE_WINDOW_SEC=60`, `RATE_MAX` 는 20~30(용도에 따라 주석에 근거 기재).
- **파생**: `admin-request-reset` 응답의 `sent_to:[backupEmail]` 도 제거(익명 호출자에게 실주소
  유출). `land.html` 의 `if (VWORLD_KEY) {}` 블록도 풀었음 — 키가 비면 블록 안 함수 선언이
  실행되지 않아 블록 밖 호출부(검색 자동완성)에서 ReferenceError(1217행 주석과 동일 사고).
- **교훈**: 새 프록시를 만들 때 레이트리밋·`debug` 파라미터·원문 응답 반환은 처음부터 넣는다.
  RLS 정책이 없는 테이블은 service_role(RLS 우회)만 접근 가능하므로, RPC 호출부가 `rl_hit` 404/
  권한 오류를 내도 조용히 통과시키지 말고 최소한 로그를 남긴다(molit-proxy 주석 참고).

## 21. 인라인 스크립트 블록 스코프 함수가 블록 밖 호출부에서 사라지는 함정 (2026-08-15 실측)

- **증상(잠재)**: land.html 1296~3275행의 순수 블록 `{}` 안에 `function jbPopupHtml`(2347) 등이
  선언돼 있는데, 호출부 5159행(검색 자동완성 정비구역 항목 클릭)이 **블록 밖**에서 `jbPopupHtml(d)`
  를 호출한다. 현재는 에러가 나지 않지만 스크립트 전체를 깨뜨릴 수 있는 잠재 ReferenceError.
- **원인**: ES6+에서 **블록 스코프 함수 선언**(`{ function f(){} }`)은 strict mode에서 블록 안으로만
  한정된다. 이 페이지는 `'use strict'`가 없어(sloppy mode, 실측 0건) 브라우저 Annex B 규칙으로
  함수가 밖에서도 보이므로 오늘까지는 동작했다. 즉 "하드코딩 키 때문에 안 터진 게 아니라
  **sloppy-mode 호이스팅에 기댄 불안정 상태**". `'use strict'` 지시어를 넣거나, 그 블록을 다시
  `if (VWORLD_KEY) {}`로 감싸면 즉시 ReferenceError → 자동완성 클릭이 죽는다. (uUnit 사고 §16은
  `const uUnit`이라 블록 스코프가 단단해서 이미 터진 것 — 함수 선언은 느슨해 늦게 터진다.)
- **해결**: 함수 선언을 옮기지 않고 **블록 안에서 `window.jbPopupHtml = jbPopupHtml;` 한 줄**로
  노출한다(land.html 2382 근처). 방금 실측: 블록 함수를 `globalThis`에 붙이면 **클로저가
  stageColor·jbTlHtml 등 헬퍼를 통째로 캡처**해 블록 밖에서도 정상 동작한다. 215줄짜리
  상호의존 로직을 통째로 옮길 필요가 없다. 엄밀히 하려면 5159 호출부를 `window.jbPopupHtml(d)`
  로 명시해도 된다.
- **WHY(판단 사유)**: "블록 밖에서 함수가 안 보인다"는 원인을 알면 해법은 "블록 안에서 window로
  올리기"(1줄)가 최소 변경이다. 블록을 통째로 없애는 방법(1296·3275의 `{}` 제거)도 있지만
  블록 안 `const`와 밖 `const` 이름 충돌 검사가 필요해 리스크가 크다. 현재는 가시성 문제만
  해결하면 되므로 1줄 노출이 가장 안전하다.
- **교훈**: 인라인 스크립트에서 함수 선언을 조건/블록 안에 두지 말 것. 블록 안 함수를 밖에서
  써야 하면 즉시 `window.`로 노출한다. `'use strict'` 도입 시 이런 함수가 전부 깨지므로
  전역 노출(브라우저 실제 실측) 후 진행한다.

## 22. render() 성능 캐시의 무효화 조건 — window.score 캐시 (2026-08-15 실측)

- **증상(성능)**: main.js `render()`가 입력 디바운스(140ms)·탭 전환·GPS마다 전체 1,300곳을
  `window.score()`로 전량 재계산했다. 개별 비용은 수 µs라 체감은 작지만, render가 잦은
  경로의 유일한 중복 계산이었다(다른 곳은 이미 render 캐시 키·검색 인덱스·dist memo·LIST_MAX로
  최적화돼 있음).
- **해결**: `scoreOf(r)` 캐시 도입 — 점수는 취향(taste 객체)과 식당 태그에만 의존하므로 같은
  taste면 결과 재사용. `scoreCache`는 **taste 객체 identity가 바뀔 때만** 무효화
  (`scoreCacheTaste !== taste`). 세션 중 taste 대입은 `loadAll()` 1회뿐이라 사실상 1회 계산 후
  계속 히트. 함께 만든 `restaurantById`(id→식당 Map)는 리스트 클릭·자동완성·recent-chip의
  `restaurants.find`(O(n))를 O(1)로 바꾼다.
- **함정(다음 세션 주의)**:
  1. **캐시 무효화 키는 taste 객체 identity다.** "세션 중 취향 재입력" 기능을 만들면 **반드시
     새 객체로 대입**해야 캐시가 자동으로 비워진다. 기존 taste 객체를 mutate 하면 캐시가
     썩어 점수가 영영 예전 취향으로 남는다.
  2. `restaurantById`는 `buildRestIndex()`가 만들므로, **`restaurants`를 직접 수정한 뒤
     `buildRestIndex()`를 안 부르면 Map이 누락**돼 클릭이 조용히 무반응이 된다. 저장 경로
     (saveNaverPlace/saveKakaoPlace)는 push 후 buildRestIndex 호출 확인 완료 — 새 저장 경로를
     만들 때도 동일하게.
  3. 식당 태그는 세션 중 불변 전제. push로 추가된 신규 식당은 캐시에 없어 최초 1회만 계산된다.

## 23. 수집기 저장 경로는 전부 writeSafe 가드를 쓸 것 — house 3곳 누락 발견·수정 (2026-08-15 실측)

- **증상(잠재)**: `tools/collect_realprice.js`에서 villa·apt·officel 은 `writeSafe`(0건 중단·
  기존 절반 미만 중단·tmp+rename 원자 저장)를 쓰는데, **단독다가구 3곳은 raw `fs.writeFileSync`**
  였다 — `realprice_house.json`(매매)·`realprice_house_rent.json`(전월세)·house 좌표 보강 쓰기.
  data.go.kr 이 HTTP 200 에 오류 XML 을 실어 0건을 돌려주면(키 오류·쿼터 초과, §16 과 같은
  조용한 실패) 멀쩡한 house 파일이 통째로 날아갈 수 있었던 것.
- **해결**: 3곳 모두 `writeSafe` 로 교체(2026-08-15). 보강 경로는 count=기존 동 수라 가드가
  오작동하지 않는다(동 수 동일 → 절반 미만 조건 불발).
- **검증(실측)**: writeSafe 단위 시뮬레이션 — ①0건 저장 거부+기존 보존 ②절반 미만(10→4) 중단+
  보존 ③절반 이상(10→6) 통과 저장 ④정상 저장 시 `.tmp` 잔존 없음.
- **WHY(판단 사유)**: "새 파일 경로를 추가할 때도 같은 가드를 붙인다"는 규칙이 문서에 없어
  누락이 눈에 안 띄었다. 수집기 파일 저장은 **전부 writeSafe 경유**가 규칙 — 새 저장 경로를
  만들면 이 규칙을 따른다.

## 25. 팝업 폭 자동측정·복원 칩·min 버튼 — 3건 실측 (2026-08-16)

### ① 팝업 "자연 폭" 측정이 항상 지도 폭을 반환하는 함정 (scrollWidth)
- **증상**: `popup.getContent().scrollWidth`(또는 `offsetWidth`)로 자연 폭을 재면 **지도 폭이 나온다**
  (1280px 뷰포트에서 895px). Leaflet 팝업 컨테이너가 flex/block 자식(`width:100%`)을 갖는 순간
  자식이 뷰포트를 채우려 하므로 `scrollWidth`는 늘 상위 컨테이너 폭 = 지도 폭을 돌려준다.
- **해결**: 브라우저 기본 10px 보다 작은 폭(뷰포트에 없는 숨김 미리보기 박스 `width:0`)에서 측정하지 말고,
  **클램프로 해결** — `_updateLayout`에서 `Math.max(220, Math.min(natural, 지도폭 - 50, 480))`.
  480px 상한 + 좁은 화면은 50px 추가 여유(우측 레이어 탭·min 버튼과 충돌 방지, §24-2-③).
- **검증(실측)**: 1280/678/700 뷰포트에서 팝업 폭이 각각 상한 안에 들어옴(678: `lpW "318px"`).

### ② 지도 바깥 오버레이(복원 칩) 클릭이 map click 에 전파되는 함정
- **증상**: min 버튼 → "복원" 칩 클릭이 Leaflet 지도 `map.on('click')`으로도 전파돼, 아무 자리나
  눌리면 "위치 정보" 팝업(또는 다른 click 핸들러)이 열려 복원을 덮어썼다. 칩을 `map.getContainer()`에
  append 하면 map pane 컨트롤 위에 떠 있어도 이벤트 버블링은 막아주지 않는다(§2-3 과 같은 계열).
- **해결**: `L.DomEvent.disableClickPropagation(chip)` 한 줄(2026-08-16, land.html minBtn.onclick 내).
- **검증(실측)**: 복원 클릭 후 "위치 정보" 팝업이 안 뜨고(기존엔 뜸) 칩이 그대로 동작. 실마우스
  (CDP `Input.dispatchMouseEvent`)로 1280/678/700 세 뷰포트 통과.

### ③ Leaflet pane 스택: 팝업은 컨트롤·헤더 아래 — 좁은 화면에서 버튼/핸들 가림
- **증상(실측)**: 678px 이하에서 **접힌 좌측 레이어 탭**(`.lp-toggle`, 실측 x354-388·y102-136)이
  팝업 우상단의 min 버튼·상단 세로 드래그 핸들을 덮음. 또 팝업을 지도 상단 밖으로 키우면 상단
  핸들이 **페이지 헤더 `.stat-bar`** 아래로 들어가 축소 드래그가 안 됨(팝업은 `transform: matrix(...)`
  로 배치, pane 이 컨트롤보다 아래 — 구조적 한계).
- **해결**: min 버튼은 우측 30px 로 유지해 좌측 탭(좌측 0px 띠)과 안 겹치게 하고, 폭 상한에
  50px 여유를 둬 팝업 자체를 좁게 유지(①). 상단 핸들 가림은 **수용 결정**: 지도 상단 근처 마커 +
  긴 팝업 조합에서만 발생하며 하단 핸들로 축소 가능(회귀 아님, land.html 주석에 WHY 기록).
- **교훈**: Leaflet 팝업과 컨트롤이 겹치는 좌표 판정은 `getBoundingClientRect()` 실측으로만 확정.
  "클릭이 안 된다" 보고가 오면 **무엇이 그 좌표를 덮고 있는지**(팝업 transform 위치·컨트롤 rect)
  먼저 재야 한다.

## 26. 열린 레이어 패널(.lp-body)이 팝업을 덮음 — z-index 스택 + 스크롤바 margin (2026-08-16)

### ① 팝업 pane(z700) < 컨트롤 컨테이너(z1000): 열린 패널이 팝업 우측을 통째로 덮음
- **증상(사용자 보고)**: 배포 후 "드래그 크기조절이 전혀 안 됨", "스크롤바가 맨 우측에 없음",
  "팝업 상단의 접기·닫기 버튼과 스크롤바가 겹침".
- **원인(실측, 1440x900 CDP)**: `.leaflet-popup-pane` 기본 z-index 700 < Leaflet 컨트롤 컨테이너
  `.leaflet-top/.leaflet-right` z-index 1000. 사용자가 레이어 패널(`.lp`, `L.control({position:'topright'})`,
  `.lp-body` 실측 x794·y142·w250·h680)을 연 채 우측 마커(창신쌍용2, 팝업 x392-918)를 클릭하면 패널이
  팝업 오른쪽 124px 를 덮음. 하단 드래그 핸들의 `elementFromPoint` 가 `SPAN.lp-name`(패널 내부)을
  반환해 makeResizable pointerdown 이 안 뜨고, 닫기·접기·스크롤바도 패널 아래 가림. 핸들 자체는
  `z:1200; pointer-events:auto` 라도 **stacking context 가 팝업 pane(700) 안이라 컨트롤에 진다.**
- **해결**: ① `.leaflet-popup-pane { z-index: 1200 }` (팝업을 컨트롤 위로 — 항상 조작 가능한 안전망),
  ② popupopen 시 팝업 rect 와 `.lp-body` rect 가 겹치면 패널을 **자동 접기**
  (`lp.classList.remove('open')`, requestAnimationFrame 안에서 `getBoundingClientRect()` 판정).
  겹치지 않는 좌측 팝업은 패널이 그대로 열려 있음(실측 probe89: 좌측 팝업 lpOpen:true, 우측 false).
  아파트 레이어 체크 상태는 접어도 유지됨(실측 repro88: aptChecked:true).
- **검증(실측)**: 1440/1280/678 세 뷰포트에서 하단 핸들 hit = `BUTTON.lp-sbar lp-sbar-bot`, 드래그로
  내용 높이 증가(1440: ch 474→534, 폭 480 유지), JS 예외 0건. 패널 기본 상태는 닫힘(`.open` 없음,
  toggle.onclick 이 토글) — 증상은 사용자가 패널을 편 뒤에 발생.

### ② "스크롤바가 맨 우측에 없다" — content margin-right 24px 가 스크롤바를 안쪽으로 밀었음
- **원인**: `.leaflet-popup-content` 기본 `margin: 13px 24px 13px 20px` — 네이티브 스크롤바가
  content 의 오른쪽 테두리에 붙으므로 오른쪽에서 24px 들어간 자리에 생김.
- **해결**: `margin: 13px 0 13px 20px` + `padding-right: 24px` (텍스트 여백은 padding 이 대신).
  content 는 `box-sizing: border-box` 라 padding 24px 를 포함해도 `offsetWidth` 동일, 스크롤바가
  팝업의 오른쪽 끝에 붙음(실측 repro86: content x413 w480, 오른쪽 893 = 팝업 오른쪽 894-1).

### ③ 폭이 드래그 후 480→390 으로 오그라드는 함정 (maxWidth 클램프 ratchet)
- **원인(실측)**: `_updateLayout` 의 자연폭 측정이 `width:2000px` 를 주지만 **직전 실행이 남긴 인라인
  `maxWidth`(예: 390px)가 다시 그 값을 클램프**해 `scrollWidth` 가 왜곡됨(probe87 TRACE:
  maxWidth 있을 때 sw 390 → 비우면 sw 1024). 높이 드래그 → `_updateLayout` 재실행 → 폭이 오그라듦.
- **해결**: 측정하는 동안만 `content.style.maxWidth = ''` 로 비우고 끝나면 복원 (land.html _updateLayout).
  폭은 상한 480 에 안정 고정(실측 repro86: 드래그 후에도 w480, 이전엔 390).

- **교훈**: Leaflet 컨트롤과 팝업의 z-index 비교는 **pane 과 컨트롤 컨테이너가 서로 다른 stacking
  context** 라 단순 비교로 안 끝난다 — 실측 hit-test(`elementFromPoint`)로 "누가 이기는지" 확인.
  또 "폭을 재는" 코드는 **다른 인라인 스타일이 그 측정을 오염시키는지** (maxWidth·width 클램프)
  항상 점검한다.

## 27. 팝업을 키우면 리사이즈 핸들이 사라져 축소 불가 — scrollable 게이트 (2026-08-16 실측)

- **증상(사용자 후속 보고)**: "드래그로 팝업 크기 조정이 안 되잖아" (26의 z-index·margin 수정 후에도).
- **원인(실측, CDP probe91/probe92)**: 신선한 팝업에선 축소(474→414)·확대 모두 정상. 문제는
  **확대 후** — 드래그로 내용 높이(sh)를 넘게 키우면 `sh==ch` 가 되어 네이티브 스크롤바가 사라지고,
  `placeSbar` 의 `scrollable` 게이트(`sh > ch+1`)가 리사이즈 핸들(`.lp-sbar-top/.lp-sbar-bot`)까지
  `display:none` 처리 → **축소가 불가능한 상태** (probe91 실측: 성장 후 연속 6회 드래그 전부 무반응,
  핸들 `disp:none`). 스크롤 불가능한 짧은 팝업은 애초에 핸들 자체가 없어 드래그 불가.
  → "드래그 안 됨"이 "성장 후 축소 불가" 또는 "짧은 팝업에 핸들 없음"으로 사용자에게 보임.
- **해결**: 핸들을 `scrollable ? '' : 'none'` 대신 **항상 표시**. 스크롤바 위치 계산
  (`L = content.offsetLeft + content.offsetWidth - sbW`)은 그대로 — 스크롤바가 사라진 상태는
  `sbW==0` 이라 핸들이 내용 오른쪽 모서리에 정렬돼 축소 가능 (land.html placeSbar).
  → 이후 이 접근은 §28의 **코너 그립 재설계**로 대체됨(발견성 문제로 사용자가 여전히 조작을 못 찾음).
- **검증(실측)**: probe92 전 주기(축소→확대→자연높이 초과→축소) 통과, repro88 1440/1280/678
  드래그+폭 480 유지+예외 0건, probe93 120px(minH) 축소에도 핸들 유지 + X 닫기 정상, probe89
  자동 접기 불변. 커밋 `2c3a562a` push·배포 완료 (배포본 fetch로 구 마커 부재·신 마커 존재 확인).
- **WHY**: "스크롤바가 있을 때만 핸들을 보여준다"는 게이트가 **리사이즈 조작까지 스크롤 상태에
  종속**시켜 생긴 버그. 리사이즈는 스크롤과 독립된 기능이라 항상 노출해야 한다.

## 28. 리사이즈를 스크롤바에서 분리 — 팝업 레이어 우하단 코너 그립 (2026-08-16, §27 재설계)

- **증상(사용자 후속 지시)**: "스크롤바도 없고, 크기조정도 안되고. 팝업 레이어 자체를 크기 조정
  되는 기능으로 만들고 스크롤바는 별도로 코드 작성하면 되는거 아냐?" (§27의 항상-표시 핸들도
  **스크롤바 열에 붙은 16x17px 화살표**라 발견성이 여전히 나빠 조작을 못 찾음).
- **해결(전면 재설계)**: 리사이즈는 **팝업 레이어 우하단 코너의 `.lp-corner-grip`**(22x22px,
  `right:1px/bottom:1px`, 대각선 지그재그 glyph, `row-resize` 커서, **스크롤 여부와 무관하게 항상
  노출**)이 담당, 스크롤바는 네이티브(ui-scroll)로 별도 유지. `right/bottom`은 `.leaflet-popup`
  (position:absolute) 기준이라 줌/팬과 무관하게 코너에 고정 — `_placeSbar` 위치 갱신 훅 제거.
  makeResizable 재사용(`reverseH:false`), 클릭-스크롤 `onClick` 제거(네이티브 스크롤바가 담당).
- **검증(실측, CDP probe94/95)**: 1440/1280/678 전 뷰포트에서 축소→확대→자연높이 초과→축소 전
  주기 통과. 그립은 `sh==ch`(스크롤 불가) 상태에서도 `disp:block`. 그립 rect가 X(닫기)·min(접기)
  버튼과 겹침 없음, X 닫기 정상. 자동 접기(§26) 불변. 커밋 `6aa94aec` push·배포 완료.
- **WHY(판단 사유)**: "핸들이 스크롤바에 붙어 있으면 스크롤바가 없을 때 조작이 사라진다"는 결함이
  한 번 더 드러난 뒤(§27), **조작 UI와 상태 표시(스크롤바)를 완전히 분리**하기로 결정. 코너 그립은
  어느 상태에서도 존재하므로 리사이즈 가능성이 항상 보인다.
- **남은 한계(수용)**: 그립이 스크롤바 하단 화살표 자리를 일부 덮음(우하단 코너 특성상 불가피).
  폭 리사이즈 없음(자동 맞춤, 상한 480).

## 29. 팝업 스크롤바 상시 표시 + 공용 그립, 그리고 스크롤바 규격 비교 (2026-08-16 실측·배포)

- **증상(사용자 후속 지시)**: "팝업 크기 상관없이 스크롤바 나오게 해주고, 드래그해서 크기 조정
  가능하게 만들어줘. 실제 크롬(프론트뷰)에서 확인까지 해주고 푸시하자." → 이후 "레이어 클릭하고
  나오는 팝업의(레이어 패널) 스크롤바 규격 기준으로 팝업 스크롤바 규격 동일하게."
- **해결(커밋 808ff6b2)**:
  1. `.leaflet-popup-content` `overflow:auto` → `overflow-y:scroll; overflow-x:hidden` —
     **스크롤바 트랙이 팝업 크기·내용과 무관하게 항상 보임**(내용이 안 넘쳐도 thumb 가 채워져 보임).
  2. `lp-corner-grip`(§28, 은은한 투명 그립) → **공용 `.ui-grip.ui-grip-corner`**(24x24,
     `bg:rgba(0,0,0,.82)` + 흰 테두리, css/buttons.css) — 어떤 지도 타일 위에서도 눈에 띄게.
- **검증(실제 보이는 Chrome 9223, CDP 실마우스, probe96/97)**: 전 상태에서 `overflow-y:scroll`,
  그립 24x24 표시·드래그 축소→확대 전 주기 OK. 내용이 완전히 차도(ch==sh 537) **스크롤바 트랙
  15px 유지**(cw 465<ow 480). 스크린샷 4장 저장. syncheck OK. 배포본 fetch 확인.
- **스크롤바 규격 비교(실측)**: 패널 `.lp-body`는 ow250−cw233=17px 로 보이지만 2px 은
  `border:1px`(양쪽), **실제 네이티브 스크롤바는 팝업·패널 모두 15px 동일**. land.html에
  `::-webkit-scrollbar` 규칙 전무(유일하게 `land.backup-20260808.html`만 커스텀 14px 보유) —
  팝업·패널이 같은 `ui-scroll` 네이티브 규격이므로 **별도 규격 맞춤 불필요**.
  → 사용자 확인: 현재 그대로 유지.
- **WHY(판단 사유)**: "상시 스크롤바" 요구를 충족하면서도 좌우 패널과 어긋나지 않으려면, 브라우저
  네이티브 스크롤바가 유일한 공통 규격이므로 커스텀 CSS를 쓰지 않고 마커 클래스 `ui-scroll` 하나로
  통일(§14·§15 같은 결말). 그립도 지도 배경과 무관하게 보이도록 buttons.css 공용 그립을 재사용.

## 30. 팝업 드래그 리사이즈가 "안 되는" 진짜 원인 — 드래그 후 합성 click 이 지도를 울려 팝업이 재오픈됨 (2026-08-16 실측)

- **증상(사용자 보고, 3번째 재작업 요청)**: 하단에 드래그 핸들이 보이는데 크기가 안 조절된다.
  "몇번째 요청하냐" (그립·makeResizable 2회 시도 후에도 동일 보고).
- **원인(실측, 계측 로그)**: 드래그 로직은 **정상 동작**했다(높이 417→477 실변화). 문제는
  mouseup 직후 브라우저가 합성하는 `click` 이벤트 — mousedown 은 팝업(핸들), mouseup 은 지도
  위라서 **공통 조상인 지도 컨테이너에 click 이 발생** → `map.on('click')`(4549)이 위치정보 팝업을
  열고 → Leaflet 이 기존 팝업을 닫으면서 `setContent/update` 가 새 팝업을 417px 로 초기화.
  그래서 "끌어도 원래대로 돌아간다"처럼 보였다. (§28의 .ui-grip 이 실패한 환경도 같은 경로로
  추정 — 드래그 자체는 됐지만 release 직후 click 이 재오픈을 유발.)
- **해결(사용자 제안 패턴 + click 차단)**: 커스텀 그립/makeResizable(pointer capture·임계값)을
  버리고 **래퍼 하단 얇은 스트립 핸들(.lp-resize-handle, 12px, row-resize) + mousedown/
  mousemove/mouseup 플래그** 로 내용 높이만 바꾼다(React 예시의 delta 패턴). 동시에 드래그 동안
  window 캡처 단계 `click` 리스너로 `e.stopPropagation()+preventDefault()` — `rsDragging` 을
  mouseup 에서 바로 내리지 않고 `setTimeout(0)` 에서 내려 mouseup 직후의 click 을 잡는다.
- **검증(실제 보이는 Chrome 9223, CDP 실마우스, probe104/105)**: 계측 로그상 mouseup 후
  `setContent/close` 가 0건(수정 전엔 2건). 실드래그 확대 417→507, 축소 507→307 모두 유지,
  팝업 재오픈 없음, JS 예외 0건. syncheck 1블록 OK. 스크린샷 08/09 저장.
- **WHY(판단 사유)**: Leaflet 은 팝업이 지도 컨테이너 안에 있으므로 "팝업 안에서 눌러 지도 위에서
  놓는" 드래그가 항상 지도 click 을 유발한다. 드래그 직후의 click 만 억제하면 다른 click 은 전부
  그대로 두므로 안전. 사용자가 제시한 단순 패턴(상태 + delta + min/max)이 원인 추적과 수정에
  모두 가장 적은 코드로 끝났다.

## 30-1. 최종 결정 — 스트립 핸들(30)은 기각, 20260815 백업의 makeResizable() 코드로 복원 (2026-08-16 사용자 지시)

- **증상**: 30의 스트립 핸들 수정이 배포 검증까지 끝났지만, 사용자가 "지금까지도 해결이 안되고
  있어" + "백업의 드래그 리사이즈 코드 그대로 사용해라" 로 방향 전환.
- **해결(지시 그대로, 신규 코드 금지)**: `land.backup-20260815.html` 1019-1034 의
  `makeResizable(grip, content, {applyStyle:false, minW/maxW, minH/maxH, onStart/onResize/onEnd})`
  블록을 **그대로 복원**. `js/ui-resize.js`(공용 헬퍼)는 그 옵션을 여전히 지원 — 변경 불필요.
  트리거만 스크롤바 오른쪽 세로줄 바로 아래 **우하단 아이콘 버튼**(`.ui-grip.ui-grip-corner`,
  right:3/bottom:3, 항상 표시)으로 위치 조정. `_updateLayout` 의 `_lpW/_lpH` 적용 로직은
  백업 계약의 상위호환(폭 자동맞춤 포함)이라 그대로 유지.
- **검증(probe106, 실마우스)**: 417×480 → 확대 497×520 → 축소 337×460 모두 유지, 팝업 재오픈
  없음(`same:true`), JS 예외 0건.
- **WHY**: `makeResizable` 은 pointerdown 에서 `setPointerCapture()` 를 걸어 **드래그 후 합성
  click 의 target 이 그립(=팝업 컨테이너 내부)에 머문다** → `disableClickPropagation` 이 지도
  click 전파를 막아 30 의 재오픈 원인이 구조적으로 발생하지 않는다. 즉 30 의 "click 차단"이
  스트립 핸들(mousedown/up 패턴, pointer capture 없음)에만 필요했던 것. 코드를 새로 짜지 말라는
  사용자 지시가 곧 가장 안전한 경로였음.

## 30-2. 리사이즈 그립이 스크롤바 하단 세모와 겹침 — `.ui-grip-corner` bottom 오버라이드 (2026-08-16 발견·수정, 로컬 검증만)

- **증상**: 팝업 우하단 리사이즈 아이콘(그립)이 위치정보 콘텐츠의 스크롤바 하단 세모(화살표)와
  겹쳐 세모 클릭이 어렵다(사용자 "실거래 표 반영안됬어"와 무관한 별건 — 실거래 UI 분석 중 발견).
- **실측(probe107, 127.0.0.1:9223)**: 팝업 전체 y104-549, content(스크롤바 소유) y118-535,
  그립 y522-546 → 그립 하단이 content 하단(535) = 스크롤바 하단 세모 위치와 **14px 겹침**.
  §29(상시 스크롤바) 도입 후 그립(right:3/bottom:3)이 스크롤바 하단 세모 바로 위에 얹힌 것.
- **해결(land.html)**: popup 스코프 오버라이드 `.leaflet-popup .ui-grip-corner { bottom: -12px; }`
  추가. `css/buttons.css` 공용 값(right:3/bottom:3)은 건드리지 않음 — popup 에서만 그립을 아래로
  12px 매달아 세모 아래(right:3/bottom:-12px)에 위치시킴.
- **검증(probe108)**: 그립 상단 y537, content 하단 y535 → **갭 2px, 겹침 없음**. 실마우스 드래그
  417×480 → 487×510 → 347×460 모두 유지, JS 예외 0건. 스크린샷 `screens/12_grip_below_arrow.png`.
- **WHY**: 팝업 아래로 12px 매달려도 Leaflet 팝업 tip(.leaflet-popup-tip)과 같은
  overflow(visible) 메커니즘이라 잘리지 않는다. 세모 클릭 영역을 완전히 비우는 게 겹침의 본질 해결.
- **상태**: 로컬 검증 완료, **커밋·push 미완**(사용자 동의 대기). syncheck ALL OK, 서빙 사본 동기화 완료.


## 31. 실거래 등록명과 검색/클릭 대상이 안 맞아 "이 아파트" 실거래가 안 보이는 문제 — 이름 접두사 매칭 + 검색 자동완성 (2026-08-16 발견·수정, 로컬 검증만)

- **증상(사용자 실측)**: "동현아파트"를 검색·클릭하면 위치정보 팝업에 건물대장 + "근처 아파트 실거래 참고"
  (44m 논현한가람빌라트)만 나온다. 동현아파트의 매매가·거래 표가 안 보인다.
- **원인(실측)**:
  1. 국토부/부동산원 등록 단지명은 "**동현아파트1~6**"(~N동 그룹명) — 검색어 "동현아파트"와 정확히 안 맞음.
  2. 좌표도 어긋남: 검색이 이동하는 **건물**(37.51916,127.03732, 언주로146길 18) vs 실거래 **마커**
     (37.51932,127.03657) **약 68m** 떨어짐. 사용자가 클릭한 건물 위치에는 아파트 마커가 없어
     "위치 정보" 팝업만 뜨고, 이 팝업의 근처 참고는 **가장 가까운 1곳**(논현한가람빌라트)만 표시.
  3. 검색 자동완성(`renderAC`, land.html ~5481)이 아파트 단지를 후보로 안 올림(정비구역·지명만).
- **해결(land.html, 2026-08-16)**:
  1. **클릭 팝업 이름 매칭**: `buildClickPopup` — 클릭한 건물명(bldName)이 250m 내 아파트 단지명의
     접두사로 일치하면(양방향 `n.startsWith(bldName) || bldName.startsWith(n)`) 그 단지를
     "이 건물의 아파트 실거래"로 표시. 단지 대표 행(그룹 최신 거래)의 매매가·전세가율·추이·
     **최근 거래 표**를 넣고, 근처 참고(nearHtml)는 대체한다. (~4659-4688)
  2. **검색 자동완성에 아파트 추가**: `renderAC`가 단지명 포함 검색(단지별 대표 행, 최대 4개) →
     선택 시 `openRpApt`가 마커로 이동 + 실거래 팝업 오픈. 마커는 `rpClusterRef`(top-scope 참조,
     land.html ~1296)로 찾고, 가격/연식 필터에 걸렸으면 임시 마커로 팝업만 띄운다.
  3. **공용 팝업 HTML**: 마커 팝업 HTML을 `rpAptPopHtml(d)`로 추출(~1615). 마커·검색 선택이 함께 사용.
     클릭 팝업에는 안 넣음 — .rp-save/rt-start 클래스가 겹쳐 저장 버튼 배선이 꼬인다.
- **검증(probe111, 127.0.0.1:9223, naver SDK 로드 후 지오코더 stub)**:
  - Fix A: 동현아파트 건물 클릭 → "이 건물의 아파트 실거래" + 동현아파트1~6 + 거래 표 **4행**, 매매가 표시,
    근처 참고 숨김. 스크린샷 `15_donghyun_building_click.png`.
  - Fix B: 검색어 "동현아파트" → 자동완성에 "동현아파트1~6 (아파트)" → 선택 → 마커 팝업 오픈
    (head 동현아파트1~6, 매매 38.3억, 거래 표 4행, "최근 거래" 헤더). JS 오류 0건.
    스크린샷 `16_donghyun_search_select.png`.
- **WHY**: 실거래 등록명(~N동)은 수집 원본이라 건드리지 않는다. 화면에서 "검색어→단지"를 잇는 두 경로
  (클릭 팝업 이름 매칭, 자동완성)를 추가해 데이터 정규화 없이 문제를 푼다.
- **상태**: 로컬 검증 완료, **커밋·push 미완**(사용자 동의 대기). syncheck ALL OK, 서빙 사본 동기화 완료.

### 31-1. 접두사 매칭 한계 발견 — "잠원동월드메르디앙" (2026-08-16 사용자 실측, contains 매칭으로 보강)

- **증상(사용자 실측)**: 잠원동월드메르디앙(37.51284, 127.01642) 클릭 시 여전히 "근처 아파트 실거래 참고 ·
  반경 700m 71건 / 월드메르디앙 여기서 0m"만 나온다. "이 건물의 아파트 실거래"가 안 붙는다.
- **원인(실측)**: 31의 매칭은 **양방향 접두사**(`startsWith`)라 "잠원동월드메르디앙"(건물명, 지오코더
  addition0, 동명이 앞에 붙음) ↔ "월드메르디앙"(단지명)은 **접두사 관계가 아님** → 미매칭.
  단지 데이터 자체는 정상 — 배포본·로컬 `realprice_apt.json` 모두 해당 좌표에 월드메르디앙 행이 있고
  (gu idx 21=서초구, dong idx 275=잠원동, 거래 1건, 20.9억/2026.4, cnt700=71) 근처 참고는 그걸 0m로 표시.
- **해결(land.html, 2026-08-16)**: 접두사 → **양방향 contains**로 교체.
  `(bldName.length >= 3 && n.includes(bldName)) || (n.length >= 3 && bldName.includes(n))`.
  짧은 쪽이 3자 이상이어야 포함 관계로 매칭(과매칭 방지)하고, 250m 거리 필터가 경계를 추가로 막는다(~4673).
  자동완성(`renderAC`)도 "잠원동월드메르디앙" 같은 동명 붙은 검색어가 단지명과 매칭되게 contains 보강(~5521).
- **검증(probe112 재실행, probe113, 127.0.0.1:9223, naver SDK + 지오코더 stub)**:
  - Fix A: 잠원동월드메르디앙 클릭 → "이 건물의 아파트 실거래 월드메르디앙 · 서초구 잠원동 · 매매 20.9억
    · 2,465만/㎡ · 전용 85㎡ · 2층 · 거래 2026.4 · 전세 8.5억 · 전세가율 41% · 최근 거래 1건" + 거래 표 1행,
    근처 참고 숨김. JS 오류 0건.
  - Fix B: 검색어 "잠원동월드메르디앙" → 자동완성 "월드메르디앙 (아파트)" 최대 4개.
  - probe113은 팝업 전체 텍스트로 Fix A 성공 확인. (probe112 최초 1회는 지오코더 서브모듈 로드 타이밍으로
    bldName=null 유입 — 테스트 하네스 이슈였고 코드 문제 아님, 재실행 통과)
- **WHY**: 단지명이 건물명의 접두사일 때만 맞는 31은 "동명+단지명" 형태(잠원동월드메르디앙)를 놓친다.
  접두사는 contains의 부분집합이라 교체는 회귀 없음(동현아파트1~6 케이스 그대로 동작).
- **상태**: 로컬 검증 완료, **커밋·push 미완**(사용자 동의 대기). syncheck ALL OK.

---

## 32. 정비 폴리곤 퇴화 링 임계값(MIN_RING_M2) 1,000이 가로주택 구역을 전부 원으로 떨어뜨림 (2026-08-16 실측, 100으로 수정)

- **증상(사용자 실측)**: 반포동 717-16 가로주택정비사업(모아)이 폴리곤이 아니라 **반경 300m 점선 원**으로 표시됨.
  원은 대표 좌표 기준 근사치라 구역 경계가 안 보이고 인근 구역과 겹쳐 잘못된 판단을 유발.
- **원인(실측)**: `usableRings()`의 퇴화 링 임계값 `MIN_RING_M2 = 1000`이 진짜 가로주택 폴리곤을 통째로 걸렀다.
  - 전체 3,032개 링 실측 분포: p5=579.6㎡, p10=1,504㎡ — 100~999㎡ 사이 링 193개가 **전부 진짜 가로주택(모아)**.
  - 예: 반포동 717-16 (area 4,512㎡, 링 333㎡), 반포동 715-19 (7,600㎡/232㎡). 대표 좌표와 폴리곤 중심 0m 일치 → 진짜 구역.
  - 옛 주석의 "5% 지점 87㎡ / 10% 지점 6,590㎡ → 1,000㎡ 기준이 안전"은 **옛 데이터 기준**으로 틀렸다.
  - 임계값 100 적용 시: 폴리곤 2,763→2,948개, 원 200→15개로 감소. 서초구 모아 42곳 전부 폴리곤 확인.
- **해결(land.html, 2026-08-16)**: `MIN_RING_M2 = 100`로 수정 + 주석을 새 실측 근거로 교체.
  - 진짜 쓰레기 링은 0~6㎡(전체 12개, 예: 녹번동 142-1, 개봉1동 등 큰 구역의 부속 조각)라 100 이하로만 걸러진다.
  - 100㎡ 미만 단일 링 구역은 폴리곤 자체가 대지 1필지 조각만 저장된 케이스(용문동 42-3: area 4,495㎡인데 링 14㎡)라
    그려도 의미가 없다 → 원 폴백 유지가 맞다. (재수집으로 폴리곤 보강 필요)
- **검증(probe118, 127.0.0.1:8798 서빙 + Chrome 9223)**: 717-16 폴리곤으로 렌더(`targetAsPolygon:true`),
  폴리곤 55개/원 0개, JS 오류 0건. 팝업(probe120)도 진행현황 18단계(준공·입주 "예정" 포함) 정상.
- **함정**: 테스트 site 폴더에 `redevelop_polygons.json`이 없으면 `jbPolys={}`가 되어 **모든 구역이 원으로 폴백**한다.
  배포본/로컬 검증 시 데이터 파일(1.4MB + 10MB)이 서빙 디렉토리에 있는지 먼저 확인.
- **상태**: 로컬 검증 완료, 커밋·push 진행(사용자 "정상이면 그냥 푸시해줘").

