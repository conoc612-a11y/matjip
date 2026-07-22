-- 맛집 탐방 — DB 스키마 (Supabase / Postgres)
-- restaurant-guide 프로젝트에 기존 'restaurants' 표가 있어 충돌 → 우리 표는 'mj_restaurants'로 사용.
-- 5개 표 + RLS + 정책 + 회원가입 트리거 + 시드. SQL Editor에서 통째로 실행. 재실행 안전.

-- 1) profiles (auth.users 확장)
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
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
