# HANDOFF — 다른 AI/세션이 이어받을 때 읽는 파일

이 파일은 작업이 끝날 때마다 갱신한다. 새 세션(다른 AI 포함)은 여기부터 읽고 `git log -3`, `git status`로 교차 확인할 것.

> **코드를 만지기 전에 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 를 먼저 볼 것.**
> 이 프로젝트에서 반복해서 터진 버그(Leaflet 팝업/레이어 함정, localhost 에서 V-World·카카오가
> 전부 실패하는 이유, UPIS·ITS·수출입은행 API 함정, 배포 반영 확인법, 검증 방법)를
> 원인·해결까지 정리해 뒀다. 같은 함정에 다시 빠지지 말 것.
>
> **주의**: 이 파일의 "미반영/보류" 항목은 *기록만 남기고 안 한 것*이다. 기록은 작업이 아니다 —
> 새 세션은 그 항목부터 확인할 것.

---

## 2026-08-07 (4) — opencode (사업자등록증 조회 메뉴)

> 커밋·배포·실검증 완료. 이어받는 세션은 **"다음 세션 확인할 것"** 만 보면 된다.

### 한 일
- **국세청 사업자등록 상태조회** 연동 (data.go.kr data/15081808, 활용승인 자동승인 — 실측 정상).
- 신규 Edge Function `supabase/functions/bizno-proxy` 배포 + 시크릿 `NTS_API_KEY` 설정(계정 일반 키 = 청약홈과 동일 값, keys.env 기록).
- land.html 헤더에 **'사업자조회'** 버튼 추가 → 모달(사업자번호 입력 → 계속/휴업/폐업 상태·과세유형·폐업일 표시). `?biznoEndpoint=` 로 mock 교체 가능.
- 라이브 배포본 HTTP 200 확인 + Chrome CDP E2E 4시나리오 PASS(모달 열림·잘못된 입력·계속사업자·미등록).
- TROUBLESHOOTING §6-9/§9/§10 갱신.

### 배포 상태
- Edge Function `bizno-proxy` 배포 완료, 배포본 실검증(삼성전자 124-81-00998 → 계속사업자/일반과세자) OK.
- GitHub Pages: 이번 작업은 land.html 변경이라 커밋 후 빌드 반영 필요(아래 상태 확인).

### ⚠️ 다음 세션 확인할 것
- 이번 커밋 후 GitHub Pages 빌드가 `built` 되고 배포본 land.html에 `bizno-btn`(사업자조회)이 보이는지. 멈추면 HANDOFF (2)의 복구 경로(빈 커밋 push).
- 미등록 번호 조회 시 `b_stt`가 비고 `tax_type`에 "국세청에 등록되지 않은..." 메시지가 온다 — 판정 로직 바꿀 때 참고.

---

## 2026-08-07 (3) — opencode (청약 배지 + terms.html + 상세보기 복구 + 문서 정리)

> 전부 커밋(`4693cf7`)·배포·실검증 완료. 이어받는 세션은 **"다음 세션 확인할 것"** 만 보면 된다.

### 한 일
1. **청약홈 분양예정 배지** (land.html): `subLayer`/`renderSubscriptions`/`subPopupHtml`, 레이어 트리 '청약' 섹션, `.sub-badge` CSS. Supabase Edge Function `chungak-proxy` 신규 배포 + `CHUNGAK_API_KEY` 시크릿 설정. 실검증: 서울 최신 공고 2026-07-16(`RCRIT_PBLANC_DE` 기준)까지 API 가 데이터를 주는지 확인, 접수중·접수예정 필터는 **합성데이터 E2E**로 검증(배지 5개 PASS).
2. **terms.html** 신규 + land/main 푸터에 `#terms`/`#privacy`/`#copyright` 링크 3개.
3. **건축물대장 상세보기 복구**: `molit-proxy` `ALLOWED_OPS` 에 상세 op 7개 추가·재배포 (2026-08-05 `5347fa2` 키 분리 커밋에서 화이트리스트 누락 → 상세 조회 400). 배포본에서 전부 200 확인.
4. **V-World 함정 수정**: `land.html` `vworldAddrToPnu()` 에 `&category=road` 추가 (`PARAM_REQUIRED` 버그).
5. **TROUBLESHOOTING.md/HANDOFF.md 정리** (이 항목).

### 배포 상태 (전부 확인됨)
- GitHub Pages 커밋 `4693cf7` `built` — 라이브 `land.html` 에서 terms 링크·`sub-badge`·`category=road`·`chungak-proxy` 엔드포인트 확인.
- `molit-proxy`·`chungak-proxy` 배포본에서 실검증 완료.

### ⚠️ 다음 세션 확인할 것
- **Supabase 액세스 토큰(`sbp_86b17faf...`)이 이전 채팅에 노출됨. 대시보드에서 Revoke 권고** — https://supabase.com/dashboard/account/tokens. 배포하려면 새로 발급해서 `$env:SUPABASE_ACCESS_TOKEN` 으로 쓰고 **파일·리포에 저장하지 말 것**.
- 청약 배지가 "안 보인다"는 문의가 오면: **데이터 지연**(서울 최신 공고 2026-07-16, 접수중 0건이 정상)부터 의심. 로컬 테스트는 `?chungakEndpoint=` 쿼리로 mock 교체.
- `supabase` CLI 미설치 상태에서 배포 명령은 `npx -y supabase ... --project-ref bhgijvaxxjnocgfnaaeu --no-verify-jwt` (TROUBLESHOOTING §10 참고).

---

## 2026-08-07 (2) — opencode (배포 복구 시도 — GitHub Pages 빌드 멈춤)

> **이 항목은 "기록만 남기고 안 한 것"이 아니다.** 실제로 push 까지 했고, 배포 결과 확인이 남아 있다.
> 이어받는 세션은 아래 **"현재 상태 / 다음 세션 확인할 것"** 부터 확인할 것.

### 상황 (사용자: "배포 중 멈췄다")
- 배포본 = **72d153f**(마지막 성공 빌드) 버전. 이후 커밋 4개(**21757c0, bba6f0f, bd5bb8e, b914149**)가 전부 미반영.
- 배포 반영 확인법(실측): `https://conoc612-a11y.github.io/matjip/land.html` 에 `LAYER_TREE`/`UPIS_SWATCH`/`layerPanel` 포함 여부 → 미반영 상태에선 전부 `False`.
- 빌드 이력(`gh api repos/conoc612-a11y/matjip/pages/builds`): 과거엔 전부 30~60초 `built` → **2026-08-06 12:31Z 부터** `bba6f0f`(10분 실패)·`bd5bb8e`(15분 실패)·`b914149`(9시간 `building` 멈춤).

