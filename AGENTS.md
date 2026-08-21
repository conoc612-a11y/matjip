# AGENTS.md

> **읽는 순서 (다른 AI / opencode 포함)**
> 1. 이 파일 — 프로젝트 구조와 규칙
> 2. 🔒 **[`LOCKED_POPUP_SPEC.md`](LOCKED_POPUP_SPEC.md) — 팝업을 건드리기 전에 무조건 먼저.**
> 3. **[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — 반복해서 터진 버그와 해결법. 코드 만지기 전에 반드시 볼 것.**
>    (Leaflet 팝업/레이어 함정, localhost 키 제약, UPIS·ITS·수출입은행 API 함정, 배포·검증 방법)
> 4. [`HANDOFF.md`](HANDOFF.md) — 직전 세션이 어디까지 했고 무엇이 남았는지
> 5. 📋 **[`TODO.md`](TODO.md) — 보류된 과제와 외부 문의 대기 항목.**
>    "이거 왜 안 돼 있지?" 싶으면 여기를 먼저 볼 것. **이미 조사가 끝나 불가로 판정된 것**이
>    있으니(예: 감정평가서 PDF → `TROUBLESHOOTING.md` §47) 같은 조사를 되풀이하지 말 것.
> 6. `git log -5`, `git status` 로 교차 확인
>
> ✅ **검증 완료 기준점 = 태그 `stable-20260821`** (2026-08-21 사용자가 전 기능 정상 확인).
> **무언가 깨졌으면 추측하기 전에 먼저 `git diff stable-20260821 --stat` 으로 그때와 무엇이
> 달라졌는지 보라.** 되돌릴 때도 전체 reset 이 아니라
> `git checkout stable-20260821 -- <파일>` 처럼 필요한 만큼만. 상세는 `HANDOFF.md` 맨 위.
> (해시가 아니라 **태그 이름**을 쓸 것 — 이 저장소는 히스토리 재작성으로 옛 해시가 죽은 적이 있다.)

## 🔒 LOCKED 영역 — 확정본이 있는 주제 (2026-08-20 신설)

이 프로젝트에서 **같은 문제로 3회 이상 재작업된 주제**들이 있다. 사용자가 이걸 명시적으로
문제 삼았다: *"기존 기록들 확인하다가 예전에 잘못된 코드를 인식해서 문제 해결이 안되고
새로 코드짜고 수정하고 무한 반복하는 경우가 있어."*

그래서 **확정된 코드를 그대로 담은 정본 파일**을 둔다. 규칙은 셋뿐이다:

1. **LOCKED 파일이 다른 모든 기록보다 우선한다.** `TROUBLESHOOTING.md`·`HANDOFF.md`·코드 주석·
   `land.backup-*.html` 과 어긋나면 **LOCKED 가 맞다.** 다른 문서에는 기각된 접근법이 섞여 있다.
2. **"⛔ 기각됨"/"⛔ 대체됨" 표시가 붙은 절의 해결책은 복원하지 않는다.** 그 절들은 구현 코드를
   의도적으로 삭제해 뒀다 — 베끼면 현재 코드가 깨진다.
3. **사용자가 "원래대로 복원해줘"라고 하면** LOCKED 파일의 코드 블록을 그대로 되돌려 넣는다.
   새로 설계하지 말 것. 새 해법을 시도하기 전에 LOCKED 의 "하지 말 것" 목록에 있는지 확인한다.

| 주제 | 정본 | 상태 |
|---|---|---|
| 팝업 위치·크기·줌 비례 축소 | [`LOCKED_POPUP_SPEC.md`](LOCKED_POPUP_SPEC.md) §1~2 | 2026-08-20 사용자 확인 |
| 지도 드래그 ↔ 클릭 구분 | [`LOCKED_POPUP_SPEC.md`](LOCKED_POPUP_SPEC.md) §2 BLOCK-E | 2026-08-20 사용자 확인 |
| 팝업 닫기(×)/접기(−) 버튼 위치 | [`LOCKED_POPUP_SPEC.md`](LOCKED_POPUP_SPEC.md) §6 | 2026-08-20 사용자 확인 |
| 팝업 스크롤바·리사이즈 그립 겹침 | [`LOCKED_POPUP_SPEC.md`](LOCKED_POPUP_SPEC.md) §6 | 2026-08-20 사용자 확인 |
| 경매 사진 저장 위치(R2) | `TROUBLESHOOTING.md` §41 | 2026-08-20 검증 |

**팝업 z-index 3단 순서는 이것 하나뿐이다** (하나만 바꿔도 과거 버그가 재발):

```
.lp-body (1000)  <  .leaflet-popup-pane (1200)  <  .ctl-row (1300)
```

## 작업 규칙 (모든 AI 공통 — 사용자 지시)

- **응답은 반드시 존댓말**로 한다.
- **주장에는 출처와 근거를 명시**한다: 실측 값·파일 경로·줄 번호·커밋 해시·공식 문서 URL. "~한 것 같다"는 추측일 뿐 근거가 아니다. 검증 없이 확정으로 말하지 말 것.
- **버그/오류/함정은 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)에 기록**한다: 증상 → 원인 → 해결 → 검증 순으로, 실측 근거를 붙여서. 수정 커밋과 함께 문서화한다.
- **기록할 때 "무엇"만 남기지 말고 결정 사유(WHY)를 한 줄 붙인다.** "이렇게 했다"가 "왜 이렇게 했는지"보다 우세하면 나중에 방향 전환 시점을 놓친다. HANDOFF·TROUBLESHOOTING·커밋 메시지 모두 해당.
- **성공/실패 기준이 없으면 먼저 확인**한다: "이걸 해주고, 성공이면 A가 보여야 해" 형태가 재작업을 반으로 줄인다. 사용자 지시에 성공/실패 기준이 빠져 있으면, 실행 전에 "성공 기준으로 B를 잡으면 될까요?"처럼 한 줄 제안하고 시작한다.
- **세션을 끝낼 때마다 [`HANDOFF.md`](HANDOFF.md)를 갱신**한다: 한 일(근거 포함)·커밋/배포 상태·"다음 세션 확인할 것". 다른 AI(Claude/opencode 등)가 바로 이어갈 수 있어야 한다.
- **커밋·push·Edge Function 배포는 반드시 사용자 동의 후 진행**한다. 로컬 편집까지만 하고, 배포 단계에서 먼저 확인을 구한다.

