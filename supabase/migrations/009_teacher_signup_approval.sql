-- ============================================================
--  009  선생님 가입 승인 + 선생님별 학생 가입 코드
--  - 선생님도 '가입 신청 → 총괄관리자 승인' 흐름
--  - 선생님마다 고유 학생 가입 URL(signup_code)
-- ============================================================

alter table public.teachers
  add column if not exists status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  add column if not exists signup_code text;

-- 기존 선생님(운영자 포함)은 모두 승인 상태로 전환
update public.teachers set status = 'approved';

-- 기존 선생님에게 학생 가입 코드 부여
update public.teachers
  set signup_code = substr(md5(random()::text || id::text), 1, 8)
  where signup_code is null;

create unique index if not exists teachers_signup_code_key
  on public.teachers (signup_code) where signup_code is not null;

-- 신규 가입 시 teachers 프로필 자동 생성 (slack_email·가입코드 포함, 승인대기)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.teachers (id, email, name, slack_email, signup_code, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'slack_email', ''),
    substr(md5(random()::text || new.id::text), 1, 8),
    'pending'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
