-- ============================================================
--  022  채점 재시도 횟수
--   채점이 시작되지 않았거나 멈춘 제출을 서버 크론이 자동으로 되살리는데,
--   실패가 반복될 때 무한히 재시도하지 않도록 시도 횟수를 기록한다.
--   (updated_at 은 채점을 시작할 때마다 갱신되어 기준으로 쓸 수 없다)
-- ============================================================

alter table public.submissions
  add column if not exists evaluate_attempts int not null default 0;

-- 복구 대상 조회용 (아직 채점이 끝나지 않은 제출만 훑는다)
create index if not exists submissions_rescue_idx
  on public.submissions (status, updated_at)
  where status in ('submitted', 'evaluating');
