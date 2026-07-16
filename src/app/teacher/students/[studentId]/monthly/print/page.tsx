import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { gatherMonthly, currentMonth } from "@/lib/monthly";
import { todayKST } from "@/lib/date";
import { CrownMark } from "@/components/Logo";
import PrintButton from "@/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function MonthlyPrintPage({
  params,
  searchParams,
}: {
  params: { studentId: string };
  searchParams: { month?: string };
}) {
  const { db, effectiveId } = await getTeacherContext();
  const { studentId } = params;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "")
    ? (searchParams.month as string)
    : currentMonth();

  const { data: student } = await db
    .from("students")
    .select("id, name, number, school, grade, class_id")
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
    .select("content")
    .eq("student_id", studentId)
    .eq("year_month", month)
    .maybeSingle();

  const [yy, mm] = month.split("-");
  const monthKo = `${yy}년 ${Number(mm)}월`;

  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      {/* 툴바 (인쇄 제외) */}
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] items-center justify-between px-4">
        <Link
          href={`/teacher/students/${studentId}/monthly?month=${month}`}
          className="text-sm text-slate-500 hover:underline"
        >
          ← 리포트 편집으로
        </Link>
        <PrintButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark" />
      </div>

      {/* A4 시트 */}
      <article className="mx-auto w-full max-w-[210mm] bg-white p-[14mm] text-slate-800 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        {/* 헤더 */}
        <header className="flex items-center justify-between border-b-2 border-brand pb-3">
          <div className="flex items-center gap-3">
            <CrownMark className="h-11 w-11" />
            <div>
              <h1 className="text-xl font-bold text-brand">월말 스피킹 리포트</h1>
              <p className="text-xs text-slate-500">목동유쌤영어 · 유스피킹</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold">{monthKo}</div>
            <div className="text-xs text-slate-500">{klass.name}</div>
          </div>
        </header>

        {/* 학생 정보 */}
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
          <span className="text-lg font-bold">
            {student.number != null ? `${student.number}번 ` : ""}
            {student.name}
          </span>
          {student.school && (
            <span className="text-slate-500">{student.school}</span>
          )}
          {student.grade && (
            <span className="text-slate-500">{student.grade}</span>
          )}
        </div>

        {/* 요약 지표 */}
        <section className="mt-4 grid grid-cols-4 gap-2">
          <Stat
            label="제출률"
            value={`${data.rate}%`}
            sub={`${data.submitted}/${data.assigned}개`}
          />
          <Stat
            label="평균 점수"
            value={data.avg != null ? `${data.avg}점` : "-"}
          />
          <Stat
            label="성장"
            value={
              data.growth != null
                ? `${data.growth > 0 ? "+" : ""}${data.growth}`
                : "-"
            }
            sub={
              data.firstScore != null
                ? `${data.firstScore}→${data.lastScore}점`
                : undefined
            }
          />
          <Stat label="취약 단어" value={`${data.weakWords.length}개`} />
        </section>

        {/* 취약 단어 */}
        <section className="print-avoid-break mt-4">
          <h2 className="text-sm font-bold text-brand">자주 틀린 단어</h2>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {data.weakWords.length === 0 && (
              <span className="text-sm text-slate-400">
                두드러진 취약 단어가 없어요. 아주 좋아요!
              </span>
            )}
            {data.weakWords.map((w) => (
              <span
                key={w}
                className="rounded bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700"
              >
                {w}
              </span>
            ))}
          </div>
        </section>

        {/* 과제별 내역 */}
        <section className="print-avoid-break mt-4">
          <h2 className="text-sm font-bold text-brand">
            과제별 제출 내역 ({data.items.length})
          </h2>
          <table className="mt-1.5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-200 text-left text-xs text-slate-500">
                <th className="py-1.5 pr-2 font-medium">날짜</th>
                <th className="py-1.5 pr-2 font-medium">과제</th>
                <th className="py-1.5 pr-2 text-center font-medium">제출</th>
                <th className="py-1.5 text-right font-medium">점수</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-400">
                    이 달 과제가 없어요.
                  </td>
                </tr>
              )}
              {data.items.map((i, idx) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="py-1.5 pr-2 text-slate-500 tabular-nums">
                    {i.date.slice(5).replace("-", "/")}
                  </td>
                  <td className="py-1.5 pr-2">{i.title}</td>
                  <td className="py-1.5 pr-2 text-center">
                    {i.submitted ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {i.submitted
                      ? i.score != null
                        ? `${i.score}점`
                        : "채점중"
                      : "미제출"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* AI 총평 */}
        <section className="mt-5">
          <h2 className="text-sm font-bold text-brand">종합 의견</h2>
          {report?.content ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">
              {report.content}
            </p>
          ) : (
            <p className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              종합 의견이 아직 작성되지 않았어요. 리포트 편집 화면에서 “AI 초안
              만들기”로 생성한 뒤 인쇄해 주세요.
            </p>
          )}
        </section>

        {/* 푸터 */}
        <footer className="mt-6 flex items-center justify-between border-t border-slate-200 pt-2 text-[11px] text-slate-400">
          <span>목동유쌤영어 · 유스피킹</span>
          <span>발행일 {todayKST()}</span>
        </footer>
      </article>
    </div>
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
    <div className="rounded-lg border border-slate-200 p-2 text-center">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-bold text-brand">{value}</div>
      {sub && <div className="text-[11px] text-slate-400 tabular-nums">{sub}</div>}
    </div>
  );
}
