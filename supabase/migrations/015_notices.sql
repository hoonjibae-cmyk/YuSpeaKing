-- ============================================================
--  015  공지사항 + 웹푸시 알림
--   · 선생님: 특정 반 / 담당 전체 반 에 공지
--   · 운영자: 전체 반 공지
--   · 학생: 앱에서 확인(안 읽은 배지) + 휴대폰 푸시 알림
-- ============================================================

create table if not exists public.notices (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.teachers (id) on delete cascade,
  -- class      : class_id 한 반에만
  -- my_classes : 작성자가 담당하는 모든 반
  -- all        : 전체 반 (운영자 전용)
  scope      text not null check (scope in ('class','my_classes','all')),
  class_id   uuid references public.classes (id) on delete cascade,
  title      text not null,
  body       text not null default '',
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  -- scope='class' 일 때만 class_id 가 있어야 한다
  constraint notices_class_scope_chk
    check ((scope = 'class') = (class_id is not null))
);
create index if not exists notices_author_idx  on public.notices (author_id);
create index if not exists notices_class_idx   on public.notices (class_id);
create index if not exists notices_created_idx on public.notices (created_at desc);

-- 학생별 읽음 기록
create table if not exists public.notice_reads (
  notice_id  uuid not null references public.notices (id)  on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  read_at    timestamptz not null default now(),
  primary key (notice_id, student_id)
);
create index if not exists notice_reads_student_idx on public.notice_reads (student_id);

-- 웹푸시 구독 (학생 기기별)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_student_idx
  on public.push_subscriptions (student_id);

-- ---------- RLS ----------
-- 학생 화면은 서버(service role)로 조회하므로 정책 없이도 동작한다.
-- 선생님 화면은 auth.uid() 기준으로 본인 공지만 관리한다.
alter table public.notices enable row level security;
drop policy if exists notices_author_rw on public.notices;
create policy notices_author_rw on public.notices
  for all using (author_id = auth.uid()) with check (author_id = auth.uid());

-- 다른 선생님/운영자가 올린 전체 공지는 읽기만 허용
drop policy if exists notices_read_all_scope on public.notices;
create policy notices_read_all_scope on public.notices
  for select using (scope = 'all');

alter table public.notice_reads      enable row level security;
alter table public.push_subscriptions enable row level security;