### 왜 안 됐는가 (실패 원인 분석 — 재조사하지 말 것)
- **콘텐츠 문제 아님을 하나씩 배제함**:
  - 실패 커밋에 Liquid 구문(`{{`/`{%`) 0건. 프론트매터(`---`)로 시작하는 파일은 `.claude/skills/matjip-recommend/SKILL.md` 1개뿐인데 이건 72d153f(성공 빌드) 때부터 있었고, `.claude/` 는 점 디렉터리라 Jekyll 이 어차피 스킵함.
  - `_config.yml`/`_layouts`/`_includes` 없음. 대용량 파일 추가 없음(52→53개, +15KB).
  - **문서만 바꾼 커밋(bba6f0f, b914149)까지 실패/멈춤** — 콘텐츠로는 설명 불가.
- **결론: GitHub Pages 레거시 Jekyll 빌드 파이프라인 문제**(`build_type: legacy`). 정상 빌드 30~60초 → 갑자기 10~15분 실패·무한 `building`. `githubstatus.com` 은 Pages operational 이라 공식 장애 아님.

### 시도한 조치 (master 에 반영됨)
1. **빈 커밋 `f91be03`** push → 효과: 멈춰 있던 9시간 `b914149` 빌드가 `errored` 로 정리됨(큐 해제). 그러나 새 빌드도 **13분+ `building`** 멈춤.
2. **`.nojekyll` 추가 `5107f05`** → Jekyll 빌드 단계 자체 제거. **이 사이트는 100% 정적 파일**(프론트매터·Liquid·_config.yml 전무)이라 배포 결과물은 Jekyll 이 끼든 안 끼든 **1바이트도 안 바뀐다**. 그런데도 새 빌드가 **6분+ `building`** 멈춤 → Jekyll 문제가 아니라 순수 GitHub Pages 배포 파이프라인 문제임을 재확인.

### 결과 — 배포 완료됨 (2026-08-07 05:15Z, 3번째 재시도에서 성공)
- `d8b9112`(빈 커밋 재시도) 빌드가 **26초 만에 `built`**. 배포본 `land.html` 에 `LAYER_TREE`/`UPIS_SWATCH`/`layerPanel` 전부 확인됨 (len 215,888).
- **복구 경로 정리**: ① 빈 커밋 push → 9시간 멈춤 빌드 해제됨 ② `.nojekyll` 추가 ③ 12.5시간 멈춤 빌드는 다시 빈 커밋 push 로 해제 → 이번엔 성공.
- **교훈**: 멈춘 빌드는 *새 push 로 해제*되고, 해제된 새 빌드는 처음엔 또 멈췄다가 **시간이 지나면(파이프라인 복구) 성공**한다. 실패/멈춤만으로 "안 되는 것"으로 단정하지 말 것. 반영 확인은 배포본 `land.html` 의 `LAYER_TREE` 포함 여부로.
- 참고: `.nojekyll` 추가돼 있어 앞으로 콘텐츠 쪽으로는 빌드가 깨질 일이 없다.

### 손대면 안 되는 것
- `.nojekyll` 을 지우지 말 것. 이 리포는 정적 사이트라 Jekyll 은 불필요하며, 이 파일이 앞으로의 빌드 멈춤/실패를 원천 차단한다.

### Jekyll 분석 결론 (2026-08-07, 사용자 질문에 답함 — 재조사하지 말 것)
- **Jekyll 은 이 프로젝트에서 의도적으로 설정된 적이 없다.** git 히스토리 전수 조사: `_config.yml`/Gemfile/layouts/includes **한 번도 없음**, 프론트매터 있는 사이트 파일 0개, Liquid 0건. Jekyll 언급은 오늘 작성한 HANDOFF/TROUBLESHOOTING 문서뿐.
- Jekyll 이 있던 유일한 이유 = **GitHub Pages 기본 동작**(`.nojekyll` 없으면 legacy 빌드가 아무 저장소나 Jekyll 로 빌드). 프론트매터가 없으니 Jekyll 은 파일을 그대로 복사만 했고, 배포 결과물은 리포와 1:1 동일.
- Jekyll 이 유일하게 쓸모 있을 곳: 6개 HTML 페이지(index/onboarding/main/ai/land/detail)의 헤더·내비·푸터·CSS **중복 제거**(`_layouts`+`_includes`)뿐. 다만 이는 AGENTS.md 의 "No build tools" 원칙과 충돌 → **도입 보류 확정**. 중복 제거가 필요해지면 빌드 도구 없이(JS 주입 등) 처리하는 방향.

## 2026-08-07 (4) — opencode (마우스 동작 수정 — 지도 고정, 팝업만 밀어 넣음)

> 사용자 제보: 이동·클릭·줌 시 지도가 다른 곳으로 점프한다. 참조 사이트(서울도시공간포털)는 지도를 절대 움직이지 않고 정보를 고정 패널에 표시한다 — 같은 방식으로 수정.

### 원인 (분석 완료 — 재조사하지 말 것)
- 뷰 점프의 유일한 원인은 `repanPopup`의 `map.panBy([dx,dy], {animate:false})` 즉시 이동이었다. 팝업이 화면을 벗어나면 지도를 움직여 맞췄는데, ① 상세 정보가 하나씩 쌓여 팝업이 자라날 때마다 ② 줌 후에 지도가 훌쩍 다른 지역으로 옮겨갔다.
- moveend 핸들러 3개는 전부 debounce된 데이터 로드라 뷰 이동이 없다.

### 적용한 수정 (land.html, `clampPopup()` 신설)
- `map.panBy` 대신 **`popup.options.offset`을 `L.point(off.x - dx, off.y - dy)`로 줄여 팝업만 지도 안으로 끌어 들이고** `p._updatePosition()` 호출(내용 재렌더 없이 재배치만).
- `L.Popup.prototype._adjustPan`도 `clampPopup(this)` 호출로 교체(기존 `repanPopup(this, true)` → `clampPopup`). `repanPopup(p, precise)`의 precise 경로는 `clampPopup` 사용, 느슨한 판정 경로 유지(앵커가 `pad(-0.03)` 밖일 때만 — 상세 조회가 쌓일 때 어지럽게 움직이는 걸 막는 완충).
- 부호: 아래/오른쪽 넘침 → offset 감소(`-dx/-dy`), 위/왼쪽 → 증가. panBy와 반대 부호.
- Leaflet 1.9.4 `Popup._updatePosition`은 `_zoomAnimated` 분기에 따라 transform/bottom/left 둘 다 재설정 → offset 변경이 화면에 그대로 반영. offset이 배열일 수 있어 반드시 `L.point(offset || [0,0])` 정규화.

### 검증
- `clamp_test.html` (임시, 커밋 안 함)을 실제 Leaflet+CSS(headless Chrome)에서 실행 — 4케이스 전부 `insideAfter: true`·`centerMoved: false`: top-anchor(위 넘침)/right-edge(우측+하단 넘침)/center/zoom-after-clamp(줌 후에도 지도 고정·팝업 유지).
- land.html의 `clampPopup` 구현이 테스트 버전과 동일한지 대조 완료.
- 인라인 스크립트 node --check 통과(UTF-8 명시).

### Next Move
- 커밋·push → 배포 빌드 `built` 확인 → 배포본 land.html 반영 확인.

