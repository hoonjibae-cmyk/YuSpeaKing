-- ============================================================
--  030  학부모 링크 알림톡 발송 기록
--
--   학부모 열람 링크(/parent/토큰)를 알림톡으로 보낸 기록. 언제·어느 번호로
--   몇 번 보냈는지 남겨, 같은 학부모께 겹쳐 보내지 않게 하고 화면에 표시한다.
--
--   ■ 여러 번 실행해도 안전하다 (if not exists 뿐)
-- ============================================================

create table if not exists public.parent_link_sends (
  student_id uuid primary key references public.students (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  sent_to    text,
  sent_count int not null default 1
);

-- 서비스 롤로만 읽고 쓴다 (정책 없이 RLS 만 켠다)
alter table public.parent_link_sends enable row level security;
