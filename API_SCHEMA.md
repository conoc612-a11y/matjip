# API_SCHEMA — 연결된 API의 스키마와 교차검증 지도

**코드를 짜기 전에 이 파일을 본다.** 어떤 값을 어디서 가져올 수 있고, **같은 값을 주는 다른
출처가 있는지**를 여기서 확인한 뒤 구현한다.

## 왜 만들었나 (2026-08-22)

matjip 은 승인된 data.go.kr API 82건 중 13종만 쓰고 있고, **항목마다 출처가 하나뿐이었다.**
층수는 표제부만, 용도지역은 V-World 만, 건물명은 역지오코딩만. 그래서 한 출처에 오류가 있으면
그대로 화면에 나갔다.

실제로 터졌다: 국토부 실거래가 관악구 봉천동 862-1 을 **`floor=80`** 으로 주는데, 그 건물은
**지상 15층·지하 8층**이다. 세 자료가 독립적으로 일치한다:

| 확인 경로 | 값 |
|---|---|
| 사용자 확인 | 지상 15층 · 지하 8층 |
| 건축물대장 표제부 `grndFlrCnt`/`ugrndFlrCnt` | 15 / 8 |
| 건축HUB 층별개요 `flrNo` 최댓값(지상/지하) | 15 / 8 |

→ **한 출처를 그대로 믿지 말고 교차 확인한다.** 그 판정에 필요한 재료를 이 파일에 모았다.

관련 문서: 연결 현황·우선순위는 `TROUBLESHOOTING.md` §51·§52, 함정은 §50·§53.

---

## 1. 조인 키 — 서로 다른 API 를 잇는 식별자

교차검증의 전제는 "같은 대상"임을 증명하는 키다. **어떤 키를 공유하는지가 곧 무엇을 교차할 수
있는지**를 결정한다.

| 키 | 형식 | 이 키를 가진 API/자료 |
|---|---|---|
| **PNU** | 19자리 `시군구5+법정동5+산여부1+본번4+부번4` | V-World 지적(`LP_PA_CBND_BUBUN`) · 건축HUB 전 op(분해해서 `sigunguCd/bjdongCd/platGbCd/bun/ji` 로) · **소상공인 상가정보(`lnoCd`)** |
| **건물관리번호** | 25자리 | 소상공인 상가정보(`bldMngNo`) · 도로명주소 API(미신청) · 온비드 물건목록(미확인) |
| **`구 동 지번`** | `관악구 봉천동 862-1` | V-World 지적(`jibun`) · 실거래 전 종류(`_gu`+`umdNm`+`jibun`) · 소상공인(`lnoAdr`) |
| **LAWD_CD** | 5자리 시군구 | 실거래 전 종류의 요청 파라미터 |
| **법정동코드** | 10자리 | 소상공인(`ldongCd`) · 건축HUB(`sigunguCd`+`bjdongCd`) · 행안부 CCTV |
| **사업자등록번호** | 10자리 | 국세청 상태조회(**입력**) · 소상공인엔 **없다** → §53 미해결 |

⚠️ **PNU 는 우리가 이미 확보해 둔 가장 강력한 키다.** 팝업이 V-World 지적에서 받아
건축HUB·소상공인 양쪽에 그대로 넘긴다. 새 API 를 붙일 때 **PNU 로 조회되는지를 먼저 확인**하면
좌표 계산·주소 매칭이 전부 불필요해진다(소상공인 `storeListInPnu` 가 그 예).

⚠️ **하지 말 것**: 건물명 문자열로 매칭. `land.html` 주석에 '잠원동월드메르디앙' 오매칭 사례가
남아 있다. 지금 실거래↔단지 매칭이 아직 그 방식이라, 한국부동산원 **공동주택 단지 식별정보**
(승인됨·미구현)로 대체하는 것이 §52 우선순위 5위다.

---

## 2. 교차검증 매트릭스 — 같은 값을 주는 출처들

**✅=지금 코드가 쓰는 출처 · ⬜=접근 가능하지만 아직 안 쓰는 출처 · 🔒=미신청**

