-- ============================================================
--  019  이동 예약일 + 반 인수인계 공동 관리 기간
--   · 이동 날짜를 정해 두면 그 날짜에 적용된다 (당일이면 즉시)
--   · 반 인수인계는 공동 관리 기간을 둘 수 있고, 그 기간에는
--     기존 담임과 새 담임이 함께 반을 관리한다
-- ============================================================

alter table public.transfer_requests
  add column if not exists effective_date  date,        -- 실제로 바뀌는 날
  add column if not exists coteach_start   date,        -- 공동 관리 시작일 (없으면 공동 관리 없음)
  add column if not exists target_class_id uuid references public.classes (id) on delete cascade,
  add column if not exists applied_at      timestamptz; -- 실제 반영 시각

-- 같은 선생님 반끼리의 예약 이동도 기록해야 하므로 제약 완화
alter table public.transfer_requests
  drop constraint if exists transfer_different_teacher_chk;

-- 대기 중이거나 아직 적용 전인 예약도 중복 방지 대상
drop index if exists transfer_requests_pending_student_key;
drop index if exists transfer_requests_pending_class_key;
create unique index if not exists transfer_requests_open_student_key
  on public.transfer_requests (student_id)
  where kind = 'student' and applied_at is null and status in ('pending','accepted');
create unique index if not exists transfer_requests_open_class_key
  on public.transfer_requests (class_id)
  where kind = 'class' and applied_at is null and status in ('pending','accepted');

create index if not exists transfer_requests_due_idx
  on public.transfer_requests (effective_date)
  where applied_at is null and status = 'accepted';

-- ---------- 공동 관리 ----------
create table if not exists public.class_coteachers (
  class_id   uuid not null references public.classes (id)  on delete cascade,
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  starts_on  date not null,
  ends_on    date not null,
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);
create index if not exists class_coteachers_teacher_idx
  on public.class_coteachers (teacher_id);

alter table public.class_coteachers enable row level security;
drop policy if exists class_coteachers_involved on public.class_coteachers;
create policy class_coteachers_involved on public.class_coteachers
  for select using (
    teacher_id = auth.uid()
    or exists (select 1 from public.classes c
               where c.id = class_coteachers.class_id and c.teacher_id = auth.uid())
  );

-- 반을 관리할 수 있는가? (담임이거나, 공동 관리 기간 중인 인수인계 상대)
-- 한국시간 기준으로 날짜를 비교한다.
create or replace function public.can_manage_class(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.classes c
       where c.id = cid and c.teacher_id = auth.uid()
    ) or exists (
      select 1 from public.class_coteachers cc
       where cc.class_id = cid
         and cc.teacher_id = auth.uid()
         and (now() at time zone 'Asia/Seoul')::date between cc.starts_on and cc.ends_on
    );
$$;

-- ---------- 정책 재정의 (공동 관리 반영) ----------
drop policy if exists classes_owner on public.classes;
create policy classes_owner on public.classes
  for all using (teacher_id = auth.uid() or public.can_manage_class(id))
  with check (teacher_id = auth.uid() or public.can_manage_class(id));

drop policy if exists students_owner on public.students;
create policy students_owner on public.students
  for all using (public.can_manage_class(students.class_id))
  with check (public.can_manage_class(students.class_id));

drop policy if exists assignments_owner on public.assignments;
create policy assignments_owner on public.assignments
  for all using (public.can_manage_class(assignments.class_id))
  with check (public.can_manage_class(assignments.class_id));

drop policy if exists submissions_owner on public.submissions;
create policy submissions_owner on public.submissions
  for all using (
    exists (select 1 from public.assignments a
             where a.id = submissions.assignment_id
               and public.can_manage_class(a.class_id))
  ) with check (
    exists (select 1 from public.assignments a
             where a.id = submissions.assignment_id
               and public.can_manage_class(a.class_id))
  );

drop policy if exists monthly_reports_owner on public.monthly_reports;
create policy monthly_reports_owner on public.monthly_reports
  for all using (
    exists (select 1 from public.students s
             where s.id = monthly_reports.student_id
               and public.can_manage_class(s.class_id))
  ) with check (
    exists (select 1 from public.students s
             where s.id = monthly_reports.student_id
               and public.can_manage_class(s.class_id))
  );
