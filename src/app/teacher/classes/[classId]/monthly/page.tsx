import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { currentMonth } from "@/lib/monthly";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export default async function ClassMonthlyPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { month?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "")
    ? (searchParams.month as string)
    : currentMonth();

  const { data: klass } = await db
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .eq("teacher_id", effectiveId)
    .single();
  if (!klass) notFound();

  const { data: students } = await db
    .from("students")
    .select("id, name, number")
    .eq("class_id", classId)
    .order("number");

  const ids = (students ?? []).map((s) => s.id);
  const withReport = new Set<string>();
  if (ids.length) {
    const { data: reports } = await db
      .from("monthly_reports")
      .select("student_id")
      .eq("year_month", month)
      .in("student_id", ids);
    (reports ?? []).forEach((r: { student_id: string }) =>
      withReport.add(r.student_id)
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link
        href={`/teacher/classes/${classId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← {klass.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">월말 리포트</h1>

      {/* 월 선택 */}
      <form method="get" className="mt-4 flex items-center gap-2">
        <input
          type="month"
          name="month"
          defaultValue={month}
          className="rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          조회
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">
        {month} · 학생을 선택해 리포트를 만들거나 확인하세요.
      </p>

      <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {(students ?? []).map((s) => (
          <li key={s.id}>
            <Link
              href={`/teacher/students/${s.id}/monthly?month=${month}`}
              className="flex items-center justify-between px-5 py-3 hover:bg-slate-50"
            >
              <span>
                <span className="inline-block w-8 text-slate-400">{s.number}</span>
                {s.name}
              </span>
              {withReport.has(s.id) ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs text-green-700">
                  작성됨
                </span>
              ) : (
                <span className="rounded-full bg-brand-light px-3 py-1 text-xs text-brand">
                  만들기
                </span>
              )}
            </Link>
          </li>
        ))}
        {(!students || students.length === 0) && (
          <li className="p-6 text-center text-sm text-slate-400">
            학생이 없어요.
          </li>
        )}
      </ul>
    </main>
  );
}
