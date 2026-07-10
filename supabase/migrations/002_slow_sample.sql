-- 느린 속도 샘플 음성 URL (초6이 따라 듣기 쉽도록 0.75배 버전)
-- Supabase SQL Editor 에서 실행

alter table public.assignments
  add column if not exists sample_audio_slow_url text;