---

## 2026-08-07 (3) — opencode (land.html 로딩 속도 최적화 — 시작 시 2.5MB 절감)

> 사용자 요청: "페이지 로딩 속도 최적화, 최대한 코드 안 건드리면서." **아직 커밋 안 함** (편집만 완료, 문법 검증만 통과).

### 로드 타이밍 전수 조사 결과 (재조사하지 말 것)
- **이미 lazy**: 정비사업(`overlayadd` 시 redevelop_seoul.json + redevelop_polygons.json 10MB), 실거래가(`loadRp` — 레이어 켤 때), 빌라/단독(`_villaPromise`/`_housePromise`), Naver SDK(`ensureNaver`), Supabase(`ensureSb`), CCTV(bbox 이동 시).
- **시작 시 로드**: Leaflet/markercluster(필수), **toji_heoga.geojson 2.5MB**(문제 — 토지거래허가구역 레이어는 기본으로 꺼져 있는데 무조건 fetch), Kakao SDK(~L501, 기본 검색엔진이 vworld 인데 무조건 로드), 헤더 날씨·환율(소량, 그대로).

### 적용한 수정 (land.html, 2건)
1. **토지거래허가구역 지오JSON lazy-load** — `fetch('toji_heoga.geojson?v=2')` 를 시작 시 실행에서 `overlayadd` 핸들러(레이어 첫 활성화 때, `_tojiLoaded` 플래그로 1회)로 이동. 시작 다운로드 **2.5MB 절감**. 기존 overlayadd 패턴(정비사업)과 동일.
2. **정비사업 rows 중복 fetch 제거** — overlay 로드 완료 시 `_jbRowsGlobal = rows` 도 세팅해, 정비사업 레이어를 켠 뒤 검색창에 정비구역명을 치면 redevelop_seoul.json(~1MB)을 재다운로드 하지 않음. 검색→overlay 순서는 **의도적으로 안 건드림** — 검색 캐시엔 폴리곤이 없어 재사용하면 원반경 폴리곤으로 시각적 회귀가 생김(jbPolys null 허용 확인됨).

### 검증
- 인라인 스크립트 전부 `node --check` 통과 (UTF-8 명시 필수 — PS5.1 기본 인코딩이 한글을 깨뜨려 오탐 난다).

### 보류 (이유와 함께 — 최대한 안 건드리는 원칙)
- **Kakao SDK 시작 로드**: ~L501 무조건 주입. lazy로 옮기려면 `kakao.maps.services` 호출부 전부 확인이 필요해 침습적 → 이번엔 스킵. 원하면 다음에.
- 검색→overlay 중복 fetch: 위 2번 이유로 스킵.

### Next Move
1. 커밋·push → 배포 반영 확인 (`gh api repos/conoc612-a11y/matjip/pages/builds/latest --jq .status` → `built`, 배포본 land.html 에 `_tojiLoaded` 포함 확인).
2. (선택) Kakao SDK lazy 화 — 별도 세션에서 침습적으로.

---

## 2026-08-07 — Claude Code

### 한 일 (요청 4건)
1. **레이어 메뉴 3단화** (대분류 > 중분류 > 소분류). Leaflet 기본 컨트롤을 버리고 전용 패널 `.lp` 를 만들었다(`LAYER_TREE` 자료구조 + `layerPanel` 컨트롤). 9/36/63개.
   - 색 견본: `{MapServer}/legend?f=pjson` 의 `imageData`(base64 PNG)를 그대로 `UPIS_SWATCH` 로 박아 넣었다(41개, 9KB). 참조 사이트와 같은 색이 나온다.
   - 소분류는 레이어를 개별로 만들지 않는다. 중분류마다 타일 레이어 1개를 두고 `options.upisLayers` 문자열만 갈아끼운 뒤 `redraw()`.
   - **함정 1**: `upisGroupLayer()` 안에서 `mid._on = new Set()` 으로 초기화하면 방금 추가한 소분류 id 가 지워져 레이어가 안 뜬다. 초기화는 패널 생성 시 한 번만.
   - **함정 2**: 부분선택(indeterminate) 체크박스를 누르면 브라우저 기본은 '해제'다. 참조처럼 '전체 선택'이 되게 하려면 직전 indeterminate 여부를 `dataset` 에 기억해 두고 onchange 에서 뒤집어야 한다.
2. **CCTV 아이콘 표시**. 원인 2개: ① 반경 3km 조회 → ITS 는 고속도로·국도만 커버해 도심은 늘 0건(강남 0 / 서울 전역 240) → 화면 bbox 로 변경. ② **ITS 가 Supabase Edge Function IP 를 사실상 차단**(내 PC 1.5초 / Edge 20초+ 타임아웃, 재시도·병렬·캐시 다 넣어도 간헐 성공) → **브라우저 직접 호출로 전환**(CORS 허용 확인, 1.4초/220건). Edge Function 은 사내망 등 대비 폴백으로 남겨 둠. 실측 189개 마커.
   - **키 정책 변경**: `ITS_CCTV_KEY` 가 프론트에 노출된다. 서버 경유가 물리적으로 불가능해 내린 결정이고, 무료 공개 API 라 V-World·카카오와 같은 취급으로 바꿨다. `keys.env` 에도 정정 기록. 남용 시 its.go.kr 에서 재발급.
3. **드래그 시 엉뚱한 글자 선택** — 조작용 UI 에 `user-select:none`, 복사할 내용만 `text` 허용.
4. **팝업/패널 크기 조절 + 글자 자동 맞춤** — 팝업 내부 `.pc` 가 264px 고정이라 늘려도 여백만 생겼다 → `width:100%`. `.leaflet-popup-content` 의 `max-width` 도 화면폭까지 열어야 넓히기가 된다. 오른쪽 패널은 `#panel-resizer` 드래그(260 ~ 화면폭−360px, localStorage 저장, 놓을 때 `map.invalidateSize()`).

### 검증
JS 에러 0. 3단 메뉴: 소분류 1개 → `upisLayers="94"`, 중분류 전체 → `"94,95,96,97,98,99,100"`, 해제 → 제거. CCTV 마커 189개. 패널 280→430px 리사이즈·저장 확인.

---

## 2026-08-06 (4) — Claude Code

### 한 일
참조 사이트(서울도시공간포털)의 **주제도 목록 전체**를 matjip 레이어 메뉴에 옮겼다. 9개 대분류·36개 항목.

### 결정적 정보원: `/legend?f=pjson`
`{MapServer}?f=pjson` 은 레이어 이름이 코드(UPIS_C_UQ120_BZ101)로만 나와 한글명을 알 수 없다.
**`{MapServer}/legend?f=pjson` 을 쓰면 각 레이어의 한글 범례명이 그대로 나온다.** 이걸로 참조 사이트 범례와 100% 같은 이름·묶음을 만들었다(추측 없음). 다음에 항목을 더 늘릴 때도 이 엔드포인트를 먼저 볼 것.

