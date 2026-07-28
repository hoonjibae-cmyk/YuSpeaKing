-- ============================================================
--  018  반 이동 / 인수인계
--   1) 같은 선생님 반 내 이동 — 요청 없이 바로 (테이블 불필요)
--   2) 다른 선생님 반으로 학생 이동 — 인수인계 요청 → 상대가 수락
--   3) 반 담임 교체 — 기존/신규 담임 어느 쪽이든 요청 → 상대가 수락
--   ※ 학생 계정·제출·점수·쿠폰·배지는 students.id 에 묶여 있어
--     class_id 만 바뀌므로 기록이 그대로 따라간다.
-- ============================================================

create table if not exists public.transfer_requests (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('student','class')),
  -- kind='student' 일 때만 사용
  student_id      uuid references public.students (id) on delete cascade,
  -- student: 학생의 현재 반 / class: 담임을 넘길 반
  class_id        uuid not null references public.classes (id) on delete cascade,
  from_teacher_id uuid not null references public.teachers (id) on delete cascade,
  to_teacher_id   uuid not null references public.teachers (id) on delete cascade,
  requested_by    uuid not null references public.teachers (id) on delete cascade,
  status          text not null default 'pending'
    check (status in ('pending','accepted','rejected','canceled')),
  note            text,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  constraint transfer_student_id_chk
    check ((kind = 'student') = (student_id is not null)),
  constraint transfer_different_teacher_chk
    check (from_teacher_id <> to_teacher_id)
);

create index if not exists transfer_requests_to_idx
  on public.transfer_requests (to_teacher_id, status);
create index if not exists transfer_requests_from_idx
  on public.transfer_requests (from_teacher_id, status);

-- 같은 대상에 대해 대기 중인 요청이 중복 생기지 않도록
create unique index if not exists transfer_requests_pending_student_key
  on public.transfer_requests (student_id) where status = 'pending' and kind = 'student';
create unique index if not exists transfer_requests_pending_class_key
  on public.transfer_requests (class_id) where status = 'pending' and kind = 'class';

-- RLS: 요청에 관련된 선생님만 조회
alter table public.transfer_requests enable row level security;
drop policy if exists transfer_requests_involved on public.transfer_requests;
create policy transfer_requests_involved on public.transfer_requests
  for select using (
    from_teacher_id = auth.uid()
    or to_teacher_id = auth.uid()
    or requested_by = auth.uid()
  );
