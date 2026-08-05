# HANDOFF — 다른 AI/세션이 이어받을 때 읽는 파일

이 파일은 작업이 끝날 때마다 갱신한다. 새 세션(다른 AI 포함)은 여기부터 읽고 `git log -3`, `git status`로 교차 확인할 것.

---

## 2026-08-05 (저녁) — Claude Code

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
