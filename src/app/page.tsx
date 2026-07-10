import Link from "next/link";
import { Logo } from "@/components/Logo";

function HeroArt() {
  return (
    <svg
      viewBox="0 0 360 240"
      role="img"
      aria-label="원어민 발음을 듣고 말하고 AI가 평가하는 모습"
      className="mx-auto w-full max-w-sm"
    >
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#c4b5fd" />
        </linearGradient>
      </defs>

      {/* 배경 패널 */}
      <rect x="8" y="14" width="344" height="212" rx="28" fill="url(#bg)" />
      <circle cx="70" cy="60" r="46" fill="#ffffff" opacity="0.08" />
      <circle cx="300" cy="185" r="60" fill="#ffffff" opacity="0.08" />

      {/* 말풍선 (듣기·말하기) */}
      <g>
        <rect x="70" y="70" width="150" height="86" rx="20" fill="#ffffff" />
        <path d="M104 156 l0 22 l24 -22 z" fill="#ffffff" />
        {/* 음성 파형 */}
        <g fill="url(#wave)">
          <rect x="92" y="104" width="8" height="18" rx="4" />
          <rect x="106" y="94" width="8" height="38" rx="4" />
          <rect x="120" y="86" width="8" height="54" rx="4" />
          <rect x="134" y="98" width="8" height="30" rx="4" />
          <rect x="148" y="90" width="8" height="46" rx="4" />
          <rect x="162" y="102" width="8" height="22" rx="4" />
          <rect x="176" y="96" width="8" height="34" rx="4" />
          <rect x="190" y="106" width="8" height="14" rx="4" />
        </g>
      </g>

      {/* 헤드폰 (원어민 듣기) */}
      <g stroke="#ede9fe" strokeWidth="7" fill="none" strokeLinecap="round">
        <path d="M250 96 a44 44 0 0 1 88 0" />
      </g>
      <rect x="242" y="94" width="18" height="34" rx="9" fill="#ede9fe" />
      <rect x="328" y="94" width="18" height="34" rx="9" fill="#ede9fe" />

      {/* 마이크 (녹음) */}
      <g transform="translate(286,150)">
        <rect x="-11" y="-26" width="22" height="40" rx="11" fill="#ffffff" />
        <path d="M-20 2 a20 20 0 0 0 40 0" stroke="#ffffff" strokeWidth="6" fill="none" strokeLinecap="round" />
        <line x1="0" y1="22" x2="0" y2="34" stroke="#ffffff" strokeWidth="6" strokeLinecap="round" />
      </g>

      {/* AI 스파클 */}
      <g fill="#fde68a">
        <path d="M232 52 l4 10 l10 4 l-10 4 l-4 10 l-4 -10 l-10 -4 l10 -4 z" />
        <path d="M60 150 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 z" />
      </g>
    </svg>
  );
}

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <Logo size="lg" />

      <HeroArt />

      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-brand">유스피킹</h1>
        <p className="text-lg text-slate-600">
          원어민 발음을 듣고, 직접 읽고, AI가 바로 평가해주는
          <br />
          초등 영어 스피킹 학습 서비스
        </p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <Link
          href="/student"
          className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition hover:border-brand hover:shadow-md"
        >
          <div className="text-2xl">🎙️</div>
          <div className="mt-3 text-xl font-semibold">학생</div>
          <p className="mt-1 text-sm text-slate-500">
            반 코드로 입장해 과제를 녹음·제출해요
          </p>
        </Link>

        <Link
          href="/teacher"
          className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm transition hover:border-brand hover:shadow-md"
        >
          <div className="text-2xl">🧑‍🏫</div>
          <div className="mt-3 text-xl font-semibold">선생님</div>
          <p className="mt-1 text-sm text-slate-500">
            지문을 등록하고 제출·평가를 관리해요
          </p>
        </Link>
      </div>
    </main>
  );
}
