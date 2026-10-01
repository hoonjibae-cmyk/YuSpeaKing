-- ============================================================
--  027  보조강사에게 '보기' 권한 열어 주기
--
--   지금까지 보조강사(class_coteachers.role = 'coupon')는 쿠폰 발급만 할 수
--   있었다. 반 화면·학생 명단·과제·점수·제출 현황이 전혀 보이지 않아, 쿠폰을
--   줄 때조차 그 학생이 어떤 상태인지 알 수 없었다.
--
--   그래서 '볼 수 있다' 와 '바꿀 수 있다' 를 나눈다.
--    · can_manage_class : 담임 + 인수인계 공동 관리(full)   — 읽기 + 쓰기
--    · can_view_class   : 위 + 보조강사(coupon)             — 읽기만
--
--   ■ 왜 기존 정책을 그대로 두고 select 정책만 더하는가
--     같은 테이블에 허용(permissive) 정책이 여럿이면 OR 로 합쳐진다.
--     기존 'for all' 정책은 그대로 두고 'for select' 정책만 하나 더 얹으면,
--     읽기는 (관리 가능 OR 보기 가능) = 보기 가능으로 넓어지고,
--     insert/update/delete 는 기존 정책만 적용되어 그대로 좁게 남는다.
--     정책을 지웠다 다시 만들지 않으므로, 중간에 권한이 열리는 순간도 없다.
--
--   ■ 여러 번 실행해도 안전하다 (drop policy if exists → create 로 덮어쓴다)
-- ============================================================

-- 볼 수 있는가? (= 관리할 수 있거나, 그 반의 보조강사이거나)
create or replace function public.can_view_class(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_class(cid) or exists (
      select 1 from public.class_coteachers cc
       where cc.class_id = cid
         and cc.teacher_id = auth.uid()
         and cc.role = 'coupon'
    );
$$;

-- ---------- 읽기 정책 추가 (쓰기 정책은 건드리지 않는다) ----------

drop policy if exists classes_view on public.classes;
create policy classes_view on public.classes
  for select using (teacher_id = auth.uid() or public.can_view_class(id));

drop policy if exists students_view on public.students;
create policy students_view on public.students
  for select using (public.can_view_class(students.class_id));

drop policy if exists assignments_view on public.assignments;
create policy assignments_view on public.assignments
  for select using (public.can_view_class(assignments.class_id));

drop policy if exists submissions_view on public.submissions;
create policy submissions_view on public.submissions
  for select using (
    exists (select 1 from public.assignments a
             where a.id = submissions.assignment_id
               and public.can_view_class(a.class_id))
  );

drop policy if exists monthly_reports_view on public.monthly_reports;
create policy monthly_reports_view on public.monthly_reports
  for select using (
    exists (select 1 from public.students s
             where s.id = monthly_reports.student_id
               and public.can_view_class(s.class_id))
  );

-- ============================================================
--  확인용 — 보조강사에게 열린 것과 닫힌 것
--
--   열림(읽기) : 반 / 학생 명단 / 과제 / 제출물·점수 / 월말 리포트
--   닫힘(쓰기) : 과제 생성·수정·삭제, 학생 등록·승인·삭제, 채점 수정,
--                반 이름 변경, 인수인계, 리포트 저장·발송
--
--   쿠폰 발급은 예전과 같이 응용 코드에서 권한을 확인한 뒤 서비스 키로
--   처리한다 (canGrantCoupons). 이 마이그레이션은 그 동작을 바꾸지 않는다.
--
--   지금 걸려 있는 정책을 보려면:
--     select tablename, policyname, cmd
--       from pg_policies
--      where schemaname = 'public'
--        and tablename in ('classes','students','assignments',
--                          'submissions','monthly_reports')
--      order by tablename, policyname;
-- ============================================================
