# API_SCHEMA — DB 연결용 참조 (AI가 코드 쓸 때 먼저 읽는다)

## 이 문서의 목적

1. **개발 시 DB 연결 문제 해결** — 호출 형태·응답 경로·필수 파라미터를 그대로 복사해 쓴다.
2. **같은 정보를 여러 DB로 교차해 정확도 올리기** — §4 교차검증 매트릭스.
3. **여러 DB를 범주로 묶어 입지 평가·서비스 기획** — §5 범주별 인덱스.

**활용 목표는 "같은 문제를 반복하는 빈도를 줄이는 것"이다.** 아래는 실제로 이 세션에서 내가
틀렸던 것들이고, 문서에 있었으면 한 번에 끝났을 것들이다:

| 헛발질 | 원인 | 이 문서의 어느 항목이 막아 주나 |
|---|---|---|
| 실거래 경로를 `getRTMSDataSvcNrgTrade/getRTMS…` 로 씀 → 전부 `NO_OPENAPI_SERVICE` | 서비스명에 `get` 접두사를 붙였다 | **호출** 템플릿 |
| `curl --data-urlencode "serviceKey=$DGK"` → 승인된 API 도 401 | `DGK` 가 Encoding 키(`%` 포함)라 이중 인코딩 | **함정** |
| 서울 12개 구 데이터 유실을 못 알아챔 | 오류 응답을 '0건'으로 해석 | **응답경로** + **오류 표현** |
| 파라미터명 `pnu`·`lnoCd`·`cd` 로 3번 헛시도 | 정답은 `key` | **필수** |
| "상업업무용은 지번이 마스킹된다" 단정 | 첫 행만 보고 일반화 | **커버리지**(실측 비율) |

---

## 0. 이 문서를 쓰는 법 (AI용)

### 0-1. 응답 경로가 제공자마다 다르다 — 여기서 가장 많이 깨진다

| 제공자 | 데이터까지의 경로 | 주의 |
|---|---|---|
| data.go.kr XML/JSON | `response.body.items.item` | **단건이면 배열이 아니라 객체로 온다** |
| data.go.kr 일부(소상공인) | `body.items` (response 껍데기 없음) | 둘 다 대비할 것 |
| odcloud (`api.odcloud.kr`) | `data[]` + `currentCount` | 평평하다 |
| V-World | `response.result.featureCollection.features[].properties` | JSONP(콜백) |

**항상 이 형태로 흡수한다** — 한 줄로 세 경우를 모두 처리한다:
```js
const body = (j && (j.body ?? (j.response && j.response.body))) || {};
const it = body.items;
const arr = Array.isArray(it) ? it : (it && it.item ? [].concat(it.item) : []);
```

### 0-2. 오류를 '0건'과 반드시 구분한다

**data.go.kr 은 쿼터 초과·스로틀링에도 HTTP 200 에 오류 XML 을 실어 보낸다.**
이것 때문에 실거래 첫 수집에서 서울 12개 구가 조용히 사라졌다(TROUBLESHOOTING §54).

