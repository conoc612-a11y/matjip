-- 2026-08-13: molit-proxy 레이트리밋을 메모리 카운터 → DB 카운터로 교체
-- 이유(실측): Deno Edge Function 인스턴스가 요청마다 분산될 수 있어 메모리 Map 카운터가
--   공유되지 않음 — 65회 연속 요청에도 429가 한 번도 안 뜸(실측 확인). DB는 인스턴스와
--   무관하게 하나로 공유되므로 여기로 옮긴다.
-- 접근: molit-proxy 함수가 SUPABASE_SERVICE_ROLE_KEY로 REST RPC(rl_hit)만 호출한다.
--   service_role은 RLS를 우회하므로 anon/authenticated에는 정책을 주지 않는다(테이블 비공개).

create table if not exists api_rate_limits (
  key         text primary key,
  window_start timestamptz not null default now(),
  count       int not null default 1
);
alter table api_rate_limits enable row level security;
-- 정책 없음 = anon/authenticated 접근 불가. service_role만(Edge Function) RLS 우회로 접근.

-- IP(key)당 p_window_seconds 창 안에서 p_max회까지 허용, 초과 시 allowed=false.
-- UPDATE 후 미매치(신규 키 or 창 만료)면 INSERT ... ON CONFLICT로 리셋 — 원자적 처리.
create or replace function public.rl_hit(p_key text, p_window_seconds int, p_max int)
returns table(allowed boolean, retry_after int)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_row api_rate_limits;
begin
  update api_rate_limits
    set count = count + 1
    where key = p_key and window_start > v_now - make_interval(secs => p_window_seconds)
    returning * into v_row;

  if not found then
    insert into api_rate_limits(key, window_start, count)
    values (p_key, v_now, 1)
    on conflict (key) do update set window_start = v_now, count = 1
    returning * into v_row;
  end if;

  if v_row.count > p_max then
    return query select false, greatest(1, ceil(extract(epoch from
      (v_row.window_start + make_interval(secs => p_window_seconds) - v_now))))::int;
  else
    return query select true, 0;
  end if;
end;
$$;
