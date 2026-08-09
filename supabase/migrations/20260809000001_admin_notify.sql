-- 2026-08-09: 신규 회원 가입 → 관리자 이메일 알림
-- profiles INSERT 시 pg_net 으로 admin-notify Edge Function 을 호출한다.
-- 호출 검증용 x-notify-secret 은 app_secrets 테이블에 보관한다.
--   (RLS 정책이 postgres 역할(security definer 트리거)에만 SELECT 허용 → anon/authenticated 는 읽기 불가)
--   값을 넣는 명령(스크립트가 1회 실행):
--     INSERT INTO app_secrets(key,value) VALUES ('admin_notify_secret','<ADMIN_NOTIFY_SECRET과 동일>');
--   (값은 리포/마이그레이션에 평문으로 남지 않도록 배포 스크립트가 주입)

create extension if not exists pg_net;

-- 시크릿 저장소 (RLS: postgres 역할만 읽음 → 익명/로그인 사용자는 접근 불가)
create table if not exists app_secrets (
  key   text primary key,
  value text not null
);
alter table app_secrets enable row level security;
drop policy if exists "app_secrets owner read" on app_secrets;
create policy "app_secrets owner read" on app_secrets for select to postgres using (true);

create or replace function public.notify_admin_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  notify_secret text;
  u_name text;
  u_email text;
begin
  select value into notify_secret from app_secrets where key = 'admin_notify_secret';
  if notify_secret is null or notify_secret = '' then
    raise warning 'app_secrets.admin_notify_secret 미설정 — 알림 전송 생략';
    return new;
  end if;
  select raw_user_meta_data->>'name', email into u_name, u_email
  from auth.users where id = new.id;
  perform net.http_post(
    url := 'https://bhgijvaxxjnocgfnaaeu.supabase.co/functions/v1/admin-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', notify_secret),
    body := jsonb_build_object('email', u_email, 'name', u_name)
  );
  return new;
end;
$$;

drop trigger if exists trg_notify_admin_new_user on profiles;
create trigger trg_notify_admin_new_user
  after insert on profiles
  for each row execute function public.notify_admin_new_user();
