-- ============================================================
--  011  반 보관(아카이브)
--  - 삭제 대신 보관: 목록에서 숨기되 데이터는 유지, 언제든 복원 가능.
-- ============================================================

alter table public.classes
  add column if not exists archived_at timestamptz;

create index if not exists classes_archived_idx on public.classes (archived_at);
