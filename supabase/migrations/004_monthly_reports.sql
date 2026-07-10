-- #3 학생 월말 리포트
-- Supabase SQL Editor 에서 실행

create table if not exists public.monthly_reports (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  year_month text not null,                 -- 'YYYY-MM'
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, year_month)
);
create index if not exists monthly_reports_student_idx
  on public.monthly_reports (student_id);

-- updated_at 자동 갱신 (touch_updated_at 는 schema.sql 에 이미 정의됨)
drop trigger if exists monthly_reports_touch on public.monthly_reports;
create trigger monthly_reports_touch
  before update on public.monthly_reports
  for each row execute function public.touch_updated_at();

-- RLS: 소유 교사(학생이 속한 반의 교사)만
alter table public.monthly_reports enable row level security;
drop policy if exists monthly_reports_owner on public.monthly_reports;
create policy monthly_reports_owner on public.monthly_reports
  for all using (
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = monthly_reports.student_id and c.teacher_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.students s
      join public.classes c on c.id = s.class_id
      where s.id = monthly_reports.student_id and c.teacher_id = auth.uid()
    )
  );