## 사용자 프로필 (질문 스타일 — 이 프로젝트 사용자 전용, 2026-08-08 기록)

**유형**: "AI를 집행자로 쓰는 게 아니라 동료 체계로 구축"하는 사용자 — 짧은 지시 + 높은 신뢰 + 근거 강제 + 운영 안전장치 설계.

**소통 패턴**:
- 지시는 극단적 단문("웅", "잡고싶어", "굿굿"). 최소 정보만 주고 판단·실행은 AI에 위임.
- "어떻게"는 묻지 않고 "무엇"만 지정. 기술 해법은 AI 몫.
- 근거·출처를 엄격히 요구: 실측 값·파일 경로·줄 번호·커밋 해시·공식 문서. "~한 것 같다"는 근거가 아님.
- 커밋·push·Edge Function 배포는 반드시 동의 후. 세션마다 HANDOFF/TROUBLESHOOTING 갱신을 요구(지식 휘발 방지).

**이 사용자에게 질문할 때 (재질문 가이드)**:
1. 선택지는 **2~4개, 추천안을 첫 번째**로. (그는 보통 추천안을 선택함)
2. 개방형("어떻게 할까요?") 금지 — **구체적 선택지**로만.
3. 지시가 짧아 문맥이 부족할 수 있음을 인지 — 방향 오판 전에 **필요한 최소 문맥 1가지를 질문 하나로 보충**한다. 방향이 틀리면 뒤집기 비용이 큰 편이라 초반 1분 설명이 아껴줌.
4. 질문 문구는 **그가 자신의 패턴을 알아보도록** 구성: "당신의 단문 결정 패턴대로 → A 아니면 B?" 식.
5. 성공/실패 기준이 안 보이면 그 기준부터 확인.