| 항목 | 출처 A | 출처 B | 출처 C | 지금 상태 |
|---|---|---|---|---|
| **지상/지하 층수** | ✅ 표제부 `grndFlrCnt`/`ugrndFlrCnt` | ⬜ 층별개요 `flrNo` 최댓값 | ✅ V-World 건물 `grnd_flr`/`ugrnd_flr` | **교차 적용됨**(`nonresFloorBounds`) |
| **연면적** | ✅ 표제부 `totArea` | ⬜ 층별개요 `area` 합 | ✅ V-World `totalarea` | 단일 출처 |
| **주용도** | ✅ 표제부 `mainPurpsCdNm` | ⬜ 층별개요 `mainPurpsCdNm`(층별) | ✅ V-World `usability`(계열) | 단일 출처 |
| **사용승인일** | ✅ 표제부 `useAprDay` | ✅ V-World `useapr_day` | ⬜ 건축인허가(🔒승인됨·미구현) | 폴백만, 비교 안 함 |
| **용도지역** | ✅ V-World `LT_C_UQ111` | ⬜ **지역지구 `getBrJijiguInfo`** | 🔒 토지이용규제(승인됨·미구현) | 단일 출처 |
| **용도지구·용도구역** | ⬜ 지역지구 `getBrJijiguInfo` | — | — | **아예 없다** |
| **개별공시지가** | ✅ V-World 지적 `jiga` | ⬜ `getBrHousePriceInfo` | — | 단일 출처 |
| **건물명** | ✅ 역지오코딩(네이버) | ✅ 표제부 `bldNm` | ⬜ 소상공인 `bldNm`(4/36 채움) | 폴백만 |
| **상호(업소)** | ✅ 카카오 장소 | ✅ 소상공인 상가정보 | — | 둘 다 쓰지만 **대조 안 함** |
| **층(업소)** | ✅ 소상공인 `flrNo`(78%) | ⬜ 층별개요(층별 용도) | — | 단일 출처 |
| **실거래 층** | ✅ 실거래 `floor`(**오류 있음**) | ✅ 표제부 층수 | ⬜ 층별개요 | **교차 적용됨** |
| **세대/호 수** | ✅ 표제부 `hhldCnt`/`fmlyCnt`/`hoCnt` | ⬜ 전유부 `getBrExposInfo` | — | 단일 출처 |
| **내진설계** | ✅ 표제부 `rserthqkDsgnApplyYn` | ⬜ 유지점검(🔒승인됨·미구현) | — | 단일 출처 |
| **에너지등급** | ✅ 표제부 `engrGrade`/`engrEpi` | 🔒 건물에너지(승인됨·미구현) | — | 단일 출처 |

### 교차검증을 붙일 때 지킬 규칙

1. **여러 출처가 있으면 "가장 큰 값"이 아니라 "무엇을 판단하려는가"로 고른다.**
   층수 상한 판정은 큰 값(낮게 기록된 자료 때문에 진짜 고층을 버리지 않도록),
   면적 신뢰도 판정은 차이의 크기가 관심사다.
2. **근거가 없으면 걸러내지 않는다.** 출처가 하나뿐이면 그대로 보여준다.
   임의 임계값으로 자르면 진짜 값을 버린다(`nonresFloorOk` 가 `bounds===null` 이면 통과시키는 이유).
3. **불일치를 숨기지 말고 드러낸다.** 값이 갈리면 사용자가 판단할 수 있게 둘 다 보여주는 편이
   한쪽을 조용히 고르는 것보다 정직하다.
4. **추가 API 호출을 늘리지 않는다.** 위 ⬜ 중 층별개요·전유부·지역지구·공시지가는
   `loadLedgerDetail`(상세 보기)이 **이미 받아 둔다**. `st.detail` 에서 꺼내 쓰면 호출이 0이다.

---

## 3. API별 실측 스키마