| 응답 | 뜻 | 대응 |
|---|---|---|
| `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | 경로는 맞고 **미신청** | data.go.kr 에서 활용신청 |
| `NO_OPENAPI_SERVICE_ERROR` | **경로가 틀렸거나** 폐기됨 | 경로 재확인 |
| `NO_MANDATORY_REQUEST_PARAMETERS_ERROR` | **접근 가능**, 필수 파라미터만 빠짐 | 파라미터 채우기 |
| `LIMITED_NUMBER_OF_SERVICE_REQUESTS…` / `resultCode≠0` | 쿼터·스로틀링 | **멈추고 기다린다**(즉시 재시도 금지) |
| V-World `status:"ERROR"` + `INCORRECT_KEY` | 도메인 잠금 | 배포본 브라우저에서 호출 |
| odcloud `HTTP 401 {"code":-4}` | 키 형식/미신청 | 인코딩 확인 |

💡 이 차이로 **신청 없이 오퍼레이션 목록을 열거**할 수 있다 — 이름만 바꿔 쏘면
존재하는 것은 `SERVICE_KEY_IS_NOT_REGISTERED`, 없는 것은 `NO_OPENAPI_SERVICE` 다.
(소상공인 12개 op 를 그렇게 확인했다.)

### 0-3. 키 함정

| 키 | 성격 | 함정 |
|---|---|---|
| `DGK` | data.go.kr **계정 공용**, 개발계정 일 10,000 | ① **Encoding 키(`%` 포함)** → URL 에 그대로 붙인다. `--data-urlencode` 금지<br>② **이 키를 쓰는 수집기를 동시에 두 개 이상 돌리지 말 것** — 합계가 한도를 넘겨 중간 구간이 조용히 비워진다(§54) |
| `MOLIT_KEY` | 건축HUB 전용(별도) | 프론트에 두지 말 것 → `molit-proxy` 경유 |
| `VWORLD_KEY` | **도메인 잠금** | 로컬 curl 은 `INCORRECT_KEY`. 배포본에서만 측정 가능 |
| 카카오 · 네이버 | **도메인 잠금** | localhost 에서 안 뜬다(TROUBLESHOOTING §1) |

### 0-4. 새 API 를 붙일 때 순서

1. **PNU 로 조회되는지 먼저 본다** — 되면 좌표 계산·주소 매칭이 전부 불필요해진다.
2. 에러코드로 신청 상태 확인(§0-2).
3. **검증용 입력으로 한 번 호출**해 응답 경로와 필드를 눈으로 본다.
4. 키를 갖는 API 면 **Edge Function 프록시** 를 만든다(프론트에 키 금지).
5. 이 문서에 블록을 추가하고 §2·§3 을 갱신한다.

---

## 1. matjip 에 연결된 DB 리스트 (전체 인벤토리)

**외부 소스 21곳.** 여기 없는 것을 쓰려면 새로 붙이는 것이다.

| # | 제공 | 호스트 / 서비스 | 용도 | 경유 | 키 | 상태 |
|---|---|---|---|---|---|---|
| 1 | 국토지리정보원 | `api.vworld.kr` | 지적·용도지역·건물·지오코딩·검색·타일 | 직접(JSONP) | `VWORLD_KEY` **도메인잠금** | ✅ |
| 2 | 국토교통부 | `apis.data.go.kr/1613000/BldRgstHubService` | 건축물대장 11 op | `molit-proxy` | `MOLIT_KEY` | ✅ |
| 3 | 국토교통부 | `apis.data.go.kr/1613000/RTMSDataSvc*` | 실거래 10종 | 수집기 → 정적 JSON | `DGK` | ✅ |
| 4 | 소상공인시장진흥공단 | `apis.data.go.kr/B553077/…/sdsc2` | 상가(상권)정보 | `sbiz-proxy` | `DGK` | ✅ |
| 5 | 국세청 | `api.odcloud.kr/nts-businessman` | 사업자등록 진위·상태 | `bizno-proxy` | `DGK` | ✅ |
| 6 | 한국부동산원 | `api.odcloud.kr/ApplyhomeInfoDetailSvc` | 청약홈 분양정보 | `chungak-proxy` | `DGK` | ✅ |
| 7 | 기상청 | `apis.data.go.kr/1360000/VilageFcstInfoService_2.0` | 단기예보 | `kma-weather-proxy` | `DGK` | ✅ |
| 8 | 한국환경공단 | `apis.data.go.kr/B552584/EvCharger` | 전기차 충전소 | 수집기 → 정적 JSON | `DGK` | ✅ |
| 9 | 행정안전부 | `apis.data.go.kr/1741000/cctv_info` | CCTV 표준데이터 | 수집기 → 정적 JSON | `DGK` | ✅ |
| 10 | 국가교통정보센터 | `openapi.its.go.kr:9443/cctvInfo` | CCTV 실시간 영상 | `its-cctv-proxy` | `ITS_CCTV_KEY` | ✅ |
| 11 | 한국수출입은행 | `oapi.koreaexim.go.kr` | 환율 | `eximbank-proxy` | `EXCHANGE_RATE_KEY` | ✅ |
| 12 | ODsay | `api.odsay.com` | 대중교통 경로 | 직접 | `ODSAY_KEY` | ✅ |
| 13 | OSRM | `router.project-osrm.org` | 도로 경로 | 직접 | 없음 | ✅ |
| 14 | 카카오 | `dapi.kakao.com` (SDK) | 장소 검색(카테고리 8종) | 직접 | `KAKAO_JS_KEY` **도메인잠금** | ✅ |
| 15 | 네이버 | `openapi.map.naver.com` | 지도 SDK·역지오코딩 | 직접 | `NAVER_MAPS_KEY` **도메인잠금** | ✅ |
| 16 | 네이버 | `openapi.naver.com/v1/search/local` | 지역 검색 | `naver-search` | `NAVER_CLIENT_*` | ✅ |
| 17 | 서울시 | `urban.seoul.go.kr` | UPIS 도시계획 주제도 | 프록시 | 불필요 | ✅ |
| 18 | 서울시 | `cleanup.seoul.go.kr` | 정비사업 | 직접 | — | ✅ |
| 19 | 법원 | `courtauction.go.kr` | 경매 (**API 아님·스크레이핑**) | Playwright 수집기 | — | ✅ |
| 20 | Supabase | `bhgijvaxxjnocgfnaaeu.supabase.co` | 자체 DB + Edge Function 12개 | — | `SUPABASE_*` | ✅ |
| 21 | Cloudflare R2 | `pub-…r2.dev` | 경매 사진 40,198개 | 직접 | 공개 | ✅ |

**Edge Function 12개**: `molit-proxy` `sbiz-proxy` `bizno-proxy` `chungak-proxy`
`kma-weather-proxy` `eximbank-proxy` `its-cctv-proxy` `vworld-geocode` `naver-search`
`visit-count` `admin-*` `delete-account`

⚠️ **키를 갖는 API 는 반드시 Edge Function 경유.** 프론트에 두면 공개 배포본에 노출된다
(MOLIT_KEY 노출 사고). 예외는 도메인 잠금으로 보호되는 V-World·카카오·네이버 SDK 뿐이다.

---

## 2. 공공데이터포털 82건 — 무엇을 쓰고 무엇을 못 쓰는가

계정(conoc) 활용신청 **82건**(승인 79 · 신청중 3). 그중 matjip 이 실제로 쓰는 것은 **16종**이고
**66종은 승인만 받아 두고 안 쓴다.**

### 2-1. ✅ 활용 중 (16종)

| 승인 항목 | 어디에 쓰나 |
|---|---|
| 국토교통부_건축HUB_건축물대장정보 | 팝업 토지·건물 정보 + 상세(op 11개) |
| 국토교통부_아파트 매매 실거래가 상세 | `realprice_apt.json` |
| 국토교통부_아파트 전월세 | 전세가율 |
| 국토교통부_연립다세대 매매 | `realprice_villa.json` |
| 국토교통부_연립다세대 전월세 | 전월세 |
| 국토교통부_단독/다가구 매매 | `realprice_house.json`(동 집계) |
| 국토교통부_단독/다가구 전월세 | `realprice_house_rent.json` |
| 국토교통부_오피스텔 전월세 | `realprice_officel.json` |
| 국토교통부_상업업무용 부동산 매매 | `realprice_nonres.json` ← **2026-08-22 신규** |
| 국토교통부_오피스텔 매매 | 같음 ← **신규** |
| 국토교통부_공장 및 창고 등 매매 | 같음 ← **신규** |
| 소상공인시장진흥공단_상가(상권)정보 | 팝업 '이 건물 업소' ← **신규** |
| 한국부동산원_청약홈 분양정보 | 청약 탭(24h 캐시) |
| 국세청_사업자등록정보 진위확인·상태조회 | 헤더 사업자등록증조회 |
| 기상청_단기예보 | 헤더 날씨 |
| 한국환경공단_전기자동차 충전소 정보 | 충전소 레이어 |
| 행정안전부_CCTV정보 조회서비스 | CCTV 레이어(39,484건) |

### 2-2. 🔒 승인만 받고 미활용 (66종) — 범주별

**부동산·건축 (우선순위 높음)**

| 항목 | 왜 값이 있나 |
|---|---|
| 건축HUB_건축인허가정보 | **"이 옆에 뭐가 올라오나"** — 착공 전 단계까지 |
| 건축HUB_주택인허가정보 | 주택 공급 파이프라인 |
| 건축HUB_건물에너지정보 | 실제 관리비 추정·노후도 |
| 건축HUB_건축물유지점검정보 | 안전점검 이력·하자 리스크 |
| 건축HUB_폐쇄말소대장정보 | **철거된 건물** → 재개발 진행 확인 |
| 국토교통부_토지이용규제정보서비스 | 행위제한 원문 |
| 국토교통부_공동주택 기본 정보제공 | 단지 기본정보 |
| 국토교통부_아파트 분양권전매 실거래가 | 분양권 시장 |
| 한국부동산원_공동주택 단지 식별정보 | ⭐ **단지 코드 표준** — 문자열 매칭 대체(정확도) |
| 한국부동산원_전국지가변동률조사 마이크로데이터 | 지가 추세 |
| 한국부동산원_녹색건축 인증현황 | 인증 |
| 한국부동산원_청약홈 청약 신청·당첨자 정보 | 청약 경쟁 실적 |
| 한국부동산원_청약홈 경쟁률·특별공급 신청현황 | 같음 |
| 한국자산관리공사_차세대 온비드 물건상세 입찰정보 | **공매** — ⚠️ 선행 '물건목록' 미신청으로 단독 사용 불가 |
| 예금보험공사_파산금융회사 매물현황(부동산) | 특수 매물 |

**공동주택 관리 (보유비용 — 8종)**

공동주택 관리비(개별사용료) · 관리비(장기수선충당금) · 하자담보책임기간 · 유지관리 이력 ·
입찰공고 · 입찰결과공지 · 수의계약 공지 · 단지 목록제공

**공공주택·임대 (6종)**

LH 임대주택단지 · LH 분양임대공고별 상세정보 · LH 분양임대공고문 ·
마이홈 예비입주자 대기현황 · 마이홈 공공주택 모집공고 · 마이홈 공공임대주택 단지정보

**생활 인프라 (입지 평가용 — §5 범주 인덱스와 연결)**

건강보험심사평가원_병원정보서비스 · 국립중앙의료원_전국 응급의료기관 ·
행정안전부_착한가격업소 현황 · 행정안전부_공중화장실정보 ·
국토교통부_정류장별 경유노선별 이용량 · 서울교통공사_최단경로이동정보 ·
서울시설공단_도시고속도로 방음벽 정보 · 서울특별시교육청 공공도서관 소장도서정보 ·
기상청_기상특보 · 기상청_CCTV 기반 도로날씨정보 · 산림청_명산등산로 ·
한국소비자원_생필품 가격정보

**사업자·금융 (§53 사업자등록 연결 후보)**

공정거래위원회_가맹정보 3종(본부 일반·본부 재무·브랜드 가맹점) ·
국민연금공단_국민연금 가입 사업장 내역 ← **§53 유력 경로** ·
금융위원회_주식시세정보 ← 헤더 위젯 예정 · 금융위원회_기업 재무정보 ·
한국주택금융공사_전세자금보증상품 추천

**그 외**

경찰청 4종(습득물·분실물·핸드폰찾기·포털기관 습득물) · 법무부_마을변호사 ← 지도 아이콘화 예정 ·
해양수산부 3종(바다갈라짐·바다여행지수·포락지관리) · 조달청_나라장터 발주계획 ·
인천국제공항공사_출국장 혼잡도 · 한국지역정보개발원 2종(부채규모·경영성과) ·
행정안전부_공공데이터 제공표준 · 국토교통부_마이홈포털 관련 잔여 ·
보건복지부 2종(**신청중**) · 한국교통안전공단_주차정보(**신청중**)

### 2-3. 🚫 미신청 — 이것 때문에 막힌 것들

| 필요한 것 | 왜 필요한가 | 데이터셋 |
|---|---|---|
| **온비드 부동산 물건목록** | 승인된 '물건상세 입찰정보'는 `cltrMngNo`+`pbctCdtnNo` 가 입력이라 **물건을 열거할 수 없다** | `15157207` |
| 온비드 부동산 물건상세 | 감정가·최저입찰가 | `15157247` |
| **나이스 학교기본정보** | 학군 — 승인 82건에 학교 데이터가 **아예 없다**(§5-1) | 나이스 교육정보 개방 포털 |
| 국토교통부_토지 매매 실거래가 | 토지 거래 | — |
| 지방행정 인허가(LOCALDATA) | 인허가 업소 → 사업자 연결 후보(§53) | — |

⚠️ 승인 여부는 **에러 코드로 확인**한다(§0-2). `SERVICE_KEY_IS_NOT_REGISTERED` = 미신청,
`NO_OPENAPI_SERVICE` = 경로 오류.

---

## 3. 조인 키 — 서로 다른 API 를 잇는 식별자

| 키 | 형식 | 이 키를 가진 곳 |
|---|---|---|
| **PNU** ⭐ | 19자리 `시군구5+법정동5+산여부1+본번4+부번4` | V-World 지적(`pnu`) · 건축HUB 전 op(분해) · 소상공인(`lnoCd`, 입력은 `key`) |
| 건물관리번호 | 25자리 | 소상공인(`bldMngNo`) · 도로명주소API(미신청) |
| `구 동 지번` | `관악구 봉천동 862-1` | V-World 지적(`jibun`) · 실거래(`_gu`+`umdNm`+`jibun`) · 소상공인(`lnoAdr`) |
| LAWD_CD | 5자리 시군구 | 실거래 전 종류의 **요청** 파라미터 |
| 법정동코드 | 10자리 | 소상공인(`ldongCd`) · 건축HUB(`sigunguCd`+`bjdongCd`) |
| 사업자등록번호 | 10자리 | 국세청(**입력 전용**) · 소상공인엔 **없다** → §53 미해결 |

⭐ **PNU 가 마스터 키다.** 팝업이 V-World 지적에서 받아 건축HUB·소상공인 양쪽에 그대로 넘긴다.
실측 확인: 봉천동 34-4 → `1162010100100340004` (V-World `pnu` = 소상공인 `key` = 같은 값)

⚠️ V-World `jibun` 에는 **지목 꼬리('34-4대')가 붙어 온다** → 실거래 조인 시 떼야 한다.
⚠️ **건물명 문자열 매칭 금지** — '잠원동월드메르디앙' 오매칭 사례(land.html 주석).
지금 실거래↔단지 매칭이 아직 그 방식이다. 한국부동산원 **공동주택 단지 식별정보**(승인·미구현)로 대체할 것.

---

## 4. 교차검증 매트릭스 — 같은 **필드**를 주는 출처들

**✅ 쓰는 중 · ⬜ 접근 가능하나 미사용 · 🔒 미신청**

| 항목 | 출처 A | 출처 B | 출처 C | 상태 |
|---|---|---|---|---|
| **지상/지하 층수** | ✅ 표제부 `grndFlrCnt`/`ugrndFlrCnt` | ✅ 층별개요 `flrNo` 최댓값 | ✅ V-World `grnd_flr`/`ugrnd_flr` | **교차 적용됨** |
| **용도지역** | ✅ V-World `LT_C_UQ111.uname` | ✅ 지역지구 `getBrJijiguInfo` | 🔒 토지이용규제 | **교차 적용됨** |
| 용도지구·용도구역 | ✅ 지역지구 | — | — | **적용됨**(신규 노출) |
| 실거래 층 | ✅ 실거래 `floor`(**오류 있음**) | ✅ 표제부 층수 | ✅ 층별개요 | **교차 적용됨** |
| 연면적 | ✅ 표제부 `totArea` | ⬜ 층별개요 `area` 합 | ✅ V-World `totalarea`(0 로 옴) | 단일 |
| 주용도 | ✅ 표제부 `mainPurpsCdNm` | ⬜ 층별개요(층별) | ✅ V-World `usability`(코드·거칠다) | 폴백만 |
| 사용승인일 | ✅ 표제부 `useAprDay` | ✅ V-World `useapr_day` | 🔒 건축인허가 | 폴백만 |
| 개별공시지가 | ✅ V-World `jiga` | ⬜ `getBrHousePriceInfo` | — | 단일 |
| 건물명 | ✅ 역지오코딩 | ✅ 표제부 `bldNm` | ⬜ 소상공인 `bldNm`(11%) | 폴백만 |
| 상호(업소) | ✅ 카카오 장소 | ✅ 소상공인 | — | 둘 다 쓰나 **대조 안 함** |
| 세대/호 수 | ✅ 표제부 `hhldCnt`/`hoCnt` | ⬜ 전유부 | — | 단일 |
| 내진설계 | ✅ 표제부 `rserthqkDsgnApplyYn` | 🔒 유지점검 | — | 단일 |
| 에너지등급 | ✅ 표제부 `engrGrade` | 🔒 건물에너지 | — | 단일 |

### 교차검증 규칙

1. **"가장 큰 값"이 아니라 "무엇을 판단하려는가"로 고른다.** 층수 상한 판정은 큰 값(낮게 기록된
   자료 때문에 진짜 고층을 버리지 않도록), 면적 신뢰도 판정은 차이의 크기가 관심사다.
2. **근거가 없으면 걸러내지 않는다.** 출처가 하나면 그대로 보여준다. 임의 임계값으로 자르면
   진짜 값을 버린다(`nonresFloorOk` 가 `bounds===null` 이면 통과시키는 이유).
3. **불일치를 숨기지 말고 드러낸다.** 갈리면 둘 다 보여준다 — 조용히 한쪽을 고르는 것보다 정직하다.
   구현 예: 용도지역이 갈리면 `제3종일반주거지역 ⚠ 대장은 일반상업지역`, 같으면 `✓2`.
4. **추가 호출을 늘리지 않는다.** 층별개요·전유부·지역지구·공시지가는 `loadLedgerDetail` 이
   이미 받아 둔다. `st.detail` 에서 꺼내면 호출 0. `ledgerOp` 은 `op|pnu` 로 캐시한다.

---

## 5. 범주별 인덱스 — 같은 **범주**를 주는 출처들 (입지 평가·기획용)

목적: "이 아파트 주변에 학교·병원·상점·대중교통이 어떤가"를 만들려면 **한 범주를 여러 기관이
각자 제공**하므로 합쳐야 한다. 합칠 때의 관심사는 ① 커버리지 ② 좌표 유무 ③ 중복 제거 키다.

| 범주 | 출처 | 커버리지 | 좌표 | 상태 |
|---|---|---|---|---|
| **의료** | 심평원 병원정보 | 전국 전수 | 미확인 | 🔒승인·미구현 |
| | 국립중앙의료원 응급의료기관 | 응급기관만 | 미확인 | 🔒승인·미구현 |
| | 카카오 장소 `HP8`/`PM9` | 카테고리·반경 한정 | ✅ | ✅구현 |
| | 소상공인(업종=병원·약국) | 상가업소만(의원급 누락 가능) | ✅ | ✅구현 |
| **상점·생활** | 소상공인 상가정보 | 상가업소, 분기 | ✅+층 | ✅구현 |
| | 카카오 장소 `CS2` 등 | 카테고리 한정 | ✅ | ✅구현 |
| | 행안부 착한가격업소 | 지정업소만 | 미확인 | 🔒승인·미구현 |
| | 공정위 가맹정보 3종 | 프랜차이즈 본부·가맹점 | 미확인 | 🔒승인·미구현 |
| | 소비자원 생필품 가격 | 조사 품목만 | — | 🔒승인·미구현 |
| **대중교통** | 국토부 정류장별 경유노선별 이용량 | 정류장 수요 | 미확인 | 🔒승인·미구현 |
| | 서울교통공사 최단경로 | 지하철 | — | 🔒승인·미구현 |
| | ODsay | 대중교통 경로 | ✅ | ✅구현 |
| | OSRM | 도로 경로 | ✅ | ✅구현 |
| | 한국교통안전공단 주차정보 | 주차장 | 미확인 | 🔒신청중 |
| **시세·거래** | 실거래 9종(7+2 신규) | 주거 7 + 비주거 3 | 지번 | ✅구현 |
| | 부동산원 지가변동률 | 추세 | — | 🔒승인·미구현 |
| | 청약홈 3종 | 분양 | — | ✅1 / 🔒2 |
| | LH·마이홈 6종 | 공공임대·분양 | 미확인 | 🔒승인·미구현 |
| | 온비드 공매 | 공매 | 미확인 | 🔒**미신청** |
| **안전·환경** | 행안부 CCTV | 전국 377,278 → 서울 39,484 | ✅ | ✅구현 |
| | 기상청 기상특보 | 특보 | — | 🔒승인·미구현 |
| | 서울시설공단 방음벽 | 소음 지표 | 미확인 | 🔒승인·미구현 |
| **편의** | 전기차 충전소 | 전국 | ✅ | ✅구현 |
| | 행안부 공중화장실 | 전국 | 미확인 | 🔒승인·미구현 |
| | 서울교육청 도서관 소장도서 | 도서관 | 미확인 | 🔒승인·미구현 |
| **교육** | ⚠️ **없다** — §5-1 참조 | | | |

### 5-1. ⚠️ 학교 데이터가 없다 (기획상 가장 큰 공백)

승인 82건에 **학교 정보가 없다.** 교육 범주에 있는 것은 도서관 소장도서 하나뿐이고, 학원은
카카오 카테고리(`AC5`)로 간접 추정하는 수준이다.

**아파트 입지 평가에서 학군은 핵심 변수인데 대체 경로가 없다.**
→ **나이스 교육정보 개방 포털의 학교기본정보** 신청이 필요하다(초·중·고 위치·설립유형·학급수).

### 5-2. 합칠 때의 실제 문제 — 중복 제거 키가 없다

같은 병원이 심평원·카카오·소상공인에 모두 있으면 세 번 찍힌다. 그런데:

- **이름 표기가 다르다** — `서울누가치과의원`(소상공인) vs `누가치과`(카카오)
- **사업자등록번호는 어디에도 공통으로 없다**(§53 미해결)
- 남은 방법은 **좌표 근접 + 이름 부분일치**

⚠️ 이 방식의 오차는 **아직 측정하지 않았다.** 병합을 구현하기 전에 표본으로 오탐/미탐률을
재고 이 문서에 적을 것. 측정 없이 임계값(예: 30m·2자 일치)을 정하면 같은 실수를 반복한다.

---

## 6. API별 블록

**형식**: `호출` / `필수` / `응답경로` / `검증용` / `필드` / `함정`
`검증용` = **데이터가 확실히 나오는 입력**. 0건을 받았을 때 버그인지 데이터가 없는지 즉시 구분하려는 것.

### 6-1. V-World 지적 `LP_PA_CBND_BUBUN` — PNU 출처 ✅

```
호출:     GET https://api.vworld.kr/req/data?service=data&version=2.0&request=GetFeature
              &format=json&size=5&key={VWORLD_KEY}&data=LP_PA_CBND_BUBUN
              &geomFilter=POINT({lng} {lat})