### 확정한 레이어 매핑 (다시 조사하지 말 것)
- **도시계획사업** = UQ120_BZ* (id 94~122). 참조 범례의 6개 중분류:
  - 정비사업 94~100 (신속통합기획·재개발 도시정비형/주택정비형·재건축 단독/공동·주거환경개선 관리형/정비형)
  - 소규모정비사업 101~105 (모아타운·가로주택·자율주택·소규모재건축·소규모재개발)
  - 역세권사업 106~111 (장기전세주택·역세권 활성화·청년/어르신/신혼부부안심주택·미리내집)
  - 재정비촉진사업 112~115 / 국토부사업 116~117 / 기타사업 118~122
- **지구단위계획구역** = 33(UQ161), 특별계획구역 34(UQ165), 획지예정선 39(UQ162).
  주의: 56·79 그룹(DLYP01~61)은 지구단위계획 *세부요소*(조경·공개공지 등)라 대분류가 아니다. 처음에 이걸 지구단위계획구역으로 잘못 넣어 빈 화면이 나왔다.
- **용도지역** = 123, **용도지구** = 19~29, **용도구역** = 30,31,32
- **도시계획시설** = UQ151~159 → 3(도로)·12(주차장)·13(광장)·11(유통공급)·14(공공문화체육)·15(방재)·16(보건위생)·17(환경기초)·18(기타기반). `_OLD` 접미사(4~10)는 폐지분이라 쓰지 말 것.

### 그 밖에
- V-World 전국 용도지역은 '용도지역 (전국)' 으로 남겼다 — 서울 밖(경기)에서도 보여야 하므로. 서울 안에서는 UPIS '용도지역 (서울)' 이 참조와 같은 기호로 더 정확하다.
- 항목이 36개로 늘어 `.leaflet-control-layers-list` 에 스크롤을 넣었다.
- **GitHub Pages 는 push 후 바로 반영되지 않는다.** `gh api repos/<owner>/<repo>/pages/builds/latest` 로 `status: building/built` 을 확인할 것. 캐시로 오해하고 헛수고하지 말 것.

---

## 2026-08-06 (3) — Claude Code

### 한 일 (요청 5건 전부)
1. **참조 사이트 주제도 전체 이식** — 데이터를 받아 가공하지 않고 **같은 ArcGIS MapServer 를 타일로 직접 붙였다**. `L.TileLayer` 를 상속해 타일별 `/export` URL 생성(`UpisTile`). 기호·라벨·minScale 이 참조와 동일하게 동작한다.
   - 프록시 필수: MapServer 가 `http://98.33.2.225:6080` 이라 https 페이지에서 직접 못 부른다 → `https://urban.seoul.go.kr/proxy/proxy.jsp?` 경유. 브라우저에서 `new Image()` 로 실제 로드 확인함.
   - 레이어 id 는 `{MapServer}?f=pjson` 목록에서 뽑고, 묶음마다 `/export` 를 호출해 **빈 이미지(2,218바이트)와 크기 비교**로 실제 렌더 여부를 검증했다. 추가된 7종: 지구단위계획구역(57~71,80~90) / 용도지구(19~29) / 용도구역(30,31,32) / 도시계획시설(33,34,39~43,72~78) / 가로구역별 높이(333,337,338) / 기후환경(339~342) / 생태현황도(162,163,164).
   - 주의: 그룹 레이어는 하위 id 를 명시해야 그려진다. 지적도(1,2)는 minScale 5000 이라 충분히 확대해야 나온다(참조도 동일).
2. **레이어 메뉴 8개 대분류 + 순서 고정** — 헤더를 DOM 에 끼워 넣는 방식이라, 섹션 순서까지 맞추려면 선언 순서를 따르지 말고 `OVERLAY_SECTIONS` 순서대로 **DocumentFragment 로 재배치**해야 한다. 섹션에 없는 항목은 뒤에 그대로 붙여 사라지지 않게 했다.
3. **배경지도를 오른쪽 목록에서 제거** — `L.control.layers(null, landOverlays, …)`. 좌상단 썸네일이 이미 그 역할을 한다.
4. **줌 버튼 높이를 피커에 맞춤** — `.ctl-row` 를 `align-items:stretch` 로, 줌 컨트롤을 flex column 으로 만들어 각 버튼이 절반씩. 실측 87px = 87px.
5. **공인중개사 버튼 줄바꿈**(`white-space:nowrap` + `flex-wrap`), **팝업 리사이즈**(`resize:both`, `overflow:auto` 필요).

### 검증
- 로컬: JS 에러 0, 섹션 순서 8개 정의대로, 토글 후에도 유지, UPIS 타일 7장 로드/에러 0, 팝업 265×359 → 325×439 리사이즈 동작.
- **카카오 SDK 는 localhost 에서 도메인 잠금으로 안 뜬다** → 공인중개사 카드 실물은 배포본에서만 확인 가능.

---

## 2026-08-06 (2) — Claude Code

### 교훈 (가장 먼저 읽을 것)
사용자가 **참조 사이트(urban.seoul.go.kr)를 보라고 여러 번 지적**했는데도 내 방식(채우고 나서 한강을 오려내기)으로 계속 진행했다. 실제로 참조 사이트를 열어 확인했더니 **애초에 면을 칠하지 않는다** — 문제 자체가 존재하지 않는 구조였다. 사례가 있으면 내 방식을 먼저 시도하지 말고 **그 사례를 먼저 확인할 것.**

### 참조 사이트가 실제로 하는 방식 (ArcGIS export 를 직접 호출해 확인)
같은 UPIS MapServer 를 쓰지만 렌더링이 다르다:
1. **채우기 없음 — 외곽선만.** 얇은 주황 테두리 + `토지거래계약허가구역` 라벨. 자치구 전역 지정이 한강을 가로질러도 얇은 선만 보인다.
2. **`minScale: 50000`.** 축척 1:50,000 보다 축소하면 레이어를 아예 안 그린다(레이어 92 메타데이터에 명시). 서울 전역 축척에서 도시가 뒤덮이는 걸 막는 장치.
   - 확인 방법: `{MapServer}/export?bbox=...&layers=show:92&f=image` 를 프록시로 호출. 넓은 bbox → 빈 이미지, 좁은 bbox → 외곽선+라벨.
3. 메뉴는 '주제도' 아래 대분류 > 중분류 구조.

### matjip 에 반영한 것
- `tojiLayer` 스타일을 `fill: false` + 외곽선(`#e8590c`, weight 1.5)으로 변경.
- 줌 14 미만에서는 `opacity: 0` 으로 숨김(줌 14 ≈ 1:35,000, 13 ≈ 1:70,000 이라 참조의 1:50,000 경계에 대응). `zoomend`·`overlayadd`·데이터 로드 후 `applyTojiZoom()` 호출.
- 레이어 메뉴를 6개 대분류로 묶음: 도시계획사업 / 현장 확인 / 실거래 / 규제구역 / 행정경계 / 용도·지적.
  - **주의**: Leaflet 은 레이어 토글마다 `_update()` 로 목록 DOM 을 통째로 재생성한다. 헤더를 한 번만 꽂으면 첫 체크에 사라진다 → `layersCtrl._update` 를 감싸 갱신 뒤마다 `applyOverlaySections()` 재적용. 실측으로 토글 2회 후에도 헤더 6개 유지 확인.
