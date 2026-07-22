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
- `tools/recommend.js` — shared recommend logic (CommonJS, zero dependencies)
- `tools/matjip-cli.js` — CLI for recommendations

## Key gotchas

- **Table name is `mj_restaurants`**, not `restaurants`. Name chosen to avoid collision with an existing table in the Supabase project.
- **Module systems differ**: `tools/recommend.js` is CommonJS (`require`/`module.exports`), `mcp/server.js` is ESM (`import`). Do not mix.
- **Recommend logic is duplicated** between `tools/recommend.js` and `mcp/server.js`. Keep them in sync if changing scoring rules.
- **Local dev**: open `index.html` directly in browser works, but GPS, V-World tiles, and Supabase Auth require HTTPS or localhost. Use a local server if testing those features.
- **No build, lint, typecheck, or test commands exist.** There is no CI.
- **Supabase anon key is embedded** in HTML files, `tools/recommend.js`, and `mcp/server.js`. It is a publishable key — security is handled by RLS, not by hiding the key.

## Recommendation system

Rule-based scoring: tag overlap × 2 points, plus spicy-level bonus. Implemented in `tools/recommend.js:13` (canonical) and duplicated in `mcp/server.js:16`.

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

## Kakao real-time search

`main.html` has a Kakao REST API integration for searching real restaurants. Set `KAKAO_REST_KEY` in `main.html:75` to enable. Uses `/v2/local/search/keyword.json` (FD6 category = food). No domain registration needed — just a REST API key from developers.kakao.com.

Search results can be saved to `mj_restaurants` directly from the UI. If the restaurant name already exists, it links to the existing row; otherwise it inserts a new row with empty tags.

## Deployment

GitHub Pages (static files). After deploy, set Supabase Authentication → Confirm email ON + Site URL to deployment URL. V-World map key requires domain registration at vworld.kr.
