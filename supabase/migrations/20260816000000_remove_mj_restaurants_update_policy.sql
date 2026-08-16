-- 2026-08-16 보안 조치: mj_restaurants update 정책 제거
--
-- 기존 정책 "mj_restaurants update auth"(using(true) with check(true))는
-- 로그인한 누구나 전 행(이름·주소·좌표·태그)을 변조할 수 있었다.
-- 프론트(ai.html/main.js/detail.html)에서 mj_restaurants를 update하는 호출이 없으므로
-- 정책을 아예 제거한다. insert는 유지(ai.html savePlace가 사용자 검색 결과를 저장).
-- 관리자는 service_role이 RLS를 bypass하므로 SQL Editor/seed에서 수정 가능.
-- WHY: update 정책을 "관리자만"으로 만드는 대신 제거를 택함 — 이 프로젝트는 관리자 역할
--   컬럼이 없어(profiles에 is_admin 없음) 인증 방식으로 제한하려면 스키마 확장이 필요하다.
--   서비스에 update 경로가 없으므로 제거가 최소·최선이며, 추후 관리자 역할이 생기면
--   그때 정책을 추가한다.

drop policy if exists "mj_restaurants update auth" on mj_restaurants;
