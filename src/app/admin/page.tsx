import Link from "next/link";
import { headers } from "next/headers";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { signOut } from "../teacher/actions";
import {
  impersonateTeacher,
  approveTeacher,
  rejectTeacher,
  setTeacherRole,
  deleteTeacher,
} from "./actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import CopyButton from "@/components/CopyButton";
import { CrownMark } from "@/components/Logo";

export const dynamic = "force-dynamic";

// 오프셋 주(0=이번 주)의 [시작, 끝) 구간을 KST 월요일 기준으로 계산
function kstWeekWindow(offset: number): {
  startUtc: string;
  endUtc: string;
  label: string;
} {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const dow = kst.getUTCDay(); // 0=일..6=토 (KST 벽시계)
  const sinceMon = (dow + 6) % 7;
  const mondayKstMidnight = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate()
  ) - sinceMon * 86400000;
  const startKst = mondayKstMidnight - offset * 7 * 86400000;
  const endKst = startKst + 7 * 86400000;
  // KST 벽시계 자정 → 실제 UTC 순간(−9h)
  const startUtc = new Date(startKst - 9 * 3600 * 1000).toISOString();
  const endUtc = new Date(endKst - 9 * 3600 * 1000).toISOString();
  const label =
    offset === 0
      ? "이번 주"
      : offset === 1
        ? "지난주"
        : offset === 2
          ? "지지난주"
          : `${offset}주 전`;
  return { startUtc, endUtc, label };
}

