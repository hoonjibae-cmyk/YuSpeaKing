-- 012_rewards.sql — 성취 배지 축하 연출 + 완성도 쿠폰/보상 제도

-- 선생님별 쿠폰/보상 설정
--  · coupon_goal        : 쿠폰 몇 개를 모으면 상품을 받는지
--  · coupon_reward_text : 다 모았을 때 학생에게 띄울 안내 문구(상품 안내 등)
alter table public.teachers
  add column if not exists coupon_goal int not null default 10,
  add column if not exists coupon_reward_text text;

-- 학생별 쿠폰함/배지 상태
--  · coupons_reset_at : 마지막 쿠폰함 리셋(상품 수령) 시각. 이 시각 이후 제출분만 쿠폰으로 집계.
--  · seen_badges      : 이미 축하 연출을 본 배지 key 목록(중복 축하 방지)
alter table public.students
  add column if not exists coupons_reset_at timestamptz,
  add column if not exists seen_badges jsonb not null default '[]'::jsonb;
