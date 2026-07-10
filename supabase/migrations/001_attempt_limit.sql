-- 재제출 횟수 제한 기능
-- Supabase SQL Editor 에서 실행 (기존 DB 업데이트용)

-- 과제별 허용 제출 횟수 (기본 3회)
alter table public.assignments
  add column if not exists max_attempts int not null default 3;

-- 제출별 시도 횟수 누적
alter table public.submissions
  add column if not exists attempt_count int not null default 0;