**인간적 유형 (2026-08-08 대화 분석 — 추론은 확신처럼 쓰지 말 것)**:
- 확실한 관찰 근거: 언어 극단적 경제성(단문 지시·승인), 위임 후 간섭 없음, 근거·출처 강제, 안전장치(배포 동의·시크릿 경계) 직접 설계, 지식 보존 집착(HANDOFF·TROUBLESHOOTING), Claude Code+opencode 교차 운용, 복수 프로젝트.
- 유형 판단: **"시스템 구축자"** — 결과물보다 그걸 낳는 체계에 투자. 신뢰-검증 이중 구조(권한은 크게 주되 근거·배포 게이트로 확인). 단문은 무례가 아니라 비용 절감. 지식 휘발을 공포로 여김. 권한 경계의식 = 책임 소재 명확화. "~한 것 같다"를 용납 안 함 = 판단의 근거 중시(감리/품질책임 성향).
- 가능성(약한 근거): 독립 작업자 성향, 어느 정도 내향적일 가능성, 근거 기반 판단 직군(정확성·감사·법률·품질·투자 심사) 가능성, 메타인지 높고 자기개선에 개방적.
- 위험 지점: ① 단문 지시가 추측→재작업 유발(문맥 1줄 추가가 아껴줌) ② 문서화가 자기 방어막이 되어 유연성 저하 위험 ③ 근거 요구가 창의적 브레인스토밍에선 발목일 수 있음 — 그 상황에선 근거 요구를 내려놓을 줄 알아야 함.

## What this is

Static HTML/JS Seoul restaurant finder. No build tools, no bundler, no framework. Supabase backend (Auth + Postgres + RLS). Deployed on GitHub Pages.

## Project structure

