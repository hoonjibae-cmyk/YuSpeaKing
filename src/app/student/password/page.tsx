import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { changeStudentPassword } from "../actions";
import SubmitButton from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// 학생이 직접 비밀번호를 바꾼다. 선생님이 재설정해 준 임시 비밀번호는 외우기
// 어려워서, 로그인한 뒤 자기가 기억할 수 있는 것으로 바꾸게 한다.
export default async function StudentPasswordPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  await requireStudent();
  const field =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 focus:border-brand focus:outline-none";

  return (
    <main className="mx-auto max-w-sm px-6 py-10">
      <Link
        href="/student/home"
        className="text-sm text-slate-500 hover:underline"
      >
        ← 오늘의 스피킹
      </Link>
      <h1 className="mt-3 text-xl font-bold text-brand">🔑 비밀번호 바꾸기</h1>
      <p className="mt-1 text-sm text-slate-500">
        내가 기억하기 쉬운 비밀번호로 바꿔요.
      </p>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      <form action={changeStudentPassword} className="mt-5 space-y-4">
        <label className="block text-sm text-slate-600">
          지금 비밀번호
          <input
            name="current"
            type="password"
            required
            autoComplete="current-password"
            className={field}
          />
          <span className="mt-1 block text-xs text-slate-400">
            선생님이 임시 비밀번호를 주셨다면 그걸 적어요.
          </span>
        </label>
        <label className="block text-sm text-slate-600">
          새 비밀번호
          <input
            name="password"
            type="password"
            required
            minLength={4}
            autoComplete="new-password"
            className={field}
          />
          <span className="mt-1 block text-xs text-slate-400">
            4자 이상이에요.
          </span>
        </label>
        <label className="block text-sm text-slate-600">
          새 비밀번호 한 번 더
          <input
            name="password_confirm"
            type="password"
            required
            minLength={4}
            autoComplete="new-password"
            className={field}
          />
        </label>
        <SubmitButton
          pendingText="바꾸는 중…"
          className="w-full rounded-lg bg-brand py-2.5 font-medium text-white hover:bg-brand-dark"
        >
          비밀번호 바꾸기
        </SubmitButton>
      </form>
      <p className="mt-4 text-xs text-slate-400">
        지금 비밀번호가 기억나지 않으면 선생님께 말씀드려요. 선생님이 임시
        비밀번호를 만들어 주실 수 있어요.
      </p>
    </main>
  );
}
