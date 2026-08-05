-- ============================================================
--  021  보조 선생님 (쿠폰 발급 전용)
--   한 반을 두 선생님이 함께 맡되, 한 분은 과제·채점까지 전부 관리하고
--   다른 한 분은 '쿠폰 발급'만 하는 운영 형태를 지원한다.
--
--   class_coteachers 를 등급(role)으로 나눈다.
--    · full   : 인수인계 공동 관리 기간 (기존) — 기간 한정, 전체 권한
--    · coupon : 보조 선생님 — 기간 제한 없음, 쿠폰 발급만
-- ============================================================

alter table public.class_coteachers
  add column if not exists role text not null default 'full';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'class_coteachers_role_chk'
  ) then
    alter table public.class_coteachers
      add constraint class_coteachers_role_chk check (role in ('full','coupon'));
  end if;
end $$;

-- 보조 선생님은 기간이 없으므로 날짜를 비워 둘 수 있어야 한다
alter table public.class_coteachers alter column starts_on drop not null;
alter table public.class_coteachers alter column ends_on   drop not null;

-- ★ 전체 권한은 'full' 등급에만. (이 조건이 빠지면 보조 선생님이
--   학생 삭제·과제 삭제까지 할 수 있게 되므로 반드시 함께 적용한다)
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
         and cc.role = 'full'
         and cc.starts_on is not null
         and cc.ends_on is not null
         and (now() at time zone 'Asia/Seoul')::date between cc.starts_on and cc.ends_on
    );
$$;