필수:     data · geomFilter · key
응답경로: response.result.featureCollection.features[].properties
          ⚠️ JSONP 다 — land.html 은 vworldFeature(dataId, lat, lng, cb) 로 감싸 둔다
검증용:   POINT(126.95603 37.48501) → pnu=1162010100100340004, jibun="34-4대",
          jiga="10820000", addr="서울특별시 관악구 봉천동 34-4"
필드(8):  gosi_year:str  pnu:str(19)  jibun:str  bonbun:str  bubun:str  addr:str
          gosi_month:str  jiga:str(원/㎡)
          + _geom(MultiPolygon) — 코드가 붙인다(건물 스냅 거리 계산용)
함정:     ① jibun 에 지목 꼬리('대')가 붙는다 → 조인 전에 제거
          ② jiga 가 문자열이다 → Number() 필요
          ③ 키가 도메인 잠금 → 로컬 curl 은 INCORRECT_KEY
```

### 6-2. V-World 용도지역 `LT_C_UQ111` ✅

```
호출:     6-1 과 동일, data=LT_C_UQ111
응답경로: 6-1 과 동일
검증용:   POINT(126.95603 37.48501) → uname="준주거지역"
필드(5):  uname:str  dyear:str  dnum:str  sido_name:str  sigg_name:str
함정:     ⚠️ **피처가 2개 오고 그중 하나는 uname 이 빈 문자열이다.**
          그래서 코드가 .find(x => x.uname) 로 고른다. [0] 을 쓰면 빈 값을 집는다.
          이 로직을 '단순화'하지 말 것.