**실측 = 실제로 호출해 응답에서 확인한 것.** 추측으로 적은 필드는 없다.
미측정 API 는 §4 에 측정 명령과 함께 남겼다 — 채울 때 반드시 실제 응답으로 확인할 것.

### 3-1. 건축HUB 건축물대장 (`1613000/BldRgstHubService`) — ✅ 구현됨

프론트는 직접 부르지 않는다. **`supabase/functions/molit-proxy` 경유**(serviceKey 서버 보관).
공통 입력: `sigunguCd` `bjdongCd` `platGbCd` `bun` `ji` (PNU 를 `pnuParts()` 로 분해)

#### `getBrTitleInfo` 표제부 — 필드 78개 (실측 2026-08-22, 관악구 봉천동 862-1)

```
rnum platPlc sigunguCd bjdongCd platGbCd bun ji mgmBldrgstPk regstrGbCd regstrGbCdNm
regstrKindCd regstrKindCdNm newPlatPlc bldNm splotNm block lot bylotCnt naRoadCd naBjdongCd
naUgrndCd naMainBun naSubBun dongNm mainAtchGbCd mainAtchGbCdNm platArea archArea bcRat totArea
vlRatEstmTotArea vlRat strctCd strctCdNm etcStrct mainPurpsCd mainPurpsCdNm etcPurps roofCd roofCdNm
etcRoof hhldCnt fmlyCnt heit grndFlrCnt ugrndFlrCnt rideUseElvtCnt emgenUseElvtCnt atchBldCnt atchBldArea
totDongTotArea indrMechUtcnt indrMechArea oudrMechUtcnt oudrMechArea indrAutoUtcnt indrAutoArea
oudrAutoUtcnt oudrAutoArea pmsDay stcnsDay useAprDay pmsnoYear pmsnoKikCd pmsnoKikCdNm pmsnoGbCd
pmsnoGbCdNm hoCnt engrGrade engrRat engrEpi gnBldGrade gnBldCert itgBldGrade itgBldCert crtnDay
rserthqkDsgnApplyYn rserthqkAblty
```

지금 팝업이 쓰는 것: `bldNm` `mainPurpsCdNm` `etcPurps` `hhldCnt` `fmlyCnt` `vlRat` `bcRat`
`platArea` `archArea` `totArea` `strctCdNm` `grndFlrCnt` `ugrndFlrCnt` `useAprDay`
`rserthqkDsgnApplyYn` `rserthqkAblty` `regstrGbCdNm`

**안 쓰는 값 중 값이 큰 것**: `heit`(높이) · `hoCnt`(호 수) · `engrGrade`/`engrEpi`(에너지효율등급)
· `pmsDay`/`stcnsDay`(허가일·착공일 → 사업 진행 속도) · `rideUseElvtCnt`(승강기)
· `indrMechUtcnt`/`oudrAutoUtcnt`(주차 대수) · `gnBldGrade`(녹색건축) · `itgBldGrade`(지능형건축)

#### `getBrFlrOulnInfo` 층별개요 — 필드 34개, 862-1 은 36행

```
rnum platPlc sigunguCd bjdongCd platGbCd bun ji mgmBldrgstPk newPlatPlc bldNm splotNm block lot
naRoadCd naBjdongCd naUgrndCd naMainBun naSubBun dongNm flrGbCd flrGbCdNm flrNo flrNoNm
strctCd strctCdNm etcStrct mainPurpsCd mainPurpsCdNm etcPurps mainAtchGbCd mainAtchGbCdNm
area areaExctYn crtnDay
```

실측값(862-1): `flrGbCdNm` = `지상`/`지하`, `flrNo` 지상 최대 **15** · 지하 최대 **8**
층별 `mainPurpsCdNm` = 학원, 상점(소매점), 기타문화및집회시설, 기타 운동시설, 기타판매시설,
휴게음식점, 기타제1종근린생활시설, 기타제2종근린생활시설

⭐ **교차검증의 핵심 재료다.** 층수 상한, 연면적 합, 층별 용도를 전부 여기서 독립 확인할 수 있다.
`loadLedgerDetail` 이 `st.detail.floors` 로 이미 받아 둔다.

