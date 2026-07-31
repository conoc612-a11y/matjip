# AGENTS.md

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

- **클러스터링은 커스텀(뷰포트 기반)** — 네이버 MarkerClustering 대신 `js/main.js`의 `buildClusters()`가 현재 화면 범위(+1셀 여유)의 식당만 격자 버킷으로 묶어 마커를 만든다. 팬/줌 idle 시에만 갱신. 정비사업은 MarkerClustering 유지.
- **render() 캐시** — 쿼리·탭·카테고리·지도중심·취향·즐겨찾기가 모두 같으면 재렌더 생략. `savedIds` 변경 시 `savedRev++`. 점수는 전체 계산(Set 캐시)하되 **거리 hav()는 표시할 상위 50곳만** 계산.
- **검색 인덱스** — `buildRestIndex()`가 소문자 검색 문자열을 1회 생성. 입력 시 1,300건 join/소문자 변환 반복 제거.
- **지도 점프 방지** — 검색어 입력 중엔 지도를 움직이지 않음. 이동은 Enter/자동완성 선택/카드 클릭/GPS에서만.
- **데이터 로드 병렬화** — 식당 페이지네이션(2페이지씩), 사용자 취향·즐겨찾기, 푸터 통계 3종을 Promise.all(Settled)로 동시 조회. 검색결과 저장 시 전체 재조회 대신 새 행만 append.

## Key gotchas

- **Table name is `mj_restaurants`**, not `restaurants`. Name chosen to avoid collision with an existing table in the Supabase project.
- **Module systems differ**: `tools/recommend.js` is CommonJS (`require`/`module.exports`). `mcp/server.js` is ESM (`import`) and imports `score`/`fetchRestaurants` from `tools/recommend.js`.
- **Browser scoring logic** lives in `js/recommend.js` (`window.score()`), included via `<script>`. All 3 HTML files (main, ai, land) use it.
- **Canonical version** is `tools/recommend.js`. If changing scoring rules, update it and mirror to `js/recommend.js`.
- **Local dev**: open `index.html` directly in browser works, but GPS, V-World tiles, and Supabase Auth require HTTPS or localhost. Use a local server if testing those features.
- **No build, lint, typecheck, or test commands exist.** There is no CI.
- **Supabase anon key is embedded** in HTML files, `tools/recommend.js`, and `mcp/server.js`. It is a publishable key — security is handled by RLS, not by hiding the key.

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
