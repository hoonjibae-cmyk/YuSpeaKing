import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "../teacher/actions";
import { impersonateTeacher } from "./actions";
import { CrownMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  await requireAdmin();
  const admin = createAdminClient();

  const [teachersRes, classesRes, studentsRes, assignmentsRes, submissionsRes] =
    await Promise.all([
      admin.from("teachers").select("id, name, email, role"),
      admin.from("classes").select("id, teacher_id"),
      admin.from("students").select("id, class_id"),
      admin.from("assignments").select("id, class_id, created_at"),
      admin.from("submissions").select("assignment_id, overall_score, status"),
    ]);

  // 이번 달 AI 비용
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const { data: usage } = await admin
    .from("usage_logs")
    .select("kind, cost_usd")
    .gte("created_at", monthStart);
  const costByKind = new Map<string, number>();
  let totalCost = 0;
  (usage ?? []).forEach((u: { kind: string; cost_usd: number }) => {
    const c = Number(u.cost_usd) || 0;
    totalCost += c;
    costByKind.set(u.kind, (costByKind.get(u.kind) ?? 0) + c);
  });
  const KIND_LABEL: Record<string, string> = {
    tts: "샘플음성(TTS)",
    azure: "발음평가(Azure)",
    claude_feedback: "피드백(Claude)",
    claude_monthly: "월말리포트(Claude)",
  };
  const usdKrw = 1350;

  const teachers = teachersRes.data ?? [];
  const classes = classesRes.data ?? [];
  const students = studentsRes.data ?? [];
  const assignments = assignmentsRes.data ?? [];
  const submissions = submissionsRes.data ?? [];

  // 인덱스
  const classTeacher = new Map(classes.map((c) => [c.id, c.teacher_id]));
  const studentsPerClass = new Map<string, number>();
  students.forEach((s) =>
    studentsPerClass.set(s.class_id, (studentsPerClass.get(s.class_id) ?? 0) + 1)
  );
  const subsByAssignment = new Map<string, { overall_score: number | null; status: string }[]>();
  submissions.forEach((s) => {
    const arr = subsByAssignment.get(s.assignment_id) ?? [];
    arr.push(s);
    subsByAssignment.set(s.assignment_id, arr);
  });

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 교사별 집계 (운영자 겸 교사도 포함)
  const rows = teachers
    .map((t) => {
      const myClasses = classes.filter((c) => c.teacher_id === t.id).map((c) => c.id);
      const studentCount = myClasses.reduce(
        (a, cid) => a + (studentsPerClass.get(cid) ?? 0),
        0
      );
      const myAssignments = assignments.filter((a) =>
        myClasses.includes(a.class_id)
      );
      const lastUpload = myAssignments.reduce<string | null>(
        (max, a) => (!max || a.created_at > max ? a.created_at : max),
        null
      );
      const thisWeek = myAssignments.filter((a) => a.created_at >= weekAgo).length;

      // 제출률 & 평균점수
      let expected = 0;
      let actual = 0;
      const scores: number[] = [];
      myAssignments.forEach((a) => {
        const enrolled = studentsPerClass.get(a.class_id) ?? 0;
        expected += enrolled;
        const subs = subsByAssignment.get(a.id) ?? [];
        actual += subs.length;
        subs.forEach((s) => {
          if (s.status === "evaluated" && s.overall_score != null)
            scores.push(Number(s.overall_score));
        });
      });
      const rate = expected ? Math.round((actual / expected) * 100) : 0;
      const avg = scores.length
        ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
        : null;

      return {
        id: t.id,
        name: t.name || t.email,
        email: t.email,
        isAdmin: t.role === "admin",
        classCount: myClasses.length,
        studentCount,
        assignmentCount: myAssignments.length,
        thisWeek,
        lastUpload,
        rate,
        avg,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CrownMark className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold text-brand">유스피킹 · 운영자</h1>
            <p className="text-sm text-slate-500">
              선생님별 과제 업로드·제출률·평균점수 현황
            </p>
          </div>
        </div>
        <form action={signOut}>
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
            로그아웃
          </button>
        </form>
      </header>

      {/* 이번 달 AI 비용 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">이번 달 AI 비용 (추정)</h2>
          <div className="text-right">
            <div className="text-2xl font-bold text-brand">
              ${totalCost.toFixed(2)}
            </div>
            <div className="text-xs text-slate-400">
              ≈ {Math.round(totalCost * usdKrw).toLocaleString()}원
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["tts", "azure", "claude_feedback", "claude_monthly"].map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="text-xs text-slate-400">{KIND_LABEL[k]}</div>
              <div className="mt-0.5 text-sm font-semibold text-slate-700">
                ${(costByKind.get(k) ?? 0).toFixed(2)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          근사 요율 기준 추정치 · 실제 청구는 각 서비스 콘솔 기준. 환율 1,350원 가정.
        </p>
      </section>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">선생님</th>
              <th className="px-3 py-3">반/학생</th>
              <th className="px-3 py-3">과제(누적)</th>
              <th className="px-3 py-3">이번 주 업로드</th>
              <th className="px-3 py-3">최근 업로드</th>
              <th className="px-3 py-3">제출률</th>
              <th className="px-3 py-3">평균점수</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                  등록된 선생님이 없어요.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <form action={impersonateTeacher}>
                    <input type="hidden" name="teacherId" value={r.id} />
                    <button
                      type="submit"
                      className="text-left font-medium text-brand hover:underline"
                      title="이 선생님 화면으로 들어가기"
                    >
                      {r.name}
                    </button>
                    {r.isAdmin && (
                      <span className="ml-2 rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">
                        운영자
                      </span>
                    )}
                    <div className="text-xs text-slate-400">{r.email}</div>
                  </form>
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {r.classCount}반 · {r.studentCount}명
                </td>
                <td className="px-3 py-3 text-slate-600">{r.assignmentCount}개</td>
                <td className="px-3 py-3">
                  <span
                    className={
                      r.thisWeek < 2
                        ? "font-medium text-amber-600"
                        : "font-medium text-green-600"
                    }
                  >
                    {r.thisWeek}개
                  </span>
                  <span className="text-xs text-slate-400"> / 주2회</span>
                </td>
                <td className="px-3 py-3 text-slate-500">
                  {r.lastUpload ? r.lastUpload.slice(0, 10).replace(/-/g, ".") : "-"}
                </td>
                <td className="px-3 py-3">
                  <span
                    className={
                      r.rate < 60 ? "text-amber-600" : "text-slate-700"
                    }
                  >
                    {r.rate}%
                  </span>
                </td>
                <td className="px-3 py-3 font-semibold text-brand">
                  {r.avg != null ? `${r.avg}점` : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        · 이번 주 업로드가 2회 미만이면 주황색으로 표시됩니다 (주 2회 기준).
        · 제출률 60% 미만은 주황색.
      </p>
    </main>
  );
}
