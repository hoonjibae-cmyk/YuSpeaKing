-- ============================================================
--  YuSpeaking - Database schema
--  Supabase SQL editor 또는 `supabase db push` 로 실행
-- ============================================================

-- ---------- 확장 ----------
create extension if not exists "pgcrypto";

-- ============================================================
--  teachers : Supabase Auth(auth.users)와 1:1 프로필
-- ============================================================
create table if not exists public.teachers (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '',
  email      text not null,
  role       text not null default 'teacher', -- 'teacher' | 'admin'(운영자)
  created_at timestamptz not null default now()
);

-- 신규 가입 시 teachers 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.teachers (id, email, name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  classes : 반 (교사 소유, 학생 로그인용 반 코드)
-- ============================================================
create table if not exists public.classes (
  id         uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  name       text not null,
  class_code text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists classes_teacher_idx on public.classes (teacher_id);

-- ============================================================
--  students : 반별 학생 명단 (이메일 미수집, 이름/번호 + 선택 PIN)
-- ============================================================
create table if not exists public.students (
  id         uuid primary key default gen_random_uuid(),
  class_id   uuid not null references public.classes (id) on delete cascade,
  name       text not null,
  number     int  not null,
  pin_hash   text,                       -- 선택: 4자리 PIN 해시
  created_at timestamptz not null default now(),
  unique (class_id, number)
);
create index if not exists students_class_idx on public.students (class_id);

-- ============================================================
--  assignments : 과제(그날의 지문) + 샘플음성
-- ============================================================
create table if not exists public.assignments (
  id               uuid primary key default gen_random_uuid(),
  class_id         uuid not null references public.classes (id) on delete cascade,
  title            text not null,
  passage_text     text not null,
  sample_audio_url text,                 -- OpenAI TTS 생성 후 채워짐 (정상 속도)
  sample_audio_slow_url text,            -- 느린(0.75배) 버전
  due_date         date,
  max_attempts     int not null default 2, -- 학생 재제출 허용 횟수
  created_at       timestamptz not null default now()
);
create index if not exists assignments_class_idx on public.assignments (class_id);

-- ============================================================
--  submissions : 학생 제출 + AI 평가 결과
-- ============================================================
create table if not exists public.submissions (
  id               uuid primary key default gen_random_uuid(),
  assignment_id    uuid not null references public.assignments (id) on delete cascade,
  student_id       uuid not null references public.students (id) on delete cascade,
  audio_path       text not null,        -- submissions 버킷 내 경로
  audio_expired    boolean not null default false, -- 60일 후 음원 삭제 여부
  attempt_count    int not null default 0, -- 제출(시도) 횟수 누적
  status           text not null default 'submitted'
                     check (status in ('submitted','evaluating','evaluated','error')),
  azure_scores     jsonb,                -- Azure 발음평가 원본 점수
  overall_score    numeric,
  student_feedback text,                 -- 학생용 간단 피드백 (즉시 노출)
  teacher_feedback text,                 -- 교사용 상세 리포트
  teacher_reviewed boolean not null default false,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (assignment_id, student_id)     -- MVP: 재제출 시 덮어쓰기
);
create index if not exists submissions_assignment_idx on public.submissions (assignment_id);
create index if not exists submissions_student_idx on public.submissions (student_id);

-- updated_at 자동 갱신
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists submissions_touch on public.submissions;
create trigger submissions_touch
  before update on public.submissions
  for each row execute function public.touch_updated_at();

-- ============================================================
--  RLS : 교사(로그인 사용자)는 본인 반 데이터만.
--        학생 데이터 접근은 서버(서비스 롤)에서 처리하므로 RLS로 막아둔다.
-- ============================================================
alter table public.teachers    enable row level security;
alter table public.classes     enable row level security;
alter table public.students    enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;

-- teachers: 본인 프로필만
drop policy if exists teachers_self on public.teachers;
create policy teachers_self on public.teachers
  for all using (id = auth.uid()) with check (id = auth.uid());

-- classes: 소유 교사만
drop policy if exists classes_owner on public.classes;
create policy classes_owner on public.classes
  for all using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

-- students: 소유 교사의 반에 속한 학생만
drop policy if exists students_owner on public.students;
create policy students_owner on public.students
  for all using (
    exists (select 1 from public.classes c
            where c.id = students.class_id and c.teacher_id = auth.uid())
  ) with check (
    exists (select 1 from public.classes c
            where c.id = students.class_id and c.teacher_id = auth.uid())
  );

-- assignments: 소유 교사의 반 과제만
drop policy if exists assignments_owner on public.assignments;
create policy assignments_owner on public.assignments
  for all using (
    exists (select 1 from public.classes c
            where c.id = assignments.class_id and c.teacher_id = auth.uid())
  ) with check (
    exists (select 1 from public.classes c
            where c.id = assignments.class_id and c.teacher_id = auth.uid())
  );

-- submissions: 소유 교사의 반 제출만 (읽기/검토용). 학생 쓰기는 서버가 처리.
drop policy if exists submissions_owner on public.submissions;
create policy submissions_owner on public.submissions
  for all using (
    exists (
      select 1 from public.assignments a
      join public.classes c on c.id = a.class_id
      where a.id = submissions.assignment_id and c.teacher_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.assignments a
      join public.classes c on c.id = a.class_id
      where a.id = submissions.assignment_id and c.teacher_id = auth.uid()
    )
  );

-- ============================================================
--  monthly_reports : 학생 월말 리포트 (교사 작성/AI 초안)
-- ============================================================
create table if not exists public.monthly_reports (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  year_month text not null,
  content    text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, year_month)
);
create index if not exists monthly_reports_student_idx
  on public.monthly_reports (student_id);
drop trigger if exists monthly_reports_touch on public.monthly_reports;
create trigger monthly_reports_touch
  before update on public.monthly_reports
  for each row execute function public.touch_updated_at();

alter table public.monthly_reports enable row level security;
drop policy if exists monthly_reports_owner on public.monthly_reports;
create policy monthly_reports_owner on public.monthly_reports
  for all using (
    exists (select 1 from public.students s
            join public.classes c on c.id = s.class_id
            where s.id = monthly_reports.student_id and c.teacher_id = auth.uid())
  ) with check (
    exists (select 1 from public.students s
            join public.classes c on c.id = s.class_id
            where s.id = monthly_reports.student_id and c.teacher_id = auth.uid())
  );

-- ============================================================
--  Storage 버킷
--   sample-audio : 샘플 음성 (공개 읽기)
--   submissions  : 학생 녹음 (비공개, 서명 URL로만 접근)
--  * Storage 정책은 Supabase 대시보드에서도 설정 가능. 아래는 참고용.
-- ============================================================
insert into storage.buckets (id, name, public)
  values ('sample-audio', 'sample-audio', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('submissions', 'submissions', false)
  on conflict (id) do nothing;
