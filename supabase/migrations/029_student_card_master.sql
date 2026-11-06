-- ============================================================
--  029  Student Card 를 반·학생의 원본으로
--
--   반 구성과 학생 등록을 Student Card 에서 한 방향으로 받아온다.
--   처음에는 '전환' 상태로 시작한다 — 자동으로 맞출 수 있는 것만 잇고, 기존
--   자료는 바꾸지 않는다. 운영자가 결과를 확인한 뒤 '일원화' 를 켜면 그때부터
--   반 만들기·학생 등록·반 이동·퇴원 처리가 Student Card 를 따라간다.
--
--   ■ 여러 번 실행해도 안전하다 (if not exists / 같은 이름 제약을 지웠다 다시 만듦)
--   ■ 먼저 실행되어 있어야 하는 것: 025, 026
-- ============================================================

-- ---------- 학생 상태 ----------
-- invited   : Student Card 에서 들어왔고 아직 아이디·비밀번호를 만들지 않음
-- withdrawn : Student Card 에서 사라짐(퇴원 등). 기록은 그대로, 로그인·명단·통계에서만 빠짐
-- 기존 'approved' 만 세는 화면·통계는 그대로 이 둘을 빼고 센다.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.students'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.students drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.students
  add constraint students_status_check
  check (status in ('pending', 'approved', 'rejected', 'invited', 'withdrawn'));

alter table public.students
  -- 어떻게 이어졌는지: id·exact·suffix·name+phone·phone·manual·created, 또는
  -- none(운영자가 'Student Card 에 없는 학생' 으로 표시)
  add column if not exists hr_link_method text,
  -- 가입 안내 링크 (알림톡으로 보낸다). 가입을 마치면 비운다.
  add column if not exists invite_token   text,
  add column if not exists invited_at     timestamptz,
  add column if not exists withdrawn_at   timestamptz;

create unique index if not exists students_invite_token_key
  on public.students (invite_token) where invite_token is not null;

-- Student Card 학생 한 명에는 유스피킹 학생도 한 명만.
-- 이미 겹쳐 있으면 인덱스를 만들지 않고 알린다 (자료를 고치지 않기 위해).
-- 겹친 학생은 운영자 화면의 학생 매칭에서 정리한 뒤 이 파일을 다시 실행하면 된다.
do $$
begin
  if exists (
    select hr_student_id from public.students
     where hr_student_id is not null
     group by hr_student_id having count(*) > 1
  ) then
    raise notice '같은 Student Card 학생에 이어진 유스피킹 학생이 둘 이상 있어 고유 인덱스를 건너뜁니다.';
  else
    create unique index if not exists students_hr_student_key
      on public.students (hr_student_id) where hr_student_id is not null;
  end if;
end $$;

-- ---------- 선생님 매칭 ----------
-- Student Card 는 담임을 이름으로만 준다 (ID·이메일 없음). 그래서 이름을 열쇠로 둔다.
-- Student Card 쪽 이름이 바뀌면 연결이 풀려 '미연결' 로 다시 보인다 (엉뚱한 사람과
-- 이어지지는 않는다).
create table if not exists public.teacher_links (
  card_teacher_name text primary key,
  teacher_id        uuid not null references public.teachers (id) on delete cascade,
  method            text not null default 'auto' check (method in ('auto', 'manual')),
  linked_at         timestamptz not null default now(),
  linked_by         uuid references public.teachers (id) on delete set null
);
create index if not exists teacher_links_teacher_idx on public.teacher_links (teacher_id);

-- ---------- 학생 매칭: 사람이 골라야 하는 후보 ----------
create table if not exists public.hr_match_suggestions (
  local_student_id uuid not null references public.students (id) on delete cascade,
  hr_student_id    text not null,
  class_id         uuid not null references public.classes (id) on delete cascade,
  hr_name          text not null,
  hr_student_phone text,
  hr_parent_phone  text,
  -- same-name   : 같은 이름 후보가 여럿
  -- parent-phone: 이름은 다른데 학부모 번호만 같음 (형제자매일 수 있음)
  reason           text not null check (reason in ('same-name', 'parent-phone')),
  found_at         timestamptz not null default now(),
  primary key (local_student_id, hr_student_id)
);
create index if not exists hr_match_suggestions_class_idx on public.hr_match_suggestions (class_id);

-- ---------- 연락처가 서로 다를 때 ----------
-- 전환 상태에서는 기존 번호를 덮어쓰지 않고 여기에 적어 둔다.
create table if not exists public.hr_contact_diffs (
  student_id        uuid primary key references public.students (id) on delete cascade,
  card_student_phone text,
  card_parent_phone  text,
  found_at          timestamptz not null default now()
);

-- ---------- 가입 안내 발송 기록 ----------
-- Student Card 학생 ID 기준으로 둔다. 일원화 전에는 아직 유스피킹 학생이 없는
-- 경우도 있어서(등록 필요 명단만 있음) 학생 표에 붙일 수 없다.
create table if not exists public.signup_invites (
  hr_student_id text primary key,
  sent_at       timestamptz not null default now(),
  sent_to       text,
  sent_count    int not null default 1
);

-- ---------- 자동 변경 기록 ----------
-- 일원화 상태에서 동기화가 바꾼 것을 모두 남긴다 (반 생성·담임 변경·학생 생성·
-- 반 이동·퇴원·복귀). 운영자가 나중에 '왜 바뀌었지?' 를 확인할 수 있어야 한다.
create table if not exists public.hr_sync_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  kind       text not null,
  class_id   uuid references public.classes (id) on delete set null,
  student_id uuid references public.students (id) on delete set null,
  detail     text not null default ''
);
create index if not exists hr_sync_log_at_idx on public.hr_sync_log (at desc);

-- ---------- 설정 ----------
alter table public.app_settings
  add column if not exists hr_sync_mode text not null default 'convert'
    check (hr_sync_mode in ('convert', 'oneway')),
  -- 마지막 동기화 요약 (운영자 화면 표시용)
  add column if not exists hr_last_report jsonb;

-- ---------- 접근 권한 ----------
-- 모두 서비스 롤로만 읽고 쓴다 (정책 없이 RLS 만 켠다)
alter table public.teacher_links        enable row level security;
alter table public.hr_match_suggestions enable row level security;
alter table public.hr_contact_diffs     enable row level security;
alter table public.hr_sync_log          enable row level security;
alter table public.signup_invites       enable row level security;

-- ============================================================
--  확인용
--   · 같은 Student Card 학생에 둘 이상 이어진 경우 찾기:
--       select hr_student_id, array_agg(name) from public.students
--        where hr_student_id is not null group by 1 having count(*) > 1;
-- ============================================================
