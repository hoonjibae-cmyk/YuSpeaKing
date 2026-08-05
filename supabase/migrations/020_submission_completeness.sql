-- ============================================================
--  020  제출물 완성도를 별도 칼럼으로 분리
--   쿠폰 적립 기준(완성도 90 이상)을 세려면 지금은 azure_scores(jsonb) 전체를
--   읽어야 해서 목록 조회가 무겁다. 완성도만 칼럼으로 빼서 가볍게 집계한다.
-- ============================================================

alter table public.submissions
  add column if not exists completeness numeric;

-- 기존 채점 결과에서 완성도 값 채우기
update public.submissions
   set completeness = (azure_scores ->> 'completeness')::numeric
 where completeness is null
   and azure_scores ? 'completeness';

-- 쿠폰 집계용 (학생별 · 적립 대상만)
create index if not exists submissions_coupon_idx
  on public.submissions (student_id, created_at)
  where status = 'evaluated' and completeness >= 90;
