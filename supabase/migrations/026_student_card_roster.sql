-- ============================================================
--  026  Student Card 명단 연동
--
--   · 반 매칭: 유스피킹 반 ↔ Student Card 반
--     (이름이 다르면 운영자가 이어 주고, 이름이 같으면 자동으로 이어진다)
--   · 학생 연결: 이름이 바뀌어도 끊기지 않도록 Student Card 학생 ID 를 들고 있는다
--   · 동기화 결과: 선생님 화면에 '등록 안 된 학생' 알림을 띄우려면 매번 외부
--     API 를 부를 수 없으므로 결과를 저장해 두고 화면은 이것만 읽는다
--
--  ■ 이름에 남아 있는 hr_ 에 대하여
--    처음에 HR manager 와 잇는 것으로 만들었다가 Student Card 로 바뀌었다.
--    테이블·컬럼 이름은 그대로 두었다. 응용 코드가 이 이름들을 문자열로
--    쓰고 있어서(타입 검사에 걸리지 않는다) 한 군데라도 빠뜨리면 조용히
--    실패하기 때문이다. 여기서 hr_ 은 'Student Card 쪽' 이라는 뜻이다.
--
--  ■ 여러 번 실행해도 안전하다
--    모든 구문이 if not exists / 되돌림 없는 설정이라, 그대로 다시 실행해도
--    기존 데이터를 지우거나 덮어쓰지 않는다. (자세한 내용은 맨 아래 주석)
--
--  ■ 먼저 실행되어 있어야 하는 것: 025 (app_settings 테이블을 만든다)
-- ============================================================

-- ---------- 반 매칭 ----------
-- 한 번 이어 두면 그 뒤로는 ID 로 따라가므로, 양쪽에서 반 이름을 바꿔도
-- 연결이 끊기지 않는다.
create table if not exists public.class_links (
  class_id      uuid primary key references public.classes (id) on delete cascade,
  -- Student Card 반 ID (예: 'aca:1234')
  hr_class_id   text not null,
  -- 운영자 화면에 보여 줄 Student Card 쪽 반 이름 (참고용)
  hr_class_name text,
  linked_at     timestamptz not null default now(),
  -- 자동으로 이어진 경우 null
  linked_by     uuid references public.teachers (id) on delete set null
);

-- 한 Student Card 반이 유스피킹 반 두 개에 붙으면 같은 학생이 양쪽에
-- 올라오므로 막는다.
create unique index if not exists class_links_hr_idx
  on public.class_links (hr_class_id);

-- ---------- 학생 연결 + 연락처 ----------
-- hr_student_id : Student Card 학생 ID. 이름이 바뀌어도 연결을 유지하는 열쇠.
-- student_phone : 학생 본인 번호 (보관용)
-- (학부모 번호 parent_phone 은 025 에서 이미 만들었다 — 알림톡 발송에 쓰인다)
alter table public.students
  add column if not exists hr_student_id text,
  add column if not exists student_phone text;

create index if not exists students_hr_idx on public.students (hr_student_id);

-- ---------- 동기화 결과 ----------
-- Student Card 에는 있는데 유스피킹에 아직 없는 학생.
-- 선생님 첫 화면의 알림은 외부 API 가 아니라 이 표만 읽는다.
create table if not exists public.hr_pending_students (
  id             uuid primary key default gen_random_uuid(),
  class_id       uuid not null references public.classes (id) on delete cascade,
  hr_student_id  text not null,
  name           text not null,
  student_phone  text,
  parent_phone   text,
  -- 'new'       : 유스피킹에 없는 학생 → 선생님이 등록해야 함
  -- 'ambiguous' : 홍길동A·홍길동B 처럼 누구인지 사람이 골라야 함
  kind           text not null default 'new' check (kind in ('new', 'ambiguous')),
  -- ambiguous 일 때 어느 학생에 대한 후보인지
  local_student_id uuid references public.students (id) on delete cascade,
  found_at       timestamptz not null default now(),
  unique (class_id, hr_student_id)
);

create index if not exists hr_pending_class_idx
  on public.hr_pending_students (class_id);

-- 마지막 동기화 시각 (운영자 '반 매칭' 화면에 표시)
alter table public.app_settings
  add column if not exists hr_synced_at timestamptz;

-- ---------- 접근 권한 ----------
-- 이 표들은 서비스 롤로만 읽고 쓴다. 앱이 운영자/담당 선생님인지 먼저 확인한
-- 뒤에 접근하므로, 브라우저에서 직접 읽을 수 있으면 안 된다.
-- (정책을 만들지 않은 채 RLS 만 켜면 서비스 롤 외에는 아무도 읽지 못한다)
alter table public.class_links enable row level security;
alter table public.hr_pending_students enable row level security;

-- ============================================================
--  다시 실행했을 때 무슨 일이 일어나는가
--
--   create table if not exists   → 이미 있으면 건너뛴다. 안의 데이터는 그대로.
--   create index if not exists   → 이미 있으면 건너뛴다.
--   add column if not exists     → 이미 있으면 건너뛴다. 값은 그대로.
--   enable row level security    → 이미 켜져 있으면 아무 일도 없다.
--
--  지우거나(drop/delete) 덮어쓰는(update) 구문이 하나도 없으므로, 몇 번을
--  실행해도 결과는 같다.
--
--  다만 한 가지: 예전에 이 파일의 '일부만' 실행해서 표가 반쯤 만들어진
--  상태라면, create table if not exists 가 그 표를 건너뛰어 빠진 컬럼이
--  채워지지 않는다. 그럴 때는 아래로 지금 상태를 확인하면 된다.
--
--    select table_name, column_name
--      from information_schema.columns
--     where table_schema = 'public'
--       and table_name in ('class_links', 'hr_pending_students')
--     order by table_name, ordinal_position;
-- ============================================================