```

### 6-3. V-World 건물 `LT_C_BLDGINFO` ✅ (폴백 전용)

```
호출:     6-1 과 동일, data=LT_C_BLDGINFO
검증용:   POINT(126.95603 37.48501) → usability="03000", grnd_flr="3",
          ugrnd_flr="1", totalarea="239.89", useapr_day="19691220"
필드(13): bld_nm:str  dong_nm:str  usability:str(코드)  grnd_flr:str  ugrnd_flr:str
          archarea:str  height:str  vl_rat:str  bc_rat:str  totalarea:str
          platarea:str  useapr_day:str(YYYYMMDD)  strct_cd:str
함정:     ⚠️ archarea·height·vl_rat·bc_rat·platarea 가 "0" 으로 온다 — 값이 없다는 뜻이지
          0 이 아니다. 그래서 **건축물대장이 없을 때의 폴백으로만** 쓴다.
          usability 는 코드값(BLD_USE 로 변환). 대장 mainPurpsCdNm 보다 거칠다.
          bld_nm·dong_nm 이 빈 문자열인 경우가 흔하다.
```

### 6-4. 건축HUB 표제부 `getBrTitleInfo` ✅

```
호출:     GET {molit-proxy}?op=getBrTitleInfo&sigunguCd={5}&bjdongCd={5}
              &platGbCd={0|1}&bun={4}&ji={4}&numOfRows=10&pageNo=1
          (프론트는 직접 부르지 않는다 — serviceKey 는 Edge Function 에만 있다)
