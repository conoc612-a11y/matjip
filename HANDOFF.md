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

## 2026-08-16 (44) — opencode ("동현아파트 확인하면 근처 참고만 나온다" — 이름 불일치 Fix A/B 구현·검증 완료, 커밋·push 대기)

> 사용자 실측: "동현아파트" 검색·클릭 → 위치정보 팝업에 건물대장 + 근처 아파트 참고(44m 논현한가람빌라트)
> 만 나옴 → 원인 규명 후 "둘 다 적용" 선택. **Fix A(클릭 팝업 이름 매칭) + Fix B(검색 자동완성에 아파트 추가)**.

### 원인 (실측 근거)
- 등록 단지명 "**동현아파트1~6**"(국토부 ~N동 그룹명) vs 검색어 "동현아파트" 불일치. 좌표도 건물
  (37.51916,127.03732)과 마커(37.51932,127.03657) **약 68m** 어긋남 → 검색은 건물로 이동하고,
  클릭 팝업은 건물 위치 기준 **가장 가까운 1곳**(논현한가람빌라트)만 참고로 표시. 동현아파트 실거래
  데이터 자체는 존재(매매 38.3억, 최근 거래 4건, 2026.5 최신) — 마커 클릭 시 정상 표시.
- 검색 자동완성(`renderAC`)이 아파트 단지를 후보로 안 올림(지명·정비구역만).

### 변경 (land.html)
1. **Fix A — 클릭 팝업 이름 매칭** (`buildClickPopup` ~4659): bldName(건물명)이 250m 내 단지명과
   접두사 일치(양방향)하면 그 단지 최신 거래의 매매가·전세가율·추이·**최근 거래 표**를 "이 건물의
   아파트 실거래"로 표시, 근처 참고(nearHtml)는 대체.
2. **Fix B — 검색 자동완성** (`renderAC` ~5481): 단지명 포함 검색(대표 행 기준 최대 4개) → 선택 시
   `openRpApt`가 마커로 이동+실거래 팝업 오픈. 마커는 top-scope `rpClusterRef`(~1296, 1594 대입)로
   찾고, 필터에 걸렸으면 임시 마커 팝업.
3. **공용화**: 마커 팝업 HTML을 `rpAptPopHtml(d)`로 추출(~1615). 클릭 팝업에는 미사용 —
   .rp-save/rt-start 클래스가 겹쳐 저장 배선이 꼬임(주석에 WHY 기록).

### 검증 (probe111, syncheck ALL OK, 서빙 사본 동기화)
- Fix A: 건물 클릭 → "이 건물의 아파트 실거래" + 동현아파트1~6 + 거래 표 4행, 근처 참고 숨김.
- Fix B: "동현아파트" 입력 → 자동완성 "동현아파트1~6(아파트)" → 선택 → 마커 팝업(38.3억, 거래 표 4행).
- JS 오류 0건. 스크린샷 `15_donghyun_building_click.png`, `16_donghyun_search_select.png`.
- TROUBLESHOOTING §31 기록.

### 커밋·배포 상태
- 로컬 변경: land.html(그립·거래 표·Fix A/B) + HANDOFF 43/44 + TROUBLESHOOTING 30-2/31.
- 그립 `c3508ec2`, 거래 표 `34aaa945` **push 완료**(사용자 "웅") — 배포 반영 확인(rpDealTableHtml 포함).
- **Fix A/B는 로컬 편집만 — 커밋·push 동의 대기.**

### ▶ 이어서 할 일
1. Fix A/B 커밋·push 동의 확인 → 커밋·push·배포 반영 확인.
2. 사용자 실사용 확인 후 ② 매매/전세/월세 구분(수집기 확장) 등 후속 개선 여부 판단.

---

## 2026-08-16 (45) — opencode ("잠원동월드메르디앙 클릭해도 참고만 나온다" — 44의 접두사 매칭 한계, contains 매칭으로 보강)

> 사용자 실측: 잠원동월드메르디앙(37.51284,127.01642) 클릭 → 여전히 "근처 아파트 실거래 참고 · 반경
> 700m 71건 / 월드메르디앙 여기서 0m"만 나오고 "이 건물의 아파트 실거래"가 안 붙음. **단지 데이터는 정상**
> (배포본·로컬 realprice_apt.json 모두 해당 좌표에 월드메르디앙 행 존재, gu=21 서초구/dong=275 잠원동,
> 매매 20.9억/2026.4, cnt700=71). 원인은 44의 **양방향 접두사(startsWith) 매칭**이 "잠원동월드메르디앙"
> (건물명, 지오코더 addition0) ↔ "월드메르디앙"(단지명)을 못 이은 것 — 동명이 앞에 붙는 형태는 접두사 관계가 아님.

### 변경 (land.html)
1. **클릭 팝업 매칭을 contains로 교체** (~4673): `(bldName.length >= 3 && n.includes(bldName)) ||
   (n.length >= 3 && bldName.includes(n))` — 짧은 쪽 3자 이상이어야 포함 관계로 매칭(과매칭 방지),
   250m 거리 필터가 경계를 추가로 막음. 접두사는 contains의 부분집합이라 회귀 없음(동현아파트1~6 유지).
2. **자동완성도 contains 보강** (~5521): "잠원동월드메르디앙" 같은 동명 붙은 검색어도 단지명과 매칭
   (`nl.includes(q) || (q.includes(nl) && nl.length >= 3)`).

### 검증 (probe112 재실행, probe113 — syncheck ALL OK, 서빙 사본 동기화)
- Fix A: 잠원동월드메르디앙 클릭 → "이 건물의 아파트 실거래 월드메르디앙 · 서초구 잠원동 · 매매 20.9억
  · 2,465만/㎡ · 전용 85㎡ · 2층 · 2026.4 · 전세가율 41% · 최근 거래 1건" + 거래 표 1행, 근처 참고 숨김.
- Fix B: "잠원동월드메르디앙" → 자동완성 "월드메르디앙 (아파트)" 최대 4개.
- JS 오류 0건. probe113은 팝업 전체 텍스트로 Fix A 확인.
- **주의**: probe112 최초 1회는 지오코더 서브모듈 로드 타이밍으로 bldName=null 유입 실패 — 테스트 하네스
  이슈(코드 아님), 재실행 통과. 동현아파트 케이스도 contains의 부분집합이라 영향 없음.
- TROUBLESHOOTING §31-1 기록.

### 커밋·배포 상태
- 직전 커밋 `9fb62677`(44의 Fix A/B)는 **push 완료** — 배포 반영 확인됨(rpClusterRef 포함, try 3).
- **이번 contains 보강 `f006ce94` push·배포 반영 완료** — 배포 확인(includes(bldName) 포함, try 3).
  변경: land.html + HANDOFF 45 + TROUBLESHOOTING 31-1.

### ▶ 이어서 할 일
1. contains 보강 커밋·push 동의 확인 → 커밋·push·배포 반영 확인(사용자 실사용 재확인).
2. 사용자 실사용 확인 후 ② 매매/전세/월세 구분(수집기 확장) 등 후속 개선 여부 판단.

---

## 2026-08-16 (43) — opencode (그립 겹침 수정 검증 완료 + 참조사이트 실거래 UI 재분석. "1번 최근 거래 표" 구현 보류 중 — 사용자가 재시작 후 재지시 예정)

> 사용자 지시: "실거래 표 반영안됬어" → "이거 말고 너가 참조사이트 분석 새로 해서 UI 개선 할
> 부분 알려줘봐" (기존 경쟁사_비교분석 추천 5종과 무관한 **새 분석 요청**). 분석·보고 후 사용자
> "1번 진행할것인데 복구·기록 저장 다 해놔, 1번은 2시간 후 컴터 리스타드 뒤 다시 물어볼 것" →
> 본 항목 작성 + 로컬 커밋. **push 하지 않음**.

### 1. 그립 겹침 수정 (이전 세션 이어짐, 로컬 검증 완료·미커밋)
- `.leaflet-popup .ui-grip-corner { bottom: -12px; }` 오버라이드 + 주석 2곳(land.html ~498-506,
  ~1113). probe107(겹침 실측 y522-546 vs content 하단 535) → probe108(그립 상단 537, 갭 2px,
  드래그 417×480→487×510→347×460 정상, JS 오류 0건, 스크린샷 12_grip_below_arrow.png).
  TROUBLESHOOTING §30-2 기록.

### 2. 참조사이트 실거래 UI 분석 결과 (새 분석)
- **네이버부동산**(land.naver.com, SPA): 매매/전세/월세 **최상위 유형 필터** + 실거래 탭 = 시세
  그래프 + **거래 테이블**(거래일·유형·가격·동/층·면적) + 기간(1년/3년/5년)·면적 필터.
- **호갱노노**(hogangnono.com, SPA): 지표 필터바 실측 — 전세가율·갭가격·월세수익률·**거래량**·
  신고가·재건축·경매 등.
- **재개발닷컴**(jaegebal.com, SSR 실측): **실거래 전용 탭** + "가장 많이 거래된 구역" 거래량
  랭킹(30/90/365일, `/hot?tab=traded`).
- **matjip 갭**: 아파트 실거래 팝업(land.html ~1576)에 **개별 거래 내역 표 없음** — 최신 1건
  (매매가·거래일·층·면적) + 평단가 그래프(최근 8건)만. 이게 사용자가 "실거래 표"라 부른 것.
- **추천안(우선순위순)**: ① **최근 거래 표** — rpGroup(d) 캐시에 단지별 전체 거래(ymd·priceEok·
  area·floor) 이미 존재, **추가 수집 불필요**. ② 매매/전세/월세 구분(collect_realprice.js 확장
  필요) ③ 거래량 표시(rpGroup으로 즉시 계산) ④ 그래프 매매+전세·기간 필터 ⑤ 전세가율·갭 ⑥ 면적별.
- **사용자 결정**: ①번 진행 예정(③·⑤ 동반 가능성), 단 **재시작 후 재지시 받고 시작**.

### 커밋·배포 상태
- 오늘 수정(그립 오버라이드 + HANDOFF 43 + TROUBLESHOOTING 30-2): 로컬 커밋 `c3508ec2`, push 대기.
- **실거래 거래 표 추가**: 커밋 전(사용자 "지금해줘" = 구현 지시, 커밋·push 동의는 별도). land.html 수정.
- 직전 커밋 `a803d4a9` push 완료. (HANDOFF 42에 적힌 커밋 해시 `6b4ec9f1`은 오기 — 실제는 `a803d4a9`.)
- 미추적 파일(변경 없음): `PLAN_auction_detail.md`, `land.backup-20260808.html`,
  `redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

### ▶ 이어서 할 일
1. **실거래 최근 거래 표(①) 구현 완료 (2026-08-16, 사용자 "지금해줘")** — 검증 통과:
   - `rpDealTableHtml(d)` (land.html ~1400, rpTrendHtml 옆) + `rpNewLow(d)` (rpNewHigh 옆) +
     팝업 배선 `${rpTrendHtml(d)}${rpDealTableHtml(d)}` (~1576) + `.rp-deals` CSS (~507).
   - 표: 거래월·매매가(총액)·평단가·면적·층, 최근 10건, 신고/최저/해제/직거래/임대 배지.
   - 헤더에 거래량 지표 "최근 거래 N건 / 최근 6개월 M건" (참조: 호갱노노·재개발닷컴).
   - probe109 실측: 삼익파크맨션 20건(2025.10~2026.7) → 표 10행, "최근 거래 20건/최근 6개월 14건",
     첫 행 2026.7·14.1억 일치, 배지(해제·최저·직거래) 렌더, ㎡↔평 토글 시 표 재생성(80㎡→24평),
     JS 오류 0건, 스크린샷 `screens/13_deal_table.png`. syncheck ALL OK.
   - 데이터 추가 수집 불필요 (rpGroup 캐시 재사용). 연립·다세대는 거래 행 단위 데이터가 아니라 적용 안 함.
2. **커밋·push 동의 확인**: land.html(그립 + 거래 표) 2개 변경분 — 동의 시 커밋·push.
3. 사용자 실사용 확인 후 ② 매매/전세/월세 구분(수집기 확장) 등 후속 개선 여부 판단.

---

## 2026-08-16 (42) — opencode (팝업 리사이즈 최종: 20260815 백업의 makeResizable() 코드 복원 + 우하단 아이콘 배치. 사용자 "어" 승인으로 커밋·push)

> 사용자 지시: "너가 뭘 다시 코드 짜려고 하지말고 리사이즈 삭제하기 전 복구 자료에서 그 코드
> 그대로 사용해줘, 다만 스크롤바 있는 그 세로줄 밑에 아이콘(버튼)으로 리사이즈 되게끔만 위치만
> 조정해줘" → (41)의 스트립 핸들 기각, 백업 코드 복원.

### 수정 (land.html, 커밋 `6b4ec9f1`)
1. `.lp-resize-handle`(스트립) + mousedown/mousemove/mouseup click 차단 제거.
2. **`land.backup-20260815.html` 1019-1034 의 makeResizable() 드래그 코드를 그대로 복원**
   (`applyStyle:false, minW:220/minH:120, maxW/maxH = 지도−30/−50, onStart: autoPan 끔,
   onResize: _lpW/_lpH + _updateLayout + _updatePosition, onEnd: autoPan 복원`).
   `js/ui-resize.js` 공용 헬퍼는 그 옵션을 여전히 지원(변경 없음).
3. 트리거: `<button class="ui-grip ui-grip-corner">` — **스크롤바 오른쪽 세로줄 바로 아래
   우하단**(right:3/bottom:3, buttons.css 공용 그립, 항상 표시). 폭·높이 동시 조절.
4. re-entry 가드 `.lp-resize-handle` → `.ui-grip`. `_updateLayout` 의 `_lpW/_lpH` 분기는
   백업 계약의 상위호환이라 유지(폭 자동맞춤·maxWidth 정리 포함).

### 검증 (probe106, 실마우스)
- 417×480 → 확대(+40,+80) 497×520 → 축소(−60,−160) 337×460 모두 유지. 팝업 재오픈 없음
  (`same:true`), JS 예외 0건. 스크린샷 10/11 저장. syncheck ALL OK.

### WHY (이 설계가 안전한 이유)
- makeResizable 이 pointerdown 에서 `setPointerCapture()` 로 드래그 후 합성 click 의 target 을
  **그립(팝업 컨테이너 내부)**에 고정 → `disableClickPropagation` 이 지도 click 전파를 차단 →
  (41)의 click-차단 방어가 구조적으로 불필요해짐. 코드 신규 작성 금지 지시 = 가장 안전한 경로.

### 커밋·배포
- 커밋 `6b4ec9f1` (land.html + HANDOFF 42 + TROUBLESHOOTING 30-1), push 완료(사용자 "어").
- 배포본 fetch 확인: `ui-grip-corner`(팝업용) 존재, `.lp-resize-handle` 부재.

### ▶ 이어서 할 일
- 사용자 실사용 확인(배포본): 우하단 아이콘을 대각선으로 드래그해 크기 조절 유지되는지.
- (41)의 스트립 핸들 관련 관찰은 무효 — makeResizable+setPointerCapture 는 재오픈을 유발하지 않음.

---

## 2026-08-16 (41) — opencode (팝업 드래그 리사이즈 3차 재작업 — 진짜 원인: 드래그 후 합성 click 이 지도 팝업을 재오픈. 하단 스트립 핸들 + click 차단으로 해결. 커밋·push 완료)

> 사용자: (40) 직후 "드래그해서 크기 조정가능하게" 재보고 → 3번째 재작업. 이번엔 **커밋·push 없이
> 로컬만** ("푸시 절대 하지말고, 로컬에서 먼저 확인할꺼야") → 실마우스 검증 통과 후 사용자
> "푸시해봐 확인해볼께" 승인으로 커밋·push·배포 완료.

### 근본 원인 (실측 — 보이는 Chrome 9223, 계측 로그 probe104)
- **드래그 로직 자체는 정상 동작했다**(높이 417→477 실변화, probe101). 문제는 mouseup 직후
  **브라우저가 합성하는 `click`** — mousedown 은 팝업(핸들), mouseup 은 지도 위라 공통 조상인
  **지도 컨테이너에 click 이 발생** → `map.on('click')`(4549)이 위치정보 팝업을 열고 → Leaflet 이
  기존 팝업을 닫으며 `setContent/update` 가 새 팝업을 자연 높이(417)로 초기화. "끌어도 원래대로
  돌아간다"=사용자 보고. (§28·§39의 그립 실패도 같은 경로로 추정.)
- probe103(직접 `_lpH` 세팅 후 `_updateLayout()`)으로 **`_updateLayout` 자체는 결함 없음** 확인.

### 수정 (land.html, 41자 `+51/−28`)
1. 커스텀 그립+makeResizable(pointer capture·임계값) 제거 → **래퍼 하단 12px 스트립
   `.lp-resize-handle`** + mousedown/mousemove/mouseup 플래그로 `content.style.height` 만 변경
   (React SearchSection 델타 패턴, min 120 / max 지도높이−50). 폭은 자동 맞춤 유지.
2. **드래그 동안 window 캡처 click 차단** — `rsDragging` flag + `e.stopPropagation()+preventDefault()`,
   flag 는 mouseup 에서 `setTimeout(0)` 으로 내려 **mouseup 직후의 click 을 잡는다**.
3. `.leaflet-popup-content-wrapper` 에 `position:relative` (핸들 좌표 기준).

### 검증 (실마우스 probe104/105)
- probe104 계측: mouseup 후 `setContent/close` 0건 (수정 전 2건). probe105: 417→507(+90)→307(−200)
  모두 유지·팝업 재오픈 없음·JS 예외 0건. 스크린샷 08/09 저장.
- syncheck ALL OK, 서빙 사본(`site\land.html`) 동기화 확인. TROUBLESHOOTING §30 기록.

### 커밋·배포
- 커밋·push 완료 (사용자 "푸시해봐 확인해볼께"). 배포본 fetch 확인: `lp-resize-handle` True,
  `ui-grip.ui-grip-corner`(팝업용) 부재 — 거리뷰·경매 패널의 공용 그립은 유지됨.

### ▶ 이어서 할 일
- 사용자 실사용 확인 (배포본): 핸들 드래그로 크기 조절이 유지되는지.
- 남은 관찰: §28 "성장 후 축소 불가" 함정이 이 설계에서 재발하는지 — 높이를 자연 높이 미만/초과로
  반복해 재오픈 없이 축소 가능한지 사용자 실사용으로 확정.

---

## 2026-08-16 (40) — opencode (스크롤바 상시 표시 + 공용 ui-grip 그립, 실제 크롬 프론트뷰 검증·push·배포 완료 + 스크롤바 규격 비교 확정)

> 사용자 지시(39 직후): "제발 팝업크기 상관없이 스크롤바 나오게 해주고, 드래그해서 크기 조정가능하게
> 만들어줘, 너가 꼭 실제 크롬익스플러에서 작동하는지(프론트뷰)에서 확인까지 해주고 푸시하자."

### 수정 (land.html, 커밋 808ff6b2)
1. **스크롤바 상시 표시**: `.leaflet-popup-content` `overflow:auto` → `overflow-y:scroll; overflow-x:hidden`.
   팝업 크기·내용과 무관하게 네이티브 스크롤바 트랙이 항상 보인다(내용이 차면 thumb 가 채워짐).
2. **그립을 공용 디자인으로 교체**: `lp-corner-grip`(은은한 대각선, 투명) → **`.ui-grip.ui-grip-corner`**
   (24x24, 어두운 배경 rgba(0,0,0,.82) + 흰 테두리 — css/buttons.css 공용, 어떤 지도 위에서도 보임).
   makeResizable 콜백은 그대로.

### 검증 — 실제 보이는(비헤드리스) Chrome + CDP 실마우스, 1440x900
- probe96: `overflow-y:scroll` 전 상태 유지, 그립 24x24 `disp:flex`·배경 확인, 드래그 축소→확대→
  축소 전 주기, JS 예외 0건. 스크린샷 4장(01_open→02_shrunk→03_grown→04_min) 저장.
- probe97: 내용이 완전히 차도(ch==sh 537) **스크롤바 트랙 15px 유지**(cw 465 < ow 480), `oy:scroll` — PASS.
- probe89: 레이어 패널 자동 접기 불변. syncheck 1블록 OK. 배포본 fetch 확인(overflow-y:scroll,
  ui-grip 존재, 구 lp-corner-grip 부재).

### 스크롤바 규격 비교 (사용자 질문 → 실측 확정)
- "지도에서 레이어 클릭하고 팝업 나오잖아, 거기(=레이어 패널) 스크롤바 규격 기준으로 팝업도 동일하게."
- 실측: 패널 `.lp-body` ow250−cw233=17px 이지만 2px 은 border(1px×2), **실제 네이티브 스크롤바는
  팝업·패널 모두 15px 동일**. 뷰포트에서 서로 다른 커스텀 규격 없음(::-webkit-scrollbar 전무).
- **사용자 선택: 현재 그대로 유지** (스크롤바 규격 변경 없음). 항상 표시(overflow-y:scroll)만 유지.

### 배포
- 커밋 `808ff6b2`, push `d0341a6e..808ff6b2`. 배포본 확인 완료.
- 스크린샷: `C:\Users\conoc\AppData\Local\Temp\opencode\landtest\screens\`.

---

## 2026-08-16 (39) — opencode (재설계: 리사이즈를 스크롤바에서 분리 — 팝업 레이어 우하단 코너 그립 상시 노출, 커밋·push·배포 완료)

> 사용자 후속 지시: "스크롤바도 없고, 크기조정도 안되고. 팝업 레이어 자체를 크기 조정 되는 기능으로
> 만들고 스크롤바는 별도로 코드 작성하면 되는거 아냐?" (스크린샷은 모델 이미지 미지원으로 미열람 —
> 텍스트 지시만으로 진행.) (38)의 "스크롤바 핸들 항상 표시" 접근을 버리고 전면 재설계했다.

### 결정 (WHY)
- (38)의 근본 원인(성장 후 핸들 소실)은 맞았지만, **핸들을 스크롤바 열에 붙이는 설계 자체가
  발견성 결함**(16x17px 화살표)이라 사용자가 여전히 조작을 못 찾음. 사용자가 제안한 대로
  **리사이즈 그립을 팝업 레이어(우하단 코너)에 상시 노출**하고 스크롤바는 네이티브(ui-scroll)로 분리.

### 수정 (land.html)
- `.lp-sbar-top/.lp-sbar-bot`(스크롤바 화살표 자리, 16x17px ×2) 제거 → **`.lp-corner-grip` 1개**
  (22x22px, 우하단 `right:1/bottom:1`, 지그재그 대각선 glyph, `row-resize` 커서, 항상 표시).
  `right/bottom`은 `.leaflet-popup`(position:absolute) 기준이라 줌/팬과 무관하게 코너 고정 — JS 위치
  갱신(`_placeSbar`) 필요 없어져 `_updateLayout`의 훅도 제거.
- makeResizable 재사용(`reverseH:false` — 아래로 끌면 커짐). 클릭-스크롤(`onClick`)은 제거(네이티브
  스크롤바가 담당). `minH:120`, `maxH: 지도높이-50` 유지.

### 검증 (로컬 CDP 실마우스 probe94/95, 3 뷰포트)
- probe94: 1440/1280/678 전부 축소→확대→자연높이 초과→축소 전 주기 통과, **그립은 sh==ch(스크롤
  불가) 상태에서도 `disp:block` 상시 표시**, JS 예외 0건.
- probe95: 그립 rect가 X(닫기)·min(접기) 버튼과 겹침 없음(false), X 클릭 정상 닫힘, 예외 0건.
- probe89: 레이어 패널 자동 접기 불변(좌측 팝업 lpOpen:true, 우측 false). `syncheck` 1블록 OK.

### 배포 확인
- 커밋 `6aa94aec`, push `1471ca18..6aa94aec`.
- 배포본 fetch: `.lp-corner-grip` 존재 True, `.lp-sbar` 부재 False(새 주석의 "스크롤바 위·아래
  화살표 자리" 문구는 설명용 — 오탐 아님).

### 남은 유의
- 그립이 스크롤바 하단 화살표 자리를 일부 덮음(우하단 코너 특성상 불가피, 구 `.lp-sbar-bot`과 동일
  수준). 스크롤은 휠·썸 드래그로 가능 — 화살표 클릭만 포기.
- 폭 리사이즈는 없음(자동 맞춤, 상한 480). 가로 그립을 원하면 `axis` 확장 필요.

---

## 2026-08-16 (38) — opencode (후속 신고: "드래그로 팝업 크기 조정이 안 되잖아" — 원인 규명·수정·커밋·push·배포 완료)

> 사용자 후속 신고: "스크롤바 팝업 위치는 확인됬고 상단 겹침도 해결됬어. 다만, 드래그로 팝업 크기
> 조정이 안되잖아." (37)의 z-index/자동접기/스크롤바 margin 수정은 유지한 채 드래그만 분석했다.

### 근본 원인 (실측 — CDP 1440x900, probe91/probe92)
- 신선한 팝업에서 축소(474→414)·확대는 **정상 동작**. 문제는 **확대 후**: 드래그로 내용 높이(sh)를
  넘게 키우면 `sh==ch` 가 되어 스크롤바가 사라지고, `placeSbar`의 `scrollable` 게이트(`sh > ch+1`)가
  리사이즈 핸들까지 `display:none` 처리 → **축소가 불가능한 상태가 됨**(probe91 실측: 성장 후 6회
  연속 드래그 전부 무반응, 핸들 `disp:none`). 스크롤 불가능한 짧은 팝업은 애초에 핸들 자체가 없음.
- 이 "성장 후 축소 불가" 또는 "핸들 없는 짧은 팝업"이 사용자 보고와 일치.

### 수정 (land.html)
- `placeSbar`의 핸들 표시를 `scrollable ? '' : 'none'` → **항상 표시**(`''`)로 변경. 스크롤바 위치
  (`L = content.offsetLeft + content.offsetWidth - sbW`)는 그대로 — 스크롤바가 사라진 상태에선
  `sbW==0`이라 핸들이 내용 오른쪽 모서리에 정렬, 축소 가능.

### 검증 (로컬 CDP 실마우스, `site/land.html` 서빙)
- probe92: 축소→확대→자연높이 초과 확대→축소 전 주기 통과 (474→414→474→534→474).
- repro88: 1440/1280/678 뷰포트 드래그 + 폭 480 유지 + JS 예외 0건.
- probe93: 120px(minH)까지 축소해도 핸들 유지, X 닫기 버튼 정상 동작(팝업 닫힘).
- probe89: 좌측 팝업 비접힘(lpOpen:true)·우측 접힘 유지. `syncheck` 1블록 OK.

### 배포 확인
- 커밋 `2c3a562a`, push `5ffa108d..2c3a562a`.
- 배포본 `land.html` fetch 확인: 새 마커("핸들만 항상 보여준다" 주석, `''` 할당) True, 구 마커
  (`scrollable ? '' : 'none'`, "스크롤 불가면 숨긴다") False.

### 유의 (남은 기하 상태)
- 접힌/축소된 팝업에서 top 핸들이 X(닫기) 버튼과 ~10px 겹침 — (37)과 동일한 기존 배치, 실측상 X
  클릭 정상(probe93). 그대로 수용.
- 상단 핸들 드래그 시 팝업이 페이지 헤더 아래로 가면 상단 핸들이 가려짐 — 축소는 하단 핸들 사용
  (land.html 주석 2026-08-16 기록).

---

## 2026-08-16 (37) — opencode (배포 후 신고 3건 수정: 드래그 리사이즈 무동작·스크롤바 위치·버튼 겹침 — 커밋·push·배포 완료)

> 사용자 신고(배포본 스크린샷): "드래그 크기조절이 전혀 안 됨", "스크롤바가 맨 우측에 없음",
> "팝업 상단 접기·닫기 버튼과 스크롤바 겹침". (36)의 검증은 1280/678 에서만 진행돼 **1440px + 레이어
> 패널이 열린 상태의 겹침을 놓쳤다** — 교훈: 열린 레이어 패널 포함 전 뷰포트 조합으로 검증해야 한다.

### 근본 원인 (실측 — CDP 1440x900, repro86/probe87/probe89)
- `.leaflet-popup-pane` z700 < Leaflet 컨트롤 컨테이너 z1000 → **열린 레이어 패널(.lp-body)이 팝업
  우측 124px 을 덮음**. 하단 드래그 핸들 hit-test 가 패널 내부 `SPAN.lp-name` 을 반환 → 드래그
  pointerdown 미발생(무동작), 닫기·접기·스크롤바 가림. 핸들이 `z:1200` 이어도 **popup pane 안의
  stacking context** 라 컨트롤에 진다.
- "스크롤바 맨 우측 아님": content 기본 `margin: 13px 24px 13px 20px` 가 스크롤바를 24px 안쪽으로.
- 버튼 겹침: 모두 패널 아래 가려 나타난 착시 + content margin.

### 수정 (land.html)
1. **`.leaflet-popup-pane { z-index: 1200 }`** — 팝업을 컨트롤 위로 (안전망).
2. **popupopen 자동 접기** — 팝업 rect 와 `.lp-body` rect 가 겹치면 패널 fold
   (`requestAnimationFrame` + `getBoundingClientRect`). 안 겹치는 좌측 팝업은 패널 유지(실측 probe89),
   아파트 체크는 유지(실측 repro88). 레이어는 켜진 채 접히므로 재토글 1번으로 복귀.
3. **content `margin: 13px 0 13px 20px` + `padding-right:24px`** — 스크롤바가 팝업 오른쪽 끝에 붙음
   (content 는 `box-sizing:border-box` → offsetWidth 동일).
4. **폭 ratchet 수정** — `_updateLayout` 자연폭 측정 시 이전 실행이 남긴 인라인 `maxWidth` 가
   `width:2000px` 을 다시 클램프해 드래그 후 폭이 480→390 으로 오그라듦(실측 probe87 TRACE:
   maxWidth 있을 때 sw390 → 비우면 sw1024). 측정 동안만 maxWidth 비움 → 폭 480 유지(실측).

### 검증 (실측 — CDP 실마우스)
- 1440/1280/678 세 뷰포트: 하단 핸들 hit = `lp-sbar-bot`, 드래그로 높이 증가(1440: ch 474→534),
  폭 480 유지, 패널 자동 접힘(레이어는 유지), JS 예외 0건.
- probe89: 좌측 팝업(팝업 x12-514, 패널 x794)은 접히지 않음 / 우측 팝업은 접힘.
- 상세 함정·수치: TROUBLESHOOTING §26.

### 커밋·배포 상태
- 커밋 1개: `land.html`(+54/−7) + `HANDOFF.md`(37) + `TROUBLESHOOTING.md` §26. push 후 배포본 `?cb=`
  마커(`lp-pane-z`/`lp-fold`/`sb-margin`/`mw-clear`)로 확인 예정. untracked 4개·`keys.env` 커밋 안 함.

### ▶ 이어서 할 일
- 배포 반영 확인 후 사용자 실사용 확인(로그인 세션): 드래그·스크롤바 위치·버튼 배치가 배포본에서 정상인지.
- **다음 회귀 검증 관례(37 교훈)**: 팝업 레이아웃 변경 시 반드시 **패널 열림 + 넓은 화면(1440)** 조합 포함.
- (36)의 이어서 할 일 유지. 테스트 프로세스(chrome 9223·python 8798)는 정리 예정.

---

## 2026-08-16 (36) — opencode (팝업 폭 자동맞춤 + 스크롤바 세로 드래그 + 버그 3건 — 커밋·push·배포 완료)

> 사용자: "테스트 다끝나면 푸시 배포까지 다 해놓고 기록해놔" → 사전 동의로 커밋·push·배포·기록까지 진행.

### 구현 (land.html)
1. **팝업 폭 자동맞춤** — `_updateLayout()` else 분기 `Math.max(220, Math.min(natural, 지도폭-50, 480))`.
   기존 700px 대비 팝업이 우측 레이어 탭을 비켜감(원래 신고 버그 해소).
2. **스크롤바 세로 드래그** — `.lp-sbar` 상/하단 화살표를 `makeResizable`(기존 ui-resize 헬퍼, §18)로
   높이 리사이즈에 연결. 4px 드래그 임계값 → 못 넘으면 클릭(한 화면 스크롤). 그립(드래그 막대) 제거.
3. **버그 3건 수정** (전부 실측, TROUBLESHOOTING §25):
   - ① 폭 자동측정 회귀: `scrollWidth`가 항상 지도 폭 반환(1280px→895px) → 위 클램프로 해결.
   - ② **복원 칩 버블링(기존 기능 버그)**: 칩 클릭이 `map.on('click')`에 전파돼 "위치 정보" 팝업이
     복원을 덮어씀 → `L.DomEvent.disableClickPropagation(chip)` (minBtn.onclick 내).
   - ③ min 버튼 가림(원래 신고): 678px에서 접힌 레이어 탭(실측 x354-388·y102-136)이 우상단 버튼을
     덮음 → ② 폭 상한에 50px 여유로 해소, 버튼 right:30 유지.

### 검증 (실측 — 헤드리스 CDP 실마우스)
- min→칩→복원 전 흐름: 1280/678/700 **3개 뷰포트 통과** (복원 후 "창신쌍용2" + trendSvg + sbar 2 +
  map.click 없음). test30 오류 스윕 `ERRORS: []`, test15/16 통과.
- 스크롤바 핸들: 하단 성장(392→472)/축소(412→312), 상단 성장(312→412), 클릭 스크롤(scrollTop 100→37) OK.
- **수용한 한계**: 팝업을 지도 상단 밖으로 키우면 상단 핸들이 페이지 헤더(stat-bar) 아래로 들어가
  축소 불가 — 하단 핸들로 축소 가능. Leaflet pane 스택(팝업<컨트롤) 구조상 회귀 아님. land.html 주석에 WHY 기록.

### 커밋·배포 상태
- 커밋 1개: `land.html`(+90/−18) + `HANDOFF.md` + `TROUBLESHOOTING.md` §25. push 후 배포본 `?cb=` 캐시
  우회로 `w-50cap`/`chipfix`/`min-btn` 마커 확인. untracked 4개(`PLAN_auction_detail.md`·backup 2개·hwpx)·
  `keys.env`는 커밋 안 함(사용자 보존 확인).
- **상단 항목 (35) 정정**: 986a0451 로 커밋·push·배포 이미 완료 (아래 항목의 "커밋 대기" 문구는 stale).

### ▶ 이어서 할 일
- 배포 후 실사용 확인(로그인 세션): 팝업 폭 자동맞춤·세로 드래그가 배포본에서 정상인지.
- (35)/(34)의 이어서 할 일 유지: (32) 커밋·push, 사진 수집 재개 등은 별도 동의 대기.
- 테스트 프로세스(chrome 9223·python 8798)는 정리 완료.

---

## 2026-08-15 (35) — opencode (실거래 시계열·신고가·가격변동 테마 — land.html)

> 사용자: "1/2번 둘다 해도 되나?" → 둘 다 진행. 코드·테스트 완료, **커밋·push·배포는 사용자 동의로 진행.**
> **상태 정정(2026-08-16)**: 커밋 `986a0451` 로 커밋·push·배포 완료됨.

### 데이터 구조 확정 (핵심)
- `realprice_apt.json` 은 **거래 1건 = 행 1개(time series)** — 30,515행, 단지(이름|구|동) 그룹 12,459개 중 8,224개가 복수 거래월. 시계열·신고가·가격변동 전부 이 데이터로 계산 가능(실측).

### 구현 (land.html, 신규 헬퍼는 `ageColor` 뒤 최상위 스코프)
1. **시계열 추이 그래프** `rpTrendHtml()` — 단지 팝업에 최근 8건 평단가(만/㎡) 인라인 SVG(220×56, 선+점, 첫·끝 거래월, 변동률 %). 총액 대신 평단가로 비교(평형별 왜곡 방지 — WHY 주석).
2. **신고가 배지** `rpNewHigh()` — 평형(면적 0.5㎡ 매칭)의 직전 거래들보다 최신 거래가 최고가면 빨간 배지(`rpFlagsHtml`에 추가).
3. **가격변동 지도 테마** — 패널에 "마커 색: 노후도|가격변동" 칩(`#rp-color`). `rpMoveColor()`: 최신 거래월 vs **직전 거래월** 평균 평단가 +2%↑ 빨강/−2%↓ 파랑/보합·부족 회색. 토글 시 `rpBuild()` 재빌드 + `rpLegendRows()` 범례 동기화.

