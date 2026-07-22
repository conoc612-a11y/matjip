# 맛집 탐방 🍜

서울 맛집을 취향 기반으로 추천받고, 지도와 길찾기로 찾아가는 웹 서비스. (모두연 캠프 MVP)

## 화면 (3개)
- `index.html` → `onboarding.html` : 로그인/회원가입 + 취향 온보딩 설문 → `taste_profiles` 저장
- `main.html` : 지도(Leaflet + V-World/OSM) + 취향 기반 규칙 추천 리스트 + 저장
- `detail.html` : 맛집 상세 + 저장/관심 + 현재위치(GPS) → 대중교통/도보/자차 길찾기

## 기술
- **DB/인증**: Supabase (Postgres + Auth 이메일 검증), RLS로 본인 데이터만 접근
- **지도**: Leaflet + V-World 타일 (키 없으면 OSM 자동 대체)
- **길찾기**: 구글맵/카카오맵 딥링크 (대중교통·도보·자차)
- **프론트**: 정적 HTML/JS, 빌드 도구 없음 · GitHub Pages 배포

## DB (5테이블)
`profiles`(auth 확장) · `taste_profiles` · `mj_restaurants` · `saved_restaurants` · `feedbacks`
스키마·RLS·시드는 `schema.sql` (Supabase SQL Editor에서 실행).

## 로컬 실행
정적 파일이라 브라우저로 `index.html`을 열면 됩니다.
(GPS·V-World 지도는 https/localhost에서 동작 — 배포 환경 권장)

## 설정 메모
- V-World 지도: `main.html`/`detail.html`의 `VWORLD_KEY`에 vworld.kr 발급 키 입력(도메인 등록 필요).
- 이메일 검증: 배포 후 Supabase Authentication에서 Confirm email ON + Site URL을 배포 주소로 설정.
- 클라이언트에 노출된 키는 publishable(anon) 키로 공개 안전 — 접근 제어는 RLS가 담당.