필수:     op · sigunguCd · bjdongCd · platGbCd · bun · ji
          ⚠️ platGbCd 를 빠뜨리면 조회되지 않는다
          PNU → pnuParts(pnu) 로 분해한다(land.html)
응답경로: response.body.items.item  (단건이면 객체!)
검증용:   sigunguCd=11620&bjdongCd=10100&platGbCd=0&bun=0862&ji=0001
          → totalCount=1, 지상15층·지하8층·판매시설·연면적26450.99㎡
            ·사용승인20060808·용적률799.94%
필드(78): 지금 쓰는 것 — bldNm mainPurpsCdNm etcPurps hhldCnt fmlyCnt vlRat bcRat
          platArea archArea totArea strctCdNm grndFlrCnt ugrndFlrCnt useAprDay
          rserthqkDsgnApplyYn rserthqkAblty regstrGbCdNm
          안 쓰는데 값 큰 것 — heit(높이) hoCnt(호수) engrGrade/engrEpi(에너지효율)
          pmsDay/stcnsDay(허가일·착공일) rideUseElvtCnt(승강기)
          indrMechUtcnt/oudrAutoUtcnt(주차) gnBldGrade(녹색건축) itgBldGrade(지능형)
          전체 목록은 아래 '표제부 78필드' 참고
함정:     구버전 BldRgstService_v2 는 응답이 비어 있다 → BldRgstHubService 를 쓸 것
          한 필지에 동이 여러 개일 수 있다(아파트) → 연면적 최대를 대표로 삼는다
          동시 요청이 몰리면 게이트웨이가 통째로 막는다 → 순차 2개씩 + 150ms 간격
          429 는 재시도하지 말 것(구멍을 더 깊게 판다)
```

<details>
<summary>표제부 78필드 전체</summary>

```
rnum platPlc sigunguCd bjdongCd platGbCd bun ji mgmBldrgstPk regstrGbCd regstrGbCdNm
regstrKindCd regstrKindCdNm newPlatPlc bldNm splotNm block lot bylotCnt naRoadCd naBjdongCd
naUgrndCd naMainBun naSubBun dongNm mainAtchGbCd mainAtchGbCdNm platArea archArea bcRat totArea
vlRatEstmTotArea vlRat strctCd strctCdNm etcStrct mainPurpsCd mainPurpsCdNm etcPurps roofCd
roofCdNm etcRoof hhldCnt fmlyCnt heit grndFlrCnt ugrndFlrCnt rideUseElvtCnt emgenUseElvtCnt
atchBldCnt atchBldArea totDongTotArea indrMechUtcnt indrMechArea oudrMechUtcnt oudrMechArea
indrAutoUtcnt indrAutoArea oudrAutoUtcnt oudrAutoArea pmsDay stcnsDay useAprDay pmsnoYear
pmsnoKikCd pmsnoKikCdNm pmsnoGbCd pmsnoGbCdNm hoCnt engrGrade engrRat engrEpi gnBldGrade
gnBldCert itgBldGrade itgBldCert crtnDay rserthqkDsgnApplyYn rserthqkAblty
```
</details>

### 6-5. 건축HUB 층별개요 `getBrFlrOulnInfo` ✅ — 교차검증 핵심 재료

```
호출:     6-4 와 동일, op=getBrFlrOulnInfo, numOfRows=100
검증용:   862-1 → totalCount=36, 지상 최대 15층 / 지하 최대 8층
          층별 용도: 학원·상점(소매점)·기타문화및집회시설·기타 운동시설·기타판매시설
                     ·휴게음식점·기타제1종근린생활시설·기타제2종근린생활시설
필드(34): flrGbCdNm:str("지상"|"지하")  flrNo:num  flrNoNm:str  area:num
          mainPurpsCdNm:str  strctCdNm:str  areaExctYn  dongNm  + 공통 지번 필드
함정:     층수 상한을 이 값으로 검증할 수 있다 → land.html nonresFloorBounds()
          loadLedgerDetail 이 st.detail.floors 로 이미 받아 둔다(추가 호출 0)
```

### 6-6. 건축HUB 지역지구 `getBrJijiguInfo` ✅

```
호출:     6-4 와 동일, op=getBrJijiguInfo
검증용:   862-1 → totalCount=3
          용도구역코드=제1종지구단위계획구역 / 용도지구코드=일반미관지구
          / 용도지역코드=일반상업지역  (전부 reprYn=1)
필드(19): jijiguGbCdNm:str("용도지역코드"|"용도지구코드"|"용도구역코드")
          jijiguCdNm:str  jijiguGbCd  jijiguCd  reprYn:str("1"=대표)  etcJijigu
