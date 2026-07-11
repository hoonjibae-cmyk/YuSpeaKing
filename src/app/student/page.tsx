import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/lib/student-session";
import { studentLogin } from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/Logo";

export default async function StudentEntryPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  if (await getStudentSession()) redirect("/student/home");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-2xl font-bold text-brand">유스피킹</span>
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold">학생 로그인</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          반 코드와 본인 이름·번호를 입력해요
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form action={studentLogin} className="mt-6 space-y-3">
          <input
            name="code"
            placeholder="반 코드 (예: ABC234)"
            required
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg font-bold uppercase tracking-widest focus:border-brand focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              name="number"
              type="number"
              placeholder="번호"
              required
              className="w-20 shrink-0 rounded-xl border border-slate-300 px-3 py-3 text-center focus:border-brand focus:outline-none"
            />
            <input
              name="name"
              placeholder="이름"
              required
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none"
            />
          </div>
          <SubmitButton
            pendingText="확인 중…"
            className="w-full rounded-xl bg-brand py-3 text-lg font-semibold text-white transition hover:bg-brand-dark"
          >
            입장하기
          </SubmitButton>
        </form>
      </div>

      <p className="mt-4 text-center text-xs text-slate-400">
        처음이면 입장 후 나만의 PIN을 정할 수 있어요 🔒
      </p>
    </main>
  );
}
