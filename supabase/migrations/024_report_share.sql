-- ============================================================
--  024  월말 리포트 웹링크 발송
--   학부모께 리포트를 링크로 보낼 수 있도록 공유 토큰을 둔다.
--   선생님이 '링크 발급'을 눌렀을 때만 값이 생기므로, 발급 전에는
--   링크가 존재하지 않는다(초안 상태의 글이 새어 나가지 않는다).
-- ============================================================

alter table public.monthly_reports
  add column if not exists share_token text;

-- 토큰으로 바로 찾기 (학부모 링크 조회)
create unique index if not exists monthly_reports_share_token_idx
  on public.monthly_reports (share_token)
  where share_token is not null;