함정:     ⚠️ **한 필지에 여러 행이 온다** — 종류로 갈라 읽어야 한다
          reprYn=1 을 우선하고 중복 이름은 접는다(land.html jjPick)
          지구단위계획구역 여부는 증축·재건축 판단에 직결 → 상단에 노출한다
```

### 6-7. 국토부 실거래 `RTMSDataSvc*` ✅

```
호출:     GET https://apis.data.go.kr/1613000/{서비스명}/get{서비스명}
              ?serviceKey={DGK}&LAWD_CD={5}&DEAL_YMD={YYYYMM}&numOfRows=1000&pageNo=1&_type=xml
          ⚠️ 서비스명에 get 을 붙이면 NO_OPENAPI_SERVICE 다.
             올바름: RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade
응답경로: response.body.items.item (단건이면 객체) + totalCount 로 페이징
검증용:   RTMSDataSvcNrgTrade  LAWD_CD=11620 DEAL_YMD=202607 → 19건
          RTMSDataSvcOffiTrade LAWD_CD=11620 DEAL_YMD=202607 → 19건
          RTMSDataSvcInduTrade LAWD_CD=11545 DEAL_YMD=202607 → 18건
함정:     ⚠️ 오류가 HTTP 200 + 오류 XML 로 온다 → '0건'과 구분할 것(§0-2, §54)
          dealAmount 가 콤마 문자열("160,000") 이다 → 숫자 변환 필요
          floor 에 원본 오류가 있다(아래)
```

| 서비스명 | 대상 | 지번 마스킹(실측) | 상태 |
|---|---|---|---|
| `RTMSDataSvcAptTradeDev` | 아파트 매매 상세 | — | ✅ |
| `RTMSDataSvcAptRent` | 아파트 전월세 | — | ✅ |
| `RTMSDataSvcRHTrade`/`RHRent` | 연립다세대 | — | ✅ |
| `RTMSDataSvcSHTrade`/`SHRent` | 단독다가구 | **전량 마스킹** → 동 집계만 | ✅ |
| `RTMSDataSvcOffiRent` | 오피스텔 전월세 | 0% | ✅ |
| `RTMSDataSvcNrgTrade` | 상업업무용 매매 | 관악 21% · 강남 16% | ✅ |
| `RTMSDataSvcOffiTrade` | 오피스텔 매매 | 0% | ✅ |
| `RTMSDataSvcInduTrade` | 공장·창고 매매 | 0%(금천·강서) | ✅ |
| `RTMSDataSvcLandTrade` | 토지 매매 | — | 🔒 미신청 |

**상업업무용 필드(22)**
```
buildYear buildingAr buildingType buildingUse buyerGbn cdealDay cdealType dealAmount
dealDay dealMonth dealYear dealingGbn estateAgentSggNm floor jibun landUse plottageAr
sggCd sggNm shareDealingType slerGbn umdNm
```
- `buildingUse` = 제1종근린생활 · 제2종근린생활 · 판매 · 교육연구 · 기타
- `buildingType` = 집합 / 일반. **`집합`이면 `plottageAr` 이 비어 온다**(구분소유)

**오피스텔 매매 필드(18)**
```
buildYear buyerGbn cdealDay cdealType dealAmount dealDay dealMonth dealYear dealingGbn
estateAgentSggNm excluUseAr floor jibun offiNm sggCd sggNm slerGbn umdNm
```
- 면적이 `excluUseAr`(전용) — 상업업무용 `buildingAr`(건물면적)과 **의미가 다르다**
- `offiNm` 이 `(863-9)` 처럼 지번을 괄호로 감싼 자동생성명인 경우가 있다 → 버린다

⚠️ **`floor` 에 원본 오류가 있다.** 관악구 봉천동 862-1 = 7.33㎡ 판매시설 2,250만원인데
`floor=80` 이다. 그 건물은 **실제로 지상 15층·지하 8층**(사용자 확인 + 표제부 + 층별개요 3중 확인).
상가 부스/호 번호가 층 칸에 들어간 것으로 보인다. 정부 원본이라 수집기는 그대로 싣고,
**프론트가 그 건물의 실제 층수와 비교해 걸러낸다**(`nonresFloorBounds`).

### 6-8. 소상공인 상가(상권)정보 `storeListInPnu` ✅

```
호출:     GET https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPnu
              ?serviceKey={DGK}&key={PNU19}&numOfRows=100&pageNo=1&type=json
          (프론트는 sbiz-proxy?pnu={PNU} 경유)
필수:     key = PNU 19자리
          ⚠️ pnu · lnoCd · cd 는 전부 NO_MANDATORY_REQUEST_PARAMETERS_ERROR
응답경로: body.items  (response 껍데기가 없다)
검증용:   key=1162010100100340004 → total=3
          파리바케트 행운점[빵/도넛](층 없음) / JDS헤어디자인[미용실] 2층
          / 제이엠뷰티룸[피부 관리실] 3층
필드(39): bizesId bizesNm brchNm indsLclsCd/Nm indsMclsCd/Nm indsSclsCd/Nm ksicCd/Nm
          ctprvnCd/Nm signguCd/Nm adongCd/Nm ldongCd/Nm lnoCd plotSctCd/Nm lnoMnno
          lnoSlno lnoAdr rdnmCd rdnm bldMnno bldSlno bldMngNo bldNm rdnmAdr
          oldZipcd newZipcd dongNo flrNo hoNo lon lat
```
**채움률 실측(반경 50m 36건 표본)** — UI 설계 전에 볼 것:

| 필드 | 채움 | 메모 |
|---|---|---|
| `lnoCd` | 36/36 | **= PNU 19자리.** 조인 키 |
| `bldMngNo` | 36/36 | 건물관리번호 25자리 |
| `flrNo` | **28/36 (78%)** | 층은 있을 때만 표시 |
| `hoNo` | **0/36** | **호 단위 표시는 포기할 것** |
| `dongNo` | **0/36** | 같음 |
| `bldNm` | 4/36 | 대부분 빈다 |

```
함정:     갱신 분기 → 폐업 최대 3개월 지연. 화면에 기준을 밝힌다
          상가업소 대상 → 사무실·일반 사무업 누락
          오퍼레이션 12개 존재: storeListInPnu/InBuilding/InRadius/InArea/InUpjong
          storeOne storeZoneOne storeZoneInRadius large/middle/smallUpjongList reqStoreModify
```

### 6-9. 국세청 사업자등록 ✅

```
호출:     GET https://api.odcloud.kr/api/nts-businessman/v1/status   (상태조회)
          GET https://api.odcloud.kr/api/nts-businessman/v1/validate (진위확인)
          (프론트는 bizno-proxy 경유)
필수:     사업자등록번호 10자리
응답경로: data[]
함정:     ⚠️ **입력이 사업자등록번호뿐** — 상호·주소로 목록 조회가 불가능하다.
          소상공인 39필드에 사업자번호가 없어 '이 건물 업소'와 자동 연결이 안 된다.
          **불가 판정이 아니라 미해결 과제다** → TROUBLESHOOTING §53 (경로 후보 있음)
