import Image from "next/image";
import Link from "next/link";
import PrintButton from "./PrintButton";
import { CrownMark } from "./Logo";

const chapters = [
  "가입하기",
  "홈 화면 살펴보기",
  "과제하는 순서",
  "점수와 내 기록",
  "성취 배지 모으기",
  "쿠폰 모아 상품 받기",
  "공지사항 확인하기",
  "자주 묻는 질문",
];

export function ManualShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[#f4f7fc] text-slate-800 print:bg-white">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-5 md:px-8">
          <Link href="/" className="flex items-center gap-3 font-bold text-brand">
            <CrownMark className="h-9 w-9" />
            유스피킹
            <span className="text-sm font-normal text-slate-400">학생 가이드</span>
          </Link>
          <PrintButton className="no-print rounded-full bg-brand px-4 py-2 text-sm font-medium text-white" />
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-5 py-9 md:px-8 md:py-14 print:p-0">
        <div className="mb-9 overflow-hidden rounded-[28px] bg-gradient-to-br from-[#173967] via-[#2454a2] to-[#6c63d9] p-7 text-white md:p-11 print:bg-white print:text-black">
          <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-blue-100 print:text-slate-500">
            YUSPEAKING · STUDENT GUIDE
          </p>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl leading-7 text-blue-50 print:text-slate-600">{subtitle}</p>
          <div className="mt-7 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/15 px-3 py-2">화면을 보며 차근차근 따라하기</span>
            <span className="rounded-full bg-white/15 px-3 py-2">휴대폰 · 태블릿 · 컴퓨터</span>
            <span className="rounded-full bg-white/15 px-3 py-2">2026.09 업데이트</span>
          </div>
        </div>

        <div className="grid items-start gap-9 lg:grid-cols-[210px_minmax(0,1fr)]">
          <aside className="no-print lg:sticky lg:top-6">
            <p className="mb-3 text-xs font-bold tracking-widest text-slate-400">CONTENTS</p>
            <nav aria-label="학생 가이드 목차" className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-1">
              {chapters.map((chapter, index) => (
                <a
                  key={chapter}
                  href={`#chapter-${index + 1}`}
                  className="rounded-lg px-3 py-2 text-sm text-slate-600 transition hover:bg-white hover:text-brand"
                >
                  <span className="mr-2 text-xs text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                  {chapter}
                </a>
              ))}
            </nav>
          </aside>

          <article className="min-w-0">
            <div className="mb-5 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
              화면은 실제 유스피킹 프로그램을 익명 예시 데이터로 실행해 캡처했습니다. 이미지를 누르면 크게 볼 수 있어요.
            </div>
            {children}
            <footer className="mt-10 border-t py-6 text-xs text-slate-400">
              목동유쌤영어 · YuSpeaKing 학생 가이드
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}

export function Section({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`chapter-${no}`}
      className="mb-6 scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-8 print:border-0 print:p-0 print:shadow-none"
    >
      <h2 className="mb-6 flex items-center gap-3 text-xl font-bold tracking-tight">
        <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-indigo-50 px-2 text-sm text-brand">
          {no}
        </span>
        {title}
      </h2>
      <div className="space-y-5 text-sm leading-7 text-slate-600">{children}</div>
    </section>
  );
}

export function GuideScreen({
  name,
  title,
  caption,
  height,
}: {
  name: string;
  title: string;
  caption: string;
  height: number;
}) {
  const src = `/manual/student/${name}.png`;

  return (
    <figure className="print-avoid-break mx-auto my-7 max-w-[600px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-sm">
      <div className="flex items-center gap-2 border-b bg-white px-4 py-3 text-xs font-semibold text-slate-600">
        <span className="h-2 w-2 rounded-full bg-indigo-400" />
        {title}
        <span className="ml-auto font-normal text-slate-400">예시 화면</span>
      </div>
      <a href={src} target="_blank" rel="noreferrer" aria-label={`${title} 크게 보기 (새 탭)`}>
        <Image
          src={src}
          alt={caption}
          width={560}
          height={height}
          className="h-auto w-full"
          unoptimized
        />
      </a>
      <figcaption className="border-t bg-white px-4 py-3 text-xs leading-6 text-slate-500">
        {caption}
      </figcaption>
    </figure>
  );
}
