-- ============================================================
--  017  학부모도 공지 푸시 알림 받기
--   · 같은 학생에 대해 학생 기기 / 학부모 기기를 구분해 저장
--   · 나중에 '학부모에게만' 보내는 알림(미제출 안내 등)에도 쓸 수 있다
-- ============================================================

alter table public.push_subscriptions
  add column if not exists audience text not null default 'student';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'push_subscriptions_audience_chk'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_audience_chk
      check (audience in ('student','parent'));
  end if;
end $$;

create index if not exists push_subscriptions_audience_idx
  on public.push_subscriptions (student_id, audience);