```

### 6-10. 행정안전부 CCTV 표준데이터 ✅

```
호출:     GET https://apis.data.go.kr/1741000/cctv_info/info
              ?serviceKey={DGK}&pageNo={n}&numOfRows=100&type=json
필수:     없음(전량 순회)
응답경로: response.body.items.item
검증용:   numOfRows=1&pageNo=1 → totalCount=377278 (전국)
필드:     CAM_CNTOM(대수) CAM_PIXEL_CNT DAT_CRTR_YMD INSTL_PRPS_SE_NM(설치목적)
          INSTL_YM KPNG_DAY_CNT(보관일수) LCTN_ROAD_NM_ADDR LCTN_LOTNO_ADDR
          WGS84_LAT WGS84_LOT MNG_INST_NM MNG_INST_TELNO SHT_ANGLE_INFO FCLT_NM MNG_NO
함정:     type=json 과 returnType=json 둘 다 동작한다
          전국 3,773페이지 순회에 약 50분 — DGK 를 쓰는 다른 수집기와 **동시 실행 금지**(§54)
          ⚠️ collect_cctv.js 를 --its-only / --standard-only 로 돌린 결과를 커밋하지 말 것
             (두 소스가 서로를 덮어써 38,109건이 사라진 이력이 있다 — §52-2)
```

### 6-11. 카카오 장소 검색 (SDK) ✅

```
호출:     kakao.maps.services.Places().categorySearch(code, cb, {location, radius, sort})
          (REST 가 아니라 JS SDK. land.html findPois() 가 감싼다)
필수:     카테고리 코드 — matjip 이 쓰는 8종:
          FD6 음식점 · CE7 카페 · HP8 병원 · PM9 약국 · CS2 편의점 · BK9 은행
          · AC5 학원 · AG2 중개업소
응답경로: 콜백 (data[], status) — status 는 문자열 'OK'
검증용:   CE7, (37.48501,126.95603) radius=200 → 15건, 최근접 "카페인" 22m
필드(12): place_name:str  category_name:str("음식점 > 카페")  category_group_code:str
          category_group_name:str  address_name:str(지번)  road_address_name:str(도로명)
          phone:str  distance:str(m, 문자열!)  id:str  place_url:str  x:str(lng)  y:str(lat)
함정:     ⚠️ **카테고리 단위로만 주변 조회가 된다** — '전부'가 없어서 카테고리 수만큼 호출한다
          (그래서 클릭당 8회. _poiCache 로 반복 호출을 막는다)
          distance·x·y 가 **문자열**이다 → Number() 필요
          **도메인 잠금** — localhost 에서 안 뜬다
          ⚠️ ToS 상 저장·재배포 제약이 있다 → 화면 표시만. DB 에 쌓지 말 것
          (같은 '상호'를 저장해도 되는 것은 소상공인 상가정보다 — 이용허락범위 제한 없음)
```

### 6-12. 네이버 역지오코딩 (SDK) ✅

```
호출:     naver.maps.Service.reverseGeocode({coords, orders}, cb)
          orders = OrderType.ADDR + ',' + OrderType.ROAD_ADDR
응답경로: cb(status, res) → res.v2.address.{jibunAddress, roadAddress}
                          → res.v2.results[].{name, code, region, land}
검증용:   (37.48501,126.95603) → status "200"
          jibunAddress = "서울특별시 관악구 봉천동  34-4"
          roadAddress  = "서울특별시 관악구 관악로  232-1"
          results[].name = ["addr","roadaddr"]
필드:     v2.status.{code,name,message}
          v2.address.{jibunAddress, roadAddress}
          v2.results[].name("addr"|"roadaddr") · .code.{id(법정동10),type,mappingId}
                      · .region.{area0..area4} · .land.{type,number1,number2,addition0..4,coords}
함정:     ⚠️ **주소 문자열에 공백이 두 개 들어온다** — "봉천동  34-4" (동 뒤에 2칸).
          정규식으로 파싱할 때 \s+ 를 쓸 것. \s 하나로 잡으면 실패한다.
          건물명은 addition0.value 에 오는 경우가 있다(대장 bldNm 과 다를 수 있다)
          **도메인 잠금**
```

### 6-13. ODsay 대중교통 ✅

```
호출:     GET https://api.odsay.com/v1/api/searchPubTransPathT
              ?apiKey={ODSAY_KEY}&SX={출발lng}&SY={출발lat}&EX={도착lng}&EY={도착lat}&output=json
응답경로: result.path[].{pathType, info, subPath}
검증용:   SX=126.9560&SY=37.4850&EX=127.0276&EY=37.4979 → 정상(배포 도메인에서)
필드:     result.{searchType outTrafficCheck busCount subwayCount subwayBusCount
                 pointDistance startRadius endRadius path}
          path[].info.{totalTime(분) payment(원) totalWalk totalWalkTime trafficDistance
                       busTransitCount subwayTransitCount firstStartStation lastEndStation
                       totalStationCount busStationCount subwayStationCount totalDistance
                       checkIntervalTime checkIntervalTimeOverYn totalIntervalTime mapObj}
함정:     ⚠️ **키가 도메인 잠금이다.** 로컬 curl 은 `[ApiKeyAuthFailed]` 를 준다 —
          키가 죽은 게 아니다(2026-08-22 실측: 로컬 실패 / 배포본 정상).
          로컬에서 실패했다고 키를 재발급하지 말 것.
```

### 6-14. OSRM 도로 경로 ✅ (키 없음)

```
호출:     GET https://router.project-osrm.org/route/v1/driving/{lng1},{lat1};{lng2},{lat2}
              ?overview=false
응답경로: routes[]
검증용:   126.9560,37.4850;127.0276,37.4979 → code="Ok", distance=8204m, duration=492.9s
필드:     code:str("Ok")  waypoints[]  routes[].{distance(m) duration(s) legs weight weight_name}
함정:     공개 데모 서버다 — 가용성 보장이 없고 상업적 대량 호출에 부적절하다.
          서비스로 키우면 자체 호스팅이나 유료 대안이 필요하다.
```

### 6-15. 한국수출입은행 환율 ✅

```
호출:     GET https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON
              ?authkey={EXCHANGE_RATE_KEY}&searchdate={YYYYMMDD}&data=AP01
          (프론트는 eximbank-proxy 경유)
응답경로: 최상위가 **배열**이다(껍데기 없음)
검증용:   searchdate=20260821 → AED/AUD/… 통화 목록, deal_bas_r 값 존재
필드(11): result:num(1=성공)  cur_unit:str("AED","JPY(100)")  cur_nm:str
          ttb:str(살 때)  tts:str(팔 때)  deal_bas_r:str(매매기준율)  bkpr:str
          yy_efee_r  ten_dd_efee_r  kftc_bkpr  kftc_deal_bas_r