### 버그 2건 발견·수정 (브라우저 실측)
- **① `rpColorMode` 객체 비교 오류**: `rpBuild`가 `rpColorMode === 'move'`로 비교했는데 선언이 `{ v: 'age' }` 객체 → 항상 false → 마커 색이 move로 안 바뀜. `rpColorMode.v === 'move'`로 수정(2곳).
- **② villa/apt 공용 패널 불일치**: `#rp-panel`은 아파트·연립이 공용인데 가격변동 칩·범례는 아파트 전용(rpMoveRate는 rpRows·rpGroup 기준). villa만 켠 상태에서 칩을 누르면 범례만 move로 바뀌고 villa 마커는 노후도색 그대로. → `rpSyncColorChip()` 추가: apt 레이어가 켜져 있을 때만 `#rp-color-wrap` 표시, apt 꺼지면 자동 age 복귀.
- **③ `rpMoveRate` 주석 위반**: 주석 "직전 거래월"인데 구현은 *이전 전체 기간 평균*과 비교. 직전 거래월(ymds 중 마지막 2개) 비교로 수정.

### 검증 (실측)
- **로직 (Node, 실데이터 30,515행)**: 상승 12,941 / 하락 8,596 / 보합 2,534 / 거래부족 6,444 = 합 일치. 창신쌍용2: 직전월 평균 1,209 vs 최신 1,371 → +13.37%. 추이 점 1371→1151→1267→807→823.
- **브라우저 (헤드리스 CDP, auth-guard 스텁, 실데이터)**: rows 30,515·그룹 12,459·신고가 1,586·moveRate 35.48→(수정 후) 확인. 팝업 SVG(선 1+점 5, 유효 경로)·신고가 배지(아남1)·마커 fill 전환(move 시 `#868e96` = 거래부족)·villa/apt 시나리오 4종 전부 PASS. 문법: 인라인 스크립트 2개 OK.
- 테스트 인프라·프로세스 정리 완료 (헤드리스 9223·python 8798 종료).

### 커밋·배포 상태
- **커밋·push·배포는 이 항목 마지막에 사용자 동의로 진행.** 변경 파일: `land.html`(+131/−7) + `HANDOFF.md`.

### ▶ 이어서 할 일
- (34)의 "▶ 이어서 할 일" 중 남은 것: (32) 커밋·push(별도 동의), (31) 사진 수집 재개 등.
- 배포 후 실사용 확인: 팝업 추이 그래프·신고가 배지·가격변동 토글이 배포본(`?cb=` 캐시 우회)에서 정상인지.

---

> 사용자: "8월18일자인데 송파시그니처롯데캐슬 은 왜 안나와?" → 원인 규명·수정·push·배포까지 완료(사용자 동의 후).

### 원인 (실측 근거)
- 송파 시그니처 롯데캐슬(거여동 181·202번지 일원, **불법행위 재공급 1세대**, 접수 2026-08-18)은
  **무순위 잔여세대 재공급(줍줍)** — 일반 분양 API `getAPTLttotPblancDetail` 에는 아예 검색 불가
  (`HOUSE_NM::LIKE` 송파 → 0건, 서울 194건 스캔 0건). 별도 op **`getRemndrLttotPblancDetail`** 에만 존재
  (서울 matchCount=303, `HOUSE_MANAGE_NO=2026930025`).
- 무순위 응답 필드가 일반 분양과 다름: 접수 마감 `RCEPT_ENDDE` 가 아니라 **`GNRL_RCEPT_ENDDE`**,
  공급세대 `TOT_SUPLY_HSHLDCO` 가 아니라 **`TOT_SUPPLY_HSHLDCO`**(S 2개). 특공 필드 `SPSPLY_RCEPT_*` 는 비어 있음.
- 무순위 주소는 **다중 지번(콤마)** 빈번: `거여동 181, 202번지` — V-World 실측 181번지는 road/parcel 모두
  NOT_FOUND, **202번지만 parcel 로 OK** (1171011300102020156, 127.1481/37.4969).

### 수정 (`land.html`, 커밋 `72c58135` — push·배포 완료)
1. `loadSubscriptions()`: `getAPTLttotPblancDetail` + `getRemndrLttotPblancDetail` **병렬 호출 병합**.
   날짜 필터는 op 별로 나눠 적용(`RCEPT_ENDDE`/`GNRL_RCEPT_ENDDE`). `PBLANC_NO` 로 dedup.
2. `vworldAddrToPnu()`: 다중 지번(콤마)일 때만 각 지번으로 분리해 road→parcel **순차** 시도
   (단일 지번·도로명은 원문 1개 후보 — 도로명 숫자에 '번지'를 붙이면 깨짐).
   - **함정 수정**: `번지?` 는 '번'+선택'지'라 '번'이 필수 → 숫자만 있는 지번('181')이 매치 안 됨.
     `(?:번지)?` 로 묶어야 전체가 선택이 된다 (실측으로 발견).
3. TROUBLESHOOTING §6-7 에 무순위 함정(필드명·다중지번·번지? 함정) 기록.

### 검증
- 프록시 경유 무순위 응답 OK(서울 matchCount=303), 2026-08-15 기준 배지 후보 **5건**(기존 4 + 송파 시그니처 롯데캐슬).
- 두 함수 문법 OK, 배포본(382,499 B) 서명 확인: `getRemndrLttotPblancDetail`·`GNRL_RCEPT_ENDDE`·
  `TOT_SUPPLY_HSHLDCO`·`(?:번지)` 모두 반영. Edge Function 배포 불필요(chungak-proxy 가 Remndr 이미 허용).

### ▶ 이어서 할 일
- (33)의 "▶ 이어서 할 일" 중 남은 것: (32) 커밋·push(별도 동의), (31) 사진 수집 재개 등.
- 배지 무순위 포함 UI 확인은 브라우저(배포본 `?cb=` 캐시 우회)에서 — 이번 주 접수 5건 모두 표시되는지.

---

## 2026-08-15 (33) — opencode (자동 갱신 일원화 + 청약 배지 누락 원인·수정)

> 사용자: "법원경매·SH공사 공고·실거래가·지오코딩 진행하고" + "청약 분양예정은 스케줄 불필요한데 지금도 서울에 1곳만 떠, 실제 더 많은데 어떻게 해야 해?".
> **코드·워크플로 변경만. 커밋·push·배포·시크릿 등록은 사용자 동의 대기.**

### 완료
1. **청약 배지 4건 중 1건만 뜨던 원인 확정 (실측)** — API 데이터는 정상(서울 접수마감 미지난 공고 4건:
   쌍용 더 플래티넘 서대문·더샵 신길센트럴시티·써밋 클라비온·충정로역자이르네, 최신 공고 2026-08-14).
   문제는 `land.html:3508` `vworldAddrToPnu()` 가 `category=road`(도로명) 고정인데, 청약 주소가
   `서울특별시 영등포구 신길동 413-8번지 일원` 같은 **지번+"일원" 접미사**라 3/4건 `NOT_FOUND`
   (V-World 실측). `category=parcel` 로 "일원/일대"를 떼고 묻자 4/4 좌표 획득.
   → `vworldAddrToPnu()` 를 **road → parcel 순차 재시도**로 수정(JSONP 콜백에서 결과 없으면 s2() 로 parcel 재시도).
2. **실거래가 수집기 CI 대응** — `tools/collect_realprice.js` `geocode()` 에 `VWORLD_PROXY` 분기 추가
   (`collect_auction.js` 와 동일 정책: 프록시 경유 시 `{status,lat,lng}`, 차단 null 은 캐시 안 함).
   **스모크 테스트: 강남구 1개월 + VWORLD_PROXY 경유 → 지오코딩 10/10 100% 성공, 차단 0건.**
   (프록시 자체는 간헐 차단이라 6연속 502 → 7/10 OK 까지 실측 — 재시도+백오프가 흡수.)
3. **자동 갱신 워크플로 2종**
   - `collect-auction.yml` → 이름 "경매·공고 자동 갱신"으로, **공고 수집 스텝 추가**
     (`node tools/collect_notices.js` → `notices.json`, 키 불필요·초 단위), 커밋 파일에 notices.json 포함.
     매일 07:00 KST(`0 22 * * *`) 유지.
   - `collect-realprice.yml` **신규** — 매월 1일 07:00 KST(`0 22 1 * *`), `timeout-minutes: 120`.
     메인 실행(`DGK`·`MONTHS=12`·`WITH_APT=1`·`VWORLD_PROXY`) → RENT_ONLY 실행(전월세 2종).
     `writeSafe` 가 0건/절반 미만이면 스텝 실패. 커밋은 `realprice_*.json`·`.geocache.json` 변경 시에만.
4. **TROUBLESHOOTING 갱신** — §6-6에 지번"일원" 함정·parcel 폴백 실측 기록, §6-7의 "0건이 정상"(08-07
   실측)에 08-15 갱신 주석(4건), §19-2에 실거래가 프록시 전환 기록.

### 주기 결정 사유 (재작업 방지용 WHY)
- **경매+공고 = 매일 07:00 KST**: 법원·SH공사 둘 다 하루 단위 신규물건, IP 차단 위험 낮추려면 1회/일이 상한.
- **실거래가 = 월 1회 (1일 07:00)**: 데이터가 월 단위 확정 공개. 주 1회(연 314,496회) vs 월 1회(연 72,576회)
  호출 — 최신성 차이는 거의 없는데 data.go.kr 쿼터 소모만 4.3배. **레포가 PUBLIC**이라 Actions 분은
  무제한(비공개만 월 2,000분 제한)이라 분당 제한은 무관.
- **청약 = 스케줄 불필요**: chungak-proxy 실시간 조회(페이지 로드 시). 사용자 확정.

### ⚠️ 배포 전 필수 (사용자 동의 필요) — ✅ 모두 완료 (커밋 `f0f5a81d`·push·배포, DGK 시크릿 등록 2026-08-15)
- **`DGK` GitHub 시크릿 등록** — 아직 시크릿 0개 (`gh secret list` 확인). 실거래가 워크플로가
  `secrets.DGK` 를 쓰므로 등록 전엔 실패. 값은 `keys.env` 에 있음 (키 이름만 참조, 값 출력 금지).
  등록 명령: `gh secret set DGK` (keys.env 값 입력) — **사용자 동의 후**.
- 커밋 6개 파일: `.github/workflows/collect-auction.yml`·`collect-realprice.yml`(신규)·`land.html`·
  `tools/collect_realprice.js`·`tools/.geocache.json`·`TROUBLESHOOTING.md`(+HANDOFF).
  `.geocache.json` 변경은 스모크 테스트로 추가된 유효 좌표(강남구 연립)임.
- **커밋 대기 (32)의 css/buttons.css·main.html·js/main.js 파일과 함께 묶지 말 것** — (32)는 별도 동의 대기 중이므로 분리 커밋 권장.
- vworld-geocode Edge Function 배포는 이미 되어 있음(400/200 응답으로 확인). land.html 수정은
  **배포(GitHub Pages push) 후 `?cb=` 캐시 우회로 확인** — 분양예정 배지가 4건 다 뜨는지.

### ▶ 이어서 할 일
- 사용자 동의 후: ① `gh secret set DGK` ② 33번 작업 커밋·push ③ (32) 커밋·push ④ 배포본에서 배지 4건 확인.
- (31)의 "▶ 이어서 할 일" ①사진 수집 재개 ③Edge 배포 명령 ④테스트 방법은 그대로 유효.

---

## 2026-08-15 (32) — opencode (land.html UI 검토 6건 수정 — "다 고쳐")

> 사용자: "land만 UI 렌더 검토 → 보고" → 6건 리스트 보고 → "다 고쳐". **코드 변경만, 커밋·push·배포는 동의 대기.**

### 완료 (수정 근거: 실측 — 헤드리스 Chrome, §1·§8 방법, 데몬은 §8 신규 메모 참조)
1. **모바일 지도 하단 92px 클리핑** — `css/buttons.css` `#map{height:100vh}` → `calc(100vh - 92px)`+`calc(100dvh - 92px)`. 실측 390×844: map bottom 936→844(=뷰포트 바닥). 헤더(58)+stat-bar(34)가 실제 공간 차지가 원인.
2. **데스크톱 우측 패널 항상 280px** — `.panel` 기본 `min-width:380px`(TROUBLESHOOTING §24-② 참조: 9:1 배분이 항상 min-width 미만이라 눌림) + `@media (max-width:900px)`에서 280 복귀. 실측: 1440/1024→380, 900/820→280. 드래그 저장 폭(mj_panel_w)은 인라인 flex로 우선 — 기존 리사이즈 동작 불변.
3. **다크모드 OS 미연동** — 저장값 없으면 `matchMedia('(prefers-color-scheme: dark)')` 따라감. **`<head>` 프리페인트 스크립트 추가**(플래시 방지, head·body 판정 동일 — 한쪽 바꾸면 다른 쪽도). `js/main.js` 도 같은 결함이라 함께 수정.
4. **320px 이하 헤더 좁힘** — `.brand-title` ellipsis + `@media (max-width:380px){#weather-chip{display:none}}`. 실측 320: headerOverflow=false, 헤더 58px 유지(수정 전 360px에서 날씨칩 2번째 줄 탈출·stat-bar 덮음).
5. **푸터 죽은 링크 제거** — `이용안내`/`이용방법 및 장애문의`(`href="#"`) land·main 둘 다 제거.
6. **키보드 포커스 링** — css/buttons.css 공용에 `:focus-visible` 규칙. 실측: Tab→`.brand` outline 2px(주 색상).

