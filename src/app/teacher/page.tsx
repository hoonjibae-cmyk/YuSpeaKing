import Link from "next/link";
import { requireTeacher, getRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createClass, signOut } from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { CrownMark } from "@/components/Logo";

export default async function TeacherDashboard({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const teacher = await requireTeacher();
  const role = await getRole();
  const supabase = createClient();

  const { data: classes } = await supabase
    .from("classes")
    .select("id, name, class_code, created_at, students(count), assignments(count)")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CrownMark className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold text-brand">유스피킹 · 선생님</h1>
            <p className="text-sm text-slate-500">{teacher.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role === "admin" && (
            <Link
              href="/admin"
              className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-indigo-100"
            >
              운영자 대시보드
            </Link>
          )}
          <form action={signOut}>
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      {/* 반 만들기 */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">새 반 만들기</h2>
        <form action={createClass} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="예: 6학년 A반"
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
          <SubmitButton
            pendingText="만드는 중…"
            className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
          >
            만들기
          </SubmitButton>
        </form>
      </section>

      {/* 반 목록 */}
      <section className="mt-6 space-y-3">
        {(!classes || classes.length === 0) && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            아직 반이 없어요. 위에서 새 반을 만들어 보세요.
          </p>
        )}
        {classes?.map((c) => {
          const studentCount = (c.students as { count: number }[])?.[0]?.count ?? 0;
          const assignmentCount =
            (c.assignments as { count: number }[])?.[0]?.count ?? 0;
          return (
            <Link
              key={c.id}
              href={`/teacher/classes/${c.id}`}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm"
            >
              <div>
                <div className="font-semibold">{c.name}</div>
                <div className="mt-1 text-sm text-slate-500">
                  학생 {studentCount}명 · 과제 {assignmentCount}개
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-400">반 코드</div>
                <div className="font-mono text-lg font-bold tracking-wider text-brand">
                  {c.class_code}
                </div>
              </div>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
