# 맛집 탐방 — PRD / MVP

## 1. 개요
서울 지역 사용자가 맛집을 추천받거나 기존 맛집 정보를 저장하고, 지도와 대중교통/도보/자차 길찾기로 찾아가는 웹 서비스.

## 2. 과제 요구사항
- 프론트엔드 화면 2개 이상 → 온보딩 / 메인(지도+추천) / 상세·길찾기 (3개)
- 백엔드 API → 자체 REST API + 지도/공공교통/대중교통 길찾기 API 연동
- DB 연동 → 5개 테이블 CRUD, 저장·조회 흐름
- 배포 → 클라우드 배포 + MCP/Skill/AI 추천 확장 시도

## 3. 핵심 기능 (MVP)
1. 취향 온보딩 설문 → 취향 프로필 저장
2. 취향 + 위치 기반 맛집 추천
3. 맛집 저장 및 지도 표시
4. 현재 위치(GPS) → 맛집 길찾기 (대중교통/도보/자차)

## 4. 프론트엔드 (화면 3개)
1. 온보딩(취향 입력) — 취향 설문 → 서버 저장
2. 메인(지도+추천) — 지도에 추천/저장 맛집 표시, 추천 리스트
3. 상세/길찾기 — 맛집 상세, 저장 버튼, 길찾기

## 5. 백엔드 API
자체 REST API:
- `POST /api/taste` — 취향 프로필 저장
- `GET  /api/recommend` — 취향+위치 기반 추천 목록
- `POST /api/saved` — 맛집 저장
- `GET  /api/saved` — 저장 맛집 조회

외부 API(후보):
- 지도 렌더링: 서울시 공공 지도
- 공공 교통정보: data.go.kr, 서울 열린데이터광장
- 대중교통 길찾기: ODsay OPEN API
- 식당 검색 : 카카오 실시간 장소검색

## 6. DB (5테이블)
- `profiles` (auth.users 확장): id, email, created_at
- `taste_profiles`: user_id(FK), spicy_level, flavor_tags, situation_tags
- `restaurants`: name, address, lat, lng, category, tags
- `saved_restaurants`: user_id(FK), restaurant_id(FK), memo, rating
- `feedbacks`: user_id(FK), restaurant_id(FK), action, created_at

인증/인가: Supabase Auth(이메일+비번+이메일 검증), RLS로 본인 데이터만 접근.
추천 로직(초기): 취향 태그 ↔ 맛집 태그 가중치 매칭(규칙 기반).

## 7. 배포 & AI 확장
- 클라우드 배포로 실제 접근 가능한 서비스
- AI: 자연어 취향 입력 → 추천 (LLM)
- MCP: 맛집·취향 데이터를 MCP로 노출
- Skill: 추천 워크플로우(취향 조회 → 매칭 → 근거 생성) 패키징

## 8. 빌드 순서
1. **DB 스키마 + RLS** ← 현재 단계 (`schema.sql`)
2. Auth + 온보딩 화면 → taste_profiles 저장
3. 메인: Kakao 지도 + 규칙기반 추천
4. 상세/길찾기: 저장 + ODsay/Kakao 길찾기
5. 배포 + AI/MCP/Skill 확장
