import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { unarchiveClass } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";

export default async function ArchivedClassesPage() {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();

  const { data: classes } = await db
    .from("classes")
    .select(
      "id, name, archived_at, students(count), assignments(count)"
    )
    .eq("teacher_id", effectiveId)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  const list = (classes ?? []) as {
    id: string;
    name: string;
    archived_at: string | null;
    students: { count: number }[];
    assignments: { count: number }[];
  }[];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold">🗂️ 보관반 목록</h1>
      <p className="mt-1 text-sm text-slate-500">
        보관한 반이에요. 데이터는 그대로 유지되며, 언제든 다시 불러올 수 있어요.
      </p>

      <section className="mt-6 space-y-3">
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            보관한 반이 없어요.
          </p>
        )}
        {list.map((c) => {
          const studentCount = c.students?.[0]?.count ?? 0;
          const assignmentCount = c.assignments?.[0]?.count ?? 0;
          return (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="min-w-0">
                <div className="font-semibold">{c.name}</div>
                <div className="mt-1 text-sm text-slate-500">
                  학생 {studentCount}명 · 과제 {assignmentCount}개
                  {c.archived_at && (
                    <span className="text-slate-400">
                      {" "}
                      · 보관 {c.archived_at.slice(0, 10)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={`/teacher/classes/${c.id}`}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                >
                  열어보기
                </Link>
                <form action={unarchiveClass}>
                  <input type="hidden" name="classId" value={c.id} />
                  <SubmitButton
                    pendingText="복원 중…"
                    className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                  >
                    다시 불러오기
                  </SubmitButton>
                </form>
              </div>
            </div>
          );
        })}
      </section>
    </main>
  );
}
