# 유스피킹 (YuSpeaking)

초등 영어 스피킹 과제 제출 & AI 발음 평가 웹앱.

매일 러닝 교사용(v1.54.2): 전용 `teacher-dashboard` POST는 유쌤포탈의 서명된 읽기 권한을 온라인으로 확인하고, 승인된 선생님의 본인/유효한 공동 관리 반에 한해 최근 과제와 제출 인원을 반환합니다. 학생 이름·음성·점수는 반환하지 않으며 동기화·예약 이동·DB 쓰기를 실행하지 않습니다. 기존 출제 및 로그인 화면은 유지합니다.

매일 러닝 연결(v1.54.0): `LEARNING_PORTAL_ENABLED=true`에서 전용 SSO 진입 경로를 제공합니다. 기존 주소의 화면·로그인은 유지하며, 포탈 연결 후에만 공통 학습 메뉴를 표시합니다. `/learning-portal/preview`는 인증된 가상 학생 전용으로, 기존 녹음 UI를 사용하지만 업로드·유료 평가를 실행하지 않습니다. OpenAI 선택과 WaveNet F 일반·0.7배속 세트 생성은 유지합니다.

학생이 그날의 지문을 (1) 원어민 샘플 음성으로 듣고 → (2) 직접 읽으며 녹음·제출하면
→ (3) AI가 발음을 자동 평가합니다. 학생에겐 즉시 **간단 피드백**을, 선생님 관리자
페이지에는 **상세 리포트**를 제공하는 하이브리드 방식입니다.

## 스택

| 영역 | 기술 |
|---|---|
| 프론트/호스팅 | Next.js (App Router) · Vercel |
| DB · 인증 · 스토리지 | Supabase (Postgres · Auth · Storage) |
| 샘플 음성 (TTS) | Google Cloud WaveNet F (새 과제 기본) · OpenAI `gpt-4o-mini-tts` (선택) |
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

Google 음성이 활성화된 환경에서는 새 과제의 기본 음성이 미국 영어 WaveNet F입니다.
WaveNet 10종 또는 기존 OpenAI 음성 중에서 선택할 수 있습니다.
WaveNet은 같은 목소리로 일반 낭독과 강제 쉼 없는
0.7배속 MP3를 함께 저장합니다. 운영 인증·환경변수·검증 방법은
[`docs/WAVENET-PRODUCTION.md`](docs/WAVENET-PRODUCTION.md)를 참고하세요.

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
