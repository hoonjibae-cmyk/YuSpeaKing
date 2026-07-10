import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudentSession } from "@/lib/student-session";
import { enterClass } from "./actions";

export default async function StudentEntryPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  if (await getStudentSession()) redirect("/student/home");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <Link href="/" className="mb-8 text-center text-3xl font-bold text-brand">
        유스피킹
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold">반 코드 입력</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          선생님이 알려준 코드를 넣어줘요
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form action={enterClass} className="mt-6 space-y-4">
          <input
            name="code"
            placeholder="ABC123"
            required
            autoCapitalize="characters"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl font-bold uppercase tracking-widest focus:border-brand focus:outline-none"
          />
          <button className="w-full rounded-xl bg-brand py-3 text-lg font-semibold text-white transition hover:bg-brand-dark">
            입장하기
          </button>
        </form>
      </div>
    </main>
  );
}
