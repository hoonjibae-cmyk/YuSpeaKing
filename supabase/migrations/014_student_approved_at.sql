-- 014_student_approved_at.sql — 학생 가입 승인일 기록
-- AI 코멘트(즉시 피드백 · 과제별 리포트 · 월말 리포트)가 등록 이전 과제를 두고
-- "제출률이 낮다"고 평하지 않도록, 승인 시점을 기준으로 집계한다.

alter table public.students
  add column if not exists approved_at timestamptz;

-- 이미 승인된 기존 학생은 가입 신청일을 승인일로 간주 (소급 보정)
update public.students
   set approved_at = created_at
 where approved_at is null
   and status = 'approved';

create index if not exists students_approved_at_idx on public.students (approved_at);
