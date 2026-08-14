-- 2026-08-15: api_rate_limits 무한 누적 방지 (코드리뷰 조치)
--
-- rl_hit 는 키(IP+접두사)당 1행이고 window_start 가 호출마다 갱신되므로,
-- 1일 이상 지난 행은 카운터에 절대 다시 쓰이지 않는 죽은 행이다.
-- 그런데 삭제 경로가 없어 공개 엔드포인트의 고유 IP 수만큼 테이블이 계속 자랐다.
-- 해결: rl_hit 호출마다 1% 확률로 죽은 행을 삭제한다 — 트래픽이 늘수록 정리도 자주 돌아
-- 서비스 부하 없이 누적을 막는다. (새 키 INSERT 시에만 도는 삭제보다 이 편이 더 단순.)
-- WHY(결정 사유): pg_cron 스케줄러를 새로 끌 필요 없이 기존 함수에 한 줄로 해결.
--   지연 정리(lazy)가 이 테이블에겐 충분하다 — 1% 미만으로 남는 죽은 행도 다음 호출에서
--   창 검사에 안 걸리므로 카운터 정확성에 영향이 없다.

create index if not exists api_rate_limits_window_start_idx on api_rate_limits(window_start);

create or replace function public.rl_hit(p_key text, p_window_seconds int, p_max int)
returns table(allowed boolean, retry_after int)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_row api_rate_limits;
begin
  -- 1% 확률로 1일 지난 행 정리 (무한 누적 방지, 2026-08-15)
  if random() < 0.01 then
    delete from api_rate_limits where window_start < v_now - interval '1 day';
  end if;

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
