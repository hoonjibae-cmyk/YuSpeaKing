-- ============================================================
--  007  학생 셀프 가입/승인 + 아이디·비밀번호 로그인
--  - 학생이 직접 가입 신청(이름·학교·학년·수강반·아이디·비번)
--  - 선생님 승인 후 로그인 가능
-- ============================================================

alter table public.students
  add column if not exists username      text,
  add column if not exists password_hash text,
  add column if not exists school        text,
  add column if not exists grade         text,
  add column if not exists status        text not null default 'approved'
    check (status in ('pending','approved','rejected'));

-- 셀프 가입 시 번호는 아직 없을 수 있음 → nullable 로 완화
-- (기존 unique(class_id, number)는 NULL 을 서로 다른 값으로 취급하므로 유지 가능)
alter table public.students alter column number drop not null;

-- 아이디 전역 유니크 (값이 있을 때만)
create unique index if not exists students_username_key
  on public.students (username) where username is not null;

create index if not exists students_status_idx on public.students (status);

-- 기존 명단 학생(교사가 추가)은 로그인 자격이 없으므로 그대로 두되,
-- 신규 셀프가입 행만 'pending' 으로 삽입된다(앱에서 명시).
