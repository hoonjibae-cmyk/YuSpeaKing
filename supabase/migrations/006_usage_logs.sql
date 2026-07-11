-- 비용·사용량 로깅
-- Supabase SQL Editor 에서 실행

create table if not exists public.usage_logs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,          -- 'tts' | 'azure' | 'claude_feedback' | 'claude_monthly'
  model         text,
  input_tokens  int,
  output_tokens int,
  audio_seconds numeric,
  chars         int,
  cost_usd      numeric not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists usage_logs_created_idx on public.usage_logs (created_at);

-- 서버(서비스 롤)만 기록/조회. RLS 활성화 후 정책 없음 → 일반 사용자 접근 차단.
alter table public.usage_logs enable row level security;