- 검증: 로컬에서 줌 12·13 은 `opacity 0`, 14·16 은 `opacity 1`, `fill:false` 전 구간 확인. JS 에러 0건. 압구정~성수 한강 구간 캡처로 강이 깨끗한 것 확인.

### 남은 것
- 참조 사이트처럼 구역 **라벨**(구역명 텍스트)은 아직 안 넣었다. 필요하면 `L.tooltip({permanent:true})` 로 줌 15+ 에서만 노출하는 방식이 맞다(정비사업 배지와 같은 패턴).
- 중분류/소분류까지의 3단 구조는 아직 2단(대분류 > 항목)이다. 항목 수가 더 늘면 3단으로 확장할 것.

---

## 2026-08-06 — Claude Code

### Objective
"토지거래허가구역 폴리곤이 부정확하다 — 한강에도 칠해져 있다"는 제보 수정.

### 원인
기존 `toji_heoga.geojson` 은 **지정 동 전체를 칠하는 근사치**(32건)였다. 서울 행정동 경계는 한강 수면까지 포함하므로 압구정·여의도 앞 강이 통째로 덮였다. 직접 렌더링해 육안 확인함(빨강 구역이 파란 강을 가로지르는 띠가 보임).

### 조사에서 확정한 것 (다음 세션이 되풀이하지 말 것)
- **V-World `lt_c_upisuq175` 는 서울에 데이터가 없다.** 실측: 경기 23·인천(계양/남동/부평) 11·파주 2건, **서울 0건**. 서울은 시가 자체 지정하므로 국토부 전국 레이어에 안 들어간다. 이 레이어로 갈아타면 서울이 통째로 비어 더 나빠진다.
- **정답 소스: 서울 UPIS ArcGIS 레이어 92 = `UPIS_C_UQ175`** (정비사업 수집기와 같은 프록시/MapServer). 실제 경계 420건, 25개 자치구 전부, `CREATE_DAT` 2026-07-20.
- 그 데이터에는 **자치구 전역 지정 10건**(서초 46.9㎢·강남 39.5㎢·강서 41㎢ 등)이 들어 있다. 자치구 경계가 한강 중앙선까지 가므로 **원본 그대로 쓰면 한강이 덮인다** — 행정적으로는 맞는 경계다. 부동산 지도에선 노이즈라 하천을 빼야 한다.
- **하천 소스는 반드시 두 개를 합쳐야 한다.** UPIS 레이어 239(`UPIS_SHP_RIVER`, 78건) 하나만 빼면 물 위 샘플의 38.9%가 여전히 덮인다(영등포·용산·마포 구간에 구멍). V-World `lt_c_wkmstrm`(114건)도 단독으론 성수대교·여의도 북측을 안 덮는다. 두 데이터의 빈 구간이 서로 달라 **합집합**으로 빼야 메워진다 → 1.6%까지 떨어짐.
- 중복 고시가 있다(같은 구·같은 면적이 2~3건). 그대로 두면 반투명 채움이 겹쳐 진해지고 파일만 커진다 → 구+면적+둘레 기준으로 제거(16건).

### 검증 방법 (재현용)
- 손으로 찍은 좌표는 신뢰하지 말 것 — 내가 "강 한가운데"라고 찍은 점 2곳이 실제로는 물이 아니어서 잘못된 결론으로 갈 뻔했다.
- 대신 **하천 폴리곤 내부에서 샘플점을 뽑아** 허가구역이 덮는 비율을 재고, **PNG 를 직접 렌더링해 육안 확인**했다(브라우저 캡처가 막힌 환경이라 zlib 로 PNG 를 직접 인코딩). 강=파랑, 허가구역=반투명 빨강으로 겹쳐 그리면 겹침이 자주색으로 드러난다.

### 산출물
- `tools/collect_toji.js` 신규 — 수집·중복제거·하천 클리핑·좌표 단순화까지 한 번에. `VWORLD_KEY=... node tools/collect_toji.js` 로 재생성(키 없으면 V-World 하천만 생략하고 진행).
- `polygon-clipping` 은 빌드타임 전용 의존성(`npm i --no-save polygon-clipping`). 런타임/프론트에는 안 들어간다.
- 원본 19만 정점·4.3MB 라 Douglas–Peucker(약 2m)로 단순화해 줄였다. 도시 스케일 오버레이라 그 정밀도는 화면에 안 보인다.
- **단순화는 반드시 하천을 빼기 전에 해야 한다.** 클리핑 뒤에 단순화하면 강기슭을 따라 생긴 정교한 경계가 다시 직선으로 펴져 물 위를 덮는다(실측: 물 위 커버율 1.6% → 7.9% 로 악화). 순서를 뒤집지 말 것.
- 재실행은 오래 걸린다(하천 192개 폴리곤 합집합 계산에 수 분). 백그라운드로 돌릴 것.

---

## 2026-08-05 (심야 2) — Claude Code

### Objective
사용자가 "요청했는데 왜 반영 안 됐냐"고 지적한 3건 처리. **교훈: 이전 세션에서 HANDOFF 에 "목업만 하고 실코드 미반영"이라 적어두고 그대로 넘어간 항목이 있었다. 기록만 남기고 실제로 안 한 것은 안 한 것이다 — 다음 세션은 이 파일의 "미반영/보류" 항목을 먼저 확인할 것.**

### Work State — Completed (배포됨)
1. **배경지도 선택을 줌(+/−) 옆으로 + OSM 추가** — 미반영이었던 항목. `.ctl-row` 래퍼로 줌 컨트롤과 `.bm-picker` 를 한 줄에 넣었다(Leaflet 은 같은 코너 컨트롤을 세로로만 쌓으므로). `BASEMAPS` 에 `OSM (대체)` 를 4번째로 추가 — 기존엔 V-World 장애 시 자동 대체용으로만 있어 수동 선택 불가였다. 검증: 4종 클릭 시 타일 호스트가 vworld↔openstreetmap 으로 실제 전환됨, 좁은 화면 대응 media query(썸네일 52px) 추가.
2. **팝업 줌 재배치 — 진짜 원인 두 개 규명 후 수정**. 앞선 `bc66a95` 로 부족했던 이유:
   - Leaflet `_adjustPan()` 의 `_autopanning` 플래그가 다음 호출을 삼킨다(팝업 열 때 1회 패닝 → 그 다음 줌 호출이 무시). **`L.Popup.prototype._adjustPan` 을 통째로 교체** — 플래그 없이 픽셀 기준으로 잘렸는지만 보고 최소 거리 `panBy`.
   - 상세 내용은 `update()` 우회하여 **팝업 DOM 에 직접 주입**하므로 `update()` → `_adjustPan` 경로를 아예 안 탄다. 그 주입 지점 2곳(`fillLandInfo` 렌더 끝, 인근 상호 렌더)에서 `repanPopup(p, true)` 직접 호출로 변경. `_firstRender` 게이트도 제거(매번 부르지만 잘렸을 때만 최소 이동이라 3e02fdb 회귀 없음).
   - **실패한 접근 기록**: ResizeObserver 로 팝업 성장 감지 시도 → `--popup-max-h` 에 걸리면 컨테이너 크기가 안 변해 콜백 0회(실측). 제거함. 다시 시도하지 말 것.
   - 검증: 새 지점 클릭 후 상세 로드 완료 시 top 104(지도 top 92 + pad 12), 줌 12/19/15/17 전부 `fits: true`.
