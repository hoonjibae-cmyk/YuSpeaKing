# 유스피킹 배포 가이드 (Supabase + Vercel)

이 문서는 코드를 실제로 인터넷에 올려 학생·선생님이 쓸 수 있게 만드는 전체 과정을
단계별로 안내합니다. 개발 지식이 없어도 따라 할 수 있도록 최대한 자세히 적었습니다.

전체 순서:
1. Supabase 프로젝트 만들기 & DB 세팅
2. 외부 AI 서비스 키 발급 (OpenAI · Azure · Anthropic)
3. 환경변수 값 모으기
4. Vercel에 배포
5. 첫 사용 (교사 → 학생 흐름 확인)
6. 문제 해결(Troubleshooting)

예상 소요: 30~60분. 결제카드가 필요한 서비스는 OpenAI/Azure/Anthropic(유료 종량제)입니다.
Supabase·Vercel은 무료로 시작 가능합니다.

---

## 1. Supabase 프로젝트 만들기 & DB 세팅

### 1-1. 프로젝트 생성
1. https://supabase.com 접속 → GitHub로 로그인
2. **New project** 클릭
3. 입력:
   - **Name**: `yuspeaking` (아무 이름)
   - **Database Password**: 강한 비밀번호 (메모해 두세요, 나중에 직접 쓸 일은 거의 없음)
   - **Region**: `Northeast Asia (Seoul)` 권장
4. **Create new project** → 1~2분 대기

### 1-2. DB 스키마 실행 (테이블·권한·저장소 한 번에)
1. 왼쪽 메뉴 **SQL Editor** → **New query**
2. 이 저장소의 **`supabase/schema.sql`** 파일 내용을 전부 복사해 붙여넣기
3. 오른쪽 아래 **Run** 클릭
4. "Success" 가 뜨면 완료. 아래가 자동 생성됩니다:
   - 테이블: `teachers`, `classes`, `students`, `assignments`, `submissions`
   - 보안 정책(RLS): 교사는 본인 반 데이터만 접근
   - Storage 버킷: `sample-audio`(공개), `submissions`(비공개)

> 저장소(오디오 파일) 접근은 전부 서버(service_role)를 통해서만 이뤄지므로 추가 Storage
> 정책 설정은 필요 없습니다.

### 1-3. (권장) 이메일 인증 끄기 — 교사 가입을 간단하게
교사 회원가입 시 이메일 확인 절차가 번거로우면 끌 수 있습니다.
1. 왼쪽 메뉴 **Authentication** → **Sign In / Providers** (또는 **Settings**)
2. **Email** 항목에서 **Confirm email** 을 **끄기(Off)**
3. 저장

> 실제 운영에서 교사 계정을 여러 명 받을 계획이면 켜 두는 게 안전합니다. 처음 테스트 땐 꺼두면 편합니다.

### 1-4. API 키 3종 복사 (나중에 Vercel에 넣을 값)
왼쪽 메뉴 **Project Settings**(톱니바퀴) → **API** 에서 아래 3개를 메모:
- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon public** 키 → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **service_role** 키 → `SUPABASE_SERVICE_ROLE_KEY` ⚠️ **절대 외부에 노출 금지** (서버 전용)

---

## 2. 외부 AI 서비스 키 발급

### 2-1. OpenAI (샘플 음성 TTS) — `OPENAI_API_KEY`
1. https://platform.openai.com 로그인 → 결제수단 등록(Billing)
2. **API keys** → **Create new secret key** → 값 복사
3. (선택) 음성 톤을 바꾸려면 `OPENAI_TTS_VOICE` 값으로 `nova`/`alloy`/`shimmer` 등 지정 가능

### 2-2. Azure Speech (발음 평가) — `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`
1. https://portal.azure.com 로그인 (Azure 계정 필요, 무료 크레딧 있음)
2. 상단 검색창에 **Speech services** → **Create**
3. 입력:
   - **Region**: `Korea Central` (또는 `East US`)
   - **Name**: `yuspeaking-speech`
   - **Pricing tier**: `Free (F0)` 로 시작 가능 (발음평가 지원)
4. 생성 후 리소스의 **Keys and Endpoint** 메뉴에서:
   - **KEY 1** → `AZURE_SPEECH_KEY`
   - **Location/Region** (예: `koreacentral`) → `AZURE_SPEECH_REGION`

> 발음 평가(Pronunciation Assessment)는 Azure Speech의 표준 기능입니다. 지역명은 공백 없이
> 소문자로 넣습니다(예: `koreacentral`, `eastus`).

### 2-3. Anthropic Claude (피드백 생성) — `ANTHROPIC_API_KEY`
1. https://console.anthropic.com 로그인 → 결제수단 등록
2. **API Keys** → **Create Key** → 값 복사
3. (선택) 모델을 바꾸려면 `ANTHROPIC_MODEL` 값 지정 (기본 최신 Sonnet 사용)

### 2-4. 학생 세션 서명 키 — `STUDENT_SESSION_SECRET`
학생 로그인 쿠키를 안전하게 서명하는 데 쓰는 임의의 긴 문자열입니다. 아무 무작위 문자열이면
됩니다. 예를 들어 터미널에서 `openssl rand -base64 32` 결과를 쓰거나, 아무 긴 랜덤 문자열을
직접 만들어 넣으세요.

---

## 3. 환경변수 정리 (체크리스트)

