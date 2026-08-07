-- 맛집 탐방 — DB 스키마 (Supabase / Postgres)
-- restaurant-guide 프로젝트에 기존 'restaurants' 표가 있어 충돌 → 우리 표는 'mj_restaurants'로 사용.
-- 5개 표 + RLS + 정책 + 회원가입 트리거 + 시드. SQL Editor에서 통째로 실행. 재실행 안전.

-- 1) profiles (auth.users 확장)
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) taste_profiles (취향, 1인 1개)
create table if not exists taste_profiles (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,
  spicy_level    int check (spicy_level between 0 and 5),
  flavor_tags    text[] not null default '{}',
  situation_tags text[] not null default '{}',
  created_at     timestamptz not null default now(),
  unique (user_id)
);

-- 3) mj_restaurants (공용 추천 대상 — 기존 restaurants와 충돌 피하려고 접두사)
create table if not exists mj_restaurants (
  id         bigint generated always as identity primary key,
  name       text not null,
  address    text,
  lat        double precision,
  lng        double precision,
  category   text,
  tags       text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- 4) saved_restaurants
create table if not exists saved_restaurants (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id bigint not null references mj_restaurants(id) on delete cascade,
  memo          text,
  rating        int check (rating between 1 and 5),
  created_at    timestamptz not null default now(),
  unique (user_id, restaurant_id)
);

-- 5) feedbacks
create table if not exists feedbacks (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  restaurant_id bigint not null references mj_restaurants(id) on delete cascade,
  action        text not null,
  created_at    timestamptz not null default now()
);

-- ── RLS ──
alter table profiles          enable row level security;
alter table taste_profiles    enable row level security;
alter table mj_restaurants    enable row level security;
alter table saved_restaurants enable row level security;
alter table feedbacks         enable row level security;

drop policy if exists "own profile read"   on profiles;
drop policy if exists "own profile update" on profiles;
create policy "own profile read"   on profiles for select to authenticated using (auth.uid() = id);
create policy "own profile update" on profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "own taste" on taste_profiles;
create policy "own taste" on taste_profiles for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "mj_restaurants read"        on mj_restaurants;
drop policy if exists "mj_restaurants insert auth" on mj_restaurants;
drop policy if exists "mj_restaurants update auth" on mj_restaurants;
create policy "mj_restaurants read"        on mj_restaurants for select using (true);
create policy "mj_restaurants insert auth" on mj_restaurants for insert to authenticated with check (true);
create policy "mj_restaurants update auth" on mj_restaurants for update to authenticated using (true) with check (true);

drop policy if exists "own saved" on saved_restaurants;
create policy "own saved" on saved_restaurants for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own feedback read"   on feedbacks;
drop policy if exists "own feedback insert" on feedbacks;
create policy "own feedback read"   on feedbacks for select to authenticated using (auth.uid() = user_id);
create policy "own feedback insert" on feedbacks for insert to authenticated with check (auth.uid() = user_id);

-- ── 방문자 기록 (같은 IP는 하루 1건만. 로그인 없이도 집계되도록 anon 허용) ──
-- visit-count Edge Function 이 x-forwarded-for 로 IP 를 읽어 upsert 한다.
create table if not exists visits (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  page text not null default 'land',
  ip text,
  visit_date date
);
-- 기존 DB(테이블 생성 이후)에 컬럼/인덱스를 추가하는 마이그레이션:
alter table visits add column if not exists ip text;
alter table visits add column if not exists visit_date date;
create unique index if not exists visits_ip_date_uniq on visits (ip, visit_date);
alter table visits enable row level security;
-- 기록·집계는 전부 visit-count Edge Function(service role)이 담당하므로
-- anon 직접 INSERT/SELECT는 막아 같은 IP 당일 중복 기록으로 숫자가 부풀리는 것을 차단한다.
drop policy if exists "visits anon insert" on visits;
drop policy if exists "visits anon select" on visits;

-- ── 회원수 (푸터 통계) ──
-- taste_profiles는 RLS가 authenticated 전용이라 anon SELECT가 차단된다(회원수=0으로 보임).
-- 그래서 개인정보를 노출하지 않으면서 숫자만 반환하는 security definer 함수로 집계한다.
-- (비회원에게 취향·user_id가 새지 않도록, 반환값은 개수 하나뿐)
create or replace function public.member_count()
returns bigint language sql stable security definer set search_path = public as
$$ select count(*) from taste_profiles $$;
revoke all on function public.member_count() from public;
grant execute on function public.member_count() to anon, authenticated;

-- ── 정비구역 커뮤니티 피드 (land.html) — visits와 동일한 anon 모델: 로그인 없이 익명 작성 ──
create table if not exists jb_posts (
  id bigint generated always as identity primary key,
  zone_rc text not null,       -- 정비구역 recordCode (jbRows[i].rc)
  zone_name text not null,     -- 표시용 스냅샷(구역명이 나중에 바뀌어도 작성 당시 이름 유지)
  nickname text not null default '익명',
  content text not null check (char_length(content) <= 300),
  created_at timestamptz not null default now()
);
alter table jb_posts enable row level security;
drop policy if exists "jb_posts anon read"   on jb_posts;
drop policy if exists "jb_posts anon insert" on jb_posts;
create policy "jb_posts anon read"   on jb_posts for select using (true);
create policy "jb_posts anon insert" on jb_posts for insert with check (true);

-- ── 시드 (mj_restaurants 비었을 때만) ──
insert into mj_restaurants (name, address, lat, lng, category, tags)
select v.name, v.address, v.lat, v.lng, v.category, v.tags
from (values
  ('을지면옥',            '서울 중구 충무로14길 2',      37.5660, 126.9915, '냉면', array['담백','평양냉면','노포']),
  ('금돼지식당',          '서울 중구 다산로 149',        37.5583, 127.0106, '고기', array['돼지','회식','매콤']),
  ('교대이층집',          '서울 서초구 서초대로50길 24', 37.4936, 127.0145, '고기', array['삼겹','회식','가성비']),
  ('미미네',              '서울 마포구 양화로 근처',      37.5556, 126.9236, '분식', array['떡볶이','매콤','혼밥']),
  ('스시코우지',          '서울 강남구 도산대로 근처',    37.5219, 127.0411, '일식', array['스시','오마카세','데이트']),
  ('광장시장 김밥골목',   '서울 종로구 창경궁로 88',     37.5701, 126.9997, '분식', array['김밥','로컬','간단'])
) as v(name, address, lat, lng, category, tags)
where not exists (select 1 from mj_restaurants);

-- ── 관리자 (admin.html) ──
-- 비밀번호는 서버 env secret(ADMIN_PASSWORD)에만 두고 브라우저 JS·DB 어디에도 저장하지 않는다.
-- admin-login 이 성공 시 발급하는 세션 토큰만 DB에 보관한다(토큰 원문이 아니라 SHA-256 해시).
create table if not exists admin_sessions (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
-- 로그인 실패 기록 (IP당 15분 5회 시도 시 잠금. 함수 인스턴스가 재시작돼도 유지되도록 DB에 저장)
create table if not exists admin_login_log (
  id bigint generated always as identity primary key,
  ip text not null,
  attempted_at timestamptz not null default now()
);
alter table admin_sessions  enable row level security;
alter table admin_login_log enable row level security;
-- 두 표 모두 RLS 정책 없음(service role 전용) → anon·authenticated는 아예 접근 불가.
-- 세션·실패기록은 admin Edge Function(service role)만 읽고 쓴다.