#### `getBrJijiguInfo` 지역지구 — 필드 19개, 862-1 은 3행

```
rnum platPlc sigunguCd bjdongCd platGbCd bun ji mgmBldrgstPk newPlatPlc splotNm block lot
jijiguGbCd jijiguGbCdNm jijiguCd jijiguCdNm reprYn etcJijigu crtnDay
```

실측값(862-1) — **한 필지에 3종이 온다**:

| `jijiguGbCdNm` | `jijiguCdNm` | `reprYn` |
|---|---|---|
| 용도구역코드 | 제1종지구단위계획구역 | 1 |
| 용도지구코드 | 일반미관지구 | 1 |
| 용도지역코드 | **일반상업지역** | 1 |

⭐ 지금 팝업은 V-World `LT_C_UQ111` 의 **용도지역 하나만** 보여준다.
→ ① 용도지역을 **교차검증**할 수 있고 ② **용도지구·용도구역은 아예 없던 정보**다.
지구단위계획구역 여부는 재건축·증축 판단에 직접 쓰인다.

#### 그 외 op (프록시 화이트리스트에 이미 등재)

`getBrRecapTitleInfo`(총괄표제부) `getBrBasisOulnInfo`(기본개요) `getBrExposInfo`(전유부)
`getBrExposPubuseAreaInfo`(전유공용면적) `getBrAtchJibunInfo`(부속지번) `getBrHsprcInfo`/
`getBrHousePriceInfo`(주택가격) — **스키마 미측정**, §4 참조.

### 3-2. 국토부 실거래 (`1613000/RTMSDataSvc*`) — ✅ 구현됨

경로 형식: `1613000/{서비스명}/get{서비스명}` — ⚠️ 서비스명에 `get` 을 붙이면 `NO_OPENAPI_SERVICE`.
공통 입력: `LAWD_CD`(5자리 시군구) `DEAL_YMD`(YYYYMM)

| 서비스명 | 대상 | 상태 |
|---|---|---|
| `RTMSDataSvcAptTradeDev` | 아파트 매매 상세 | ✅ |
| `RTMSDataSvcAptRent` | 아파트 전월세 | ✅ |
| `RTMSDataSvcRHTrade` / `RHRent` | 연립다세대 매매/전월세 | ✅ |
| `RTMSDataSvcSHTrade` / `SHRent` | 단독다가구 매매/전월세 | ✅ |
| `RTMSDataSvcOffiRent` | 오피스텔 전월세 | ✅ |
| `RTMSDataSvcNrgTrade` | **상업업무용 매매** | ✅ 2026-08-22 추가 |
| `RTMSDataSvcOffiTrade` | **오피스텔 매매** | ✅ 2026-08-22 추가 |
| `RTMSDataSvcInduTrade` | **공장·창고 매매** | ✅ 2026-08-22 추가 |
| `RTMSDataSvcLandTrade` | 토지 매매 | 🔒 **미신청** |

#### `RTMSDataSvcNrgTrade` 상업업무용 — 필드 22개 (실측)

```
buildYear buildingAr buildingType buildingUse buyerGbn cdealDay cdealType dealAmount dealDay
dealMonth dealYear dealingGbn estateAgentSggNm floor jibun landUse plottageAr sggCd sggNm
shareDealingType slerGbn umdNm
```

- `buildingUse` = 제1종근린생활 · 제2종근린생활 · 판매 · 교육연구 · 기타
- `buildingType` = 집합 / 일반. **`집합`이면 `plottageAr`(대지면적)이 비어 온다**(구분소유)
- ⚠️ **`floor` 에 오류가 있다** — 862-1(7.33㎡ 판매시설)이 `floor=80`. 실제 지상 15층.
  상가 부스/호 번호가 층 칸에 들어간 것으로 보인다. `land.html` 의 `nonresFloorBounds()` 가 걸러낸다.
- 지번 마스킹률 실측: 관악 21% · 강남 16% (**79~84% 는 지번이 온다**)