함정:     ⚠️ **숫자가 콤마 문자열이다** — "1,001.17" → 콤마 제거 후 Number()
          ⚠️ `cur_unit` 에 단위가 붙는다 — "JPY(100)" 은 100엔당 값이다. 그대로 곱하면 100배 틀린다
          주말·공휴일은 **빈 배열**이 온다 → 직전 영업일로 물러설 것
          환율은 실시간 변동이라 **의도적으로 캐시하지 않는다**(사용자 결정)
```

### 6-16. 서울 UPIS 도시계획 주제도 ✅ (타일)

```
호출:     GET https://urban.seoul.go.kr/proxy/proxy.jsp?
              http://98.33.2.225:6080/arcgis/rest/services/UPIS/20200526_WMS/MapServer/export
              ?bbox={minx},{miny},{maxx},{maxy}&bboxSR=102100&imageSR=102100
              &size=256,256&format=png32&transparent=true&dpi=96
              &layers=show:{레이어id들}&f=image
응답:     PNG 이미지 (JSON 아님 — '스키마'가 아니라 요청 파라미터가 계약이다)
필수:     bbox(EPSG:3857) · bboxSR/imageSR=102100 · layers=show:{id}
함정:     ⚠️ MapServer 가 **http** 라 https 페이지에서 직접 못 부른다 → 서울시 프록시 필수
          ⚠️ 생 IP(98.33.2.225)다 — 서울시가 바꾸면 조용히 깨진다. 정기 확인 대상
          ⚠️ 축척이 작으면(줌 아웃) 서버가 **빈 이미지 2.2KB** 를 준다 — 오류가 아니다.
             레이어가 그려지는지 검증할 때 이 크기와 비교했다
          레이어 id 는 MapServer `?f=pjson` 목록에서 확인한다(추측 금지)
```

### 6-17. ITS CCTV 실시간 영상 ✅ (data.go.kr 아님)

```
호출:     GET https://openapi.its.go.kr:9443/cctvInfo
              ?apiKey={ITS_CCTV_KEY}&type={ex|its|all}&cctvType=1
              &minX=&maxX=&minY=&maxY=&getType=json
          (프론트는 its-cctv-proxy 경유 — http 영상 URL 을 https 페이지에서 쓰기 위함)
응답경로: response.data[]
검증용:   type=ex, bbox 126.90~127.10 / 37.45~37.60 → 10건, "[경부선] 서초" 등
필드(9):  cctvname:str("[경부선] 서초")  cctvurl:str(HLS/MP4 스트림)  cctvformat:str("HLS")
          cctvtype:num  coordx:num(lng)  coordy:num(lat)
          roadsectionid:str  cctvresolution:str  filecreatetime:str
함정:     ⚠️ **`type=its` 는 0건이다** — 실제 데이터는 `ex`(고속도로) 에 있다(실측).
          `its` 가 안 나온다고 키를 의심하지 말 것.
          roadsectionid·cctvresolution·filecreatetime 이 **빈 문자열**로 오는 경우가 흔하다
          cctvurl 이 **http** 다 → https 페이지에서 직접 못 쓴다(프록시 이유)
          ⚠️ data.go.kr 계열이 아니라 **별개 키·별개 한도**다. DGK 잠금과 무관하다
```

### 6-18. 그 외 연결된 소스 (스키마 미측정)
### 6-17. 그 외 연결된 소스 (스키마 미측정)

| 호스트 | 용도 | 경유 | 키·잠금 |
|---|---|---|---|
| `api.odcloud.kr/ApplyhomeInfoDetailSvc` | 청약홈 분양정보 | `chungak-proxy` | DGK · 24h 캐시 |
| `apis.data.go.kr/1360000/VilageFcstInfoService_2.0` | 기상청 단기예보 | `kma-weather-proxy` | DGK |
| `apis.data.go.kr/B552584/EvCharger` | 전기차 충전소 | 정적 JSON | DGK |
| `openapi.naver.com/v1/search/local` | 지역 검색 | `naver-search` | 별개 키 |
| `cleanup.seoul.go.kr` | 서울 정비사업 | 직접 | — |
| `courtauction.go.kr` | 법원 경매(**스크레이핑**) | 수집기 | API 아님 |

---

## 7. 미측정 — 채울 때의 방법

**추측으로 적지 말 것.** 아래로 실제 응답을 받아 필드를 옮겨 적는다.

```bash
# 건축HUB 나머지 op — 프록시 경유(키 불필요)
P=https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/molit-proxy
Q='sigunguCd=11620&bjdongCd=10100&platGbCd=0&bun=0862&ji=0001&numOfRows=20&pageNo=1'
curl -s "$P?op=getBrRecapTitleInfo&$Q"
```

```bash
# data.go.kr 직접 — ⚠️ DGK 는 Encoding 키. URL 에 그대로 붙일 것(--data-urlencode 금지)
DGK=$(grep '^DGK=' keys.env | cut -d= -f2-)
curl -s "https://apis.data.go.kr/{경로}?serviceKey=$DGK&…&type=json"
```

```js
// V-World — 도메인 잠금이라 로컬 curl 불가. 배포본 브라우저 콘솔에서:
vworldFeature('LT_C_UQ111', 37.48501, 126.95603, (ps) => console.log(ps));
```

### 측정 대기 목록

- 건축HUB: `getBrRecapTitleInfo` `getBrBasisOulnInfo` `getBrExposInfo`
  `getBrExposPubuseAreaInfo` `getBrAtchJibunInfo` `getBrHsprcInfo` `getBrHousePriceInfo`
- 실거래: 공장창고 필드 · 전월세 5종 필드
- V-World: `req/address` `req/search` `req/wfs` `req/wms`
- §6-11 표 전체
- 승인·미구현 69종 → `TROUBLESHOOTING.md` §51-2 / §52-1 우선순위 순서대로
- 🔒 미신청이라 측정 불가: 온비드 물건목록(15157207)·물건상세(15157247) · 토지 매매 · LOCALDATA
  · **나이스 학교기본정보**(§3-1)

---

## 8. 갱신 규칙

1. **API 를 붙이면 §6 에 블록을 추가한다.** `호출/필수/응답경로/검증용/필드/함정` 6줄 형식.
   **`검증용` 을 빼지 말 것** — 0건을 받았을 때 버그인지 데이터가 없는지 구분하는 유일한 수단이다.
2. **§4 매트릭스 갱신** — 기존 항목과 겹치는 값을 주는지 확인하고 상태(✅/⬜)를 바꾼다.
3. **§5 범주 인덱스 갱신** — 같은 범주를 주는 다른 출처가 있으면 커버리지·좌표·중복제거 키를 적는다.
4. **원본 오류를 발견하면 반드시 적는다.** 어느 필드가 어떤 조건에서 틀리는지 + 실측 사례.
   (예: 실거래 `floor` = 862-1 → 80, 실제 15층)
5. **채움률은 표본 크기와 함께** 적는다("36건 표본" 처럼). 비율만 적으면 신뢰도를 알 수 없다.
6. 갱신주기·커버리지 한계도 값이다 — UI 문구를 바꾼다("분기 갱신", "3인 이상 법인만").
