-- ============================================================
--  028  주간 운영 요약 (경영지원·교수부장 슬랙 알림)
--
--   · 녹음 시간: 지금까지 어디에도 남지 않았다. Azure 로 보낼 때 길이를
--     계산하지만 비용 로그(usage_logs)에만 들어가고, 그 표에는 어느 반·어느
--     학생인지가 없어 반별 평균을 낼 수 없었다. 제출물에 직접 남긴다.
--   · 받는 사람: 담당자가 바뀔 때마다 재배포하지 않도록 설정 표에 둔다.
--
--   ■ 여러 번 실행해도 안전하다 (add column if not exists 뿐)
--   ■ 먼저 실행되어 있어야 하는 것: 025 (app_settings 표를 만든다)
-- ============================================================

-- 녹음 길이(초). 채점할 때 내려받은 WAV 에서 계산해 함께 저장한다.
-- 이 마이그레이션 이전의 제출물은 값이 없다(null) — 평균에서 빠진다.
alter table public.submissions
  add column if not exists audio_seconds numeric;

-- 주간 요약을 받을 사람의 슬랙 이메일.
-- 운영자 → 설정 화면에서 넣고 뺀다. 비어 있으면 아무에게도 보내지 않는다.
alter table public.app_settings
  add column if not exists weekly_report_emails text[] not null default '{}';
