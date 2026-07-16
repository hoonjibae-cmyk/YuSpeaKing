import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/lib/student-session";
import { studentLogin } from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/Logo";

export default async function StudentEntryPage({
  searchParams,
}: {
  searchParams: { error?: string; signup?: string };
}) {
  if (await getStudentSession()) redirect("/student/home");

  const inputCls =
    "w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none";

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-2xl font-bold text-brand">유스피킹</span>
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold">학생 로그인</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          아이디와 비밀번호를 입력해요
        </p>

        {searchParams.signup === "done" && (
          <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-center text-sm text-green-700">
            가입 신청이 접수됐어요! 선생님 승인 후 로그인할 수 있어요 🙂
          </p>
        )}

        {searchParams.error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form action={studentLogin} className="mt-6 space-y-3">
          <input
            name="username"
            placeholder="아이디"
            required
            autoCapitalize="none"
            autoComplete="username"
            className={inputCls}
          />
          <input
            name="password"
            type="password"
            placeholder="비밀번호"
            required
            autoComplete="current-password"
            className={inputCls}
          />
          <SubmitButton
            pendingText="확인 중…"
            className="w-full rounded-xl bg-brand py-3 text-lg font-semibold text-white transition hover:bg-brand-dark"
          >
            로그인
          </SubmitButton>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-slate-400">
        처음이신가요?{" "}
        <Link
          href="/student/signup"
          className="font-medium text-brand hover:underline"
        >
          가입 신청하기
        </Link>
      </p>
    </main>
  );
}