#### `RTMSDataSvcOffiTrade` 오피스텔 매매 — 필드 18개 (실측)

```
buildYear buyerGbn cdealDay cdealType dealAmount dealDay dealMonth dealYear dealingGbn
estateAgentSggNm excluUseAr floor jibun offiNm sggCd sggNm slerGbn umdNm
```

- 면적 필드가 `excluUseAr`(전용) — 상업업무용의 `buildingAr`(건물면적)과 **의미가 다르다**
- `offiNm` 이 `(863-9)` 처럼 지번을 괄호로 감싼 자동생성명인 경우가 있다 → 수집기에서 버린다
- 지번 마스킹 **0%**(관악·강남 실측)

#### `RTMSDataSvcInduTrade` 공장·창고 — 지번 마스킹 0%(금천·강서 실측). 필드 미측정(§4)

### 3-3. 소상공인시장진흥공단 상가(상권)정보 (`B553077/api/open/sdsc2`) — ✅ 구현됨

`supabase/functions/sbiz-proxy` 경유. 오퍼레이션 12개 존재(§51-3), 우리가 쓰는 것은 `storeListInPnu`.

⚠️ 필지 파라미터명은 **`key`** 다(`pnu`·`lnoCd`·`cd` 는 `NO_MANDATORY_REQUEST_PARAMETERS_ERROR`).

#### `storeListInPnu` — 필드 39개 (실측)

```
bizesId bizesNm brchNm indsLclsCd indsLclsNm indsMclsCd indsMclsNm indsSclsCd indsSclsNm
ksicCd ksicNm ctprvnCd ctprvnNm signguCd signguNm adongCd adongNm ldongCd ldongNm
lnoCd plotSctCd plotSctNm lnoMnno lnoSlno lnoAdr rdnmCd rdnm bldMnno bldSlno
bldMngNo bldNm rdnmAdr oldZipcd newZipcd dongNo flrNo hoNo lon lat
```

**채움률 실측(반경 50m 36건 표본)** — UI 설계 전에 볼 것:

| 필드 | 채움 | 메모 |
|---|---|---|
| `lnoCd` | 36/36 | **= PNU 19자리.** 조인 키로 쓸 수 있다 |
| `bldMngNo` | 36/36 | 건물관리번호 25자리 |
| `flrNo` | **28/36 (78%)** | 비는 경우가 있다 → 층은 있을 때만 표시 |
| `hoNo` | **0/36** | **호 단위 표시는 포기할 것** |
| `dongNo` | **0/36** | 같음 |
| `bldNm` | 4/36 | 대부분 빈다 |

⚠️ 갱신 **분기** → 폐업이 최대 3개월 늦다. 화면에 기준을 밝힌다.
⚠️ 상가업소 대상 → **사무실·일반 사무업 누락**.

### 3-4. 국세청 사업자등록 (`api.odcloud.kr/api/nts-businessman/v1`) — ✅ 구현됨

`bizno-proxy` 경유. `/status`(상태조회) `/validate`(진위확인). **입력이 사업자등록번호뿐** →
상호·주소로 목록 조회 불가. 상가정보와의 연결은 §53 미해결 과제.

### 3-5. 행정안전부 CCTV 표준데이터 (`1741000/cctv_info/info`) — ✅ 구현됨

전국 `totalCount` **377,278**(실측). `type=json` 과 `returnType=json` **둘 다 동작**한다.

실측 필드(일부): `CAM_CNTOM`(카메라 대수) `CAM_PIXEL_CNT` `DAT_CRTR_YMD` `INSTL_PRPS_SE_NM`(설치목적)
`INSTL_YM`(설치년월) `KPNG_DAY_CNT`(보관일수) `LCTN_ROAD_NM_ADDR` `LCTN_LOTNO_ADDR`
`WGS84_LAT` `WGS84_LOT` `MNG_INST_NM` `MNG_INST_TELNO` `SHT_ANGLE_INFO` `FCLT_NM` `MNG_NO`

