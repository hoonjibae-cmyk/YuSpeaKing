-- 013_coupon_bonus.sql — 쿠폰함 기본 25칸 + 선생님이 직접 주는 보너스 쿠폰
-- ※ 012_rewards.sql 을 먼저 실행해야 합니다.

-- 목표 쿠폰 기본값을 10 → 25 로 변경
alter table public.teachers
  alter column coupon_goal set default 25;

-- 기존에 기본값(10)을 그대로 쓰던 선생님도 25로 맞춘다
update public.teachers set coupon_goal = 25 where coupon_goal = 10;

-- 선생님이 개별로 지급한 보너스 쿠폰 개수
-- (과제 제출로 자동 적립되는 쿠폰과 별개로 집계하고, 쿠폰함 초기화 시 함께 0으로 되돌린다)
alter table public.students
  add column if not exists bonus_coupons int not null default 0;