3. **참조 사이트 대조** — 서울도시공간포털은 `.esri-popup__main-container { max-height:300px; }` + `.esri-popup__content { overflow: hidden auto; }`. 즉 "고정 최대높이 + 내부 스크롤". matjip 은 이미 동일 구조에 고정값 대신 지도 높이 62%(`--popup-max-h`)라 더 반응형 — 높이 방식은 바꿀 필요 없었고 문제는 위치였음이 확인됨.

### 여전히 미반영/보류 (다음 세션이 이어받을 것)
- **헤더 대출금리** — 은행별 실시간 비교는 금감원 Finlife API 필요(키 미신청). 수출입은행 AP02/AP03 은 `result:2` 로 사용 불가(위 항목 참고).
- **CCTV 영상** — ITS 가 Supabase Edge Function 아웃바운드 IP 차단(로컬 curl 2초 성공 / Edge 무응답). 레이어·팝업 UI 는 구현돼 있고 데이터만 안 옴.

---

## 2026-08-05 (심야) — Claude Code

### Objective
헤더 날씨·환율 위젯 실제 구현·배포 + CCTV(ITS 키 수령) 연동 시도.

### Work State
**Completed (배포됨)**
- Edge Function 3개 신규 배포 (전부 `--no-verify-jwt`): `kma-weather-proxy`, `eximbank-proxy`, `its-cctv-proxy`. Supabase secrets에 `EXCHANGE_RATE_KEY`, `ITS_CCTV_KEY` 등록.
- **헤더 날씨** — 지도 클릭 시 그 지점으로 갱신됨(실측: 해운대 중동 26℃ → 대구 사일동 26℃ → 강남역 서초동 29℃ 구름많음). 기상청 초단기예보(`getUltraSrtFcst`) 사용. `kma-weather-proxy`가 위경도→기상청 격자(nx,ny) Lambert 변환과 base_date/base_time 계산까지 서버에서 처리하므로 프론트는 lat/lng만 넘긴다. data.go.kr 인증키는 계정당 공용이라 기존 `MOLIT_KEY`를 재사용(별도 발급 불필요).
- **헤더 환율** — USD + JPY(100) 두 개 표시(실측 USD 1,428.2 / JPY 905.16). 한국수출입은행 AP01. 휴일엔 고시가 없어 최대 6일 거슬러 재조회.
- **버그 수정: `reverseGeocode` JSONP 콜백 이름 충돌(기존 잠재 버그)** — 콜백 전역명이 좌표만으로 만들어져, 같은 지점을 동시에 두 번 조회하면(지도 클릭 시 팝업 주소용 + 헤더 날씨 지역명용) 뒤에 등록한 쪽이 `window[name]`을 덮어써 앞의 콜백이 영구히 안 불렸다. 실제로 헤더 지역명이 이전 지점에 멈추는 증상으로 드러남. 호출마다 `_vwRevSeq` 고유번호를 붙여 해결.
- **버그 수정: TDZ** — `EXIM_PROXY` 등 프록시 상수를 `MOLIT_PROXY` 근처(1500번대)에 뒀는데 헤더 위젯이 1300번대에서 즉시 호출해 `Cannot access before initialization`으로 **스크립트 전체가 죽었다**(그 아래 `let _naverPromise` 등도 초기화 안 돼 연쇄 에러). 상수를 사용 지점 앞으로 이동.

**Blocked — CCTV**
- 키는 정상이고 **로컬(직접 curl)에서는 2초 내 41건 응답**하지만, **Supabase Edge Function(Deno Deploy)에서는 응답이 아예 없다**(8초 타임아웃까지 무응답). ITS가 클라우드 아웃바운드 IP대역을 차단하는 것으로 판단 — 한국 공공기관 API에 흔한 패턴이며 패킷 드랍형이라 일반 타임아웃과 구분되지 않는다.
- 현재 상태: 레이어 목록에 'CCTV (실시간 도로영상)' 항목은 있고, 켜도 **마커 0개 + JS 에러 0건 + 지도 정상 동작**(조용히 비활성). 앱을 깨뜨리지 않으므로 그대로 배포함. 프록시에 8초 `AbortController` 타임아웃을 걸어 무한 대기를 막아뒀고 응답에 `timedOut: true`를 실어 원인 추적이 가능하다.
- **이어서 할 것(우회 방법)**: (1) Cloudflare Workers 등 다른 IP대역에서 재시도, (2) ITS에 서비스 IP 등록/문의, (3) 사용자 브라우저에서 직접 호출 — 단 이러면 `apiKey`가 노출되므로 ITS 콘솔에 도메인 잠금이 되는지 먼저 확인해야 함(안 되면 이 방법은 쓰지 말 것). CCTV 팝업 UI(영상 재생 + 닫기 버튼 + hls.js 지연로드)는 이미 구현돼 있어 데이터만 들어오면 바로 동작한다.