⚠️ **`cctv_static.json` 이 회귀 상태다** — §52-2 참조. 수집기는 ITS+표준을 병합하도록 설계됐지만
실제 실행이 매번 `--its-only`/`--standard-only` 라 서로를 덮어썼다. **플래그 결과를 커밋하지 말 것.**

### 3-6. 그 외 구현된 API (스키마 미측정)

| API | 경유 | 비고 |
|---|---|---|
| 청약홈 분양정보 `ApplyhomeInfoDetailSvc` | `chungak-proxy` | odcloud. 24시간 캐시 |
| 기상청 단기예보 `1360000/VilageFcstInfoService_2.0` | `kma-weather-proxy` | |
| 전기차 충전소 `B552584/EvCharger` | 정적 JSON | |
| ITS CCTV `openapi.its.go.kr:9443` | `its-cctv-proxy` | **data.go.kr 아님**, 별개 키 |

---

## 4. 미측정 — 채울 때 이렇게 확인할 것

**추측으로 적지 말 것.** 아래 명령으로 실제 응답을 받아 필드를 옮겨 적는다.

```bash
# 건축HUB 나머지 op (프록시 경유 — 키가 필요 없다)
P=https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/molit-proxy
Q='sigunguCd=11620&bjdongCd=10100&platGbCd=0&bun=0862&ji=0001&numOfRows=20&pageNo=1'
curl -s "$P?op=getBrRecapTitleInfo&$Q" | node -e "…필드 출력…"
```

```bash
# data.go.kr 직접 호출 — ⚠️ DGK 는 Encoding 키다(% 포함).
#   --data-urlencode 로 넘기면 이중 인코딩되어 승인된 API 도 401 이 된다. URL 에 그대로 붙일 것.
DGK=$(grep '^DGK=' keys.env | cut -d= -f2-)
curl -s "https://apis.data.go.kr/{경로}?serviceKey=$DGK&…&type=json"
```

**신청 여부를 부작용 없이 확인하는 방법** — 에러 코드가 갈린다:

| 응답 | 뜻 |
|---|---|
| `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | 경로는 맞고 **미신청** |
| `NO_OPENAPI_SERVICE_ERROR` | **경로가 틀렸거나** 폐기됨 |
| `NO_MANDATORY_REQUEST_PARAMETERS_ERROR` | **접근 가능**, 필수 파라미터만 빠짐 |

이 차이로 오퍼레이션 목록도 열거할 수 있다(소상공인 12개를 그렇게 확인했다 — §51-3).

### 측정 대기 목록

- 건축HUB: `getBrRecapTitleInfo` `getBrBasisOulnInfo` `getBrExposInfo` `getBrExposPubuseAreaInfo`
  `getBrAtchJibunInfo` `getBrHsprcInfo` `getBrHousePriceInfo`
- 실거래: `RTMSDataSvcInduTrade`(공장창고 필드) · 전월세 5종
- 승인만 받고 미구현 전부 → `TROUBLESHOOTING.md` §51-2 / §52-1 목록 순서대로
- 🔒 미신청이라 측정 자체가 불가: 온비드 물건목록(15157207)·물건상세(15157247) · 토지 매매 · LOCALDATA

---

## 5. 이 파일을 갱신하는 규칙

1. **API 를 새로 붙이면 여기에 스키마를 실측으로 적는다.** 응답 필드 전체 + 채움률(표본 크기 명시).
2. **§2 매트릭스를 함께 갱신한다** — 그 API 가 기존 항목과 겹치는 값을 주는지 확인하고,
   겹치면 교차검증에 넣을지 판단해 상태(✅/⬜)를 바꾼다.
3. **원본 오류를 발견하면 반드시 적는다.** 어느 필드가 어떤 조건에서 틀리는지 + 실측 사례.
   (예: 실거래 `floor` = 862-1 → 80, 실제 15층)
4. 갱신주기·커버리지 한계도 값이다. "분기 갱신" "3인 이상 법인만" 같은 제약은 UI 문구를 바꾼다.