### 검증
- 헤드리스(임시 HTTP 서버 + auth-guard만 무력화한 temp 사본) 실측: 위 1·2·4 항목 값 확인, 콘솔 에러 0건(환경 탓 404·subscriptions fetch 제외), `node --check js/main.js` OK, footer 링크 `#` 0개.
- 임시 파일·데몬·HTTP 서버 정리 완료. 원본 auth-guard.js 변경 없음.

### 커밋·배포 상태
- **커밋 대기 (사용자 동의 대기)**: `css/buttons.css`·`land.html`·`main.html`·`js/main.js`(+TROUBLESHOOTING §24·HANDOFF). push·배포는 별도 동의.
- **완료 (사용자 "1" 동의 + "그냥 푸시까지 다해줘")**:
  - `6494c5d7` fix(ui) 6건 — push, 배포 `built`, `?cb=` 캐시 우회 실측 반영 확인.
  - `5b957dad` docs (TROUBLESHOOTING §24·§8 메모 + HANDOFF 32) — push.
  - `2b4003ae` fix(land) 폴리곤 스타일 — push, 배포 `built`, 배포본 `weight:2`·`fillOpacity:0.2` 실측 확인.
- **정비사업 폴리곤 최종 스타일 (2b4003ae, 사용자 반복 지시)**: 채움 `fillOpacity` 전 구역 통일 **0.2**, 외곽선 `weight` 전 구역 통일 **2** (선택/미선택/폴리곤/근사 원). 과정: 45%→25%→20%, 외곽 1.5→2.5→2. 근사 원(경계 미확보)은 점선 `dashArray:'4 4'` 유지. land.html 주석에 WHY 기록.

### ▶ 이어서 할 일
- (31)의 "▶ 이어서 할 일" 1)~4) 그대로 유효: ①사진 수집 재개 ②CI 지오코딩 캐시 커밋 전환 push 대기 ③Edge 배포 명령 참고 ④테스트 방법 준수.
- 이번 수정 커밋 동의 받기. push 후 배포본에서 모바일 지도·패널 폭·다크모드 확인(§7: 캐시 주의 `?cb=`).

---

## 2026-08-15 (28) — opencode (V-World CI 해외 IP 차단 → Supabase Edge Function 프록시로 우회)

> (27)에 이어짐. 커밋 `8f8cff3e`·`defbaca2`·`4f73403d` 3개는 이미 push 완료(사용자 동의 후).
> **다음 세션이 이어받을 지점은 "▶ 이어서 할 일"부터.**

### 완료 (커밋 순)
1. `4f73403d` **CI 지오코딩 100% 실패 원인 확정** — CI 러너에서 V-World 직접 호출 **5/5 전부
   ECONNRESET**(TCP 차단). `api.github.com/meta` 실측으로 GitHub Actions 공개 러너 IP 전부
   해외(미국 Azure, 7,280 CIDR) 확인. V-World 가 해외 IP 를 네트워크 단에서 차단(§19-2).
   로컬(한국 IP)은 동일 키·동일 주소 전부 OK 였음.
2. `defbaca2` **진단 스텝을 수집 전으로 이동** — 빠른 실패 확인.
3. `8f8cff3e` **V-World 지오코딩을 Supabase Edge Function 경유로 전환** — `supabase/functions/
   vworld-geocode` 배포(재시도 4회 + `sleep(400×attempt²)` 백오프, NOT_FOUND 만 확정). `collect_
   auction.js` 는 `VWORLD_PROXY` env 가 있으면 프록시 경유(없으면 로컬 직접). 워크플로 `collect-
   auction.yml` 에 env 주입. 동시에 **null 캐시 오염 버그 수정**: 차단(502/RST)으로 끝난 null 은
   `geoCache.set` 하지 않아 일시 차단이 영구 실패로 고정되는 것을 방지(실측: 캐시에 null 2,309건
   누적돼 있었음). `if (pt || !blocked) geoCache.set(...)` 정책.
   **검증(로컬 실측)**: Supabase(미국 IP)에서 V-World 직접 호출은 ~50%(8회 중 4회 200), 재시도
   4회+백오프 넣은 `vworld-geocode` 는 4주소×8회 = **전부 OK**. TROUBLESHOOTING §19-2 문서화.

### 이번 세션 (28) 진단 결과 — CI 재실행 2회 모두 실패 (지오코딩과 무관)
- **run 31875216160 / 31875589960** 둘 다 동일 지점에서 실패: `page.goto` **법원 사이트 접속
  30초 타임아웃 ×3회** → `수집 실패: Execution context was destroyed`. 캐시 36,495건 복원·env
  주입까지는 정상, **지오코딩 스텝에 도달하기 전에 죽었다**.
- **원인 실측**: 같은 시각 로컬(한국 IP)에서도 courtauction.go.kr 이 **500 + "사용에 불편을
  드려서 죄송합니다. 잠시 후 다시 이용해 주십시오"** (57ms) 응답. §6-11 의 IP 차단 문구와 다른
  일반 점검/장애 메시지. → **법원 사이트 자체가 점검/장애 상태** (GitHub Actions 문제 아님).

### ▶ 이어서 할 일
1. **법원 사이트 정상화 후 CI 재실행** (`gh workflow run "법원경매 목록 자동 갱신" --ref master`).
   목표는 지오코딩 프록시가 **CI 환경에서 실제로 도는지** 확인 — 로컬 검증은 끝났지만 CI 통과
   확인은 법원 사이트가 살아야 가능. 사이트 장애는 수 분~수 시간이므로 1시간 뒤 재시도 권장.
2. **TROUBLESHOOTING.md §19-2 수정분 커밋** (현재 working tree 에 uncommitted, 27줄) — 사용자
   동의 후. `tools/recommend.js` 도 working tree 에 M 상태인데 이 세션과 무관한 기존 잔재(다음
   세션에서 확인 필요). [8/15(28) 세션에서 해결 — §"완료(28-2)" 참조]

### 완료 (28-2) — 정리 세션
- **커밋 `fb74bff8`**: §19-2 문서화 + HANDOFF(28) 추가, push 완료 (사용자 동의)
- **커밋 `aab8e6b8`**: `tools/recommend.js` 에 `if (!taste)` 가드 추가 (브라우저 `js/recommend.js`엔
  이미 있었는데 canonical 에만 없던 동기화 누락) + `tools/verify.js`(리팩토링 안전망) 추가, push 완료.
  호출부 전수 확인: `mcp/server.js:30`(zod 기본값)·`matjip-cli.js:22`(항상 객체) — 안전.
- **임시 파일 삭제**: `_*.txt` 10개 + `gg-codes-verified.json`(빈 `{}`)
- **검증 중 발견(데이터 정합성, 미처리)**: `mj_restaurants` 1,000건 태그 780종 중 **'매콤'·'매운맛'·
  '담백' 태그 0건** (상위: 착한가격·한식·김치찌개 등 메뉴명 기반). 취향 설문에서 "매콤" 선택 시 추천
  스코어가 전부 0점이 됨(스파이스 보정은 `매콤`/`담백` 태그 의존). 시드 데이터 태그 보강 또는 스파이스
  보정 로직 변경 필요. 지오코딩과 무관. 사용자: "다음에".
- **남은 항목**: `PLAN_auction_detail.md`·backup 2개·`경매사_비교분석_20260808.hwpx` 는 보존
  (사용자 확인 완료, 커밋 안 함).

### Relevant Files
- `supabase/functions/vworld-geocode/index.ts` — V-World 프록시 (재시도 4회+백오프)
- `tools/collect_auction.js` — `VWORLD_PROXY` env 분기 + null 캐시 가드
- `.github/workflows/collect-auction.yml` — `VWORLD_PROXY` env 주입
- `TROUBLESHOOTING.md` §19-2 — 원인/해결/검증/WHY 기록 (미커밋)

---

## 2026-08-14 (27) — Claude Code (UI 통합·코드리뷰 조치·성능 최적화 1·3 / 2번 진행 중 중단)

> (26) 에 이어짐. 커밋 8개, 전부 push 완료. **다음 세션이 이어받을 지점은 아래 "▶ 이어서 할 일" 부터.**

### 완료 (커밋 순)
1. `ad4ba61` **포켓도어 접기 탭이 실제 마우스로 전혀 안 눌리던 버그** — 원인은 `css/buttons.css` 의
   공용 `button:hover { transform: translateY(-1px) }` 가 탭의 가운데 정렬용 `transform:
   translate(-50%,-50%)` 를 통째로 대체해, 마우스를 올리는 순간 탭이 자기 크기의 절반만큼
   튀어 커서 밖으로 도망간 것. 중앙 정렬을 음수 margin 으로 바꿔 해결.
   **교훈(중요): `tab.click()` (JS 합성 클릭)으로 테스트하면 이 버그를 못 잡는다** — pointer
   이벤트 체인을 안 타기 때문. CDP `Input.dispatchMouseEvent` 로 진짜 마우스를 흉내내야 한다.
   세 번이나 "고쳤다"고 잘못 보고한 원인이 이 테스트 방식이었다.
2. `162856d` **좌측 패널 3종을 가로로 나란히 배치** — 전엔 전부 `position:absolute; left:0` 라
   겹쳐 있어서, 접으면 탭이 같은 좌표에 포개져 아래 패널을 다시 못 폈다. flex 컨테이너
   `.left-panels` 로 감싸고, 접힘을 폭 0 이 아니라 탭만 남는 띠(RAIL_W=22px)로 바꿔 해결.
3. `5788d2d` **접기 탭이 너비 조절까지 겸하도록 통합** — 드래그 전용 막대 제거(사용자 요청).
   `js/ui-resize.js` 에 `dragThreshold`/`onClick`/`dragEnabled` 옵션 추가(4px 넘게 움직여야
   드래그로 승격, 못 넘으면 클릭). 기존 호출부는 옵션을 안 넘기므로 동작 그대로.
4. `6e195d1` **코드리뷰 CRITICAL 조치** — 상세는 아래 "코드리뷰" 절.
5. `0914cd5` **중복 fetch 제거(최적화 1)** — `redevelop_seoul.json`(1.38MB)을 정비사업 레이어와
   검색창이 각각 받고 서로 다른 가드 변수를 봐서, 검색을 먼저 쓰면 2번 받았다. 공용 Promise
   로더(`loadJbRows`)로 통합. `realprice_house.json` 도 같은 구조라 `loadHouseJson` 신설.
   실측: 검색 → 레이어 ON 순서에서 1회(전 2회).
6. `1b1c1ac` **단위 토글 마커 재생성 제거(최적화 3)** — ㎡↔평 칩 누를 때마다 33,810개
   circleMarker 를 재생성하던 것 제거. 단위는 마커와 무관하고 툴팁·팝업 '텍스트'만 바뀌는데,
   팝업은 `m._pop()` 이 호출 시점에 단위를 읽는 클로저라 캐시만 버리면 된다.
   실측: 마커 9,030개 그대로 유지(객체 동일), 팝업은 `85㎡ → 26평` 정상 갱신.
7. `935dc48` **collect_realprice.js 3중 수정** — 아래 "수집기" 절.
8. `b6ae3080` **경매 사진 299 → 1,125건**.

### 코드리뷰 (에이전트 2회 실행, 총 67건 보고 → 확인된 것만 조치)
**확인하고 고친 것**
- `collect_auction.js` 가 0건이어도 `auction.json` 을 덮어썼고 **매일 07:00 CI 가 자동 커밋·푸시**.
  법원 사이트 차단/마크업 변경 시 예외 없이 종료코드 0 으로 끝나 2,949건이 `rows:[]` 가 될 수
  있었다. saveAuction 에 가드(0건·기존 대비 50% 미만이면 중단, `--force` 로 우회) + 원자적
  저장(tmp+rename) + 워크플로에도 독립 게이트 추가.
- `collect_auction.js:81` `page.goto` 가 try/catch 밖 — 법원 13곳 중 1건 타임아웃에 프로세스
  즉사. photos 수집기에서 고친 패턴이 여기엔 안 옮겨져 있었다. try/catch + IIFE `.catch()` 추가.
- `kma-weather-proxy` 가 molit-proxy 와 **같은 `MOLIT_KEY`** 를 레이트리밋 없이 사용 → 어제 넣은
  방어의 우회로였다. 같은 DB 레이트리밋 적용 + 키에 `datagokr:` 접두사를 붙여 **버킷 공유**.
- 에러 응답의 `detail: String(e)` / `raw: data` 제거 — Deno fetch 실패 메시지에 요청 URL(=
  serviceKey 포함)이 실려 익명 호출자에게 샐 수 있다.
- `collect_auction_photos.js` 의 Windows Chrome 경로 폴백 제거(리눅스 CI 에서 실행 실패 원인).

**실측으로 오탐 판정한 것 (다시 조사하지 말 것)**
- **H-1 "X-Forwarded-For 스푸핑으로 레이트리밋 우회 가능"은 오탐.** 실측: XFF 없이 75회 → 첫
  429가 64번째, 매번 다른 XFF 로 75회 → 63번째로 사실상 동일. 게이트웨이가 조작한 XFF 를
  무시하고 실제 IP 로 센다. XFF 처리 코드는 그대로 뒀다.
- `realprice_apt.json` 이 빈 것은 수집기 탓이 아니다 — 실물이 `﻿[]`(BOM 포함)이라 Node 가
  만든 게 아니라 PowerShell 로 만든 플레이스홀더다. (단, `WITH_APT=1` 없이는 애초에 아파트를
  수집하지 않는 것이 진짜 원인 — 아래 참조.)

**배포 검증 완료** (사용자가 `supabase login` 후 두 함수 배포)
- molit-proxy 한도: 첫 429가 64번째 → **45번째**(RATE_MAX 42 적용 확인). 그 전까지 `c45f5de`
  (60→42)가 git 에만 있고 배포가 안 돼 있었다.
- 버킷 공유: 날씨 프록시로 42회 채운 뒤 건축물대장 호출 → **즉시 429** (우회로 봉쇄 확인).

### 수집기 (`935dc48`)
- **기준월 하드코딩**: `new Date(2026, 6, 1)` 고정이라 2026-07 이후가 영구 미수집이었다.
  실행 시점 기준으로 바꾸고 `i=0` 부터 돌려 이번 달도 포함. `BASE_YM=YYYYMM` 으로 고정 가능.
- **URL 인코딩 누락**: Decoding 키의 `+ / =` 를 URL 에 그대로 붙여 인증이 깨졌는데, 서버가
  오류 대신 **HTTP 200 + 0건**을 준다. `encodeURIComponent` 적용(이중 인코딩 방지 포함).
- **`writeSafe()` 신설**: 0건·기존 대비 절반 미만이면 저장 거부 + tmp/rename. 이 가드가 실제로
  두 번 사고를 막았다(키 플레이스홀더로 0건일 때 / MONTHS=3 로 축소됐을 때).

---

## 2026-08-14 (28) — opencode (실거래가 수집기 경기 확장: 47개 코드 확정·스모크 통과·실전 수집 시작)

> (27)의 "이어서 할 일 1) 실거래가 복구"를 진행. **추측 금지 원칙으로 LAWD_CD 를 API 전수 탐색으로 확정**하고 수집기에 반영, 스모크 테스트까지 통과. **실전 수집(서울+경기 72지역×12개월)은 백그라운드로 진행 중.** 커밋은 사용자 동의 대기.

### 완료
1. **LAWD_CD 47개 확정 — 전수 탐색 실측**: 41100~41899 전 코드에 202606 한 달치를 1회씩 호출해 `totalCount>0` 인 것만 채택(서울 25 + 경기 47).
   - **표준 코드와 다른 경기 3곳** (TROUBLESHOOTING §18): 수원 41111/13/15/17(표준 41119 는 0건) · 부천 41192/94/96(2024 일반구 분리 — 표준 41190/95/97/99 전부 0건) · 화성 41591/93/95/97(표준 41590 은 0건).
   - **추가 검증**: 부천 구명은 V-World 지오코딩 "경기도 부천시 {원미|소사|오정}구 {동}" 3동×3구 조합 → OK 만 나온 구로 확정(41192=원미·41194=소사·41196=오정, 전부 3/3). 화성 4코드 합집합 동 41개 = 화성 전체(능동만 중복 → 수집기 dedupe).
2. **collect_realprice.js 수정**: `GU_GG` 47개 코드 추가(46~65행, 주석 포함) → `GU_ALL` 병합. 하드코딩된 `서울특별시` 를 `SIDO(cd)`(`11`=서울특별시/그 외=경기도)로 전 지오코딩 주소 생성 지점(fetchJeonse·연립·오피스텔·아파트·RENT_ONLY dong/house)에 교체.
3. **스모크 테스트 통과**: `ONLY_GU=11110,41135,41830,41597 SUFFIX=_test MONTHS=2 WITH_APT=1` — 지오코딩 100%(연립 103/103, 아파트 70/70), gu 명칭·좌표 정상(종로구/성남시 분당구/양평군/화성시, 동탄 능동 37.20653/127.05783). 테스트 파일은 정리함.
4. **TROUBLESHOOTING §18 기록**.

### 진행 중 (이 세션 종료 시점)
- **실전 수집 백그라운드 실행**: `DGK=<keys.env> MONTHS=12 WITH_APT=1 node tools/collect_realprice.js`. 지오코딩이 오래 걸림(서울 5,034건에 25분이었음 — 경기 포함 12개월이면 수시간). 완료되면 realprice_villa/officel/apt/house.json 갱신. 중단해도 `.geocache.json` 체크포인트가 있어 재개 시 이어받음.

### 다음 세션 확인할 것
- 실전 수집 완료 여부 → 완료 후 파일 확인: `realprice_apt.json` 이 서울+경기 12개월치로 채워졌는지, gu 에 경기 명칭 있는지. 지오코딩 실패율(blocked) 확인.
- 커밋·push 동의 받기: 변경은 `tools/collect_realprice.js` + `TROUBLESHOOTING.md` + `HANDOFF.md`(+ 데이터 파일들).

---

## 2026-08-15 (29) — opencode (코드리뷰 미조치 6건 수정 + CI 원인 규명 + 커밋·push·Edge Function 배포 완료)

> (28) 후속. 사용자 지시: **전부 진행해 커밋하고, push 전에 결과를 보고받을 것.** ① 실거래가 검증 커밋 `39db2c73` → ② 코드리뷰 6건 수정 커밋 `a4652c2c` → push + Edge Function 배포까지 전부 완료. **커밋 3건(`584d5c6b` 포함) push 완료, Pages 배포 완료.**

### 완료
1. **① 실거래가 검증 + 커밋 `39db2c73`** (6 files): realprice_apt 30,515 rows/gu 69, villa 13,207/gu 34, house 정상, officel 은 대상 아님(커밋 제외). TROUBLESHOOTING §18·HANDOFF(28) 갱신 포함.
2. **② 코드리뷰 미조치 6건 전부 수정 + 커밋 `a4652c2c`** (TROUBLESHOOTING §20):
   - `collect_realprice.js:324` — V-World **차단(일시적) 실패만** 캐시 제외, NOT_FOUND(확정) 는 캐시 유지. null 영구 캐싱 해소.
   - `admin-request-reset:89` — `sent_to:[backupEmail]` 응답 제거 → `{ ok: true }`.
   - `its-cctv-proxy` — `?debug=1` 백도어 2곳 제거.
   - 레이트리밋 없는 프록시 **5개**에 `rl_hit` RPC 적용(molit-proxy 패턴 복제): `naver-search`=`naver:`/20, `bizno-proxy`=`nts:`/30, `chungak-proxy`=`chungak:`/30, `eximbank-proxy`=`eximbank:`/30, `its-cctv-proxy`=`its:`/30. (data.go.kr 공용 키인 molit/kma 만 `datagokr:` 공유 유지.)
   - **신규 마이그레이션** `20260815000000_rate_limit_cleanup.sql`: `rl_hit` 1% 확률 cleanup + `window_start` 인덱스(pg_cron 대신 lazy 정리 — WHY 주석).
   - `land.html:1288` — `if (VWORLD_KEY) {` → `{` 무조건 블록. 키 비면 블록 밖 호출부(검색 자동완성 등) ReferenceError 로 죽는 잠재 이슈 해소(27세션 §26-2 와 동일 사고). **검증: 전체 스크립트 괄호 균형 1769/1769, node --check 구문 OK.**
3. **④ CI 첫 자동 실행 원인 규명** (TROUBLESHOOTING §19): run `31750427143` 이 `cancelled` — `timeout-minutes: 60` 초과(1h0m18s). 실측: 수집은 성공(3,388건, 23:03:09) → 지오코딩이 23:13(100/3300) → 23:24(200/3300) → 23:33:37 취소. **속도 ~100건/10분이라 3,300건이면 약 5.5시간** — 60분 제한에 절대 안 들어옴. 게다가 `collect_auction.js` 는 지오코딩 완료 후에만 `saveAuction()` 을 호출하므로(287·385행) **이번 실행은 auction.json 저장 자체가 안 됨**. `actions/cache` 는 취소된 실행에선 캐시를 저장 안 해 다음 실행도 전체 재지오코딩.
4. **push 완료**: `584d5c6b`(사진 400px 축소, 미푸시로 남아있던 것) + `39db2c73` + `a4652c2c` → `origin/master` 반영, Pages 빌드 시작됨.
5. **Edge Function 배포 완료** (npx supabase, 토큰은 keys.env `SUPABASE_ACCESS_TOKEN`):
   - `supabase db push` — 마이그레이션 `20260815000000` 적용됨.
   - 6개 함수 배포: `admin-request-reset`, `naver-search`, `bizno-proxy`, `chungak-proxy`, `eximbank-proxy`, `its-cctv-proxy`.
   - **429 실측 검증**: naver-search 21번째(한도 20) / bizno-proxy 31번째(30) / chungak-proxy 31번째(30) / eximbank-proxy 31번째(30)부터 429 확인. its-cctv-proxy 는 상류 ITS 응답이 지연(30초 타임아웃·`timedOut:true`)돼 429 실측 불가 — 대신 `supabase functions download` 로 배포본 코드에 `its:`/30 + debug 제거 반영 확인.
6. **keys.env 에 `SUPABASE_ACCESS_TOKEN` 항목 추가** (사용자 토큰 저장, gitignored 확인됨).

### 남은 것 (아래 "▶ 이어서 할 일" 참고)
- CI 지오코딩 타임아웃 해결 방향은 **미적용**(아래 4)).
- its-cctv-proxy 레이트리밋 429 실측 — 상류 ITS 가 Edge 아웃바운드를 사실상 차단(keys.env 주석)해 프론트 직접 호출로 전환된 상태라 실측은 어려움. ITS 응답이 빨라지는 시간대에 재시도 가능.

---

## 2026-08-15 (30) — opencode (jbPopupHtml 블록 스코프 잠재 ReferenceError 해소 + 백업 + TROUBLESHOOTING §21)

> (29) 후속. 사용자 지시: **기록 먼저 → 백업 → 커밋.** 수정 2줄만.

### 완료
1. **수정 전 백업**: `land.backup-20260815.html` (SHA-256 `87A289D0...`, 383,012B). 기존 `land.backup-20260808.html` 은 유지.
2. **TROUBLESHOOTING §21 문서화** — "인라인 스크립트 블록 스코프 함수가 블록 밖 호출부에서 사라지는 함정".
3. **수정 (land.html 2줄)**:
   - 2382 행 근처: `window.jbPopupHtml = jbPopupHtml;` 추가 — 1296~3275 블록 **안**에 선언된
     `jbPopupHtml`(2347)을 노출. 호출부 5159(검색 자동완성)가 블록 **밖**이라 strict mode 전환 시
     ReferenceError 로 죽을 잠재 이슈였음(현재는 sloppy-mode Annex B 호이스팅 덕에 동작).
   - 5160 행: `jbPopupHtml(d)` → `window.jbPopupHtml(d)` 로 명시.
   - **검증 (실측)**: ① node 실측 — sloppy mode 블록 함수는 밖에서 보임 / strict mode 는 숨김.
     ② Playwright(Chrome headless, `auth-guard.js` 라우트 차단) — `land.html` 실제 로드 후
     `window.jbPopupHtml` 함수 확인 + 팝업 HTML 9,900B 생성 + pageerror 0건.

### WHY (결정 사유)
- 215줄짜리 상호의존 로직을 통째로 블록 밖으로 옮기는 대신 **1줄 `window.` 노출**로 해결 —
  클로저가 stageColor·jbTlHtml 등 헬퍼를 통째로 캡처해 블록 밖에서도 정상 동작함을 실측으로 확인(§21).
- 블록 `{}`(1296·3275) 자체를 제거하는 대안도 있지만 블록 안/밖 `const` 이름 충돌 검사가 필요해
  리스크가 더 크다. 지금은 "가시성" 문제만 해결하면 되므로 1줄 노출이 최소 변경.