Vercel에 넣을 최종 목록입니다. `.env.example` 과 동일합니다.

| 키 | 어디서 얻나 | 공개 여부 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API | 공개 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API | 공개 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API | **서버 전용** |
| `STUDENT_SESSION_SECRET` | 직접 생성 | **서버 전용** |
| `OPENAI_API_KEY` | OpenAI | **서버 전용** |
| `OPENAI_TTS_VOICE` (선택) | 직접 지정 | 서버 |
| `AZURE_SPEECH_KEY` | Azure | **서버 전용** |
| `AZURE_SPEECH_REGION` | Azure | 서버 |
| `ANTHROPIC_API_KEY` | Anthropic | **서버 전용** |
| `ANTHROPIC_MODEL` (선택) | 직접 지정 | 서버 |

---

## 4. Vercel에 배포

### 4-1. 프로젝트 연결
1. https://vercel.com 로그인 (GitHub 계정)
2. **Add New… → Project**
3. GitHub 저장소 목록에서 **`YuSpeaKing`** 선택 → **Import**
   - (Vercel GitHub App은 이미 설치돼 있어 바로 보일 겁니다)
4. Framework Preset이 **Next.js** 로 자동 인식되는지 확인 (그대로 두면 됨)

### 4-2. 브랜치 설정 (중요)
현재 코드는 `claude/intelligent-cori-f2mga1` 브랜치에 있습니다. 두 가지 방법 중 하나:
- **간단**: 이 브랜치를 GitHub에서 `main` 으로 머지(Pull Request 생성 후 Merge)한 뒤 배포, 또는
- **바로**: Vercel 프로젝트 **Settings → Git → Production Branch** 를
  `claude/intelligent-cori-f2mga1` 로 지정

### 4-3. 환경변수 등록
Import 화면(또는 **Settings → Environment Variables**)에서 3장 표의 값을 모두 추가합니다.
- 각 변수를 **Production, Preview, Development** 에 모두 적용되도록 체크
- 값에 따옴표(" ") 붙이지 말 것

### 4-4. 배포
1. **Deploy** 클릭 → 빌드 로그가 흐르고 1~2분 뒤 완료
2. 발급된 주소(예: `https://yuspeaking.vercel.app`) 접속 → 랜딩 페이지가 뜨면 성공 🎉

---

## 5. 첫 사용 (동작 확인)

### 교사
1. 배포 주소 → **선생님** → **회원가입** (이메일/비번)
   - (이메일 인증을 안 껐다면 메일함 확인 후 로그인)
2. **새 반 만들기** → 반 코드(예: `ABC234`)가 생성됨
3. 반 클릭 → **학생 명단**에 번호/이름 추가
4. **새 지문 등록** → 영어 지문 입력 → 저장하면 잠시 후 "✓ 샘플음성 준비됨"

### 학생 (다른 창/휴대폰에서)
1. 배포 주소 → **학생** → 반 코드 입력 → 본인 이름 선택
2. 과제 열기 → **원어민 샘플 듣기** → **지문 읽으며 녹음** → **제출**
3. 잠시 후 **간단 AI 피드백**(점수 + 격려)이 표시됨

### 교사 (다시)
- 반 → 과제 클릭 → 학생별 **상세 리포트**(세부 점수·취약 단어·오디오 재생·학부모 안내 초안)
  확인 및 수정 → **검토완료** 체크

---

## 6. 문제 해결 (Troubleshooting)

**빌드 실패**
- 환경변수 오타 확인. `NEXT_PUBLIC_` 접두사가 붙은 2개는 반드시 그대로.

**샘플음성이 안 생김("⚠ 샘플음성 없음")**
- `OPENAI_API_KEY` 확인, OpenAI 결제수단 등록 여부 확인.
- 반 상세에서 해당 과제의 **"샘플음성 재생성"** 클릭.

**학생 제출 후 평가가 "오류"로 뜸**
- `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION` 확인(지역명 소문자·공백없음).
- 지문과 실제 발화가 너무 다르거나 무음이면 인식 실패할 수 있음 → 재녹음.
- 교사 대시보드의 상세 리포트에서 **"AI 재평가 실행"** 으로 재시도.

**피드백 문구가 이상하거나 비어 있음**
- `ANTHROPIC_API_KEY` 및 결제 확인.

**학생 로그인 후 바로 튕김**
- `STUDENT_SESSION_SECRET` 미설정. Vercel 환경변수에 추가 후 재배포.

**마이크 권한 문제(학생 녹음 안 됨)**
- HTTPS 주소에서만 마이크 사용 가능(Vercel은 자동 HTTPS라 문제 없음).
- 브라우저 주소창의 마이크 권한 허용 확인. iOS는 Safari 권장.

**교사가 회원가입했는데 로그인 안 됨**
- 이메일 인증을 안 껐다면 메일함의 확인 링크 클릭 필요(1-3 참고).

---

## 참고: 비용 감각
- **Supabase / Vercel**: 무료 티어로 시작(트래픽·용량 늘면 유료).
- **OpenAI TTS**: 지문당 1회 생성(캐싱)이라 매우 저렴.
- **Azure 발음평가**: 제출 1건(수십 초)당 소액. 무료 F0 티어로 초기 테스트 가능.
- **Claude 피드백**: 제출당 소액.

실제 요율은 각 서비스 콘솔에서 현재가로 확인하세요.
