-- #4 보관기간 + #5 운영자(관리자) 채널
-- Supabase SQL Editor 에서 실행

-- 음원 만료 표시 (60일 지나 자동 삭제되면 true, 점수·피드백은 유지)
alter table public.submissions
  add column if not exists audio_expired boolean not null default false;

-- 교사/운영자 역할 (기본 teacher, 운영자는 수동으로 'admin' 지정)
alter table public.teachers
  add column if not exists role text not null default 'teacher';

-- 운영자로 지정하려면 아래처럼 실행 (이메일만 본인 것으로 교체):
-- update public.teachers set role = 'admin' where email = 'you@example.com';