export default async function AdminDashboard({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const meUser = await requireAdmin();
  const admin = createAdminClient();

  const weekOffset = Math.max(
    0,
    Math.min(8, parseInt(searchParams.week || "0", 10) || 0)
  );
  const { startUtc, endUtc, label: weekLabel } = kstWeekWindow(weekOffset);

  const [teachersRes, classesRes, studentsRes, assignmentsRes, submissionsRes] =
    await Promise.all([
      admin.from("teachers").select("id, name, email, role, status"),
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
    tts: "샘플음성(gpt-4o-mini-tts)",
    azure: "발음평가(Azure)",
    claude_feedback: "피드백(Claude)",
    claude_monthly: "월말리포트(Claude)",
  };
  const usdKrw = 1350;

  const teachers = teachersRes.data ?? [];
  const pendingTeachers = (
    teachers as { id: string; name: string; email: string; status?: string }[]
  ).filter((t) => t.status === "pending");
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

  // 교사별 집계 — 선택한 주(週) 기준 (운영자 겸 교사도 포함)
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

      // 선택 주에 생성한 과제
      const weekAssignments = myAssignments.filter(
        (a) => a.created_at >= startUtc && a.created_at < endUtc
      );
      const weekUploads = weekAssignments.length;
      // 목표: 반 수 × 주 2회
      const target = myClasses.length * 2;
      const creationRate = target
        ? Math.round((weekUploads / target) * 100)
        : 0;

      // 선택 주에 생성한 과제 기준 제출률 & 평균점수
      let expected = 0;
      let actual = 0;
      const scores: number[] = [];
      weekAssignments.forEach((a) => {
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
        assignmentCount: myAssignments.length, // 누적
        weekUploads,
        target,
        creationRate,
        lastUpload,
        rate,
        avg,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const host = headers().get("host");
  const teacherSignupUrl = host
    ? `https://${host}/teacher/login?mode=signup`
    : "/teacher/login?mode=signup";

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

      {/* 선생님 가입 링크 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">선생님 가입 링크</h2>
        <p className="mt-1 text-xs text-slate-400">
          새 선생님에게 이 링크를 보내세요. 선생님이 가입 신청하면 여기 운영자
          대시보드에서 승인하고, 신청 시 총괄관리자에게 Slack DM도 전송돼요.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            id="teacher-signup-url"
            readOnly
            value={teacherSignupUrl}
            className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
          />
          <CopyButton
            targetId="teacher-signup-url"
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          />
        </div>
      </section>

      {/* 선생님 가입 신청 승인 */}
      {pendingTeachers.length > 0 && (
        <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="font-semibold text-amber-700">
            선생님 가입 신청 {pendingTeachers.length}건
          </h2>
          <ul className="mt-3 space-y-2">
            {pendingTeachers.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {t.name || "(이름 없음)"}
                  </div>
                  <div className="truncate text-xs text-slate-400">{t.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <form action={approveTeacher}>
                    <input type="hidden" name="teacherId" value={t.id} />
                    <SubmitButton
                      pendingText="승인 중…"
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark"
                    >
                      승인
                    </SubmitButton>
                  </form>
                  <form action={rejectTeacher}>
                    <input type="hidden" name="teacherId" value={t.id} />
                    <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100">
                      거절
                    </button>
                  </form>
                  <form action={deleteTeacher}>
                    <input type="hidden" name="teacherId" value={t.id} />
                    <ConfirmSubmitButton
                      message={`'${t.name || t.email}' 가입 신청을 삭제할까요? 되돌릴 수 없어요.`}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                    >
                      삭제
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {/* 주 선택 */}
      <div className="mt-6 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-sm font-medium text-slate-500">기간:</span>
        {Array.from({ length: 6 }, (_, i) => i).map((off) => {
          const on = off === weekOffset;
          const lbl =
            off === 0
              ? "이번 주"
              : off === 1
                ? "지난주"
                : off === 2
                  ? "지지난주"
                  : `${off}주 전`;
          return (
            <Link
              key={off}
              href={`/admin?week=${off}`}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                on
                  ? "bg-brand text-white"
                  : "border border-slate-300 text-slate-500 hover:bg-slate-100"
              }`}
            >
              {lbl}
            </Link>
          );
        })}
      </div>

      {/* 선생님별 운영 현황 (그래프) */}
      {rows.length > 0 && (
        <section className="mt-3 rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">
            선생님별 운영 현황 · <span className="text-brand">{weekLabel}</span>
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            과제 생성률(반 수 × 주 2회 기준)·제출률·평균점수를 막대로 비교해요.
          </p>
          <div className="mt-4 space-y-4">
            {[...rows]
              .sort((a, b) => b.creationRate - a.creationRate)
              .map((r) => (
                <div key={r.id}>
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-medium">
                      {r.name}
                      {r.isAdmin && (
                        <span className="ml-1.5 rounded-full bg-brand-light px-1.5 py-0.5 text-[10px] text-brand">
                          운영자
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-slate-400">
                      {r.classCount}반 · {r.studentCount}명
                    </span>
                  </div>
                  <div className="mt-1.5 space-y-1">
                    <Bar
                      label="과제생성"
                      value={r.creationRate}
                      display={`${r.weekUploads}/${r.target} (${r.creationRate}%)`}
                      tone={r.creationRate < 100 ? "amber" : "brand"}
                    />
                    <Bar
                      label="제출률"
                      value={r.rate}
                      display={`${r.rate}%`}
                      tone={r.rate < 60 ? "amber" : "brand"}
                    />
                    <Bar
                      label="평균"
                      value={r.avg ?? 0}
                      display={r.avg != null ? `${r.avg}점` : "-"}
                      tone="green"
                    />
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500">
            <tr>
              <th className="px-4 py-3">선생님</th>
              <th className="px-3 py-3">반/학생</th>
              <th className="px-3 py-3">과제(누적)</th>
              <th className="px-3 py-3">과제생성 ({weekLabel})</th>
              <th className="px-3 py-3">최근 업로드</th>
              <th className="px-3 py-3">제출률 ({weekLabel})</th>
              <th className="px-3 py-3">평균 ({weekLabel})</th>
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
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <form action={impersonateTeacher}>
                        <input type="hidden" name="teacherId" value={r.id} />
                        <button
                          type="submit"
                          className="text-left font-medium text-brand hover:underline"
                          title="이 선생님 화면으로 들어가기"
                        >
                          {r.name}
                        </button>
                      </form>
                      {r.isAdmin && (
                        <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs text-brand">
                          운영자
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400">{r.email}</div>
                    {r.id !== meUser.id && (
                      <div className="flex items-center gap-3">
                        <form action={setTeacherRole}>
                          <input type="hidden" name="teacherId" value={r.id} />
                          <input
                            type="hidden"
                            name="role"
                            value={r.isAdmin ? "teacher" : "admin"}
                          />
                          <button
                            type="submit"
                            className="text-xs text-slate-400 hover:text-brand"
                          >
                            {r.isAdmin ? "운영자 해제" : "운영자로 지정"}
                          </button>
                        </form>
                        <form action={deleteTeacher}>
                          <input type="hidden" name="teacherId" value={r.id} />
                          <ConfirmSubmitButton
                            message={`'${r.name}' 선생님의 계정과 그 선생님의 반·학생·과제·제출 기록이 모두 삭제됩니다. 되돌릴 수 없어요. 정말 삭제할까요?`}
                            className="text-xs text-slate-400 hover:text-red-500"
                          >
                            계정 삭제
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    )}
                  </div>
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {r.classCount}반 · {r.studentCount}명
                </td>
                <td className="px-3 py-3 text-slate-600">{r.assignmentCount}개</td>
                <td className="px-3 py-3">
                  <span
                    className={
                      r.creationRate < 100
                        ? "font-medium text-amber-600"
                        : "font-medium text-green-600"
                    }
                  >
                    {r.weekUploads}개
                  </span>
                  <span className="text-xs text-slate-400">
                    {" "}
                    / {r.target}개 ({r.creationRate}%)
                  </span>
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
        · 과제 생성률 = 그 주 생성 과제 ÷ (등록 반 수 × 주 2회). 100% 미만은
        주황색. · 제출률·평균은 그 주 생성 과제 기준이며, 제출률 60% 미만은
        주황색.
      </p>
    </main>
  );
}

function Bar({
  label,
  value,
  display,
  tone,
}: {
  label: string;
  value: number;
  display: string;
  tone: "brand" | "green" | "amber";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    tone === "amber"
      ? "bg-amber-400"
      : tone === "green"
        ? "bg-green-500"
        : "bg-brand";
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-xs text-slate-400">{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums text-slate-600">
        {display}
      </span>
    </div>
  );
}
