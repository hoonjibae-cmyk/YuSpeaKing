import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { gatherMonthly, currentMonth } from "@/lib/monthly";
import {
  generateMonthlyDraft,
  saveMonthlyReport,
} from "@/app/teacher/actions";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export default async function StudentMonthlyPage({
  params,
  searchParams,
}: {
  params: { studentId: string };
  searchParams: { month?: string; error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { studentId } = params;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "")
    ? (searchParams.month as string)
    : currentMonth();

  const { data: student } = await db
    .from("students")
    .select("id, name, number, class_id")
    .eq("id", studentId)
    .single();
  if (!student) notFound();

  const { data: klass } = await db
    .from("classes")
    .select("id, name")
    .eq("id", student.class_id)
    .eq("teacher_id", effectiveId)
    .single();
  if (!klass) notFound();

  const data = await gatherMonthly(db, student.id, student.class_id, month);

  const { data: report } = await db
    .from("monthly_reports")
    .select("content, updated_at")
    .eq("student_id", studentId)
    .eq("year_month", month)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link
        href={`/teacher/classes/${student.class_id}/monthly?month=${month}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← 월말 리포트 목록
      </Link>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {student.number}번 {student.name}
          </h1>
          <p className="text-sm text-slate-500">
            {klass.name} · {month} 월말 리포트
          </p>
        </div>
        <Link
          href={`/teacher/students/${studentId}/monthly/print?month=${month}`}
          className="shrink-0 rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
        >
          🖨 인쇄용 보기
        </Link>
      </div>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      {/* 이 달 요약 */}
      <section className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="제출률" value={`${data.rate}%`} sub={`${data.submitted}/${data.assigned}`} />
        <Stat label="평균" value={data.avg != null ? `${data.avg}점` : "-"} />
        <Stat label="성장" value={data.growth != null ? `${data.growth > 0 ? "+" : ""}${data.growth}` : "-"} sub={data.firstScore != null ? `${data.firstScore}→${data.lastScore}` : undefined} />
        <Stat label="취약단어" value={`${data.weakWords.length}개`} />
      </section>

      {data.weakWords.length > 0 && (
        <p className="mt-2 text-sm text-slate-500">
          자주 틀린 단어:{" "}
          {data.weakWords.map((w) => (
            <span key={w} className="mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
              {w}
            </span>
          ))}
        </p>
      )}

      {/* 과제별 내역 */}
      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer text-slate-600">과제별 내역 ({data.items.length})</summary>
        <ul className="mt-2 divide-y divide-slate-100">
          {data.items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between py-1.5">
              <span className="text-slate-600">
                <span className="text-slate-400">{i.date}</span> {i.title}
              </span>
              <span className={i.submitted ? "text-brand" : "text-slate-300"}>
                {i.submitted ? (i.score != null ? `${i.score}점` : "채점중") : "미제출"}
              </span>
            </li>
          ))}
          {data.items.length === 0 && (
            <li className="py-2 text-center text-slate-400">이 달 과제가 없어요.</li>
          )}
        </ul>
      </details>

      {/* 리포트 초안 생성 */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-semibold">학부모 발송용 리포트</h2>
        <form action={generateMonthlyDraft}>
          <input type="hidden" name="studentId" value={studentId} />
          <input type="hidden" name="month" value={month} />
          <SubmitButton
            pendingText="AI 초안 작성 중… (십여 초)"
            className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
          >
            {report?.content ? "AI 초안 다시 만들기" : "AI 초안 만들기"}
          </SubmitButton>
        </form>
      </div>

      {/* 리포트 편집/저장 */}
      <form action={saveMonthlyReport} className="mt-3 space-y-2">
        <input type="hidden" name="studentId" value={studentId} />
        <input type="hidden" name="month" value={month} />
        <textarea
          id="report-content"
          name="content"
          defaultValue={report?.content ?? ""}
          rows={16}
          placeholder="'AI 초안 만들기'를 누르면 이 달 데이터로 리포트 초안이 자동 작성됩니다. 그대로 쓰거나 자유롭게 수정한 뒤 저장하세요."
          className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm leading-relaxed focus:border-brand focus:outline-none"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-400">
            {report?.updated_at
              ? `최근 저장: ${report.updated_at.slice(0, 10)}`
              : "아직 저장 안 됨"}
          </span>
          <div className="flex gap-2">
            <CopyButton
              targetId="report-content"
              className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            />
            <SubmitButton
              pendingText="저장 중…"
              className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              저장
            </SubmitButton>
          </div>
        </div>
      </form>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-bold text-brand">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
