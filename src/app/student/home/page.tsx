import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { studentLogout } from "../actions";
import { CrownMark } from "@/components/Logo";
import { todayKST } from "@/lib/date";

export default async function StudentHome() {
  const session = await requireStudent();
  const admin = createAdminClient();
  const today = todayKST();

  // 서로 독립적인 조회는 병렬로 (왕복 시간 단축)
  const [assignmentsRes, subsRes, studentCountRes] = await Promise.all([
    admin
      .from("assignments")
      .select("id, title, due_date, created_at")
      .eq("class_id", session.classId)
      .order("created_at", { ascending: false }),
    admin
      .from("submissions")
      .select("assignment_id, status, overall_score")
      .eq("student_id", session.studentId),
    admin
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("class_id", session.classId)
      .eq("status", "approved"),
  ]);

  const allAssignments = assignmentsRes.data;
  const subs = subsRes.data;
  const classStudentCount = studentCountRes.count;

  // 마감이 지난 과제는 '지난 과제 목록'으로. 홈에는 진행 중(마감 전/마감 없음)만.
  const assignments = (allAssignments ?? []).filter(
    (a) => !a.due_date || a.due_date >= today
  );
  const pastCount = (allAssignments ?? []).length - assignments.length;

  const subMap = new Map((subs ?? []).map((s) => [s.assignment_id, s.status]));

  // 반 전체 제출 인원(과제별) — 화면에 보이는 과제만 집계
  const visibleIds = assignments.map((a) => a.id);
  const submitCountByAssignment = new Map<string, number>();
  if (visibleIds.length) {
    const { data: allSubs } = await admin
      .from("submissions")
      .select("assignment_id")
      .in("assignment_id", visibleIds);
    for (const s of (allSubs ?? []) as { assignment_id: string }[]) {
      submitCountByAssignment.set(
        s.assignment_id,
        (submitCountByAssignment.get(s.assignment_id) ?? 0) + 1
      );
    }
  }
  const totalStudents = classStudentCount ?? 0;

  // ---- 게임화: 성취 배지 & 연속 제출 스트릭 ----
  const submittedCount = subs?.length ?? 0;
  const bestScore = (subs ?? []).reduce(
    (m, s) => (s.overall_score != null ? Math.max(m, Number(s.overall_score)) : m),
    0
  );
  // 최신 과제부터 연속으로 제출한 개수 (지난 과제 포함)
  let streak = 0;
  for (const a of allAssignments ?? []) {
    if (subMap.has(a.id)) streak++;
    else break;
  }
  const badges = [
    { earned: submittedCount >= 1, emoji: "🎉", label: "첫 스피킹" },
    { earned: streak >= 3, emoji: "⚡", label: `${streak}회 연속` },
    { earned: submittedCount >= 5, emoji: "🔥", label: "5회 달성" },
    { earned: submittedCount >= 10, emoji: "💪", label: "10회 달성" },
    { earned: bestScore >= 90, emoji: "🏆", label: "90점 클럽" },
    { earned: bestScore >= 100, emoji: "⭐", label: "만점!" },
  ].filter((b) => b.earned);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CrownMark className="h-8 w-8" />
          <div>
            <h1 className="text-xl font-bold text-brand">오늘의 스피킹</h1>
            <p className="text-sm text-slate-500">
              {session.number != null ? `${session.number}번 ` : ""}
              {session.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/student/history"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-brand hover:bg-brand-light"
          >
            📈 내 기록
          </Link>
          <form action={studentLogout} className="inline">
            <button className="ml-2 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">
              나가기
            </button>
          </form>
        </div>
      </header>

      {pastCount > 0 && (
        <Link
          href="/student/past"
          className="mt-5 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500 transition hover:border-brand hover:text-brand"
        >
          <span>🗂️ 지난 과제 목록</span>
          <span className="text-xs">마감된 과제 {pastCount}개 →</span>
        </Link>
      )}

      {/* 성취 배지 */}
      {submittedCount > 0 && (
        <section className="mt-5 rounded-2xl border border-brand/20 bg-brand-light p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-brand">나의 성취 🏅</span>
            {streak >= 2 && (
              <span className="text-xs font-medium text-brand">
                🔥 {streak}회 연속 제출 중!
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {badges.map((b) => (
              <span
                key={b.label}
                className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm"
              >
                {b.emoji} {b.label}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 space-y-3">
        {assignments.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            {pastCount > 0
              ? "진행 중인 과제가 없어요. 지난 과제는 위에서 확인해요 🙂"
              : "아직 과제가 없어요 🙂"}
          </p>
        )}
        {assignments.map((a) => {
          const status = subMap.get(a.id);
          const done = status === "submitted" || status === "evaluating" || status === "evaluated";
          return (
            <Link
              key={a.id}
              href={`/student/assignments/${a.id}`}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm"
            >
              <div>
                <div className="font-semibold">{a.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                  {a.due_date && <span>마감 {a.due_date}</span>}
                  <span>
                    👥 {submitCountByAssignment.get(a.id) ?? 0}
                    {totalStudents > 0 ? `/${totalStudents}` : ""}명 제출
                  </span>
                </div>
              </div>
              {done ? (
                <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700">
                  제출완료
                </span>
              ) : (
                <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand">
                  시작하기
                </span>
              )}
            </Link>
          );
        })}
      </section>
    </main>
  );
}
