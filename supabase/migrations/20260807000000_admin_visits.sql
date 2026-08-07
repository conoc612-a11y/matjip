-- 2026-08-07: 방문자 IP 일 1회 집계 + 관리자 세션
-- (schema.sql의 해당 부분과 동일 내용. CLI db push로 기존 DB에만 적용)

-- visits: IP 1일 1회 dedup (visit-count Edge Function이 기록)
alter table visits add column if not exists ip text;
alter table visits add column if not exists visit_date date;
create unique index if not exists visits_ip_date_uniq on visits (ip, visit_date);
-- 기록·집계는 Edge Function(service role) 전용 → anon 직접 INSERT/SELECT 차단
drop policy if exists "visits anon insert" on visits;
drop policy if exists "visits anon select" on visits;

-- 관리자 세션/로그인 실패 기록 (admin Edge Function 전용, RLS 정책 없음)
create table if not exists admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists admin_login_log (
  id bigint generated always as identity primary key,
  ip text not null,
  attempted_at timestamptz not null default now()
);
alter table admin_sessions  enable row level security;
alter table admin_login_log enable row level security;
