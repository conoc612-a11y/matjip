-- 2026-08-09: 방문 기록에 로그인 회원 연결
-- visit-count Edge Function이 Authorization JWT를 검증해 user_id를 저장한다.
-- 비회원 방문은 user_id가 null이므로 기존 집계는 그대로 유지된다.
alter table visits add column if not exists user_id uuid references auth.users(id) on delete cascade;
create index if not exists visits_user_id_idx on visits (user_id);
