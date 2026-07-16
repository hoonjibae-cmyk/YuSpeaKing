import Link from "next/link";
import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { signIn, signUp } from "../actions";

export default async function TeacherLoginPage({
  searchParams,
}: {
  searchParams: { error?: string; signup?: string; mode?: string };
}) {
  // 이미 로그인 상태면 대시보드로
  if (await getTeacher()) redirect("/teacher");

  const isSignup = searchParams.mode === "signup";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-xl font-bold text-brand">유스피킹</span>
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">
          {isSignup ? "선생님 회원가입" : "선생님 로그인"}
        </h1>

        {searchParams.signup && (
          <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            가입 신청이 접수됐어요. 총괄관리자 승인 후 로그인할 수 있어요.
          </p>
        )}
        {searchParams.error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
            {searchParams.error}
          </p>
        )}

        <form action={isSignup ? signUp : signIn} className="mt-6 space-y-4">
          {isSignup && (
            <div>
              <label className="text-sm font-medium text-slate-600">이름</label>
              <input
                name="name"
                type="text"
                required
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-slate-600">이메일</label>
            <input
              name="email"
              type="email"
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-600">비밀번호</label>
            <input
              name="password"
              type="password"
              required
              minLength={6}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
          </div>
          {isSignup && (
            <div>
              <label className="text-sm font-medium text-slate-600">
                Slack 이메일 <span className="text-red-500">*</span>
              </label>
              <input
                name="slack_email"
                type="email"
                required
                placeholder="가입 신청 알림을 받을 Slack 계정 이메일"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-400">
                학생 가입 신청 시 이 Slack 계정으로 DM을 받아요. (Slack
                워크스페이스 멤버 이메일)
              </p>
            </div>
          )}
          <button
            type="submit"
            className="w-full rounded-lg bg-brand py-2.5 font-medium text-white transition hover:bg-brand-dark"
          >
            {isSignup ? "가입 신청하기" : "로그인"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500">
          {isSignup ? (
            <Link href="/teacher/login" className="text-brand hover:underline">
              이미 계정이 있어요 · 로그인
            </Link>
          ) : (
            <Link
              href="/teacher/login?mode=signup"
              className="text-brand hover:underline"
            >
              처음이신가요? · 회원가입
            </Link>
          )}
        </p>
      </div>
    </main>
  );
}
