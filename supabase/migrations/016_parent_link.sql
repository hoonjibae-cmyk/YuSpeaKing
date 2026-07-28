-- ============================================================
--  016  학부모 열람 링크
--   · 학생별 고유 토큰으로 로그인 없이 자녀 현황을 열람 (읽기 전용)
--   · 링크가 유출되면 선생님이 재발급해 이전 링크를 무효화
-- ============================================================

alter table public.students
  add column if not exists parent_token text;

create unique index if not exists students_parent_token_key
  on public.students (parent_token) where parent_token is not null;

-- 기존 승인 학생에게 토큰 부여 (하이픈 제거한 uuid = 32자)
update public.students
   set parent_token = replace(gen_random_uuid()::text, '-', '')
 where parent_token is null
   and status = 'approved';
