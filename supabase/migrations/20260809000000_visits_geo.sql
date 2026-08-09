-- 2026-08-09: 방문자 위치 정보 컬럼 추가 (visit-count Edge Function이 ipwho.is로 조회해 기록)
-- (schema.sql의 해당 부분과 동일 내용. CLI db push로 기존 DB에만 적용)

alter table visits add column if not exists country text;
alter table visits add column if not exists region text;
alter table visits add column if not exists city text;