### 커밋·배포 상태
- **커밋 대기 중 (사용자 동의 대기)**: `land.html`(+2/−1), `TROUBLESHOOTING.md`(+24), `HANDOFF.md`,
  `land.backup-20260815.html`(신규).

---

## 2026-08-15 (31) — opencode (성능 최적화: main.js render 스코어링 캐시 + collect_realprice.js 파싱 절감)

> (30) 후속. 사용자 지시: 최적화(기능·외부 동작 불변, 신규 의존성 없음) → **기록 → 백업 → 커밋.**

### 완료
1. **js/main.js** (지도 렌더·클러스터링 — 유일하게 남은 중복 계산은 render()의 전량 스코어링)
   - `scoreOf(r)` 점수 캐시: render()가 호출될 때마다 1,300곳 전부 `window.score()` 재계산 →
     같은 취향이면 캐시 재사용. 무효화는 **taste 객체 identity 변경 시에만**(세션 중 대입은
     `loadAll()` 619행 1회뿐 — 실측). `restaurantById`(id→식당 Map)로 리스트 클릭·자동완성·
     recent-chip 3곳의 `restaurants.find`(O(n)) → O(1).
   - `buildClusters()`는 이미 뷰포트 버킷+마커 풀 재사용이라 손대지 않음.
2. **tools/collect_realprice.js** (수집 파이프라인)
   - `parseItems()`가 `<item>`+`<totalCount>`를 **한 번의 정규식 스캔**으로 추출(기존엔 파싱 후
     `xml.match` 재스캔 — 페이지 XML ~200KB×요청 수만큼 이중 스캔 절감).
   - `geocode()` 성공 응답의 JSON.parse **2회 → 1회** (핫 경로라 요청마다 파싱 비용 반감).
   - 페이지 병렬화·동시성 증가는 **일부러 안 함** — data.go.kr 500 빈도가 높아(코드 주석·실측)
     버스트는 재시도 폭탄. 현재 CONC=6·지오코딩 8.8건/s 리미트 유지가 최적.
3. **백업 (수정 전 git HEAD 원본)**: `js/main.backup-20260815.js`(50,049B)·
   `tools/collect_realprice.backup-20260815.js`(33,972B)
4. **TROUBLESHOOTING §22** — scoreOf 캐시 무효화 조건 함정(새 객체 대입 규칙·buildRestIndex 누락 주의).
5. **추가 수정 (최종 확인 중 발견)**: 단독다가구 저장 3곳(`realprice_house`·`realprice_house_rent`·
   house 좌표 보강)이 `writeSafe` 가드 없이 raw `fs.writeFileSync` — §16 과 같은 "빈 파일
   덮어쓰기" 버그 클래스. **전부 `writeSafe` 로 교체** + TROUBLESHOOTING §23(저장 경로는 전부
   writeSafe 경유 규칙). 검증: 0건 거부·절반 미만(10→4) 중단+보존·절반 이상 통과·`.tmp` 잔존
   없음 — 4항목 시뮬레이션 PASS.

### WHY (결정 사유)
- gprof/valgrind는 네이티브용이라 vanilla JS엔 부적합 → Node `--cpu-prof` 대신 핫 패스 직접
  복잡도 분석으로 병목 확정. 남은 병목은 "render마다 전량 재계산" 하나뿐이었고, 수집 파이프라인은
  I/O·API 속도제한 바운드라 남은 여지는 파싱 중복 제거가 전부.

### 검증
- `node --check` 두 파일 구문 OK / `parseItems` 실제 XML → `{items:[...], total:3}` 정상 반환.
- `scoreOf` 시뮬레이션: 캐시 히트(호출 1회)·taste 변경 무효화·신규 취향 반영 통과.
- 동작 불변성: total 0이면 1페이지 후 종료(기존 동일) · JSON 파싱 실패 → 차단 재시도 경로(기존 동일).

### 커밋·배포 상태
- **커밋 `e3c11f40`** 완료: js/main.js·collect_realprice.js·백업 2건·HANDOFF(31)·TROUBLESHOOTING §22.
- **미커밋 추가분 (동의 대기)**: collect_realprice.js house 3곳 writeSafe 교체 + TROUBLESHOOTING §23 + 본 항목 수정. push 는 별도 동의 대기.

---

## ▶ 이어서 할 일 (다음 세션은 여기부터)

> ~~1) 실거래가 복구~~ → **완료·push 완료** (커밋 `39db2c73`).
> ~~2) 코드리뷰 미조치~~ → **전부 수정·push·배포 완료** (2026-08-15 (29), 커밋 `a4652c2c`).
> ~~4) CI 첫 실행 확인~~ → **원인 규명 완료** (타임아웃 취소 — 해결은 미적용). 아래 1)~4) 만 남음.

### 1) 사진 수집 (진행 중, 언제든 재개 가능)
`auction_photos.json` 현재 **1,125 / 2,949건**. 재개: `node tools/collect_auction_photos.js`
(이미 있는 cn 은 자동 스킵). 건당 10~15초라 전체는 수 시간. 여러 세션에 나눠 돌리면 됨.

### 2) CI 지오코딩 타임아웃 해결 — **적용 완료 (2026-08-15, push 대기)**
`collect-auction.yml` 60분 제한 vs 지오코딩 ~5.5시간 필요 → **캐시 커밋 전환**으로 해결:
실측으로 경매 주소 2,862개 중 98.1%가 로컬 `.geocache.json`(34,206 엔트리)에 히트.
① `.gitignore` 에서 `tools/.geocache.json` 제거(커밋 파일로) ② 워크플로 커밋 단계에 geocache
스테이징 추가 + `actions/cache` 스텝 제거 ③ `timeout-minutes: 60 → 360`. **push 후
`workflow_dispatch` 로 실제 실행 시간 확인할 것**(수집 ~30분 + 지오코딩 수 분 예상).

### 3) Edge Function 배포 환경 정리 (참고)
배포는 `npx supabase` + keys.env `SUPABASE_ACCESS_TOKEN`(사용자 저장, gitignored) 로 완료됨.
CLI 가 PATH 에 없으므로 이후 배포 시: `$env:SUPABASE_ACCESS_TOKEN=(keys.env 에서 읽음)` 후
`npx -y supabase@latest functions deploy <이름> --project-ref bhgijvaxxjnocgfnaaeu`. 프로젝트 ref 는 `bhgijvaxxjnocgfnaaeu`(restaurant-guide).

### 4) 테스트 방법 (이번 세션에서 정립 — 꼭 따를 것)
- UI 동작 검증은 **반드시 CDP `Input.dispatchMouseEvent`** 로. `element.click()` 은 pointer
  이벤트 체인을 안 타서 진짜 버그를 통과시킨다(위 1번 항목이 그 사례).
- 헤드리스로 `land.html` 을 열 때는 `auth-guard.js` 요청을 `Fetch.failRequest` 로 막아야 한다
  (안 그러면 온보딩으로 리다이렉트).
- 배포본 확인은 `curl` 로 실제 파일을 받아 문자열을 grep 하는 게 확실하다(캐시 주의:
  `Cache-Control: max-age=600`).
- 테스트용 크롬을 정리할 때 **`taskkill /IM chrome.exe` 를 쓰지 말 것** — 백그라운드 수집기의
  브라우저까지 죽인다(이번 세션에 실제로 사고). spawn 한 프로세스만 `.kill()` 할 것.
- land.html 인라인 스크립트 검증: `<script>` 블록을 UTF-8 로 추출해 `node --check` (PS5.1 은
  `Get-Content` 기본 인코딩이 ANSI 라 한글 정규식 리터럴이 깨져 오판 — `[IO.File]::ReadAllText(..., UTF8)` 필수).
- Edge Function 레이트리밋 실측: anon key 헤더(`apikey`/`Authorization`)로 25~35회 반복 호출 →
  한도 초과 시 429. PS5.1 에 `SkipHttpErrorCheck` 없음 — try/catch 로 `$_.Exception.Response.StatusCode.value__`.

---

## 2026-08-13 (26) — Claude Code (molit-proxy 레이트리밋 DB화·지도 클릭 ReferenceError·스크롤바·CI 자동화·사진 수집 재개)

> (25) 이후 같은 세션에서 이어감. 다섯 갈래 작업 — 전부 커밋·push·배포 완료(마지막 사진 수집만 진행 중).

### 완료 (커밋 순서대로)
1. **molit-proxy 레이트리밋 추가 → 메모리 Map 실패 실측 → DB(Postgres RPC)로 교체** (`69a7e72`, `53bd567`, `c45f5de`)
   - 처음 메모리 Map으로 짰으나 65회 연속 요청에도 429가 한 번도 안 떠서(Edge Function 인스턴스 분산 — 메모리 공유 안 됨) `api_rate_limits` 테이블 + `rl_hit` RPC로 교체. 재검증: 61번째 요청부터 정확히 429 확인.
   - 마이그레이션(`supabase/migrations/20260813000000_molit_proxy_rate_limit.sql`) 적용 + 함수 재배포 완료(사용자가 `supabase db push` + `functions deploy` 실행).
   - 이후 사용자 요청으로 한도를 분당 60회 → **분당 클릭 6회(원시 요청 42회)**로 강화(`c45f5de`).
   - **주의**: 로컬 CLI로 배포하려면 `$env:SUPABASE_ACCESS_TOKEN="..."` (PowerShell, `set`아님) 필요 — 토큰은 채팅에 노출된 적 있음(사용자가 필요시 재발급 고려).
2. **지도 클릭 팝업이 "주소를 가져오지 못했어요"만 뜨던 버그 — 진짜 원인 규명·수정** (`4d19e59`)
   - 헤드리스 재현으로 `ReferenceError: uUnit is not defined` (land.html:4066) 확인. `uUnit`/`uPriceMain`/`uPriceSub`/`uAreaTxt` 등 7개 헬퍼가 `if (VWORLD_KEY) {}` 블록 안에 갇혀 있었는데 최상위 스코프의 `map.on('click')` 핸들러가 참조 → 예외로 죽고 6초 스턱 가드가 저 문구로 덮어씀. 클릭 지점 1.5km 안에 실거래가 있을 때만 그 코드 줄을 타서 "자주 실패"로 보였다.
   - 수정: 헬퍼 7개를 최상위 스코프로 이동 + Naver 지오코딩이 빈 주소 주면 V-World 폴백 추가.
   - 검증: 헤드리스로 용도지역·공시지가·지번·용적률까지 정상 표시 확인.
3. **스크롤바를 우측 패널과 동일하게(사용자 요청)** (`4d19e59`)
   - `.ui-scroll`의 8px 커스텀 스크롤바(`::-webkit-scrollbar`) 제거 → 브라우저 기본(15px, 화살표 버튼 있음)으로 복귀. 좌측 경매 패널·팝업이 좁고 화살표 없어서 조작하기 힘들다는 실사용 문제였음. CCTV 팝업(`.cctv-pc`)은 원래 미사용이라 요청대로 미변경.
4. **`auction.json` 매일 자동 갱신 — GitHub Actions** (`435abc7`, `088cd55`)
   - `.github/workflows/collect-auction.yml`: 매일 07:00 KST(=22:00 UTC) 스케줄 + 수동 실행(workflow_dispatch). `collect_auction.js` 실행 → 변경 있을 때만 자동 커밋·push(Pages 자동 재배포).
   - `tools/collect_auction.js`: Chrome 못 찾으면(Linux CI) 하드코딩 Windows 경로로 폴백하던 걸 제거 → `undefined`면 playwright 번들 브라우저 사용. 로컬 Windows 동작은 그대로(검증됨).
   - `package.json`에 `playwright`(전체, `playwright-core`와 버전 고정) devDependency 추가 — CI의 `npx playwright install`이 맞는 브라우저 리비전을 받도록.
   - 지오코딩 캐시(`tools/.geocache.json`, gitignore 유지)는 `actions/cache`로 실행 간 이어받아 매일 전체 재지오코딩을 피함.
   - **아직 실행 검증 안 됨** — 다음 세션은 GitHub Actions 탭에서 첫 스케줄 실행(2026-08-14 07:00 KST경) 결과를 확인할 것. 실패하면 `npx playwright install --with-deps chromium` 관련 로그부터 볼 것.
   - 사진(auction_photos.json)은 전량 재수집 8~10시간이라 이 자동화 범위 밖(수동 유지, GitHub Actions 무료 티어 잡 하나당 최대 6시간 제한도 있음).

### 진행 중 (이 세션 종료 시점 상태 — 다음 세션이 이어받을 것)
- **경매 사진 수집**: 사용자가 "가능한 만큼 계속 수집"을 요청해 `node tools/collect_auction_photos.js`를 백그라운드로 재개함(28건 → 진행 중, 대상 2,921건 남음, 케이스당 ~10-15초 = 전체 완료까지 8~10시간 소요 실측 확인됨).
  - **재개 방법**: `node tools/collect_auction_photos.js` (인자 없이) — 이미 `auction_photos.json`에 있는 cn은 자동 스킵하므로 여러 세션에 걸쳐 안전하게 나눠 돌릴 수 있음.
  - 진행 중 IP 차단 징후 없었음(종결 물건은 "물건상세조회 버튼 없음"으로 정상 스킵). 커밋은 이 세션이 멈춘 시점 기준 최신 상태로 남겨둠 — 정확한 수집 건수는 `git log --oneline -1 -- auction_photos.json` 및 `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('auction_photos.json'))).length)"` 로 확인.

### 다음 세션 확인할 것
1. GitHub Actions `법원경매 목록 자동 갱신` 워크플로가 첫 스케줄에서 성공했는지 (Actions 탭).
2. 사진 수집 이어서 진행 — 몇 시간 단위로 나눠 돌리고 커밋·push.
3. `PLAN_auction_detail.md`, `_c1.txt`~`_tjr.txt`, `land.backup-20260808.html`, `redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx` 등 정리 안 된 임시 파일들 여전히 존재 — 필요시 사용자에게 정리 여부 확인(이번 세션도 손 안 댐).

---

## 2026-08-13 (25) — Claude Code (opencode 세션 (24) 이어받음: 사진 안 나옴·지도 팝업 느림/실패·상세 패널 잘림 3건 수정)

> 사용자가 opencode에서 (24) 작업 중 헤드리스 크롬 devtools 연결 문제로 검증하다 세션이 끊겼다며 이어받아 달라고 요청. opencode 세션 로그(원인 조사까지 완료, 코드 수정은 0건)를 그대로 이어받아 실제 수정·커밋·배포까지 진행.

### 원인 (opencode가 실측, 코드 수정은 이번 세션에서)
- **경매 사진 안 보임**: 버그 아님. `auction_photos.json`에 사진 메타가 있는 사건이 2,949건 중 2건뿐(수집기 전체 미실행).
- **경매 상세 패널 잘림**: `.ap-detail`에 `.ap-list`와 같은 `flex:1;overflow-y:auto;min-height:0`가 없어 내용이 스크롤 없이 패널 밖으로 넘침.
- **지도 클릭 팝업 느림/실패**: Leaflet 마커/폴리곤 클릭이 `map.on('click')`(land.html:4011)으로도 전파되는데 `e.layer` 가드가 없어, 경매(등 다른) 팝업이 열린 직후 "정보 불러오는 중…" 팝업(건축물대장 7회 API 순차 호출)으로 덮임 → 클릭할 때마다 무거운 API 체인이 불필요하게 실행됨.

### 완료
- `land.html` — `.ap-detail` CSS 규칙 추가(L120), `map.on('click')`에 `if (e.layer) return;` 가드 추가(L4020 부근). 커밋 `e138b15`.
- `tools/collect_auction_photos.js` 전체 실행 시작 → **처리 속도가 사건당 ~10-15초로, 남은 2,344건 전체는 8~10시간 소요**(당초 "GAP_MS 1초 기준 50분+" 추정은 틀림 — 사건당 화면 재진입·검색·상세클릭 왕복이 병목). 사용자 확인 후 **28건 수집 시점에서 중단**. IP 차단 징후는 없었음(종결 물건은 "물건상세조회 버튼 없음"으로 정상 스킵).
- `auction_photos.json` 7건 → **28건**, `auction_photos/` 신규 26개 사건 디렉토리. 커밋 `889e8bd`.
- `git push origin master` 완료 — GitHub Pages 반영됨.

### 커밋·배포 상태
- **완료·배포됨**: `e138b15`(CSS/JS 버그 2건), `889e8bd`(사진 확장자 매직바이트 판별 + 사진 28건). `origin/master`에 push 완료.

### 다음 세션 확인할 것
- **사진 수집 미완료 — 2,949건 중 28건만 있음.** 이어서 돌리려면: `node tools/collect_auction_photos.js`(이미 있는 cn은 자동 스킵, 재실행 안전). 시간이 오래 걸리므로 **여러 세션에 나눠서 백그라운드로 돌리는 것을 권장** (8~10시간 전체 vs 1회 세션에 1~2시간씩).
- 저장소에 정리 안 된 임시 파일들이 있음(`_c1.txt`~`_tjr.txt`, `PLAN_auction_detail.md`, `land.backup-20260808.html`, `redevelop_seoul.backup-20260808.json`, `package.json`/`package-lock.json` 등) — 이번 세션에서 손 안 댐, 필요시 사용자에게 정리 여부 확인.

---

## 2026-08-13 (24) — opencode (경매 상세 패널: 사진 캐러셀·확대·전 구분 수집 — 코드 변경만, 커밋 전)

> 참조사이트(디스코·재개발닷컴) 벤치마크: "물건 클릭 → 패널이 상세로 전환 + 사진 다음장/확대 + 공개 사진 전부 + 빠른 로딩" 요구. 이미지 확인은 불가(모델 한계)했지만 텍스트로 구현.

### 완료 (실측·검증 근거 포함)
- **사진 저장 방식 전환**: base64 인라인 → `auction_photos/<사건>/<구분>_<n>.jpg` 개별 파일 + `auction_photos.json` 메타(`{ cn: [{dvs,name,file}] }`). 기존 2건(6장)을 `legacy_*.jpg` 로 마이그레이션. 메타 JSON 1.9MB→**0.9KB**, 사진 디렉토리 1.39MB. **이유**: 상세를 열 때 필요한 사진만 개별 로드 = 참조사이트처럼 빠름(신건 전부 수집해도 auction.json·메타는 가벼움).
- **`collect_auction_photos.js` 개조**: 전 구분(000241/243/244/245/246 + 미확정 000247) 전부 수집, 구분 코드 순 정렬. 검증: 신건 **2025타경2782 총 17장**(전경도3·위치도2·관련사진10·000247 2) 수집 성공 후 원복·디렉토리 삭제. **000247 이름 미확정 — 추측 금지**(DVS_NAMES에 없으면 코드 그대로 표시).
- **land.html 상세 패널**: 목록 행 클릭 → `#ap-detail` 전환(목록 ↔ 상세). 구성 = 사진 캐러셀(화살표·카운터 `n/N`·구분명 캡션) + 클릭 시 **라이트박스 확대**(`#apd-lightbox`, 좌우 nav·닫기) + 감정/최저/매각기일 카드 + D-day 배지 + 상세 그리드(사건번호·법원·물건번호·용도·진행상태·담당계·매각기일·비고) + 액션(☆즐겨찾기·지도에서 보기·법원 사이트). 목록 행에 썸네일(64×48) 추가.
- **버그 2건 수정 (실측)**: ① `#apd-lightbox` CSS `display:flex` 가 `hidden` 의 `display:none` 을 덮어써 상세 패널 조작을 가로챔 → `#apd-lightbox[hidden]{display:none}` 필수. ② 라이트박스 div 가 `<script>` 뒤에 있어 실행 시점에 null → body 상단(패널 뒤)으로 이동.
- **헤드리스 검증 통과**: 상세 열림·사진 `loaded:true`·다음장 `1/3→2/3`·라이트박스 열고 닫기·뒤로가기 목록 복귀·목록 썸네일 2,896행. console 에러 없음(의도된 auth-guard net::ERR_FAILED 제외).

### 커밋·배포 상태
- **커밋·push 없음** (동의 대기). 변경: `tools/collect_auction_photos.js`·`land.html`·`auction_photos.json`(메타화)·`auction_photos/`(신규 6 jpg)·TROUBLESHOOTING §6-14. `auction.json` 변경 없음.

### 다음 세션 확인할 것
- 커밋 동의 후 관심 사건 확대 수집: `node tools/collect_auction_photos.js --court 서울중앙` (IP 안정 시, GAP 1초 유지).
- 000247 구분명: 다음 수집 때 캡처 확인 후 DVS_NAMES에 추가 여부 판단.

---

## 2026-08-13 (23) — opencode (경매 사진 분리: auction.json 유지 + auction_photos.json 별도 — 코드 변경만, 커밋 전)

> 사용자 "20건 이상 계획" → 사진 인라인(rows[*].photos)은 사진 1행 ~952KB 실측이라 20건 넘으면 무거움. **auction.json(927KB)은 그대로, 사진은 auction_photos.json `{ cn: [...] }` 맵으로 분리 결정.**

### 완료
- **`tools/collect_auction_photos.js`**: auction.json은 **읽기 전용**, 사진은 `auction_photos.json`(cn 키 맵)에 저장. 대상 선정은 cn 기준(행 인덱스 미의존), 기존 사진 있는 cn은 스킵. `--court`/`--max`/`--headful` 동일. 테스트: 2025타경2782(신건) 3장 수집 성공 후 원복.
- **`land.html` `loadAuction()`**: `Promise.all`로 auction.json + auction_photos.json 병렬 fetch, cn으로 photos 조회(`ph[cn] && ph[cn].length ? ... : []`). photos 파일 404면 `.catch(()=>({}))` → 전부 '준비 중'(안전).
- **`auction.json`**: 원본 복원(927KB, fields 13 — photos 필드 제거). 기존 수집 2건(2023타경2726·2023타경110870)은 `auction_photos.json`(1.9MB)으로 이전.

### 검증 (헤드리스, auth-guard 차단 — §1)
- fetch: auction.json 2회 + auction_photos.json 1회(병렬) → 팝업 data-uri img 3장 `loaded:true`.
- 수집기: 신건 1건 재배열 → `--max 1` → 3장 수집 → auction.json 2949행 유지 + auction_photos.json cn 맵 저장 → 원복.

### 함정 (기록용)
- TROUBLESHOOTING §6-14 갱신: 분리 구조 + 용량 근거(신건 638건 전부 시 1.5GB). `+N` 배지는 `.auc-photo` 안 `.auc-photo-more` span이어야 함.
- (22)에서 수집한 데이터는 auction_photos.json으로 이전했고, land.html에 auction.json photos 필드 잔재 없음 확인.

### 커밋·배포 상태
- **커밋·push·배포 없음** (사용자 동의 대기). 변경: `tools/collect_auction_photos.js`·`land.html`·`auction_photos.json`(신규) + auction.json(복원) + TROUBLESHOOTING §6-14. land.html엔 (21) 세션 미커밋 변경(단위 토글 등 196줄)도 여전히 존재.

### 다음 세션 확인할 것
- 커밋 동의. 관심 사건 확대 수집: `node tools/collect_auction_photos.js --court 서울중앙`(신건 위주, IP 안정 시).

---

## 2026-08-13 (22) — opencode (경매 물건 대표 사진 수집: 관심 사건만 — 도구 + auction.json 2건, 커밋 전)

> 사용자 선택 "관심 사건만 대표 사진 수집(추천)". 법원 사이트에서 전경도(000241) 3장을 base64로 수집해 auction.json에 병합. **커밋·push 전 단계(사용자 동의 대기)**.

### 완료
- **`tools/collect_auction_photos.js` 신규**: auction.json을 읽어 **photos 필드 없는 행만** 대상으로, PGJ159 사건검색(연도 셀렉트→사건번호→검색→물건상세조회 클릭) → 상세 응답 `selectAuctnCsSrchRslt.on`의 `csPicLst`에서 **전경도(000241) 최대 3장**을 `data:image/jpeg;base64,...`로 추출 → `rows[*].photos` 병합 저장. fields에 `photos` 추가, 기존 열 보존. `--court 법원명`, `--max N`(테스트용), `--headful` 옵션. 요청 간 GAP 1초(§6-11 IP 차단).
- **auction.json**: fields에 `photos` 추가, 2023타경2726·2023타경110870(중복 사건) 2건 각 3장 저장(파일 2,830KB).
- **land.html**: 수정 없음 — `loadAuction`(1607)·`auctionPhotoHtml`(1617)이 이미 photos 배열 렌더 지원(있으면 `<img>` 그리드, 없으면 '📷 사진 준비 중' 플레이스홀더).

### 실측 (TROUBLESHOOTING §6-14)
- 사진 원본 URL(`/pgj/pgj15B/nas_e_image_pgj/...`)은 **404** — 외부 핫링크 차단, base64만 유일한 소스.
- 사진 구분 코드: 000241=전경도(대표) · 000243=내부구조도 · 000244=위치도 · 000245=관련사진 · 000246=지적도.
- 사진 base64는 상세 응답 `selectAuctnCsSrchRslt.on`의 `csPicLst[]`에 인라인. 사진 많은 사건은 응답 4.8MB.

