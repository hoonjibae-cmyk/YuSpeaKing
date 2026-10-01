-- ============================================================
--  026  HR manager 명단 연동
--   · 반 매칭: 유스피킹 반 ↔ HR manager 반 (이름이 달라도 운영자가 이어 준다)
--   · 학생 연결: 이름이 바뀌어도 끊기지 않도록 HR 학생 ID 를 들고 있는다
--   · 동기화 결과: 선생님 화면에 '등록 안 된 학생' 알림을 띄우려면 매번 외부
--     API 를 부를 수 없으므로 결과를 저장해 두고 화면은 이것만 읽는다
-- ============================================================

-- 반 매칭
create table if not exists public.class_links (
  class_id      uuid primary key references public.classes (id) on delete cascade,
  hr_class_id   text not null,
  hr_class_name text,
  linked_at     timestamptz not null default now(),
  linked_by     uuid references public.teachers (id) on delete set null
);
create unique index if not exists class_links_hr_idx
  on public.class_links (hr_class_id);

-- 학생 연결 + 연락처
alter table public.students
  add column if not exists hr_student_id text,
  add column if not exists student_phone text;
create index if not exists students_hr_idx on public.students (hr_student_id);

-- 동기화 결과: HR 에는 있는데 유스피킹에 아직 없는 학생
create table if not exists public.hr_pending_students (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes (id) on delete cascade,
  hr_student_id  text not null,
  name           text not null,
  student_phone  text,
  parent_phone   text,
  -- 'new'       : 유스피킹에 없는 학생 → 선생님이 등록해야 함
  -- 'ambiguous' : 홍길동A·홍길동B 처럼 누구인지 골라야 함
  kind           text not null default 'new' check (kind in ('new', 'ambiguous')),
  -- ambiguous 일 때 어느 학생에 대한 후보인지
  local_student_id uuid references public.students (id) on delete cascade,
  found_at       timestamptz not null default now(),
  unique (class_id, hr_student_id)
);
create index if not exists hr_pending_class_idx
  on public.hr_pending_students (class_id);

-- 마지막 동기화 시각 (운영자 화면 표시용)
alter table public.app_settings
  add column if not exists hr_synced_at timestamptz;

alter table public.class_links enable row level security;
alter table public.hr_pending_students enable row level security;