- `index.html` → redirects to `onboarding.html`
- `onboarding.html` — login/signup + taste survey → saves to `taste_profiles`
- `main.html` — Naver map + rule-based recommendations. App logic는 `js/main.js`가 담당
- `js/main.js` — main.html 전용 앱 로직 (섹션별 정리: 검색·추천·클러스터링·정비사업)
- `detail.html` — restaurant detail + in-app directions (대중교통=ODsay, 도보/자차=OSRM, Kakao deep link)
- `schema.sql` — all 5 tables, RLS policies, trigger, seed data (run in Supabase SQL Editor)
- `seed_more.sql` — 24 additional seed restaurants (safe to re-run)
- `mcp/` — MCP server (Node.js ESM, has own `package.json`)
- `js/recommend.js` — browser용 공유 추천 로직 (`<script src="js/recommend.js">`로 포함)
- `tools/recommend.js` — Node.js용 공유 추천 로직 (CommonJS, canonical; mcp/server.js가 import). 점수 로직 변경 시 양쪽 동기화 필요
- `tools/matjip-cli.js` — CLI for recommendations
- `tools/collect_notices.js` — SH공사 공고 RSS(EUC-KR) → `notices.json` 정적 생성. `node tools/collect_notices.js` 재실행 시 갱신. land.html의 '정비 관련 새 소식' 피드(#jb-notices)가 이 JSON을 fetch (브라우저 CORS 우회용)

## main.html 성능/구조 요점

- **클러스터링은 커스텀(뷰포트 기반)** — 네이버 MarkerClustering 대신 `js/main.js`의 `buildClusters()`가 현재 화면 범위(+1셀 여유)의 식당만 격자 버킷으로 묶어 마커를 만든다. 팬/줌 idle 시에만 갱신. 클러스터 클릭 시 줌인 + 내부 식당 목록 팝업(`openClusterList`) — 같은 건물(동일 좌표) 식당은 확대만으론 분리되지 않으므로 목록으로 개별 접근. (정비사업 기능은 2026-08-07 삭제)
- **render() 캐시** — 쿼리·탭·카테고리·지도중심·취향·즐겨찾기가 모두 같으면 재렌더 생략. `savedIds` 변경 시 `savedRev++`. 점수는 전체 계산(Set 캐시)하되 **거리 hav()는 표시할 상위 50곳만** 계산.
- **검색 인덱스** — `buildRestIndex()`가 소문자 검색 문자열을 1회 생성. 입력 시 1,300건 join/소문자 변환 반복 제거.
- **지도 점프 방지** — 검색어 입력 중엔 지도를 움직이지 않음. 이동은 Enter/자동완성 선택/카드 클릭/GPS에서만.
- **데이터 로드 병렬화** — 식당 페이지네이션(2페이지씩), 사용자 취향·즐겨찾기, 푸터 통계 3종을 Promise.all(Settled)로 동시 조회. 검색결과 저장 시 전체 재조회 대신 새 행만 append.

## Key gotchas

> 아래는 코드 구조에 관한 것이고, **실제로 자주 터진 런타임 버그·API 함정은
> [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) 에 따로 정리돼 있다.**

- **Table name is `mj_restaurants`**, not `restaurants`. Name chosen to avoid collision with an existing table in the Supabase project.
- **Module systems differ**: `tools/recommend.js` is CommonJS (`require`/`module.exports`). `mcp/server.js` is ESM (`import`) and imports `score`/`fetchRestaurants` from `tools/recommend.js`.
- **Browser scoring logic** lives in `js/recommend.js` (`window.score()`), included via `<script>`. All 3 HTML files (main, ai, land) use it.
- **Canonical version** is `tools/recommend.js`. If changing scoring rules, update it and mirror to `js/recommend.js`.
- **Local dev**: open `index.html` directly in browser works, but GPS, V-World tiles, and Supabase Auth require HTTPS or localhost. Use a local server if testing those features.
- **No build, lint, typecheck, or test commands exist.** There is no CI.
- **Supabase anon key is embedded** in HTML files, `tools/recommend.js`, and `mcp/server.js`. It is a publishable key — security is handled by RLS, not by hiding the key.
- **land.html 은 커스텀 레이어 패널을 쓴다** (`L.Control.Layers` 없음). Leaflet 1.9 는 `overlayadd`/`overlayremove` 를 기본 컨트롤이 있을 때만 fire 하므로, 레이어를 켜고 끄는 코드는 `map.fire('overlayadd'/'overlayremove', { layer })` 를 직접 호출해야 한다 (TROUBLESHOOTING §3). 커스텀 컨트롤에는 `L.DomEvent.disableClickPropagation` 도 필수.
- **API keys live in `keys.env`** (gitignored). V-World/Kakao/Naver/ODsay frontend keys are domain-locked publishable keys — they must stay in HTML (tiles/SDK/JSONP need them in URL), keep their domains registered. data.go.kr serviceKeys and Naver client secret are **server-only** — route through Supabase Edge Functions (`molit-proxy`, `naver-search`); never hardcode them into HTML (see `land.html` SUBSCRIPTION_API_KEY guard).

## Recommendation system

Rule-based scoring: tag overlap × 2 points, plus spicy-level bonus. Canonical in `tools/recommend.js`, mirrored to `js/recommend.js` for browser use. MCP server imports from `tools/recommend.js`.

CLI usage:
```
node tools/matjip-cli.js list
node tools/matjip-cli.js recommend --spicy 4 --flavors 매콤,단짠 --situations 회식 [--limit 5]
```

## DB schema

5 tables in `schema.sql`: `profiles`, `taste_profiles`, `mj_restaurants`, `saved_restaurants`, `feedbacks`. All have RLS enabled. Auth trigger auto-creates profile row on signup.

## MCP server

```
cd mcp && npm install && node server.js
```

Tools: `list_restaurants`, `recommend(spicy_level, flavor_tags[], situation_tags[])`.

## Multi-engine search (네이버 / 카카오 / V-World)

- **main.html**: 검색창 아래 엔진 선택 버튼(네이버·카카오)으로 전환 가능. Enter 또는 자동완성의 '검색' 항목 클릭 시 선택된 엔진으로 검색.
- **land.html**: V-World·카카오 중 선택. 주소·지명 검색에 사용.
- **네이버**: Supabase Edge Function(`quick-handler`) 프록시 경유, `main.html` 전용.
- **카카오**: `kakao.maps.services.Places.keywordSearch()` 직접 호출. `main.html`·`land.html`·`ai.html`에서 사용.
- **V-World**: `land.html` 기본 검색 — JSONP로 CORS 우회, 주소/지명 검색.

검색 결과는 `mj_restaurants`에 저장 가능. 동일 이름 있으면 기존 row 연결, 없으면 새 row 생성.

## Deployment

GitHub Pages (static files). After deploy, set Supabase Authentication → Confirm email ON + Site URL to deployment URL. V-World map key requires domain registration at vworld.kr.

> **커밋·push·Edge Function 배포는 반드시 사용자 동의를 받은 뒤 진행할 것** (2026-08-07). 사용자가 앞으로 계속 수정할 예정이므로, 변경만 해 두고 push/배포 단계에서 먼저 확인을 구한다.