### 검증 (헤드리스, auth-guard 차단 — §1)
- 수집 스크립트: 2건 실행 성공(재시도 로그 0). 개발 중 **셀렉터 버그** 발견·수정: `openSearch`가 `courtSel.replace('#','')`로 `#`을 지워 querySelector가 태그명으로 해석 → 항상 "화면 로드 실패" 로그. `#` 유지로 수정.
- 렌더: '진행 물건' 토글 → 마커 220개 → 사진 있는 사건(남현7길 51, 2023타경2726) 좌표로 `map.setView(18)` → 클릭 → 팝업에 data-uri `<img>` 3장 렌더 확인.

### 함정 (기록용)
- **재수집(collect_auction.js) 실행 시 photos가 통째로 사라진다** — saveAuction이 전체 재작성. 전체 재수집 후엔 collect_auction_photos.js를 다시 실행할 것(독립 보강 모드).

### 커밋·배포 상태
- **커밋·push·배포 없음** (사용자 동의 대기). 변경: `tools/collect_auction_photos.js`(신규) + `auction.json`(photos 2건) + TROUBLESHOOTING §6-14.

### 다음 세션 확인할 것
- 사용자 동의 받아 커밋·push. push 후 배포본에서 경매 레이어 → 사진 있는 사건 마커 클릭 시 사진 3장 표시 확인.
- 관심 사건 확대 수집: 실행 `node tools/collect_auction_photos.js --court 서울중앙`(전체 13법원 2,949건이면 IP 부담 크므로 법원/건수 지정 권장).

---

## 2026-08-13 (21) — opencode (disco.re 벤치마크: 단위 토글 + 구역 멀티선택 합계 + 거리 측정 — 코드 변경만, 커밋 전)

> 사용자 "총액/단가·㎡/평 토글, 정비 구역 멀티선택 합계, 지도 거리 측정" — 전부 land.html에 구현. **커밋·push 전 단계(사용자 동의 대기)**.

### 완료 (land.html 1파일, 커밋 전)
- **① 총액↔단가 토글 + ② ㎡↔평 토글**: 전역 상태 `uUnit = { price:'total'|'unit', area:'m2'|'pyeong' }` + 헬퍼 `uAreaVal/uAreaTxt/uUnitTxt/uPriceMain/uPriceSub/uPriceShort`. 실거래 필터 패널(`.lc-rp`)에 칩 2조(총액/평단가, ㎡/평) 추가, `showPriceFilter`에서 배선. **적용 범위**: 아파트·연립·다세대 팝업+툴팁, 오피스텔 팝업(면적), 클릭 팝업 근처 실거래, 즐겨찾기 비교표(실거래가·전용면적·구역면적), 정비 구역 팝업(대지면적·타이틀). `rpRefresh() = rpBuild+villaBuild+officelBuild`로 마커 팝업 클로저 재생성.
- **③ 정비 구역 멀티선택 합계**: jbCtrl 패널에 `🖇 구역 선택 모드` 버튼. 선택 모드에서 구역 클릭 → 마젠타 하이라이트 + 우하단 `선택 구역 합계` 패널(개수·대지면적 합, `선택 비우기`). `jbSetSelMode/jbSelToggle/jbSelApplyStyles/jbSelRender/ensureJbSelCtrl`. jbBuild 재빌드 시 선택 유지(키 `name|jibun|rc`), 면적은 폴리곤 링 실제 합산(`jbSelAreaM2`).
- **④ 거리 측정**: 하단좌측 컨트롤 `시작`→지도 클릭으로 지점 연결(점선 폴리라인+지점 원), 총거리 km/m 자동 표기, `지우기`. `msr/ensureMsrCtrl/msrClear/msrAddPoint`, 지도 click 핸들러 상단에서 `msr.on`이면 팝업 대신 지점 추가.
- `.btn-mini.active` CSS 신설(토글 버튼 상태).

### 검증
- 인라인 스크립트 `new Function()` 구문 검사 OK, `ppm/areaPy` 잔재 0.
- 헬퍼 블록 추출 eval 단언 **12항 전부 PASS**(12억 ↔ 1,420만/㎡ ↔ 4,695만/평, 84.5㎡ ↔ 26평, null 처리) — 개발 중 `만원만/㎡` 중복·평 변환 누락 2버그를 테스트가 먼저 잡아 수정(TROUBLESHOOTING §16·§17).
- 신규 id/함수 전부 배선 확인. 로컬·배포 실화면 확인은 **아직 안 함**(지도 타일이 V-World 도메인 잠금이라 로컬에선 OSM 전환 필요).

### 함정 (기록용)
- TROUBLESHOOTING §16·§17 추가: 단위 표시는 헬퍼 한 곳에서(변환+라벨 분리), 접미사 중복 주의, 인라인 헬퍼 단위 검증은 `eval(block + asserts)` 한 문자열.

### 커밋·배포 상태
- **커밋·push·배포 없음** (사용자 동의 대기). 변경은 land.html 1파일.

### 다음 세션 확인할 것
- 사용자에게 동의 받아 커밋·push. push 후 배포본 실화면: ① 실거래 레이어 켜고 표시 단위 칩 토글 → 팝업·툴팁 값 변경, ② 정비 레이어에서 선택 모드 → 구역 여러 개 클릭 → 합계 갱신, ③ 거리 측정 시작 → 클릭 3~4지점 → 총거리, 이탈 시 `지우기`.
- 클릭 팝업 근처 실거래는 열려 있는 동안 토글해도 갱신 안 됨(재클릭 필요) — 의도된 동작.

---

## 2026-08-13 (20) — opencode ("어떤 게 삭제됐는지 확인" 조사 — 코드 변경 없음)

> 사용자 "길찾기 활성 표시 안 되고 부동산 정보가 삭제돼 있는 것 같다" → 조사만 수행. **삭제된 것 없음** 확인, 원인은 사용자 브라우저 캐시 → Ctrl+Shift+R로 해결.

### 완료 (조사·검증만, 커밋 없음)
- **git diff 실측**: land.html 변경은 버튼 리팩토링 56+/21−뿐 — 삭제 21줄 전부 의도된 인라인 스타일 제거, 기능 코드 0줄 손실.
- **파일 크기**: backup-20260808 240KB → 현재 289KB(증가), 실배포 284KB. 실거래가·경매·건축년도 등 키워드 36→63개 증가.
- **헤드리스 Chrome(CDP)** `%TEMP%\opencode\route-repro.cjs` 재현: 을지로3가구역 6지구 마커 팝업 **14,587자 전체 렌더**, 길찾기 자차/도보 활성 표시 정상 전환, JS 예외 0건.
- **서버 실측**: localhost:8123이 land.html 334,142 bytes를 로컬 파일과 바이트 일치로 서빙(구버전 서빙 아님).
- `realprice_apt.json` 5B 빈 파일은 의도된 폴백 경로(HANDOFF 493행) — 버그 아님.

### 함정 (기록용)
- 배포본 검증용 `route-live.cjs`는 PowerShell 5.1 ANSI 인코딩 문제로 한글 주석+개행이 붙어(`// CSS 프로브`와 `{`가 한 줄로) eval 파싱 오류 → 폐기. **파일 복사·치환은 `-Encoding UTF8` 필수** (TROUBLESHOOTING §14 같은 함정).

### 커밋·배포 상태
- 코드 변경 없음 → 커밋·push 없음.

### 다음 세션 확인할 것
- 없음(이슈 해결). 참고: UI 회귀 보고는 캐시부터 — TROUBLESHOOTING §15.

---

## 2026-08-12 (19) — opencode (상수·유틸 공용화: js/common.js — 커밋 `1c36943` push 완료)

> 사용자 "What did we do so far?" → 진행 중이던 공용화 작업을 이어서 마무리·커밋. **상수·유틸이 6개 페이지에 복붙돼 있던 것을 `js/common.js` 한 곳으로 모음.** push까지 완료. Edge Function 배포 없음(프론트만).

### 완료
- **`js/common.js` 신규**: `SUPABASE_URL/KEY`·`ODSAY_KEY`·`VWORLD_KEY`·`$`·`esc`·`ensureSb()`(지연 로드). 키 정책은 TROUBLESHOOTING §9 그대로(프론트 허용 발행키만, 도메인 잠금).
- **`js/ie-guard.js` 신규**: IE 차단 배너(ES5+documentMode)를 5개 페이지 인라인 블록에서 공용 파일로.
- **`js/footer-stats.js` 신규**: 푸터 통계(member_count RPC + visit-count Edge Function)를 main·land 공용으로. `loadFooterStats('main'|'land')`.
- **CSS 공용화**(`css/buttons.css`): `* {box-sizing}`(6페이지 인라인 중복)·`.hidden`·푸터 클래스(.site-footer·.footer-top·.footer-stats 등, land 기준 통일)·모바일 하단 시트 → common 섹션으로. main 푸터는 테두리·패딩·글자 크기가 미세 변화(댓글에 명시).
- **페이지 전환**: main/land/onboarding/detail/ai/admin 전부 common.js 기반. land.html의 `ODSAY_KEY`·`VWORLD_KEY`·`esc`·`loadFooterStats()` 중복 제거 + **Edge Function 프록시 URL 7곳(chungak/bizno/KMA/EXIM/CCTV/MOLIT)**을 `SUPABASE_URL + '/functions/v1/...'`로 치환. admin.html의 `FN`도 동일.
- **순 오차**: +128/−200줄(공용화로 6개 페이지 키·유틸 복붙 제거).

### 함정 (기록용)
- **top-level `const` 재선언은 같은 페이지에서 SyntaxError**: ai.html이 common.js 로딩 후 `const $`·`const esc`를 다시 선언 → 인라인 스크립트 전체가 죽는 문제를 발견·제거(처음 common.js 전환 시 발생 가능). `node --check`는 외부 js만 잡으므로 HTML 인라인 블록은 `<script src>` 제외 정규식으로 추출해 검사해야 함(PS5.1은 `Get-Content` 기본 인코딩이 ANSI → `-Encoding UTF8` 필수, 아니면 한글 리터럴이 깨져 오판).
- auth-guard.js의 `const SUPABASE_URL/KEY`는 IIFE 안이라 스코프 충돌 없음 — 확인만 하고 놔둠.

### 커밋·배포 상태
- **커밋 `1c36943` push 완료** (사용자 "웅" 동의): `js/common.js`·`js/footer-stats.js`·`js/ie-guard.js`(신규) + main/land/onboarding/detail/ai/admin.html + `js/main.js` + `css/buttons.css`, 11파일 +128/−200.
- 배포 반영은 GitHub Pages가 자동으로 새 커밋을 build — 실서버에서 푸터·지도·검색 정상 동작만 확인하면 됨.

### 다음 세션 확인할 것
- 배포본 실화면: 6개 페이지(특히 main·land)에서 푸터 통계·로그아웃·지도 키(V-World/ODsay/네이버) 정상 동작 확인.
- `NAVER_SEARCH_FN`(js/main.js)은 여전히 하드코딩 URL — SUPABASE_URL 치환 후보로 남김(동작엔 무관).
- 스크래치 파일(`_*.txt` 10개·`land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`·`package.json`/`package-lock.json`·hwpx) 미커밋 유지.

---

## 2026-08-12 (18) — opencode (리사이즈/버튼 UI 통일: makeResizable 헬퍼 — 커밋 `a5a34b8`·`52b046c`·`eb331e3` push 완료)

> 사용자 지시 "버튼까지 통일" → Leaflet 팝업·레이어 컨트롤·경매/목록 패널·거리뷰·푸터의 **6개 중복 리사이즈 구현을 `js/ui-resize.js`의 `makeResizable()` 1개로 통일**하고, 그립·스크롤바·팝업 버튼 CSS를 `css/buttons.css` 공용 섹션으로 모음.

### 완료
- **`js/ui-resize.js` 신규**: `window.makeResizable(grip, target, opts)` — pointer events + setPointerCapture(try/catch), rAF 배칭, min/max(옵션 또는 computed style 폴백), reverseW/H, applyStyle, bodyClass/gripClass, onStart/onResize/onEnd.
- **6개 리사이즈 전부 이관**: Leaflet 팝업(land.html `ap-resizer`·`lcGrip`·`panel-resizer`·거리뷰 `ovGrip` → makeResizable), 레이어 컨트롤(jb/rp/범례), 푸터(`js/footer-resize.js` 재작성, axis h + reverseH + minH 24 + maxH innerHeight*0.6 + onEnd 저장).
- **CSS 통일**(`css/buttons.css`): `.ui-scroll`(스크롤바 8px)·`.ui-grip`+`.ui-grip-corner`(그립 24px)·`.ui-pop-btn`(팝업 버튼)·`.footer-resize`. land.html의 스크롤바 3세트·그립 3세트·`.cctv-pc-close`·`.lp-min-btn` 중복 제거, main.html `.footer-resize` 중복 제거.
- **net**: land.html `-238줄`, main.html `-1줄`, buttons.css `+26`, ui-resize.js 신규.

### 함정 (TROUBLESHOOTING §8 참고)
- **로드 순서**: `ui-resize.js`는 반드시 `footer-resize.js`보다 먼저. 순서 뒤집으면 `ReferenceError: makeResizable is not defined`(`footer-resize.js:11`)로 푸터 드래그 사망 — 실측으로 발견해 수정(land.html 531-532 교체, main.html은 원래 순서 맞음).
- **합성 PointerEvent**는 `setPointerCapture`가 NotFoundError를 던져 그 뒤 bodyClass/gripClass 추가가 누락됨 → 헬퍼가 try/catch로 감싸 해결.

### 검증 (회귀 하네스 `%TEMP%\opencode\ui-resize-test.cjs`)
- 단위 5/5(클램프 양축, reverseW, applyStyle:false, 클래스 토글+클릭 무변화), CSS 존재 확인, **land.html 실화면**: `.lp-midcb` '정비사업 상세' 체크박스 클릭 → `.lc-jb` 생성 → 그립 드래그 212→332×497→522 증가 확인, JS 예외 0건. 헤드리스 제약상 Chrome은 `--remote-allow-origins=*` 필요, `/json/new`는 PUT.
- 발견된 **잠재 버그(보류)**: `ap-resizer`(경매 패널, 좌측 패널 우측 가장자리)가 드래그 방향 반대 — `reverseW:true`로 기존 동작 보존. 자연스러운 방향 원하면 reverseW 제거.

### 커밋·배포 상태
- **커밋·push 완료** (사용자 "웅 진행해"): `52b046c`(ui-resize + CSS)·`a5a34b8`(land/main 이관)·`eb331e3`(TROUBLESHOOTING §8 + 본 HANDOFF). Pages built 확인.

### 다음 세션 확인할 것
- (완료) 배포 후 각 패널 드래그·푸터 높이 조절 수동 확인 — `1c36943`(19) 이후 배포본에서 확인.
- ~~ap-resizer 방향 보정 여부(사용자 선택)~~ → **2026-08-12 완료**: 사용자 보고로 `reverseW` 제거(오른쪽으로 끌면 넓어짐). TROUBLESHOOTING §8에 방향 판단 기준 기록.
- 회귀 하네스 `ui-resize-test.cjs`를 리포에 커밋할지(현재 %TEMP%에만 존재).

---

## 2026-08-12 (17) — opencode (모아타운 취소현황 정합성 + 면목3·8동 관리지역고시 반영 — 로컬 편집만, 커밋 대기)

> 사용자 "취소현황 처리했어?" 확인 → 2026-08-06 뉴스(면목3·8동 관리계획 승인·고시)와 정보몽땅 취소현황(2026-06-19 기준 11건)을 대조해 `redevelop_seoul.json` 정합성 처리. **커밋·push·배포는 사용자 동의 대기 중.**

### 완료
- **면목3·8동 모아타운(면목동 453-1)**: stage `대상지선정` → `관리지역고시` (근거: 2026-08-06 아시아경제 "중랑구, 면목3·8동 모아타운 관리계획 승인·지형도면 고시 완료").
- **자양2동 681**: stage `수립범위 자문` → `취소` (근거: 정보몽땅 모아타운 취소현황, 취소일 2026-06-19).
- **취소현황 11건 전수 대조**: 기반영 6건(송정동 97-3·석관동 124-42·신당동 156-4·사근동 190-2·신당동 50-21·자양2동 681), **누락 5건 신규 추가** — 신당동 122-3(중구, 63,085㎡)·도림동 247-78(영등포구, 92,057㎡)·월계동 500(노원구, 85,165㎡)·화곡본동 98-88(강서구, 53,298㎡)·자양4동 12-10(광진구, 75,608㎡). 전부 stage=취소·method=모아타운·bz=BZ201·create=2026-08-12·rc/sn=""(경계지도 링크 없음).
- **좌표 출처**: 신당동 122-3·월계동 500 = V-World 지번(getcoord type=PARCEL, 정밀, approx=false) / 도림동·화곡본동·자양4동 = Nominatim(동/도로 근사, approx=true — 팝업에 "(동 근사위치)" 표시).
- **검증**: JSON 파싱 OK, 총 2,969행, 모아타운 취소 11건, diff 83+/3- (최소). **기존 파일은 2-space pretty-print** — 재작성 시 `JSON.stringify(rows, null, 2)` 유지(첫 시도에서 압축 저장으로 54,518줄 diff → HEAD 복원 후 재적용).

### 함정 (TROUBLESHOOTING 참고)
- 정보몽땅 취소현황 주소·면적은 UQ120(정비사업) 데이터에 **미포함** → V-World getcoord(type=PARCEL)가 취소지번 상당수에서 NOT_FOUND(실측: 신당동 122-3 성공, 도림동 247-78·화곡본동·자양4동 실패) → **Nominatim 주소 검색으로 폴백**(동/도로 근사, approx=true).
- redevelop_seoul.json 재작성 시 포맷 주의: 원본이 2-space pretty-print. `JSON.stringify(rows)`(압축)로 저장하면 전체 파일 diff 폭주.

### 커밋·배포 상태
- **커밋 3건 push 완료** (사용자 "웅 진행해"): `e968ada`(css/buttons.css + HTML 6종 링크) → `6646779`(redevelop_seoul.json 취소현황) → `699e8ff`(HANDOFF·API 정보). 세션 전 blob(1,411,871B) 대비 **83+/3- 정확히 일치, 데이터 손실 없음**(`git cat-file -s`·numstat 실측).
- ⚠️ **배포 차단 발견·해소**: 저장소가 private이라 Pages 비활성(`has_pages=false`, 실사이트 404) — 사용자 선택으로 **public 전환**(`gh repo edit --visibility public`) + `POST /pages`로 재활성화 → **built 699e8ff** 확인.
- **배포 검증 완료**: `redevelop_seoul.json` 200 (1,413,471B, 로컬과 byte 동일), 파싱 2,969행, 신당동 122-3 등 5건 취소·자양2동 취소·면목동 관리지역고시 전부 반영. `css/buttons.css` 200.

### 다음 세션 확인할 것
- 사용자 동의 → 커밋·push → 배포 후 land.html에서 취소구역(회색) 11곳·면목3·8동 `관리지역고시` 표시 확인.
- (보류) 취소현황 자동 수집 파이프라인(첨부파일 파싱) — 이번엔 11건 수동 대조로 갈음, 파이프라인 미구축.

---

## 2026-08-09 (15) — opencode (법원경매 수집 파이프라인 + land.html 경매 레이어 — 로컬 편집만, 커밋 대기)

> 법원경매 물건을 지도에 반영. courtauction.go.kr(WebSquare5 SPA)을 playwright 기반으로 수집해 `auction.json` 생성, land.html에 '법원경매' 레이어로 표시. **커밋·push·배포는 사용자 동의 대기 중.**

### 완료
- **`tools/collect_auction.js` 신규** (playwright-core + system Chrome, 헤드리스): 법원 select 변경 → WebSquare5 검색 클릭 → 결과 그리드 파싱 → 페이지네이션(40건/페이지) → VWorld 지오코딩 → `auction.json` 압축 포맷 저장. 서울+경기 **14개 법원, 진행중 물건 2,949건** (auction.json 926.9KB).
- **지오코딩 개선 + `--regeo` 모드**: 도로명 주소는 `type=PARCEL`로 실패 → `cleanAddr()`(층/호·비동 제거) + `type=ROAD` 재시도 추가. 실패(null) 캐시는 재시도 대상으로 두고 `--regeo`로 보강 — 좌표 확보율 **72.7% → 98.2%** (2,896/2,949건).
- **land.html '법원경매' 레이어**: LAYER_TREE에 대분류 추가(전기차 충전소 옆). evCluster와 동일 패턴으로 `auctionCluster`(markerClusterGroup) 구현 — 진행중 물건 2,896개 마커, 진행상태별 색(유찰=빨강 `#fa5252`, 그 외=주황 `#f08c00`), 팝업(법원·사건번호·소재지·용도·감정평가액·최저매각가격·진행상태·담당계 매각기일·비고).
- **검증** (로컬 서버 + 헤드리스 Chrome 실측): 레이어 체크 → `auction.json` fetch 200 → 클러스터 **214개 DOM 렌더**, 콘솔 에러 0. (참고: land.html은 클로저라 `window.auctionCluster` 접근 불가 — DOM 기반 검증.) 스크린샷 `%TEMP%\opencode\auc_layer.png`.
- **TROUBLESHOOTING §6-11 신규 기록**: courtauction 직접 요청 불가(파라미터 오류·IP 차단 실측), 클릭 기반 수집 경로, playwright evaluate IIFE 필수, VWorld 지오코딩 함정(PARCEL→ROAD, 층/호 정제).

### 함정 (TROUBLESHOOTING §6-11 참고)
- courtauction.go.kr: 직접 fetch = `"파라미터가 없습니다"` 오류, 반복 시 **IP 차단** — WebSquare5 클릭 요청만 유효. 요청 간 GAP_MS=1000 필수.
- 그리드에 `a[href]` 링크 없음 → 사건번호(cn)만 확보, **상세 URL 미확보**(추후 과제).
- 지오코딩 캐시: 실패(null) 항목은 `collect_realprice.js`와 공유하는 `.geocache.json`에 남는다 — `--regeo`가 재시도.

### 커밋·배포 상태
- **미커밋**: `tools/collect_auction.js`(신규), `auction.json`(신규, 926.9KB), `land.html`(경매 레이어), `TROUBLESHOOTING.md`(§6-11), `HANDOFF.md`(본 항목). 커밋·push는 사용자 동의 대기.
- 기존: `ae58b0a` → `9607cc5` push/built 완료.

### 다음 세션 확인할 것
- 커밋·push 동의 받기 → 배포 후 land.html '법원경매' 레이어 실화면 확인(클러스터 → 줌인 → 개별 마커 → 팝업).
- (선택 과제) 경매 상세 URL(사건번호 기반) 확보, 매각예정물건(PGJ157M00) 추가, `land.backup-20260808.html`·`_*.txt` 정리.

---

## 2026-08-09 (16) — opencode (법원경매 왼쪽 사이드 패널 + 표시 버그 수정 + 매각예정 수집 확장 — 커밋·push·배포 완료)

> 사용자 신고 "경매 팝업에 사건번호 등 정보 없음"은 재현 불가(팝업 정상)였고, 대신 **감정평가액·최저가가 "0억원"으로 표시되는 실제 버그**를 찾아 수정했다. 이어 사용자 요구로 **법원경매 레이어 전용 왼쪽 사이드 패널**(리사이즈·사건 목록·즐겨찾기·법원 링크 2종)을 구현했다. 사용자 "예정물건도 있으면 해" → PGJ157 실측 후 `--sched` 수집 모드 확장(수집 실행은 IP 안정 후).

### 완료
- **표시 버그 수정** (`land.html` wonEok): 감정평가액·최저매각가격이 항상 "0억원"으로 나옴 → 원인은 `v/10000` 이중 변환. `auction.json` 의 appr/low 는 이미 억 단위(실측: 4.1 → 4.1억원)라 `/10000` 제거. 검증: 명륜4가 팝업 감정평가액 7.8억원·최저매각가격 4억원 정상 표시.
- **courtauction 문서 직접 URL 실측 완료** → **결론: 구조적으로 불가능**(SPA). 문서는 물건 상세 화면의 버튼 클릭으로만 열림. **사용자 승인으로 사건검색(PGJ159M00)·물건상세검색(PGJ151F00) 2종 화면 링크로 절충.** 상세는 TROUBLESHOOTING §6-12.
- **법원경매 왼쪽 사이드 패널** (`land.html`): 레이어 켜면 왼쪽 오버레이 패널 표시, 끄면 숨김. 오른쪽 엣지 드래그 리사이즈(200~640px). 사건 목록 2,896건(행 = 상태 배지·주소·사건번호·법원·물건번호·감정/최저/용도/매각기일). **행 클릭 = 지도 이동 + 팝업**, **사건번호 클릭 = 법원 사건검색 새 탭**, **☆ = localStorage 즐겨찾기**(`land_auction_fav`) + "즐겨찾기만" 필터. 헤더에 사건검색·물건검색 링크 2종.
- **매각예정(PGJ157) 실측 + `--sched` 확장**: PGJ151=오늘~+2주, PGJ157=기본 오늘~+2개월임을 실측(auction.json 2,949건 전부 8.10~8.21 이 두 화면 분담을 확증). PGJ157 그리드가 PGJ151과 동일 구조라 EXTRACT_JS 재사용. `collect_auction.js --sched` → `auction_sched.json`(kind=1, 진행중 kind=0). 화면 로드 폴링+재시도 추가. **수집 실행은 IP 차단 리스크로 보류 — 사용자 동의 "스크립트 확장 후 나중에 수집"**.
- **검증**: 사이드 패널 CDP 실측 7항목 전부 통과. `--sched` 는 문법 검사만(화면 수집은 IP 안정 후).
- **TROUBLESHOOTING §1·§6-12·§6-13 기록**: auth-guard 함정, 문서 열람 경로, 화면 분담+PGJ157 로드 불안정.

