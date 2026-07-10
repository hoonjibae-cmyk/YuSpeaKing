import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-brand">
          유스피킹
        </h1>
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

      <p className="text-xs text-slate-400">
        Vercel · Supabase · OpenAI TTS · Azure 발음평가 · Claude
      </p>
    </main>
  );
}
