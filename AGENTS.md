# AGENTS.md

## What this is

Static HTML/JS Seoul restaurant finder. No build tools, no bundler, no framework. Supabase backend (Auth + Postgres + RLS). Deployed on GitHub Pages.

## Project structure

- `index.html` → redirects to `onboarding.html`
- `onboarding.html` — login/signup + taste survey → saves to `taste_profiles`
- `main.html` — Leaflet map (V-World tiles, OSM fallback) + rule-based recommendations
- `detail.html` — restaurant detail + directions (Google Maps / Kakao deep links)
- `schema.sql` — all 5 tables, RLS policies, trigger, seed data (run in Supabase SQL Editor)
- `seed_more.sql` — 24 additional seed restaurants (safe to re-run)
- `mcp/` — MCP server (Node.js ESM, has own `package.json`)
- `js/recommend.js` — browser용 공유 추천 로직 (`<script src="js/recommend.js">`로 포함)
- `tools/recommend.js` — Node.js용 공유 추천 로직 (CommonJS, canonical; mcp/server.js가 import)
- `tools/matjip-cli.js` — CLI for recommendations

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

## Multi-engine search (네이버 / 카카오 / Google / V-World)

- **main.html**: 검색창 아래 엔진 선택 버튼(네이버·카카오·구글)으로 전환 가능. Enter 또는 자동완성의 '검색' 항목 클릭 시 선택된 엔진으로 검색.
- **land.html**: V-World·카카오·구글 중 선택. 주소·지명 검색에 사용.
- **네이버**: Supabase Edge Function(`quick-handler`) 프록시 경유, `main.html` 전용.
- **카카오**: `kakao.maps.services.Places.keywordSearch()` 직접 호출. `main.html`·`land.html`·`ai.html`에서 사용.
- **Google**: Places API (New) `POST /v1/places:searchText` 직접 호출. `GOOGLE_PLACES_KEY`가 설정되어 있어야 활성화.
- **V-World**: `land.html` 기본 검색 — JSONP로 CORS 우회, 주소/지명 검색.

검색 결과는 `mj_restaurants`에 저장 가능. 동일 이름 있으면 기존 row 연결, 없으면 새 row 생성.

## Deployment

GitHub Pages (static files). After deploy, set Supabase Authentication → Confirm email ON + Site URL to deployment URL. V-World map key requires domain registration at vworld.kr.
