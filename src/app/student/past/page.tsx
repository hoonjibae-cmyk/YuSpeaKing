import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { todayKST } from "@/lib/date";

export default async function StudentPastAssignments() {
  const session = await requireStudent();
  const admin = createAdminClient();

  const { data: allAssignments } = await admin
    .from("assignments")
    .select("id, title, due_date, created_at")
    .eq("class_id", session.classId)
    .order("due_date", { ascending: false });

  const today = todayKST();
  // 마감이 지난 과제만
  const past = (allAssignments ?? []).filter(
    (a) => a.due_date && a.due_date < today
  );

  const { data: subs } = await admin
    .from("submissions")
    .select("assignment_id, status")
    .eq("student_id", session.studentId);
  const subMap = new Map((subs ?? []).map((s) => [s.assignment_id, s.status]));

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <Link
        href="/student/home"
        className="text-sm text-slate-500 hover:underline"
      >
        ← 오늘의 스피킹
      </Link>
      <h1 className="mt-3 text-xl font-bold text-brand">🗂️ 지난 과제 목록</h1>
      <p className="mt-1 text-sm text-slate-500">
        마감이 지난 과제예요. 복습으로 다시 연습해도 좋아요.
      </p>

      <section className="mt-6 space-y-3">
        {past.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            지난 과제가 없어요 🙂
          </p>
        )}
        {past.map((a) => {
          const status = subMap.get(a.id);
          const done =
            status === "submitted" ||
            status === "evaluating" ||
            status === "evaluated";
          return (
            <Link
              key={a.id}
              href={`/student/assignments/${a.id}`}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm"
            >
              <div>
                <div className="font-semibold text-slate-600">{a.title}</div>
                {a.due_date && (
                  <div className="mt-1 text-xs text-slate-400">
                    마감 {a.due_date} (종료)
                  </div>
                )}
              </div>
              {done ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  제출완료
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-400">
                  미제출
                </span>
              )}
            </Link>
          );
        })}
      </section>
    </main>
  );
}
