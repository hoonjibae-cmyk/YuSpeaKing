-- 재제출 허용 횟수 기본값 3 → 2
-- Supabase SQL Editor 에서 실행

alter table public.assignments alter column max_attempts set default 2;

-- 기존 과제 중 이전 기본값(3)인 것만 2로 조정 (커스텀 값은 유지)
update public.assignments set max_attempts = 2 where max_attempts = 3;
