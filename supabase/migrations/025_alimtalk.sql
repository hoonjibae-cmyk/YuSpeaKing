-- ============================================================
--  025  카카오 알림톡 발송 + 운영자 설정
--   · 학부모 연락처: 알림톡을 보내려면 번호가 있어야 한다.
--     지금까지 수집한 적이 없으므로 선생님이 명단에서 입력한다.
--   · 운영자 설정: AI 모델을 환경변수 재배포 없이 화면에서 바꾸기 위함.
--   · 발송 이력: 같은 리포트를 두 번 보내지 않도록 기록을 남긴다.
-- ============================================================

-- 학부모 연락처 (숫자만 저장. 예: 01012345678)
alter table public.students
  add column if not exists parent_phone text;

-- 운영자 설정 (행 하나만 존재)
create table if not exists public.app_settings (
  id         smallint primary key default 1 check (id = 1),
  ai_model   text,                       -- 비우면 환경변수/기본값 사용
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;

drop trigger if exists app_settings_touch on public.app_settings;
create trigger app_settings_touch
  before update on public.app_settings
  for each row execute function public.touch_updated_at();

-- 서비스 롤로만 읽고 쓴다 (앱에서 운영자 권한을 확인한 뒤 접근)
alter table public.app_settings enable row level security;

-- 월말 리포트 발송 이력
alter table public.monthly_reports
  add column if not exists sent_at timestamptz,
  add column if not exists sent_to text;   -- 보낸 번호 (마스킹 없이 기록)
