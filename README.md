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

> 📘 **단계별 상세 배포 가이드**(Supabase 세팅 · AI 키 발급 · Vercel 연결 · 첫 사용 ·
> 문제 해결)는 **[`docs/DEPLOY.md`](docs/DEPLOY.md)** 참고.

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
- [x] M1 교사 코어 (로그인 · 반/학생 관리 · 과제 등록 + TTS)
- [x] M2 학생 코어 (반코드 로그인 · 연습 · 녹음 제출)
- [x] M3 AI 평가 파이프라인 (Azure 발음평가 + LLM 2단 피드백)
- [x] M4 교사 대시보드 & 상세 리포트

## 평가 흐름 (하이브리드)
학생이 녹음을 제출하면 브라우저에서 16kHz WAV로 변환 → 서버가 Azure 발음평가 →
Claude가 **학생용 간단 피드백**(즉시 노출)과 **교사용 상세 리포트**(관리자 전용,
학부모 안내 문구 초안 포함)를 생성합니다. 선생님은 관리자 대시보드에서 상세 리포트를
검토·수정하고 검토완료로 표시할 수 있습니다.
