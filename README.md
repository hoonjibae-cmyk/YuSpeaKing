# 유스피킹 (YuSpeaking)

초등 영어 스피킹 과제 제출 & AI 발음 평가 웹앱.

학생이 그날의 지문을 (1) 원어민 샘플 음성으로 듣고 → (2) 직접 읽으며 녹음·제출하면
→ (3) AI가 발음을 자동 평가합니다. 학생에겐 즉시 **간단 피드백**을, 선생님 관리자
페이지에는 **상세 리포트**를 제공하는 하이브리드 방식입니다.

## 스택

| 영역 | 기술 |
|---|---|
| 프론트/호스팅 | Next.js (App Router) · Vercel |
| DB · 인증 · 스토리지 | Supabase (Postgres · Auth · Storage) |
| 샘플 음성 (TTS) | OpenAI `tts-1-hd` |
| 발음 채점 | Azure Speech — Pronunciation Assessment |
| 피드백 생성 | Anthropic Claude |

## 로컬 개발

```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev
```

### 1. Supabase 준비
1. supabase.com 에서 프로젝트 생성
2. SQL Editor에 `supabase/schema.sql` 실행 (테이블 · RLS · Storage 버킷 생성)
3. Project Settings > API 에서 URL / anon key / service_role key 를 `.env.local` 에 입력

### 2. 환경변수
`.env.example` 참고. 서버 전용 키(`SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`,
`AZURE_SPEECH_KEY`, `ANTHROPIC_API_KEY`, `STUDENT_SESSION_SECRET`)는 클라이언트에
노출되지 않습니다.

## 배포 (Vercel)
1. GitHub 저장소를 Vercel에 연결
2. 위 환경변수를 Vercel 프로젝트에 등록
3. Push 시 자동 배포

## 구조

```
src/
  app/
    page.tsx            랜딩 (학생/교사 진입)
    student/            학생 화면 (로그인·연습·녹음·결과)
    teacher/            교사 화면 (로그인·반/과제 관리·대시보드)
    api/                Route Handlers (TTS 생성, 제출, 평가 등)
  lib/
    supabase/           Supabase 클라이언트 (browser/server/admin)
    student-session.ts  학생 반코드 로그인 세션 (서명 쿠키)
    types.ts            공용 도메인 타입
supabase/schema.sql     DB 스키마 · RLS · 버킷
```

## 개발 진행 (마일스톤)
- [x] M0 프로젝트 셋업 (Next.js + Supabase 스캐폴딩)
- [ ] M1 교사 코어 (로그인 · 반/학생 관리 · 과제 등록 + TTS)
- [ ] M2 학생 코어 (반코드 로그인 · 연습 · 녹음 제출)
- [ ] M3 AI 평가 파이프라인 (Azure 발음평가 + LLM 2단 피드백)
- [ ] M4 교사 대시보드 & 상세 리포트
