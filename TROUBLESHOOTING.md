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

**대응**: 로컬에서 지도를 봐야 하면 **배경지도를 OSM 으로 바꾸고** 테스트한다.
V-World/카카오가 필요한 검증은 **배포본에서** 해야 한다.

```js
// 로컬 테스트 시 OSM 으로 전환하는 코드
[...document.querySelectorAll('.bm-item')].find(b => b.querySelector('.bm-label').textContent === 'OSM').click();
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
- **`noClip: true`** 없으면 줌인 시 뷰포트 밖 폴리곤이 `M0 0` 으로 접힌다.
- **헤드리스 브라우저에서 `map.zoomIn()` 이 동작하지 않는다.** 애니메이션 줌이 `transitionend` 에 의존하는데 그 이벤트가 안 온다. 순정 Leaflet 지도로 대조 실험까지 해서 확인함 → **테스트에서는 `map.setZoom(z, { animate: false })` 를 쓸 것.**

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

---

## 9. 키 정책 요약

| 키 | 위치 | 비고 |
|---|---|---|
| VWORLD / KAKAO_JS / NAVER_MAPS / ODSAY | 프론트 허용 | 도메인 잠금이 방어 수단. 콘솔에 도메인 등록 필수 |
| **ITS_CCTV_KEY** | **프론트 허용(정책 변경)** | 서버 경유 불가(6-3). 남용 시 its.go.kr 재발급 |
| MOLIT / NAVER_CLIENT_SECRET / CHUNGAK / NTS | **서버 전용** | Supabase Edge Function env 에만. HTML 금지 |
| DGK | 로컬 도구 전용 | `tools/collect_realprice.js` 가 env 로 읽음 |
| EXCHANGE_RATE / LOAN_RATE / INT_RATE | 서버 전용 | `eximbank-proxy` |
| SUPABASE_ACCESS_TOKEN | 환경변수 임시 | `$env:SUPABASE_ACCESS_TOKEN='...'` 로 세션에만. 파일·리포 저장 금지. **채팅에 노출됐으면 대시보드에서 즉시 Revoke** (https://supabase.com/dashboard/account/tokens)

실제 값은 `keys.env`(gitignored)에 있다. **커밋 금지.**

---

## 10. 자주 쓰는 명령

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

# 시크릿 설정/확인
npx -y supabase secrets set "CHUNGAK_API_KEY=<키>" --project-ref bhgijvaxxjnocgfnaaeu
npx -y supabase secrets list --project-ref bhgijvaxxjnocgfnaaeu

# 로그인 상태 확인
npx -y supabase projects list

# 배포 상태
gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq '{status:.status, commit:.commit}'
```
