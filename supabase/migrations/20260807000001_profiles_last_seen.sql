-- 최종접속일을 실제 방문 기준으로 기록 (auth.users.last_sign_in_at은 비밀번호 재로그인 시에만 갱신됨)
alter table public.profiles add column if not exists last_seen_at timestamptz;
-- RLS는 기존 "own profile update"(auth.uid() = id) 정책이 이미 허용함