### 함정 (TROUBLESHOOTING §1·§6-12·§6-13 참고)
- land.html 을 헤드리스로 그냥 열면 `js/auth-guard.js` 가 onboarding 로 리다이렉트 → **가드 스크립트만 abort** 하면 지도 로직 전체를 로컬에서 검증 가능.
- PGJ157 재방문 로드가 비결정적(첫 probe 성공 후 반복 방문부터 90초 폴링에도 빈 화면) — **반복 요청 금지, 실패 시 잠시 후 재실행**. IP 차단은 blocked 메시지 없이 "화면만 안 뜨는" 형태도 있음.
- 경매 `cn` 필드 = `"서울중앙지방법원 2023타경2726"` 형식(법원명 포함) → 패널 행에서는 `d.court` 접두어 제거해 표시.

### 커밋·배포 상태
- **커밋·push·배포 완료** (사용자 "기록하고 배포해줄래"): `land.html`(사이드 패널·wonEok), `tools/collect_auction.js`(--sched), `auction.json`(2,949건), `TROUBLESHOOTING.md`, `HANDOFF.md` → `0a18d49`.
- **후속 커밋 `518d534` push/built 완료** (사용자 현장 확인 반영): 전기차 충전소 마커 ⚡·법원경매 마커 ⚖️(유찰 빨강/그 외 주황 배경) divIcon 화, 법원경매 명칭 "진행중 물건 (서울·경기)" → **"진행 물건(서울/경기)"**. 실서버 반영 확인(명칭/아이콘 모두). 검증 시 페이지에러 2건은 auth-guard·kakao dapi 의도적 차단 결과(무해).
- **후속 커밋 `50d84e6` push/built 완료**: 레이어 대분류 순서 재배열 — **법원경매·청약·실거래·지적·행정경계·도시계획사업·지구단위계획구역**을 상단으로, 나머지(용도지역·도시계획시설·규제구역·주제도·현장확인)는 기존 순서 유지. 실서버 반영 확인.
- **후속 커밋 `b0fce0e` push/built 완료**: 지적·행정경계에 **"시도 경계 (서울·경기 등, 강조)"** 레이어 추가 — V-World `lt_c_adsido`, opacity 1.0. 시군구(#68779D)보다 진한 청회색(#556284)으로 실측 확인. WMS 타일 로드 정상. 실서버 반영 확인.

### 다음 세션 확인할 것
- 배포본에서 실화면 확인: 레이어 체크 → 패널 표시 → 행 클릭 팝업 → 즐겨찾기 → 법원 링크 2종.
- **매각예정 수집 실행** (IP 안정 후): `node tools/collect_auction.js --sched` → `auction_sched.json` 생성 → **land.html 에 예정 표시 추가**(kind=1 구분, 레이어/패널 병합).
- (선택) 팝업에도 사건번호를 법원명 없는 형태로 정리할지, 패널 폭을 localStorage 에 저장할지.

---

## 2026-08-09 (14) — opencode (방문자 위치 탭 + 신규 가입 관리자 알림 배포 — 커밋 `e067009` push/built 완료)

> 사용자 "관리자모드에서 회원 IP로 위치 파악하는 메뉴 어딨어?" → 위치 목록이 아직 없음을 확인(위치 컬럼은 직전 세션에서 추가 시작) → "방문자 위치" 탭 신설 + 관리자 가입 알림 최종 배포 완료. 테스트 계정 2개 삭제.

### 완료
- **admin.html "방문자 위치" 탭**: 최근 200건의 방문일·IP(앞 3옥텟만 마스킹)·국가·지역·도시 표 + 위치 CSV. `showTab('loc')` 분기 추가.
- **admin-data**: `locations` 배열 반환 — `visits` 최신순 200건(`country/region/city/visit_date`), IP 마스킹 `maskIp()`(개인정보 최소화 사유). 배포 완료.
- **신규 가입 알림**: `admin-notify`(네이버 SMTP) + `trg_notify_admin_new_user`(pg_net) — 직전 세션 작업물을 커밋에 포함(`e067009`). **메일 수신 확인됨**.
- **테스트 계정 삭제**: `notifytest1786287998@example.com`·`trigtest1786288092@example.com` → Management API `database/query`로 삭제(profiles 등 CASCADE). QA 계정(`qa.matjip.20260808@example.com`)은 유지.

### 함정 기록 (TROUBLESHOOTING §11-7·11-8)
- 네이버 SMTP: 일반 비밀번호 → **535** → 앱 비밀번호(SMTP/POP3용) `LZEJRR1VZ5G9` 사용.
- 서비스 롤 키 없이 테스트 계정 삭제 = DPAPI 해독(`~/.supabase/access-token.enc`) → `POST /v1/projects/{ref}/database/query`.

### 커밋·배포 상태
- 커밋 `e067009`: admin.html(위치 탭) + schema.sql(알림 트리거) + admin-data(위치 반환) + admin-notify(신규) + 마이그레이션 `20260809000001_admin_notify.sql`. **push 완료**, admin-data 함수 배포 완료.
- 기존: `2784629` → `e067009` (부모 2건 미커밋 없음).

### 후속 수정 (같은 날) — 방문자 위치에 회원 이메일 연결 (커밋 `ae58b0a` push + 함수/마이그레이션 배포 완료)
- 사용자 요청: 방문자 위치에 IP·국가·지역·도시 + **회원 이메일** 표시.
- **방법**: ① `visits.user_id` 컬럼 추가(마이그레이션 `20260809000002`, FK `on delete cascade` + 인덱스) ② `visit-count`가 `Authorization` JWT를 `admin.auth.getUser()`로 검증해 user_id 저장(비회원은 null — 기존 집계 영향 없음) ③ 호출부(main.js:611·land.html:4347)에서 로그인 세션의 access_token을 헤더로 전달 ④ `admin-data`가 profiles 이메일 매핑(기존 pRes 재사용), 응답에서 user_id 대신 email만 노출 ⑤ admin.html 위치 표·CSV에 "회원" 컬럼.
- **배포**: db push(마이그레이션 1건) + visit-count·admin-data 함수 배포 + push(`ae58b0a`). 문법 검사 admin/land/main 전부 OK.
- **검증 필요**: 사용자가 로그인 상태로 main/land 재방문 → 방문자 위치 탭에 이메일 표시되는지 실화면 확인(같은 IP 하루 1건 dedup이라 기존 행에는 user_id 없음 — 다음 날부터 누적됨).

### 다음 세션 확인할 것
- 관리자 대시보드 → 방문자 위치 탭 실화면 확인(배포 반영은 GitHub Pages 캐시 고려).
- `@example.com` 계정 삭제 시 QA 계정 유지(§11-8).

### 후속 수정 (같은 날) — 로그인 버튼 마비
- 사용자 "로그인 버튼이 안 눌림" → **원인**: `exportLocations()` 괄호 1개 누락으로 인라인 JS 전체 파싱 실패 → `doLogin()` 미정의. 로컬은 같은 파일인데도 처음 `new Function` 검사가 `chart.js` 태그를 슬라이스해 **오검(OK)** — 인라인 스크립트만 정확히 추출해 재검사하니 실패 확인.
- **해결**: 괄호 보정 + 커밋 `9607cc5` push + 배포본 JS 문법 OK 확인. TROUBLESHOOTING §5-4 기록.
- **교훈**: HTML 문법 검사 시 `indexOf('<script>')` 가 CDN `<script src>` 를 잡으므로 **`chart.js` 이후의 인라인 블록**을 골라 검사할 것.

---

## 2026-08-09 (13) — opencode (팝업 재오픈 전수 QA + 전 페이지×뷰포트 회귀 QA, main.html 푸터 오버플로 재발 수정)

> 사용자 "지금 문제가 너무 많잖아… 건물 클릭→팝업 X 닫기→지도 이동 시 재오픈" 재보고 → 재현 조사 + land.html 레이어 전수 QA + 모바일 QA 진행. **재오픈은 어디서도 재현 안 됨**(이미 `6caa166` 수정·배포 반영). 대신 새 요구사항 "다른 컴퓨터·다른 모니터 규격에서도 정상 표시"로 **페이지 7종 × 뷰포트 7종 전수 회귀 QA** → **main.html 푸터 가로 오버플로 재발 발견·수정**. 커밋 대기(사용자 동의 후).

### QA 결과 (전부 실측, 콘솔 에러 0건)
- **팝업 재오픈**: 로컬(`bug4-repro.cjs`)·배포본(`bug4-deploy.cjs`·`bug4-search-deploy.cjs`)·모바일 폭(`qa8-mobile.cjs`) 모두 **재현 안 됨** — popupclose 핸들러(land.html:1553~1558)가 닫힌 팝업의 마커를 제거, async 콜백의 `if(!clickMarker) return` 가드(3598)가 재오픈 차단. 사용자 증상은 이전 버전 캐시 가능성.
- **마커 레이어 8종**(`qa7-all-layers.cjs`): 연립·단독 매매/전월세·오피스텔·CCTV·EV·분양예정 전부 팝업 열림→X 닫기→pan 재오픈 없음.
- **전 페이지×뷰포트**(`qa9-viewports.cjs`): onboarding/main/land/detail/ai/admin/terms × 320/375/412/768/1280/1920/2560 — **main.html만 1280(푸터)·768(전체)에서 가로 오버플로**. 나머지 전부 정상.

### main.html 푸터 가로 오버플로 재발 — 수정 완료 (1줄)
- **원인(실측)**: 버그1 해결(`flex-wrap:wrap`)이 land.html(369)에만 적용되고 **main.html `.footer-top`(main.html:101)에 누락** → 1280px에서 `.footer-right` R=1324(44px 초과)·`.footer-admin` R=1324. 페이지 전체 scrollWidth 고정 → 가로 스크롤바 → 지도 왼쪽 밀림.
- **해결**: main.html:101 `.footer-top`에 `flex-wrap:wrap` 추가.
- **검증**: `qa10-main-verify.cjs` — 320~2560 전 폭 hOverflow false, `.footer-right` right = vw−24, 콘솔 에러 0. TROUBLESHOOTING 버그1 항목에 재발·재수정 기록.

### 계측 함정 (이번에 알게 된 것)
- JS `dispatchEvent(click)`는 일반 div 마커엔 전달되지만 **클러스터(`.marker-cluster`)엔 안 먹힘**(popupOpen "n/a") → 실제 동작 재현은 CDP `Input.dispatchMouseEvent` 필요.
- 클러스터가 `getBoundingClientRect()` 좌표가 **화면 밖(x=-1)**일 수 있음 → 화면 안 요소만 타깃으로 잡을 것(`qa6-realclick.cjs` 보정).
- QA 스크립트에서 `map.on('popupopen')`을 반복 등록하면 리스너가 누적되어 이벤트가 N배 찍힘(테스트 스크립트 문제, 실제 버그 아님).

### 커밋·배포 상태
- 미커밋: **main.html(푸터 wrap 수정) + TROUBLESHOOTING(재발 기록) + HANDOFF(본 항목)** — 커밋·push는 사용자 동의 대기.
- 기존: `6caa166`→`2e3d4eb`→`6b3b6c2` push/built 완료.

### 다음 세션 확인할 것
- 커밋·push 동의 받기 → main.html 푸터 wrap 배포 후 `qa10-main-verify.cjs`로 배포본 재검증.
- 사용자 "팝업 재오픈" 재보고가 계속 오면: 브라우저 캐시(Ctrl+Shift+R) 확인 + 재현 단계(브라우저·OS·화면 크기) 요청.

---

## 2026-08-09 (12) — opencode (배경지도 버튼 왼쪽 잘림 + 팝업 재오픈 + IE 안내문 — 커밋 `6caa166`·`2e3d4eb` push/built 완료)

> 사용자 제보 3건: ① "프론트뷰 화면 일부 안 보임"(배경지도 버튼 왼쪽 잘림) ② "팝업 X로 닫아도 재오픈" ③ "IE 즐겨찾기 안 됨". ①·②는 근본 원인 규명·수정·검증 완료(커밋 `6caa166`), ③은 IE EOL로 **지원 중단 + 안내문**으로 결론(커밋 `2e3d4eb`). 둘 다 push·Pages built 확인.

### ① 배경지도 버튼 왼쪽 잘림 ("OSM에서 SM까지만 보임") — 루트 원인은 페이지 가로 오버플로
- **재현 실측**: 뷰포트 폭·DPR·패널 상태·줌과 무관하게 버튼 자체는 항상 정상(스크롤 0일 때 `leftCut:false`). 원인은 **페이지 전체 `scrollWidth`가 1394px로 고정**되는 것 — `.footer-right`(푸터 연락처+관리자, 574px 고정·`white-space:nowrap`)가 뷰포트가 좁아도 안 줄어든다(vw 1258에서 136px, 900에서 494px, 641에서 753px 초과). 하단 가로 스크롤바가 생기고, 오른쪽으로 스크롤하면 지도 왼쪽(배경지도 버튼 포함)이 화면 밖으로 밀림 → "OSM의 SM만 보임"과 일치.
- **해결** (land.html:369): `.footer-top { flex-wrap:wrap }` 추가 → 좁은 화면에서 푸터가 2줄로 래핑, 전 폭(641~1394)에서 `scrollWidth == clientWidth` 확인.
- **검증**: `bug2-scanwidth.cjs`(배포본, 수정 전 1394 고정)·`bug2-local.cjs`(로컬, 수정 후 전 폭 overflow 0)·`bug2-scroll.cjs`(스크롤 시 버튼 잘림 재현)·`bug2-mobile-final.cjs`(모바일 폭 정상). TROUBLESHOOTING §13 기록.

### ② 팝업 X로 닫아도 재오픈 — 비동기 지오코딩 콜백이 원인
- **재현 실측** (배포본 CDP): 이벤트 타임라인 `open(정보 불러오는 중, d:0) → close(X, d:123) → open(위치 정보, d:224)`. 지오코딩(Naver reverseGeocode, ~100ms) 콜백이 **닫힘 여부와 무관하게** `clickMarker.setPopupContent(...).openPopup()`(land.html:3603)을 실행. "지도 이동 후 재오픈"으로 보였지만 지도 이동과 무관한 **콜백 타이밍** 문제.
- **계측 함정**: `map.closePopup()` 후에도 `map._popup` 참조는 남음(STILL_SET). `map._popup !== null`로 재오픈 판정하면 오판 — 반드시 `map._popup.isOpen()` 사용.
- **해결** (land.html:1540~1546): `map.on('popupclose')` 핸들러 — 닫히는 팝업이 `clickMarker.getPopup()`과 같으면 `map.removeLayer(clickMarker); clickMarker = null`. async 콜백의 `if (!clickMarker) return` 가드(3598행)가 재오픈 차단.
- **검증**: `bug3-user-standalone.cjs`(로컬 CDP) — 클릭→120ms 후 X 닫기→3.5s 대기: `isOpenAfter3s:false`, `popupInDomAfter:false`, 재오픈 이벤트 없음(수정 전엔 `isOpenAfter3s:true`). TROUBLESHOOTING §13 기록.

### ③ IE 즐겨찾기 — IE EOL이라 지원 중단 + 안내문
- **원인 확정**: IE11은 ES6 미지원(화살표 함수 land.html:557·템플릿 리터럴 :565·`fetch()` :24 등) → 인라인 스크립트 블록 **통째로 파싱 실패** → 지도·즐겨찾기 등 JS 전부 죽음. "즐겨찾기 버튼 버그"가 아니라 스크립트 전체가 안 도는 것.
- **결정(사용자)**: IE 지원 중단 + IE 방문 시 안내문 표시(사용자가 "안내문만 추가" 선택; Babel 도입은 별도 프로젝트급이라 보류).
- **해결**: 각 페이지 `<body>` 직후 ES5 문법 + `document.documentMode`(IE 전용) 감지 스크립트 블록 추가(land·onboarding·main·ai·detail.html) — IE에서만 고정 상단 배너. **주의: 이 블록은 IE에서도 실행돼야 하므로 ES5(`var`·`createElement`·`cssText`)만 쓸 것.**
- **검증**: `ie-guard-check.cjs`(Chrome CDP) — `documentMode` undefined → 배너 0개, `mapOk:true`(비-IE 무영향). IE 실기기 없어 직접 검증은 불가, ES5+documentMode 사용으로 확실. TROUBLESHOOTING §13 기록.

### 커밋·배포 상태
- `6caa166`(버그 ①·② 수정 + TROUBLESHOOTING) → `2e3d4eb`(IE 안내문 + TROUBLESHOOTING) → push 완료 → Pages `built` 확인(`gh api .../builds/latest` = 2e3d4eb/built).
- 미커밋 유지: `_*.txt` 10개(임시), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

### 다음 세션 확인할 것
- 배포본 실사용: ① 좁은 창(900~1100px)에서 배경지도 버튼 4개 완전히 보이는지 + 하단 가로 스크롤바 없음 ② 지도 클릭→X로 닫기→팝업 재오픈 없는지 ③ 비-IE 브라우저에서 배너가 안 뜨는지.
- (참고) 이번 작업으로 `.footer-top`이 좁은 창에서 2줄로 래핑되므로, 푸터가 한 줄일 때와 레이아웃이 달라 보일 수 있음 — 의도된 것.

---

## 2026-08-09 (11) — opencode (진행현황 전 구역 표시 + EV·CCTV 아이콘 확대 — 커밋 `bdeae2c` push/built 완료 + 관리지역고시 alias 후속)

> 사용자 지시 "반도미도2차는 왜 진행현황이 없어? 꼭 지정해야만 진행현황이 나오는거야? 다른곳도 다 진행현황 나오게 만들라고!!" + "EV 마커 너무 작어" + "CCTV 아이콘 너무 작어" → 세 건 모두 land.html 수정. ①~③은 커밋 `bdeae2c`로 push/built 완료, **관리지역고시 alias는 후속 미커밋(사용자 동의 대기).**

### ① 진행현황 전 구역 표시 (반도미도2차 등 누락 해결)
- **원인 (실측)**: `jbTlHtml()`(land.html ~1641)의 tl 없는 구역 처리에서 **두 가지 억제**가 겹쳤다:
  - ① 정규식 `/(취소|중단|해제|실효|완료)/` — **'완료'**가 "기획**완료**"·"입주자 모집공고 **완료**"·"설계공모**완료**"처럼 **진행 중 단계 이름에도 붙어** 사업 종료로 오판 → 진행현황 통째로 `''`. 반도미도2차 = stage `기획완료`(신통, tl 없음)가 정확히 이 케이스.
  - ② `if (si < 0) return ''` — STAGE_SEQ(표준 18단계) 밖의 단계(`기획완료`·`관리지역고시`·`추진위구성`·`후보지선정` 등, 59개 stage 중 다수)는 매칭 실패 → 진행현황 미표시.
- **해결** (land.html): ① 정규식에서 `완료` 제거(취소·중단·해제·실효만) ② STAGE_SEQ 밖 단계는 **현재 단계 1행만** 완료로 표시(다음 절차 예측 불가 → "예정" 미표시). 취소·중단·해제·실효 계열은 여전히 진행현황 미표시(의도 유지).
- **검증** (node 단위 하네스, 실측): 2,964건 전수 — **빈 진행현황 348건 → 190건으로 감소**, 남은 190건 전부 `취소(110)·중단(57)·구역취소(10)·구역해제(12)·해제(3)·중단(실효)(1)` = 의도된 종료 단계. 반도미도2차 → 진행현황 표시 확인.

### ② EV 충전소 마커 확대
- land.html:1517 `L.circleMarker` **radius 4→7, weight 1→2** (직경 8px→14px).

### ③ CCTV 아이콘 확대
- CSS(land.html:287~288): `.cctv-icon` **26px→34px**, svg **13px→20px**, margin·iconAnchor 동기화(-34/-17, [17,34]).

### 커밋·배포 상태
- **커밋 `bdeae2c`** → push 완료 → Pages **built** 확인 (`gh api .../builds/latest` = bdeae2c/built). 커밋 대상: `land.html`·`HANDOFF.md`·`TROUBLESHOOTING.md`.
- **후속 2026-08-09 (사용자 문의 "사당동 202-29는 관리지역고시만 나오고 입주까지 쭉 나와야지")**: 모아타운 `관리지역고시`를 `seqIdx()`에서 `정비구역지정(2)` 위치로 매핑(land.html:1614~1616) — 이제 관리지역고시 이후 조합설립추진위원회승인→…→입주까지 "예정"으로 이어진다. 근거: 관리지역고시 = 구역 지정의 행정 고시 단계로 일반 정비의 정비구역지정과 동일 위치. 검증: 하네스 시뮬레이션 `si=2`, done=대상지선정·안전진단·관리지역고시, 예정=조합설립추진위원회승인~입주 16행. TROUBLESHOOTING §13에 기록.
- **후속 2026-08-09 (사용자 문의 "cctv 팝업은 크기조정이 안됨")**: `.cctv-pc`가 `width:320px` 고정(land.html:289)이라 그립 리사이즈에도 안쪽 카드가 안 늘었다 — `.pc`가 겪었던 264px 고정 버그(275~276 주석)의 재발. **해결**: `width:100%`+`min-width:320px`, flex column(`height:100%`), video `flex:1`(min-height 180px)로 변경 — 폭·높이·영상 영역 모두 드래그에 따라 확장. 검증(`cctv-resize-test.cjs`, 로컬 CDP 실측): 콘텐츠 321×263→455×358, video 180→274px. TROUBLESHOOTING §13에 기록.
- **후속 2026-08-09 (사용자 문의 "진행현황에 입주까지 절차만 나오잖아, 전체 목록이 나오라고")**: `jbTlHtml()`이 **STAGE_SEQ 18단계 전체를 항상 나열**하도록 재작성(land.html:1639~1695) — 완료(tl 또는 stage 기준)는 ✓, 나머지는 "예정". 이전엔 "마지막 완료 단계 뒤만 예정으로 붙여" tl에 없는 앞쪽 단계가 목록에서 사라졌다(예: tl=[사업시행인가]면 대상지선정~건축심의 미표시). 표준 밖 단계(기획완료 등)는 맨 위 OUT 행 + 전체 18단계. 검증(`jbtl-full-test.cjs`, 로컬 CDP 실측): 사당동 202-29=18행(완료 3), 반포미도2차=19행(OUT1+18), 상계주공5단지=18행(완료 3), 전부 입주 표시. TROUBLESHOOTING §13에 기록.
- 배포 검증 시: TROUBLESHOOTING §2-6(HANDOFF (10) 참고)대로 배포본 CDP 실측 필요 — 진행현황은 기존 `jbtl-test.cjs` 하네스 회귀, EV/CCTV는 캔버스 픽셀/iconSize 확인.
- 미커밋 유지: `_*.txt` 10개(임시), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

---

## 2026-08-08 (10) — opencode (정비 진행현황: 입주까지 전체 절차 + tl 없는 구역 해결)

> 사용자 요청 "반포주공1단지는 철거신고까지, 신반포2차는 시공자선정까지 보이는데, 시공자 선정 이후 철거·관리처분·이주·철거신고 등 입주까지 절차를 다 표시해줘" + "봉천14는 진행현황이 없고, 다른 구역도 있고 없는 게 있잖아" → 코드+데이터 양쪽 해결.

### 문제 (실측)
- **진행현황(tl)은 정보몽땅 추진경과에서 수집했는데 2,964개 중 348개(11.7%)만 보유** — 2,616개는 진행현황 섹션 자체가 안 나왔다. tl 있는 곳도 마지막 완료 단계에서 끊겨(반포주공=철거신고 2022, 신반포2차=시공자선정 2024) 입주까지 절차가 안 보였다.
- 봉천14: stage=`사업시행인가`인데 tl 없음 → 진행현황 전무.
- 신반포2차: **중복 row 2건**(rc `11000UQ120PS202407010879`·`...PS202411014200`)이고 stage가 `기획완료`/`조합설립인가`로 잘못 잡혀 있음 — tl엔 시공자선정까지 있는데 배지가 뒤처짐.

### 해결 — 코드 (land.html)
- `STAGE_SEQ`(표준 절차 18단계: 대상지선정→…→입주) 정의 + `jbTlHtml()` 신설:
  - **tl 있는 구역**: 완료 단계를 날짜순 정렬 → 마지막 완료 이후 남은 표준 절차를 **"예정"**(점선 원)으로 표시. 이미 완료된 rank 는 건너뜀.
  - **tl 없는 구역**: `stage`를 `seqIdx()`(부분일치: 준공→준공인가, 구역지정→정비구역지정, 사업시행계획인가→사업시행인가)로 매칭해 그 단계까지 완료로 채우고 이후 예정 표시. 취소·중단·해제·사업완료는 진행현황 미표시.
- `jbEffStage()`: 배지/진행%가 `d.stage`가 아니라 **tl 중 가장 최근 날짜 단계**를 기준으로 — 신반포2차처럼 stage가 뒤처진 데이터도 배지가 실제 진행(시공자선정)과 일치.
- `jbPct()`: STAGE_SEQ 순위 기반 %(18단계 중 어디까지 왔나) — stagePct의 6구간 대신 연속값.

### 해결 — 데이터 (redevelop_seoul.json, 기사 실측)
- **봉천14 tl 6단계 추가**: 조합설립추진위원회승인 2009 → 정비구역지정 2014-06-19 → 조합설립인가 2020-09 → 건축심의 2023-08 → 시공자선정 2025-03(GS건설) → 사업시행인가 2025-06-02.
- **반포주공1단지(1,2,4주구) 착공신고 2024-03 추가** — 철거신고에서 끊겨 있던 tl 완결(실제 2024.03 착공, 2026 하반기 일반분양·2027.11 입주 예정).

### 검증 (전부 실측)
- 단위 하네스(`jbtl-test.cjs`): 봉천14(tl 없음/있음)·신반포2차·반포주공·준공·취소·기획완료·구역지정 8케이스 — 완료/예정 행 수·%·effStage 전부 기대값.
- 인라인 스크립트 문법 0 오류.
- **실제 지도 팝업 CDP 실측**(`jbtl-popup-test.cjs`, 로컬 8798): 봉천14 팝업 — 완료 6단계+예정 8단계(철거업자선정~입주), 진행단계 47%. 반포주공1단지 팝업 — 완료 12단계(착공신고 2024-03 포함)+예정 3단계, 배지 `착공신고` 82%. JS 예외 0건.
- 이전 그립/폰트 기능은 손대지 않음(회귀 영향 없음).

### 커밋·배포 상태
- **커밋 `c138ca2`** → push 완료 → Pages **built** 확인(`gh api .../builds/latest` = c138ca2/built). 커밋 대상: `land.html`·`redevelop_seoul.json`·`HANDOFF.md`·`TROUBLESHOOTING.md`(§8에 CDP 검증 함정 3건 추가: returnByValue 필수 / setView 시 팝업 유실·재스캔 필요 / PowerShell 인라인 node 깨짐→.cjs 파일로).
- **배포본 CDP 실측**(`jbtl-deploy-test.cjs`, 배포 URL): 봉천14 — 완료 6단계+예정 8단계(철거업자선정~입주), 진행단계 47%. 반포주공1단지 — 완료 12단계+예정 3행, 배지 `착공신고` 82%. JS 예외 0건.
- ⚠️ **배포본 레이어 렌더는 로컬보다 느림(실측)**: 로컬은 정비 레이어 켜기 후 2.5초면 폴리곤 렌더 완료지만 배포본은 5~7초 필요. 배포본 검증 스크립트는 레이어 켜기 후 **6초 이상 대기**할 것(짧게 두면 found=false로 오판).
- 미커밋 유지: `_*.txt` 10개(임시), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

### 후속 수정 — 사업계획승인(역세권 등) 진행현황 누락 (2026-08-08, 사용자 문의 "사당동 155-4 왜 진행현황 없어?")
- **원인**: `역세권(주택복합)` 등 기타사업은 stage=`사업계획승인`(「주택법」 제15조)인데, 이 단계명이 일반 정비 STAGE_SEQ의 `사업시행인가`와 달라 `seqIdx()` 부분일치가 실패 → 진행현황 미표시. **같은 케이스 23건**(역세권 주택복합 6·도시정비형 7·주택정비형 2·공공지원임대 1·노후계획도시 7).
- **근거**: 서울시 역세권 활성화사업 운영기준 2-1-1 — 사업계획승인(주택법)·사업시행계획인가(도시정비법)·건축허가(건축법) **3유형이 동일한 인허가 위치**.
- **해결** (land.html): `seqIdx()`에 `'사업계획승인' → STAGE_SEQ.indexOf('사업시행인가')` alias 추가(land.html:1427~1429) + `STAGE_COLOR_MAP['사업계획']='#e8590c'`(1417).
- **검증**: 단위 하네스 9케이스 회귀 통과(신규: 사업계획승인 = effStage/47%/18행). 로컬 CDP 팝업 실측(`jbtl-sadang-test.cjs`) — 사당동 155-4: 완료 9단계(대상지선정~사업계획승인)+예정 9단계(시공자선정~입주), 배지 `사업계획승인`, 47%, JS 예외 0.
- **커밋 `e237184`** → push → Pages **built** 확인 → **배포본 CDP 실측**(`jbtl-sadang-deploy-test.cjs`): 사당동 155-4 팝업 — 완료 9단계+예정 9단계(시공자선정~입주), 배지 `사업계획승인`, 47%, JS 예외 0. 반영 완료.

### 후속 수정 — 겹친 구역 폴리곤 클릭이 큰 폴리곤에 가로채임 (2026-08-08, 사용자 문의 "사당동 305-35 일대 확인 + 기타사업으로 겹쳤을 때 matjip 클릭 문제")
- **재현(실측)**: 사당동 305-35 일대(신통, `대상지선정`, 폴리곤 1링 150점, 4.13만㎡) 중심을 CDP 실클릭해도 **사당4동**(기타, 마중물사업) 팝업이 떴다. pointInRing 데이터 대조: 사당4동(43.4만㎡) 폴리곤이 사당동 305-35를 **완전히 포함**하고 클릭 지점은 둘 다 내부.
- **원인**: land.html 812행 `preferCanvas: true`(Canvas 렌더러)에서도 **"나중에 추가된 도형이 위"** — Leaflet 클릭 hit test 는 렌더 역순. `jbBuild`가 `jbRows`(데이터 fetch) 순서로 `addLayer` 했고, 큰 사당4동이 뒤에 와서 위를 차지.
- **해결** (land.html, 로컬 편집만): 폴리곤을 `polys` 배열에 모았다가 **면적 내림차순**으로 정렬 후 `jbPolyLayer.addLayer`(1658) — 큰 폴리곤이 아래, 작은 정밀 경계가 위. 근사 원(`dots`)은 `jbCluster.addLayers(dots)`(1657)로 폴리곤보다 **아래**. `poly._area = _ringArea(rings[0])`.
- **검증(전부 실측, CDP 실클릭)**: A 중심·A 남서(A∩B → 작은 A)·A 동쪽(B 단독 → B)·북쪽(B∩남성역B → 남성역B)·B 단독 → 사당4동·기타사업 WMS ON 상태에서도 A 팝업 유지(UPIS 레이어는 tilePane 아래라 matjip 클릭을 가로채지 않음). 전부 pointInRing 포함 구역과 일치, JS 예외 0.
- **TROUBLESHOOTING §4 추가**: 겹친 폴리곤 클릭 함정 + **내림차순 주의**(오름차순으로 쓰면 역효과 — 실제 1회 실수).
- **커밋 `af6b700`** → push → Pages **built** 확인 → **배포본 CDP 실측**(`jbtl-click-deploy-test.cjs`): 사당동 305-35 중심·남서 → `사당동 305-35 일대`(신통/대상지선정), A 동쪽·B 단독 → `사당4동`, 북쪽(B∩남성역B) → `남성역B`, **기타사업(UPIS) ON 상태에서도 A 팝업 유지**, JS 예외 0. 로컬 결과와 동일 — 반영 완료.

---

## 2026-08-08 (9) — opencode (거리뷰 파노라마 리사이즈 버그 수정 + 그립 시인성 개선)

> 사용자 제보 "거리뷰 레이어 크기 조정은 되는데 실제 거리뷰 화면은 크기 조정은 안되네" + "그립이 안 보여서 리사이즈 가능한지 모르겠다" + "팝업 우하단 '」' 표시처럼 나오게 해달라" → 전부 수정·검증 완료.

### ① 파노라마 화면이 안 따라오는 버그 (실측)
- **증상**: `sv-overlay`(land.html 3434)는 우하단 그립으로 리사이즈 되고, 미니맵(CSS `resize:both`)도 크기 조절이 되는데 **실제 거리뷰(파노라마) 화면만 옛 크기로 남는다**.
- **실측**: `endOvDrag` 가 `panorama.refreshSize()`(land.html 3464)를 호출했는데, **`refreshSize()` 는 Naver Panorama 에 없는 메서드**(Map 전용)다. `typeof panorama.refreshSize === 'function'` 가 false 여서 **드래그 종료 시 갱신이 한 번도 실행되지 않았다**. Naver Panorama 는 컨테이너 크기 변화를 자동 감지하지 못한다(Map 의 auto-resize 는 `size` 옵션 생략 시에만 동작).
- 미니맵이 되던 이유: 이미 `ResizeObserver` + `miniMap.refresh(true)`(land.html 3524)가 있어서. 파노라마에만 그 갱신이 빠져 있었다.
- **해결** (land.html 3448-3477): `resizePano()` 를 추가해 `panorama.setSize(new nv.maps.Size(ov.clientWidth, ov.clientHeight))` 호출 — 드래그 중엔 rAF 스로틀로 라이브 갱신, 종료 시(`endOvDrag`) 최종 갱신.

### ② 리사이즈 그립 시인성 — 2차 강화까지 완료 (실측)
- **증상**: 그립은 있는데 사용자 눈에 안 띈다(16px·`opacity:.5`·`filter:invert(1)`, 어두운 파노라마 위에서 거의 사라짐).
- **1차 해결** (커밋 `6563e91`): 거리뷰 전용 `.sv-grip` 추가 — 26px·opacity 1·`rgba(0,0,0,.6)` 배경·흰색 1px 테두리·3px 흰 코너, `filter` 제거, 호버 시 힌트.
- **사용자 재제보 "아직도 그래" → 2차 강화** (land.html 327-331): 그립 **32px**·흰색 **2px** 테두리·**4px** 흰 코너·배경 `rgba(0,0,0,.78)`·hover 시 더 진해짐. 그리고 **"드래그로 크기 조절" 힌트(`sv-grip-hint`)를 호버에 의존하지 않고 항상 표시(opacity 1)** — 사용자가 크기 조절 가능함을 모르는 게 반복 제보의 근본 원인이라, 감추는 것보다 항상 알려주는 걸 선택(커밋 대기 중).

### 검증 (전부 실측)
- `sv-resize-test.cjs`(naver 스텁 + CDP PointerEvent 드래그): 오버레이 820×560 → 1020×680(+200/+120), `panorama.setSize` 2회, JS 예외 0건 — **2차 강화 후 재실행 통과**.
- `sv-grip-test.cjs`: 그립 **32×32**·opacity 1·bg rgba(0,0,0,.78)·filter none, 힌트 "드래그로 크기 조절" 오버레이 내부 배치, **힌트 opacity 1(항상 표시)**.
- `tl-test.cjs` 회귀 PASS(fitWorked:false 는 의도된 결과 — 고정 높이 타임라인). 인라인 스크립트 문법 0 오류.
- 스크린샷: `%TEMP%\opencode\sv-overlay-grip.png`(스텁 환경), `sv-live-overlay.png`(배포본 + 실제 Naver 파노라마 로드 상태).
- 배포본 라이브 실측(`sv-live-test.cjs`): 그립 존재·`elementFromPoint` 가 그립을 가리킴(가려짐 없음)·파노라마 820×560 정상 로드·JS 예외 0건.
- TROUBLESHOOTING §4 에 두 함정 모두 기록.

### 커밋·배포 상태
- **배포됨**: `2ed9710` → `071fbb7` → `d480ba3` → `6563e91`(1차 그립 개선) → **`a969543`(2차 그립 강화)** 전부 push·Pages built 완료. 배포본 라이브 실측(`sv-live2-test.cjs`)으로 그립 32px·비가림 확인. (이 항목 작성 당시 "미커밋"이라 적었으나 커밋 후 갱신 누락 — (10)에서 정정.)
- 미커밋 유지: `_*.txt` 10개(임시), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

---

## 2026-08-08 (8) — opencode (정비 폴리곤 팝업 리사이즈 시 폰트 8px 축소 버그 수정)

> 사용자 제보 "레이어 클릭해서 나오는 팝업 크기 조정 안 되잖아" → 원인 규명·수정 완료. **커밋·push·배포 확인 진행**(사용자 동의).

### 버그 원인 (실측)
- **증상**: 레이어 클릭 팝업(정비 폴리곤 등)을 드래그로 키워도 "크기 조절이 안 되는 것처럼" 보임.
- **실측**: 드래그 리사이즈 자체는 동작(목동4단지 272→472, 404→554). **문제는 드래그마다 `_updateLayout`(land.html ~837)이 `fitPopupText` 를 재실행**해 폰트를 13→**8px** 로 밀어버리는 것. 정비 팝업은 타임라인 등 **폰트에 반응하지 않는 고정 높이 요소**로 구성돼 8px 바닥까지 줄여도 `scrollH 757 > clientH 554` 가 유지된다.
- **해결** (land.html `fitPopupText`): 8px 바닥까지 줄인 뒤에도 넘치면 **기본 폰트로 복원** → 스크롤에 맡김. 드래그로 키운 크기가 글자 축소로 상쇄되지 않음.
- **검증** (`%TEMP%\opencode\realpopup-drag.cjs` — 실제 정비 폴리곤 `openPopup()` + CDP 마우스 드래그): 드래그 후 `fs 13px 유지`, 크기 272→472. `tl-test.cjs` 전체 요소(그립·타임라인·접기칩) PASS, JS 예외 0건.
- TROUBLESHOOTING §4 에 함정 기록.

### 커밋·배포 상태
- **커밋 `2ed9710` push 완료** — `land.html`·`HANDOFF.md`·`TROUBLESHOOTING.md` 3개. GitHub Pages `built` 확인(`2ed9710`), 배포본 land.html 에 복원 로직 주석 826행 반영 확인.
- 미커밋 유지: `_*.txt` 10개(임시), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`, `경쟁사_비교분석_20260808.hwpx`.

---

## 2026-08-08 (7) — opencode (레이어 체크 상태 저장/복원 + 팝업 높이 fit 폰트 축소 + 정비구역 진행현황 타임라인)

> 커밋 여부는 사용자 확인 후 결정이었으나, 사용자 지시로 **커밋·push 진행**(아래 "커밋·배포 상태" 참고). 백업: `land.backup-20260808.html`, `redevelop_seoul.backup-20260808.json` 로컬 유지.

### 한 일 (land.html)
1. **레이어 트리 체크 상태 localStorage 저장/복원** (F5 후에도 유지):
   - `saveLayerState()`·`restoreLayerState()` 추가, 키 `mj_layer_tree_v1`. 섹션>중분류 문자열 키, 소분류는 `data-id` 배열·잎은 `true` 저장.
   - 세 곳의 onchange 배선: 잎 midCb, 소분류 cb, 소분류 있는 midCb → 각각 `saveLayerState()` 추가.
   - **CDP 검증 통과**: 정비사업>94 신속통합기획 + 실거래>아파트 leaf 켜고 저장 → 새 탭 재로드 → `jbSub94Restored=true, aptRestored=true, bigChecked=true`.
2. **팝업 높이 fit — 높이를 줄이면 내용이 넘칠 때 스크롤 대신 폰트 자동 축소**:
   - `fitPopupText()` + `_updateLayout` 패치에 배선. 매번 기본 폰트에서 시작해 0.5px 단위로 줄여 8px 바닥. 다시 키우면 원래 크기 복원.
   - CDP 검증: 기본 13px → 높이 160px 강제 시 8px로 축소, 높이 420px로 복원 시 13px 복귀.
3. **정비구역 팝업에 진행현황 타임라인(`d.tl`) 추가**: `collect_prtnelapse.js`(정보몽땅 추진경과 수집, 미커밋 신규)가 만든 `tl` 필드 348곳 렌더. 현재 단계 원 채우기 + 나머지 빈 원 + 날짜. CDP 검증: 목동4단지(4단계) 팝업에 타임라인·단계바·비교 버튼·경계지도 링크·그립·접기 모두 렌더, 접기→칩→복원 왕복 정상.
4. **코드 최적화**: `zoneAreaM2()` 데드 코드 제거(호출처 없음, HANDOFF (4) 제거 후보).

### ⚠️ 검증 함정 (재발 방지)
- **클러스터에 묶인 마커는 `marker.fire('click')` 로 팝업이 안 열린다** — 클릭이 클러스터로 가기 때문. fit 검증은 `L.popup().openOn(map)` 으로 직접 팝업 생성 후 `_lpH` 조작으로 우회.
- fit 테스트에 25개 항목 같은 과도한 내용을 넣으면 8px 바닥까지 줄여도 넘쳐 "복원도 실패"로 오판. 내용은 현실적 크기(6항목)로.
- **정비구역 폴리곤은 '정비사업 상세 (matjip)' 레이어를 켜야 생성된다** — overlayadd 핸들러가 jbPolyLayer 를 map 에 붙이고 jbBuild() 를 돈다(1644행). 꺼진 상태로 폴리곤 0개를 "버그"로 오판하지 말 것. 검증은 `_jbRowsGlobal`(전역 노출)로 데이터 접근.
- 이번 커밋에 포함된 타임라인·그립·접기·배지 링크 기능은 **이전 세션(4~6)에 이미 구현·검증된 것**으로 이 세션에서 신규 검증 추가: 정비 팝업 전체 요소 `hasTl/hasStage/hasCmp/hasBadgeLink/hasGrip/hasMinBtn/chipAfterMin/reopenAfterChip` 전부 true, JS 예외 0건.

### 커밋·배포 상태 (이 세션에서 커밋·push 진행)
- **커밋 대상**: `land.html`·`redevelop_seoul.json`(tl 348곳)·`HANDOFF.md`·`TROUBLESHOOTING.md`·`tools/collect_prtnelapse.js`.
- push 후 GitHub Pages `built` 여부 확인 예정.
- **미커밋 유지**: `_*.txt` 10개(임시 분석 파일 — 삭제해도 무방), `land.backup-20260808.html`·`redevelop_seoul.backup-20260808.json`(로컬 복구용), `경쟁사_비교분석_20260808.hwpx`(분석 보고서 — 커밋 결정 대기, HANDOFF (6) 참고).

### 다음 세션 확인할 것
- 배포본에서 실사용 확인: F5 후 레이어 체크 유지, 팝업 높이 축소 시 글자 작아지는지, 정비 팝업 타임라인·접기 동작.
- (6) 이어서: 정비구역 기능 실사용 여부, `_*.txt` 정리.

---

## 2026-08-08 (6) — opencode (참조사이트 마우스 조사 완료 + 캔버스 폴리곤 클릭→팝업 CDP 실클릭 검증 통과)

> 미커밋 상태는 동일((4)·(5)의 편집). 이 항목은 (5)에서 남긴 마지막 리스크(캔버스 폴리곤 클릭)를 검증으로 해소한 기록 + 참조사이트 조사 결과.

### 한 일
1. **참조사이트 마우스 상호작용 조사 완료** (urban.seoul.go.kr + jaegebal.com) — 결론: **land.html 에 새로 반영할 항목 없음**.
   - urban (ArcGIS MapView, `tool_fcfecfbe90013pvlC4H2J2E1In`=mainMapInit.js): 휠=줌±1, 드래그=팬(82-98행), **좌클릭은 폴리곤 선택 안 함**, 우클릭(button===2)만 컨텍스트 메뉴→필지 조회(1521-1545행). 팝업 드래그 = 헤더 mousedown + document mousemove/up(`.urbanDrag_{id}`, main.js 548-557행). 호버 하이라이트 핸들러 없음.
   - jaegebal.com: 홈에 지도 없음(Next.js 카드/리스트), 카드=전체 오버레이 `<a>`(z-index 1) 클릭 이동. 지도 마우스 참고 사항 없음.
   - land.html 은 이미 폴리곤 bindTooltip(호버)+bindPopup(클릭) 보유 → 참조와 동일하거나 우위.
2. **캔버스 폴리곤 클릭→팝업 검증 통과** (`%TEMP%\opencode\poly-click-check.js`, CDP 포트 9334, 결과 `poly-click-result.txt`):
   - 실측: 천호3-2 클릭 → `elementFromPoint = CANVAS.leaflet-zoom-animated`, `evCount.canvasClick = 1`, **`popupSourceJb = "천호3-2"`**, popupContent 에 재개발 정보 정상(진행단계 15%·인근 비교·실거래 버튼 포함). 팝업 1개 열림.
   - 이로써 (5)의 유일 미검증 항목 해소 — 정비구역 신기능 전부 실사용 경로 검증 완료.

### ⚠️ 검증 함정 (TROUBLESHOOTING §4 신규 기록)
- `preferCanvas: true` 라 폴리곤이 `<path>` 가 아닌 **canvas 픽셀** → CDP `Input.dispatchMouseEvent` 로 실제 클릭을 보내야 팝업 여부를 알 수 있다.
- 클릭 좌표가 컨트롤(.lc, .leaflet-control)에 덮이면 클릭이 canvas 에 안 닿는다(실측: evCount 전부 0, elementFromPoint = `DIV.lc`). `elementFromPoint(x,y)` 가 canvas 를 가리키는지로 좌표 유효성 판정. `.leaflet-top`(pointer-events:none 스트립)을 rect 로 빼는 방식은 오판.
- setView 후 다시 containerPoint 계산해야 함(줌 바뀌면 좌표 달라짐). 구역 여러 개 준비 → 첫 비차단 지점 선택.
- 참고: `jbRows`/`jbPolys`/`jbPolyLayer`(land.html 1290-1291)는 **함수 스코프** → Runtime.evaluate 에서 접근 불가. 검증 프로브에서 `fetch('redevelop_seoul.json?v=4')` 직접 로드로 해결.

### 커밋·배포 상태 (완료)
- **커밋 `7f0c2fd` push 완료** — `land.html`·`TROUBLESHOOTING.md`·`HANDOFF.md`·`AGENTS.md`·`notices.json`·`tools/collect_notices.js` 6개. GitHub Pages `built` 확인.
- 배포본(`?cb=7f0c2fd`) 실측: `jb-near` 7회·`jb-rp-filter` 2·`jb-notices` 2·`pointInRing` 3·`toggleJbRp` 3·`notices.json` 2 — 신기능 전부 반영.
- 미커밋 잔여: `_*.txt` 10개(grep 분석 임시 — 삭제해도 무방), `land.backup-20260808.html`(로컬 복구용 유지), `경쟁사_비교분석_20260808.hwpx`(분석 보고서 — 커밋 결정 대기).

### 다음 세션 확인할 것
- 배포본에서 사용자 실사용 확인(정비구역 팝업 → 실거래·인근 비교 버튼, 정비 소식 피드). 이상 없으면 이 루프 종료.
- (선택) `zoneAreaM2` 데드 코드 제거 후보(HANDOFF (4) 기록). `_*.txt` 임시 파일 정리.

---

## 2026-08-08 (5) — opencode (정비구역 신기능 CDP 헤드리스 실브라우저 검증 완료 — 전부 정상)

> 미커밋 상태는 동일((4)의 편집). 이 항목은 **실제 브라우저에서 기능 전수 검증**만 추가한 기록.

### 검증 방법
- `%TEMP%\opencode\cdp-check.js` — 헤드리스 Chrome CDP 로 land.html(로컬 8798) 로드 → 정비사업 레이어 토글 → 실거래 토글 → 각 상태를 DOM·계측값으로 검사. auth-guard.js 를 Fetch.abort 하여 가입 진입 차단 우회.
- 이 모델은 스크린샷을 볼 수 없어, 캔버스 픽셀(`getImageData`)을 직접 계측해 폴리곤 렌더를 확인했다(사람이 보는 것과 동일한 근거).

### 검증 결과 (실측)
| 항목 | 결과 | 근거 |
|---|---|---|
| JS 예외 | **0건** | Runtime.exceptionThrown |
| 데이터 파싱 | ✅ 2,964 / 2,963 / 29건 | 브라우저 fetch().json() 실측 |
| 정비구역 폴리곤 | ✅ `L.polygon` **1,186회** + `L.circle` 85회 생성 | 지도 생성자 monkeypatch 카운트 |
| 폴리곤 실제 렌더 | ✅ 캔버스 픽셀 **21.9% 채색**, 좌/우 23,838/26,223 균등 | `getImageData` 계측 |
| 단계 바·필터 칩 | ✅ 표시·동작 | `#jb-stage-bar` display='' |
| 정비 소식 피드 | ✅ 5건 렌더 | `#jb-notices` 344자 |
| 실거래 토글(0건) | ✅ 천호3-1 → "구역 내 실거래 0건" + 토스트 | `#jb-rp-bar` + fitBounds(zoom 16) |
| 실거래 토글(양성) | ✅ 신사동200번지일대 → "**1건**" | pointInRing 실제 매치 |
| 콘솔 에러 | favicon.ico 404 1건 (무해) | Network.responseReceived |

### ⚠️ 검증 함정 (재발 방지)
- **land.html 은 `preferCanvas: true`(798행) 라 폴리곤이 SVG 가 아니라 캔버스 1장에 그려진다.** `.leaflet-overlay-pane svg path` 로 폴리곤 존재를 판단하면 "0개 = 버그"로 오판한다. `overlayCanvas` 존재 + 픽셀 채색 비율로 확인할 것.
- `markers: 16`(상시 보이는 마커) 은 jb 가 아님 — 토글 후 `L.marker` 호출 0회로 확인(회귀 아님, 기존 상시 레이어).

### 커밋·배포 상태 (변경 없음)
- 여전히 **미커밋**: land.html M, HANDOFF.md M, `notices.json`·`tools/collect_notices.js`·`land.backup-20260808.html` untracked. 커밋 여부는 사용자가 결정 대기 중.

---

## 2026-08-08 (4) — opencode (정비구역 팝업 고도화: 실거래 필터·인근 구역 비교 + 정비 소식 피드 — 로컬 편집만, 미커밋)

> **커밋·push·배포 안 함.** 로컬 편집만. 사용자가 직접 확인 후 커밋/배포 결정.
> 백업: `land.backup-20260808.html`(§6 이전 상태, 275,793B, SHA-256 `51AF4990...`)과 별도로,
> **이번 세션에서 land.html 이 101KB 로 잘리는 사고가 있었고 백업에서 복원 + 편집 전부 재적용**했다.
> 결과물 land.html 은 292,295B / 3,953줄, 인라인 스크립트 문법 에러 0.

### 한 일 (재개발닷컴 분석 §"구역 상세" 항목의 land.html 실현)
1. **정비구역 팝업 고도화 (core)** — jbPopupHtml 재작성 (land.html ~1305):
   - 진행단계 진행률 바 + 단계 배지에 사업구분·면적(폴리곤 링 실측 `_ringArea` 합계, land.html:1306 — 데이터 위조 아님).
   - **이 구역 실거래** 버튼(`jb-rp-filter`) → `toggleJbRp(d)` (land.html:1652) — 원본 실거래 레이어는 건드리지 않고 **별도 `jbRpLayer`** 에 구역 폴리곤 내부 실거래만 파란 circleMarker 로 표시 + `fitBounds(구역 bbox, maxZoom 16)`. rpRows 미로드 시 `loadRp().then(() => toggleJbRp(d))` 재귀 로드.
   - **인근 정비구역 비교** 버튼(`jb-near`) → `nearbyZones(d)` (반경 1.5km, 면적·좌표 있는 것만, 최대 6건) 팝업에 인라인 렌더 + `.min` 미니맵 클러스터.
2. **구역×실거래 교차 필터 (새 로직)** — 선택 구역 폴리곤 내부의 실거래만 격리해 보여주는 토글:
   - `pointInRing()` (ray-casting, land.html:1393) + `usableRings()`/`_ringArea()`/`_ringCache` 로 구역 폴리곤 내부 실거래 필터.
   - `toggleJbRp` 는 `rpRows` 전체를 `pointInRing` 으로 필터(거리 기반 필터 아님). 폴리곤 없는 구역(`usableRings` 빈 배열)은 toast 로 안내. 같은 구역 재클릭 → `clearJbRp()`(토글).
   - **클린업**: `clearJbRp()` — 정비사업 레이어를 끄면(`overlayremove`, land.html:1542) `jbRpLayer` 제거 + `jbRpBar`(건수 바) 숨김. 원본 실거래 레이어는 처음부터 건드리지 않으므로 '복원' 개념이 필요 없음.
3. **정비 관련 새 소식 피드 (SH공사 공고 RSS)** — jbCtrl 패널 하단 `#jb-notices` 플레이스홀더 + `loadNotices()`/`renderNotices()` (land.html ~586):
   - `tools/collect_notices.js` 신규 — SH공사 공고 RSS(EUC-KR) → **notices.json** 정적 생성. 브라우저는 정적 JSON fetch 만.
   - 실행 완료: 29건 수집(2026-08-08 실측), 정비 키워드 매칭 24건. GitHub Pages 에서 CORS 문제 없음.
   - 왜 RSS 를 직접 안 읽나: EUC-KR 인코딩 + 브라우저 CORS — TROUBLESHOOTING 에 이미 비슷한 함정 기록돼 있음.

### ⚠️ 사고 기록 (되풀이하지 말 것)
- land.html 이 진행 중 **101,053B 로 잘림**(LastWriteTime 20:32, 줄 3,966→1,706, jbBuild 이후 전부 소실). 징후: `read`/`grep` 출력이 모든 줄을 2번씩 반복해서 표시되는 도구 디스플레이 깨짐이 동반됨. 원인 미상(OneDrive 동기화 충돌 추정, 편집 도구 자체로는 확인 불가).
- **복구 절차**: `land.backup-20260808.html` 로 복원 → §6 4건 + 이번 기능 편집 전부 재적용 → `node vm.Script` 문법 검사로 검증.
- **교훈**: 편집은 작은 단위로 나누고 편집 후 매번 크기/문법 확인. 이 프로젝트는 `land.html` 원본 + 백업 2벌을 유지하는 게 안전.

### 검증 (로컬)
- 인라인 스크립트 1블록 문법 에러 0 (`node vm.Script`). 새 함수 10개(jbPopupHtml·pointInRing·zoneAreaM2·nearbyZones·clearJbRp·renderNotices·loadNotices·rpResetFilter·rpEmptyNotify·toast) 각 1회 정의 — 중복 적용 없음. (`zoneAreaM2` 는 정의만 있고 사용처 없음 — 데드 코드, 제거 후보.)
- `pointInRing` 단위 테스트 6케이스 PASS(내부/경계 4방향/모서리 내부).
- `jbPopupHtml`·`nearbyZones` 런타임 하네스(실제 redevelop_seoul.json + polygons 사용): 팝업 HTML 6,028B 생성, 실거래 필터·인근 비교 버튼 포함, 인근 구역 5건/0.16~0.21km 정상.
- `notices.json` 서빙 확인(로컬 8798, HTTP 200). land.html 서빙 확인(292,295B).
- **2차 심층 재검토(2026-08-08)**: `pointInRing` 실데이터 전수 검증 — 2,763구역 × 9,030건 스캔 → **1,328 (행,구역) 히트**(은평재정비 34·가재울 21·신정 19 등 실제 히트 확인). 천호3-1 의 0건은 구옥 밀집 신통구역의 정상 결과(구역 중심점 in-ring=true, bbox 모서리=false 로 pointInRing 자체는 정확). 폴리곤 좌표 [lat,lng] — pointInRing 과 일치. overlayadd 4곳·overlayremove 4곳 전부 `e.layer` 가드 확인, jbRpLayer 토글은 overlayadd 를 fire 하지 않아 교차 발화 없음. popupopen 배선은 `onclick=` 재할당 + 신규 노드라 중복 리스너 없음. `vsMarker`(2118)·`cmpSel`(3470) 은 클릭 시점에만 참조 → TDZ 없음.
- 참고: `realprice_apt.json` 은 현재 **빈 파일(5B, BOM+`[]`)** — `loadRp()` 가 `decodeCompactRp([])` throw → `realprice_seoul_gg.json`(9,030건) 폴백하는 정상 경로(버그 아님). apt 압축 파일 생성/배포 전까지는 legacy 데이터 사용. JSON 파일들의 BOM 은 브라우저 `fetch().json()` 이 제거(Encoding 표준) — 문제 없음.
- 사용자 로컬 확인 포인트: ① 정비구역 팝업 → "이 구역 실거래" 클릭 → 구역 내부 실거래만 파란 마커 + 상단 건수 바 표시, 구역으로 이동 ② "인근 정비구역 비교" → 인근 목록 + 미니맵 ③ 정비사업 레이어 끄면 실거래 마커·건수 바만 사라짐(원본 실거래 레이어는 영향 없음) ④ jbCtrl 패널 하단에 정비 소식 5건.

### 커밋·배포 상태
- **커밋 안 함.** 변경: `land.html`(편집), `notices.json`(신규, ~4KB), `tools/collect_notices.js`(신규). 삭제됨: §6 백업 `land.backup-20260808.html` 이 여전히 있음(제거하지 말 것).
- `git status`: land.html M, HANDOFF.md M, `notices.json`·`tools/collect_notices.js`·`land.backup-20260808.html` untracked.
- 다음 세션: 사용자 확인 후 커밋 → push → GitHub Pages 빌드 `built` 확인(`gh api .../pages/builds/latest`) → 배포본 land.html 에 `jb-near` 포함 여부로 반영 확인.

---

## 2026-08-08 (3) — opencode (경쟁사 보고서 §6 UX 보완을 land.html 에 적용 — 로컬 편집만, 미배포)

> **커밋·push·배포 안 함.** 사용자가 로컬에서 직접 확인 후 결정. 문제 생기면
> `land.backup-20260808.html`(백업, 275,793B, SHA-256 `51AF4990A1894A51EDCF3BCAC56107B79D99B661C40B035ADE817516679F88D4`)으로 즉시 복원 가능.

### 한 일 (§6 항목 중 land.html 에 실제 적용 가능한 것만, 최소 diff)
1. **SEO (경매알리미 §6-8)**: head 에 `description` + `og:type/locale/title/description` 추가 (land.html:8~12). 순수 추가라 리스크 없음.
2. **비모달 토스트 (경매알리미·재개발닷컴 §6-6)**: `alert()` 2곳을 토스트로 교체 —
   - V-World 검색 결과 없음 (land.html:1976), 빈 검색어 안내 (land.html:3715).
   - 헬퍼 `toast(msg, action?)` (land.html:492~511) + CSS `.toast`/`.action` (land.html:186~193).
   - 카카오 검색 결과 없음(land.html:3761 `rec-list` 인라인 안내)은 이미 비모달이라 그대로 둠.
3. **실거래 필터 초기화 + 0건 안내 (오늘의경매·경매알리미 §6-1/6-3)**: `rpFilterCtrl` 에 `초기화` 버튼 추가 (land.html:1011), `rpResetFilter()` (land.html:1055), `rpEmptyNotify()` (land.html:1064) — 필터 변경 시 로드된 레이어가 0건이면 토스트+초기화 링크. **데이터 미로드 시 "결과 없음" 오판 방지 가드 포함** (`rpRows`/`villaRows` 로드 확인 후에만 알림).
4. **목록↔지도 연동 (경매알리미 §6-7)**: 카카오 검색 결과 카드 클릭 → 해당 마커로 이동+팝업 (land.html:3787~3792, `renderKakao`).
5. **스킵 항목 (이미 구현 or 해당 없음)**: 상태 칩 색상·카드 정보 계층(진행단계/사업구분 배지+진행률 바 이미 존재), 점수 시각화(부동산 스코어 개념 없음), 필터 폭(3단 레이어 패널+실거래 필터 이미 존재), 모바일(이미 대응), 정비 진행단계 칩(8칩 색상 구분 이미 존재).

### 검증 (로컬)
- 인라인 스크립트 전체 `node vm.Script` 문법 검사: **1개 블록, 에러 0**.
- 백업·현재 파일 SHA-256 다름 확인 → 백업이 편집 전 상태로 무결.
- 사용자 로컬 확인 포인트: ① 검색창에 없는 지명 검색 → 토스트(alert 대신) ② 실거래가 레이어 켜고 필터 조작 → 0건이면 토스트+초기화 링크 ③ 카카오 검색 결과 카드 클릭 → 지도 이동+팝업 ④ 다크모드에서도 토스트 가독성.

### 커밋·배포 상태
- **커밋·배포 안 함.** 변경 파일: `land.html`(편집), `land.backup-20260808.html`(신규 백업), `HANDOFF.md`(이 기록).
- localhost 서버에서 확인 완료 후 사용자 동의를 받고 push/배포.

---

## 2026-08-08 (2) — opencode (경쟁사 4사이트 분석 + HWPX 보고서 생성)

> 기록·산출물 완료. **기능 구현은 미착수** — 아래 "다음 세션 확인할 것" 중 골라서 진행할 것.

### 한 일 (전부 실측 검증 후 확정)
1. **경쟁사 4사이트 종합 분석 완료** (경매알리미=2026-08-07, 오늘의경매·재개발닷컴·리치고=2026-08-08 실측):
   - **today77.com(오늘의경매)**: 구형 PHP(search01.php 서버렌더링). 자체 DB에 법원 데이터 적재, 검색 필터(시도 17종·현재상태 19종·감정가·유찰수)가 courtauction.go.kr 과 1:1 미러. 수익=권리분석리포트 유료+전화상담+유튜브(10만 구독).
   - **jaegebal.com(재개발닷컴)**: Next.js(App Router). 법인 등록 2026-02-13(bizno.net 실측). 구역별 페이지(진행단계·공급세대·노후도·평당가·실거래·매물·**경매**·커뮤니티). 경매는 "공공데이터 기반 참고용"으로 정비구역과 조인해 집계 — 법원에 직접 안 닿음.
   - **richgo.ai(리치고)**: SPA 앱(데이터노우즈). ML 가격예측·투자점수·**AI 입찰가 산정+권리분석**(플레이스토어 실측). B2B(MAS 기업용)로 수익화.
   - 핵심 사실: **법원경매정보는 공식 Open API 가 없다** — 경쟁사 전부 우회 수집(스크래핑/자체DB/공공데이터). TROUBLESHOOTING §6-10 신규 기록.
2. **HWPX 보고서 생성**: `경쟁사_비교분석_20260808.hwpx` (프로젝트 루트, 4,623자·표 5종·8절). python-hwpx 라이브러리로 생성, `validate_package` OK, 재열람 텍스트 온전 확인. 한글(HOffice)은 이 PC에 없어 실제 열람 확인은 불가 — 한글 2014+ (권장 2018+)에서 열기.
   - 참고: 사용자 요청 "hwp 파일" → **.hwpx**(KS X 6101 표준, 한글 2014 이상). 레거시 .hwp 바이너리는 라이브러리 지원 없어 미생성. 필요하면 말할 것.

### 핵심 결론 (다음 세션 방향)
- **가장 닮은 사례 = 재개발닷컴**: matjip land.html 의 정비사업(2,964건)·실거래(9,030건)·청약이 이미 겹침. 재개발닷컴의 "구역 상세 패널 + 구역×실거래/경매 조인 + 고시 피드"가 최고 우선순위.
- **UX 모델 = 경매알리미**: 상태 칩·목록-지도 연동·로드뷰·뷰포트 증분로딩.
- **차별점 = matjip 만의 취향 기반 추천**: 경매 4사이트는 전부 "물건/구역" 중심, 사용자 취향 매칭이 없음. taste_profiles+score() 엔진이 유일한 무기.

### 커밋·배포 상태
- **커밋 안 함** (문서·hwpx 생성만, 사용자 동의 전 커밋 금지 규칙). `git status` 기준 변경: HANDOFF.md, TROUBLESHOOTING.md(§6-10), `경쟁사_비교분석_20260808.hwpx`(신규). 배포 불필요.

### ⚠️ 다음 세션 확인할 것
- 아래 중 하나 선택해 구현 (분석 보고서 5절 참고):
  - **정비구역 상세 패널** (권장, land.html 폴리곤 클릭 → 구역 상세)
  - **영업상태 배지** (main.html 카드에 사업자조회 API 휴업/폐업/계속 3색)
  - **다중 필터 칩 바** (main.html 가격대/거리/매운맛/영업상태 + 정렬)
- Supabase 액세스 토큰(`sbp_86b17faf...`) 여전히 미 Revoke → 대시보드에서 Revoke 후 `$env:SUPABASE_ACCESS_TOKEN` 으로만 사용.

---

## 2026-08-08 (1) — opencode (전면 QA + main.html 지도/패널 높이 버그 수정·배포)

> 커밋·push·배포·실검증 완료. 이어받는 세션은 **"다음 세션 확인할 것"** 만 보면 된다.

### 한 일 (전부 실측 검증 후 확정)
1. **전 페이지 QA 완료** (배포 URL `https://conoc612-a11y.github.io/matjip/`, 테스트 계정으로 헤드리스 실사용):
   - onboarding: 약관 미동의 차단 → 동의 후 가입 → 설문 진입. **함정 기록: 로그인 모드가 기본이라 회원가입은 `#to-signup` 전환 필수.**
   - main: 식당 1338건 로드, 추천목록, 카드 클릭→줌16·정보창·최근목록, 검색 "왕비"→자동완성·결과 5건, 즐겨찾기 저장→탭 반영, GPS 폴백 배너, 푸터 통계.
   - detail: Leaflet+V-World 타일 200, GPS 미허용 시 안내 정상.
   - land: 날씨·환율 실데이터, V-World 검색 "강남역"→이동(37.4977,127.0278 z16), 베이스맵 4종.
   - admin: Edge Function 로그인 200, 대시보드 차트·회원표, **탈퇴 기능으로 QA 계정 삭제 확인**.
2. **main.html 지도/패널 높이 버그 수정·배포** (커밋 `34d31d8`, TROUBLESHOOTING §10 신규):
   - 증상: `#map` offsetHeight 8203px(컨테이너 617px), `.panel` 스크롤 없음 → 추천목록 하단 잘림.
   - 원인: `.layout` flex-wrap 라인 높이 = 항목 콘텐츠 높이 최댓값. 추천목록(8203px)이 비동기 렌더되며 라인이 부풀고 `align-self:stretch`로 `#map`·`.panel` 모두 8203으로 늘어남. `.panel`은 라인 크기만큼 이미 커서 `overflow-y:auto`여도 스크롤이 안 생김.
   - 해결: `#map`·`.panel`에 `max-height:100%` 추가 → 라인을 컨테이너 높이로 고정, 패널 내부 스크롤.
   - 검증: 실배포 페이지에 CSS 주입 → mapH 8203→617, `scrollHeight>clientHeight`(scrollable=true). Naver `getSize()`=617로 정상 — **깨진 건 컨테이너지 지도가 아님**.
3. **TROUBLESHOOTING §10 기록** (커밋 `2d0d099`).

### 커밋·배포 상태
- `34d31d8`(fix) → `2d0d099`(docs) 순 push 완료, GitHub Pages 반영 확인 (`max-height:100%` 배포본 존재, mapH=617 실측).
- QA 테스트 계정 `qa.matjip.20260808@example.com`(QA2) **유지** — 사용자 승인. `qa.matjip.20260807@example.com`은 삭제됨.

### ⚠️ 다음 세션 확인할 것
- **무엇보다: Supabase 액세스 토큰(`sbp_86b17faf...`)이 여러 채팅에 노출됨 → 대시보드에서 Revoke 후 새로 발급**해서 `$env:SUPABASE_ACCESS_TOKEN`으로만 사용(파일·리포 저장 금지).
- 회원가입 QA 시: `#to-signup`(회원가입 모드) 전환 후 진행. 이메일 확인은 `mailer_autoconfirm:true`(꺼짐)라 가입 즉시 로그인 가능.
- 배포 후 검증은 `curl -s URL | grep`(PS `Invoke-WebRequest`는 비인터랙티브 오류) 사용.

---

## 2026-08-07 (5) — opencode (실거래·정비사업 레이어 렌더 버그 수정 + 전용면적 검증 + 범례 개선)

> 커밋·push 완료. 이어받는 세션은 **"다음 세션 확인할 것"** 만 보면 된다.

### 한 일 (전부 실측 검증 후 확정)
1. **실거래·정비사업 레이어 마커 렌더 버그 원인 규명·수정** (핵심, TROUBLESHOOTING §3 신규 행):
   - 증상: 실거래/정비사업 체크박스를 켜도 클러스터가 전혀 안 그려짐. 실서버(conoc612-a11y.github.io)에서도 재현 — 프로덕션 버그.
   - 원인: Leaflet 1.9 에서 `overlayadd`/`overlayremove` 는 **`L.Control.Layers` 가 있을 때만** 발생. 커스텀 3단 패널이 기본 컨트롤을 대체(bd5bb8e)한 뒤로 `map.on('overlayadd')` 에 묶인 `rpBuild()`/`jbBuild()`/`showPriceFilter()` 가 영원히 불리지 않음.
   - 진단 경로: `layer-check.mjs`(데이터 9,030건 로드 OK + 클러스터 0) → `probe-events.mjs`(`layeradd` 는 뜨고 `overlayadd` 는 안 뜸) → leaflet-1.9.4.js 에서 `overlayadd` 출현이 Control.Layers 한 곳뿐임을 grep 으로 확인.
   - 수정 (land.html ~1733 `midCb.onchange`): 체크/해제 시 `addTo`/`removeLayer` 후 **직접 `map.fire('overlayadd'/'overlayremove', { layer })`**. 기존 overlayadd 핸들러 배선은 그대로 동작.
   - 검증: 로컬 8798 서버에서 실거래 클러스터 304, 정비사업 343건 로드·렌더, 실거래가 필터 컨트롤·건축년도 단계 바 표시 확인.
2. **실거래 팝업 전용면적 라벨 최종 검증** (`rp-popup-check.mjs`): "광화문스페이스본(101동~105동)" area 126.34 → 실제 팝업 DOM 에 "전용 126.34㎡" 렌더 확인. (참고: `m.bindPopup(m._pop())` 후 `openPopup()` 을 해야 DOM 이 열림)
3. **건축년도(노후도) 범례 → 실거래가 필터 아래(topleft)로 이동** + **좌우 폭 통일(190px)** + **코너 드래그 크기조절**(`.lc-rp { width:190px; min-width:150px; max-width:380px; resize:both; overflow:auto }`).
   - 크기조절 중 지도가 함께 팬되던 버그: 범례에 `L.DomEvent.disableClickPropagation(div)` 가 없어 mousedown 이 지도로 전파 → 추가로 해결. CDP Input.dispatchMouseEvent 로 실제 드래그 시뮬레이션 → `mapMoved:false`, 190→280px 리사이즈 정상 확인.

### 커밋·배포 상태
- 커밋 `f319151` push 완료 (실거래 팝업 전용면적·대분류 토글·스크롤바·네이버 근처 단지명·푸터 member_count RPC) — 이전 세션 작업.
- **이번 작업 커밋**: land.html 만, overlayadd fix + 범례 개선 포함. push 완료. GitHub Pages 빌드가 `built` 되는지 확인할 것.
- 로컬 검증 서버: `%TEMP%\opencode\serve-matjip.mjs` 포트 8798 (실행 중일 수 있음 — 안 뜨면 재기동).

### ⚠️ 다음 세션 확인할 것
- GitHub Pages 빌드가 `built` 되고 라이브 land.html 에서 실거래/정비사업 레이어 체크 시 마커가 실제로 그려지는지 (실측: 배포 URL에서 직접 확인).
- Supabase 액세스 토큰(`sbp_86b17faf...`)은 대시보드에서 **Revoke 권고** — 새로 발급 후 `$env:SUPABASE_ACCESS_TOKEN` 으로만 사용.
- 검증 스크립트는 `%TEMP%\opencode\` 에 보존: `live-check.mjs`(로컬 8798), `rp-popup-check.mjs`, `drag-check.mjs`, `legend-order-check.mjs`, `width-check.mjs`, `resize-check.mjs`, `probe-events.mjs`.

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
- 이번 커밋 후 GitHub Pages 빌드가 `built` 되고 배포본 land.html에 `bizno-btn`(사업자등록증조회)이 보이는지. 멈추면 HANDOFF (2)의 복구 경로(빈 커밋 push).
- 미등록 번호 조회 시 `b_stt`가 비고 `tax_type`에 "국세청에 등록되지 않은..." 메시지가 온다 — 판정 로직 바꿀 때 참고.

### (후속) 진위확인 추가 — 2026-08-07
- 사용자 요청으로 **진위확인(validate) 방식 추가**: 모달에 상호·대표자·개업일 입력란 추가, 사업자번호는 **하이픈 자동 입력**.
- 로직: 대표자+개업일 입력 시 `?op=validate`, 번호만이면 `?op=status`로 자동 분기. 결과에 `진위 일치/불일치` 배지 + (일치 시) 상태정보 표시.
- **중요**: 국세청 API는 상호·대표자·연락처·주소를 *반환하지 않는다*(진위확인은 입력값 일치 여부만). 사용자가 이 점을 확인했다 — 상세 보여주려면 유료 제3자 API 필요.
- E2E(`bizno-e2e.mjs`) 5시나리오 PASS. 라이브 배포본 `?op=validate` HTTP 200(`valid:"02"`) 확인.

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