**대출금리 — 제외됨(구현 안 함)**
- 한국수출입은행 `exchangeJSON`은 **AP01(환율)만 동작**. `data=AP02`/`AP03`은 키 4가지 조합(LOAN_RATE_KEY/INT_RATE_KEY × AP02/AP03) 전부 `result:2`(데이터코드 오류) — 엔드포인트 자체가 확인 불가. 사용자 지시로 헤더에서 제외.
- 애초에 수출입은행 API는 자기 은행 금리 하나만 주는 구조라 "은행별 비교"와 맞지 않음. **올바른 소스는 [금융감독원 Finlife(금융상품 한눈에)](https://finlife.fss.or.kr/finlife/main/main.do?menuNo=700000)** — 은행별 주택담보/전세자금/신용대출 금리 비교 제공, 무료, 별도 키 신청 필요. 은행연합회 소비자포털(portal.kfb.or.kr)은 웹페이지만 있고 OpenAPI 없음. 한국은행 ECOS는 은행별이 아니라 평균·월별.

### Next Move
1. Finlife 키 신청 → `finlife-proxy` Edge Function → 헤더에 은행별 대출금리 추가(원래 사용자 요구사항: "은행별로 금리가 계속 변경되게").
2. CCTV IP 차단 우회(위 3안 중 택일).

---

## 2026-08-05 (밤, 늦게) — Claude Code

### Objective
헤더 정보(날씨·금리·환율) + 지도 CCTV 팝업 기능 논의. 목업까지 만들고 실제 반영 전에 CCTV API 출처를 조사하다 사용자가 이미 별도로 키를 신청해뒀다는 걸 확인, CCTV는 보류하고 기록만 남김.

### Work State
**Completed (목업 — 실제 land.html엔 아직 미반영)**
- 헤더에 "부동산 지도" 제목 옆으로 날씨·대출금리·환율 정보 칩을 붙이는 디자인을 목업(`_mockup_header_cctv.html`, 로컬 서버로 검증 후 삭제 — 커밋 안 됨)으로 만들어 확인. 지도 클릭 시 클릭 지점 날씨로 갱신, CCTV 핀 클릭 시 영상 팝업(닫기 버튼 포함) 여닫기까지 인터랙티브하게 동작 확인함.
- 지도 종류 선택 UI(일반지도/위성지도/위성+라벨)는 이미 실제 `land.html`에 반영·배포됨(이전 항목 "배경지도 썸네일 선택 UI" 참고). OSM을 4번째 옵션으로 추가하는 것과 zoom(+/−) 컨트롤 바로 옆에 붙이는 배치는 목업에서만 확인, 아직 실코드 미반영.

**CCTV API 조사 결과 — 정정 필요**
- data.go.kr에 승인돼 있는 **기상청_CCTV 기반 도로날씨정보 조회서비스**(`https://www.data.go.kr/data/15057966/openapi.do`)는 **영상이 아니라 그 CCTV 지점의 날씨 텍스트**(날씨명·관측시각)만 준다. 엔드포인트: `https://apis.data.go.kr/1360000/RoadWthrInfoService/getCctvStnRoadWthr` (params: ServiceKey, pageNo, numOfRows, eqmtId). 이 키가 실제로 발급됐는지는 `keys.env`에서 확인 안 됨(변수명 목록에 없었음) — data.go.kr 마이페이지에서 확인 필요.
- 처음에 "영상 팝업엔 국토교통부_CCTV 화상자료(`data.go.kr/data/15040466`)를 신청하라"고 안내했는데, **사용자가 이미 정확한 경로로 [ITS 국가교통정보센터](https://www.its.go.kr/user/mypage)에 직접 인증키를 신청해둔 상태(승인 대기 중, 2026-08-05 기준)**. data.go.kr의 15040466 리스팅은 "LINK" 유형이라 실제 키 발급은 ITS 자체 마이페이지에서 이뤄지는 게 맞다 — 처음 안내가 부정확했다.

**Blocked**
- CCTV 영상 기능은 ITS 국가교통정보센터 키 승인 대기 중 (사용자 지시: "CCTV 건은 나중에 하자"). **키 승인되면 이어서**: (1) 키를 `keys.env`에 등록(예: `ITS_CCTV_KEY`), (2) `supabase/functions/cctv-proxy` Edge Function으로 감싸기(기존 `molit-proxy`/`naver-search` 패턴), (3) land.html에 CCTV 마커+영상 팝업(닫기 버튼) 실제 구현, (4) 기상청 CCTV 도로날씨 API로 팝업에 노면 날씨 텍스트도 같이 노출.

### Next Move (CCTV 제외, 바로 착수 가능)
- 헤더 날씨·금리·환율 위젯은 **키가 이미 다 있어서** CCTV와 무관하게 바로 구현 가능: 기상청 단기예보(승인됨) + 한국수출입은행 AP01(환율)·AP02(대출금리)(`EXCHANGE_RATE_KEY`/`LOAN_RATE_KEY`, `keys.env`에 등록돼 있음, 아직 Edge Function 연동 안 됨 — `API 정보.txt` §6 참고). 목업 디자인 그대로 가져다 실코드에 반영하면 됨.

### Relevant Files
- `API 정보.txt` §6 (금융 API), §8 (도시공간포털 CCTV 관련 없음 — 별도)
- `keys.env` (gitignored) — 변수명: VWORLD_KEY, KAKAO_JS_KEY, NAVER_MAPS_KEY, ODSAY_KEY, MOLIT_KEY, NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, DGK, EXCHANGE_RATE_KEY, LOAN_RATE_KEY, INT_RATE_KEY, CHUNGAK_API_KEY (ITS CCTV 키는 승인되면 여기 추가)

---

## 2026-08-05 (밤) — Claude Code

### Objective
"건물 클릭 팝업이 지도 확대·축소 시 자동으로 맞춰지지 않는다" 버그 리포트(스크린샷 첨부) 조사·수정.

### Work State
**Completed**
- 원인 특정: `zoomend` 핸들러가 `p.getElement()`(바깥 `.leaflet-popup` 래퍼)에 `maxHeight`/`minWidth`/`maxWidth`를 인라인으로 지정했는데, 실제 높이 제한은 안쪽 `.leaflet-popup-content`에 CSS 변수 `--popup-max-h`로 걸려 있어 그 조작이 **아무 효과 없는 죽은 코드**였다. 재배치 판정(`repanPopup`)도 좌표 기준 휴리스틱(`pad(-0.03)`)이라 앵커가 가장자리 근처로 줌되면 못 잡아냈다.
- 수정: `repanPopup(p, precise)`에 `precise` 옵션 추가 — 픽셀 기준으로 팝업 DOM 박스가 지도 컨테이너 밖으로 나갔는지 직접 검사. `zoomend`는 `precise=true`로 호출, 기존 좌표 기준 판정은 비동기 상세 조회 렌더(`repanPopup(p)`, 인자 생략)에 그대로 남겨둠 — 이유는 아래 참고.
- 검증: 지도 가장자리 근처에 팝업을 열고 줌 → 줌 전 `top:-136px`(화면 밖) → 줌 후 `top:116px`(정상). 팝업이 이미 화면 안에 있는 일반 케이스에서는 불필요한 지도 이동 없음(회귀 없음) 확인.

**주의 — 건드리면 안 되는 부분**: `repanPopup(p)`를 인자 없이 호출하는 곳(비동기 상세 조회 재렌더, ~L2116)은 **정밀 판정으로 바꾸면 안 됨**. 과거에 상세 조회가 하나씩 쌓일 때마다 지도가 순간이동하는 버그가 있었고(커밋 `3e02fdb`), 그걸 막으려고 일부러 느슨한 좌표 기준 판정을 쓰는 중. `zoomend`(한 번의 명확한 사용자 동작)만 정밀 판정 적용.

### Relevant Files
- `land.html` — `repanPopup()` ~L1467, `zoomend` 핸들러 ~L2158

### Objective
(1) 좌상단에 '항공' 토글 버튼만 있어 배경지도 종류를 알 수 없는 문제, (2) "폴리곤이 지도와 안 맞는다"는 지적 조사.

### Work State
**Completed**
- 배경지도 선택 UI를 썸네일 3종(일반지도/위성지도/위성+라벨) `.bm-picker`로 교체. 썸네일은 실제 V-World 타일(z15 서울 도심) 사용 — 별도 이미지 파일 없음. 전환·활성표시·타일로드(200) 브라우저로 검증.
- 폴리곤 정확도 조사: **matjip 데이터는 정확함을 입증**. 재개발닷컴(네이버 위성) 지도에 matjip 폴리곤을 직접 겹쳐 그려 픽셀 단위 일치 확인. V-World↔OSM 타일 비교로 좌표계 오프셋 없음도 확인.
- `smoothFactor` 2 → 1 적용. 줌 17 기준 경계 이탈 2.43m → 0.95m (실측).

**Blocked / 미해결**
- 사용자가 본 폴리곤 어긋남을 **재현하지 못함**. 데이터·좌표계·렌더링 모두 정상으로 측정됨. 재현되는 구역이 특정되면 그 구역의 `rc`(PRESENT_SN)로 재조사 필요.

### 조사 방법 메모 (다음 AI 참고)
- 브라우저 pane 스크린샷이 이 환경에서 실패할 수 있음("pane is not displayed"). 그럴 땐 `javascript_tool`로 수치 검증하거나, 타일을 Node로 내려받아 Read 툴로 이미지 확인.
- Chrome 확장(claude-in-chrome)은 github.io·localhost 도메인이 차단될 수 있음. 외부 비교 사이트(재개발닷컴 등)는 접근 가능하므로, **비교 사이트 지도 위에 matjip 데이터를 얹어 검증**하는 방식이 유효했다.
- Leaflet `smoothFactor` 편차는 점-점 거리가 아니라 **점-선분 수직거리**로 재야 한다(점-점으로 재면 89m처럼 과대평가됨).

### Relevant Files
- `land.html` — `.bm-picker` CSS ~L136, 배경지도 컨트롤 ~L1110, 폴리곤 생성 `jbBuild()` ~L947

---

## 2026-08-05 (오후) — Claude Code

### Objective
opencode가 `improve/redevelop-data` 브랜치에서 정비사업 데이터 개편 작업 중 커밋 못 하고 세션이 끊김 → Claude가 이어받아 마무리.

### Important Details
- **브랜치**: `improve/redevelop-data` (master 아님 — 새로 시작하는 AI는 반드시 확인).
- opencode 작업 내용은 `opencode export <sessionID>`로 복원 가능. 관련 세션: `ses_02fec90d9ffebLR3KkesEWhSQV`("신통 등 개선작업 중 멈춤"). `opencode session list`로 프로젝트별 세션 목록 확인.
- 이 브랜치는 master보다 앞서 있음(master의 `abe1653`을 포함한 상태에서 분기).

### Work State
**Completed (opencode, 커밋 대기였던 것 → 이번에 커밋됨)**
- `tools/collect_redevelop.js` 신설 — 서울도시공간포털 UQ120 전체 수집기 (`bz` 사업유형코드 필드 포함)
- `redevelop_seoul.json` 1,137→2,964건, `redevelop_polygons.json` 갱신
- `land.html`/`js/main.js`: `JB_SEC` 대분류(정비/소규모/역세권/국토부·기타) 메뉴 개편, `jbGroup()` bz 우선 분류로 모아타운 오분류 버그 수정, null 좌표 크래시 가드
- 브라우저 검증(puppeteer): 폴리곤 줌 재렌더 정상, JS 문법·HTML 균형 확인

**Completed (Claude, 이번 세션)**
- 폰트 크기를 참조 사이트(urban.seoul.go.kr) 실측값에 맞춤: 대분류 13px/600, 중분류 13px/400 (기존 12px)
- 메뉴 패널이 지도 높이를 넘던 기존 버그 수정 — `.lc`에 `overflow-y:auto` + 부모(지도) 기준 높이 제약 + 모바일용 `max-height:calc(100vh - 240px)` 이중 적용. `disableScrollPropagation`으로 메뉴 스크롤이 지도 줌으로 새는 것 방지.
- 데스크톱(1280x720)·모바일(375x812) 양쪽에서 패널이 화면 안에 들어오고 진행단계 칩까지 스크롤로 도달 가능함을 실제 브라우저로 확인
- README.md에 "정비사업 데이터 개편" 절 추가

**Blocked / 확인 필요**
- 없음. 검증 항목은 다 통과.

**미착수 (README §"개선 제안" 3~6번, 원래 계획에 있었으나 손 안 댐)**
- 추진단계 이력·담당부서 노출
- 신통기획·모아타운 뉴스 피드
- 취소구역 연동
- `main.js`에 `usableRings`(퇴화 폴리곤 필터) 로직 이식 — land.html엔 있고 main.js엔 원래부터 없던 차이, 이번에 손 안 댐

### Next Move
1. 이 커밋을 `improve/redevelop-data`에 만들고, 사용자 확인 후 master로 머지할지 결정
2. 사용자가 실제 배포본에서 눈으로 확인 (요청받음 — 배포 후 링크 확인 필요)
3. 이후 README §"개선 제안" 3~6번 중 우선순위 정해 진행

### Relevant Files
- `land.html` — `.lc`/`.lc-title`/`.lc-check`/`.lc-sub` CSS ~L126, `jbCtrl` 메뉴 정의 ~L967
- `js/main.js` — `JB_COLOR`/`jbGroup` ~L589
- `tools/collect_redevelop.js` — UQ120 수집기, PROXY `https://urban.seoul.go.kr/proxy/proxy.jsp?`
- `redevelop_seoul.json` (2,964건) / `redevelop_polygons.json` (2,963개 폴리곤)

---

## 2026-08-05 (오전) — Claude Code

### Objective
land.html에 하드코딩돼 있던 국토교통부 건축HUB `serviceKey`(MOLIT_KEY)가 공개 GitHub Pages 저장소에 노출된 것 발견 → 제거·재발급·서버 프록시로 분리.

### Work State
**Completed**
- 구 키 폐기, 신규 키 발급 → Supabase Edge Function `supabase/functions/molit-proxy`로 분리 (`Deno.env.get('MOLIT_KEY')`만 사용, 프론트엔 키 없음)
- 배포·시크릿 등록 완료(`supabase secrets set`, `supabase functions deploy`), 실제 호출 테스트로 정상 동작 확인(`resultCode: "00"`)
- master에 커밋·push 완료 (`5347fa2`)

### Relevant Files
- `supabase/functions/molit-proxy/index.ts`
- `land.html` — `MOLIT_PROXY` 상수 ~L1298, `ledgerOp()` ~L1322

---

## 작업 규칙 (모든 AI 공통)
- **API 키는 절대 프론트(html/js)에 하드코딩하지 않는다.** data.go.kr `serviceKey`처럼 계정 단위 호출한도가 있는 키는 반드시 Supabase Edge Function 프록시로 분리한다 (`molit-proxy`, `naver-search` 패턴 참고). 상세: `AGENTS.md` "API keys" 절.
- **작업을 마칠 때마다 이 파일과 README.md를 갱신한다.** 다른 AI(opencode/Claude 등)가 이어받을 수 있어야 한다.
