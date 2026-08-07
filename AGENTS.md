# AGENTS.md

> **읽는 순서 (다른 AI / opencode 포함)**
> 1. 이 파일 — 프로젝트 구조와 규칙
> 2. **[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — 반복해서 터진 버그와 해결법. 코드 만지기 전에 반드시 볼 것.**
>    (Leaflet 팝업/레이어 함정, localhost 키 제약, UPIS·ITS·수출입은행 API 함정, 배포·검증 방법)
> 3. [`HANDOFF.md`](HANDOFF.md) — 직전 세션이 어디까지 했고 무엇이 남았는지
> 4. `git log -5`, `git status` 로 교차 확인

## 작업 규칙 (모든 AI 공통 — 사용자 지시)

- **응답은 반드시 존댓말**로 한다.
- **주장에는 출처와 근거를 명시**한다: 실측 값·파일 경로·줄 번호·커밋 해시·공식 문서 URL. "~한 것 같다"는 추측일 뿐 근거가 아니다. 검증 없이 확정으로 말하지 말 것.
- **버그/오류/함정은 [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)에 기록**한다: 증상 → 원인 → 해결 → 검증 순으로, 실측 근거를 붙여서. 수정 커밋과 함께 문서화한다.
- **세션을 끝낼 때마다 [`HANDOFF.md`](HANDOFF.md)를 갱신**한다: 한 일(근거 포함)·커밋/배포 상태·"다음 세션 확인할 것". 다른 AI(Claude/opencode 등)가 바로 이어갈 수 있어야 한다.
- **커밋·push·Edge Function 배포는 반드시 사용자 동의 후 진행**한다. 로컬 편집까지만 하고, 배포 단계에서 먼저 확인을 구한다.

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
