import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { gatherMonthly } from "@/lib/monthly";
import { Logo } from "@/components/Logo";
import MonthlyTrend from "@/components/MonthlyTrend";

export const dynamic = "force-dynamic";

// 학부모께 링크로 보내는 월말 리포트 (읽기 전용, 로그인 없음).
// 검색에 노출되면 곤란하므로 색인을 막는다.
export const metadata = {
  title: "월말 리포트 · 목동유쌤영어",
  robots: { index: false, follow: false },
};

export default async function SharedReportPage({
  params,
}: {
  params: { token: string };
}) {
  const admin = createAdminClient();

  const { data: report } = await admin
    .from("monthly_reports")
    .select("student_id, year_month, content, updated_at")
    .eq("share_token", params.token)
    .maybeSingle();
  if (!report || !report.content?.trim()) notFound();

  const { data: student } = await admin
    .from("students")
    .select("id, name, class_id, status, approved_at")
    .eq("id", report.student_id)
    .maybeSingle();
  // 퇴원·거절 처리된 학생의 링크는 막는다
  if (!student || student.status !== "approved") notFound();

  const { data: klass } = await admin
    .from("classes")
    .select("name")
    .eq("id", student.class_id)
    .maybeSingle();

  const data = await gatherMonthly(
    admin,
    student.id,
    student.class_id,
    report.year_month,
    student.approved_at
  );

  const [y, m] = report.year_month.split("-");

  return (
    <main className="mx-auto max-w-2xl px-5 py-8">
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <Logo size="sm" />
        <div className="text-right">
          <div className="text-sm font-semibold text-slate-700">
            {Number(y)}년 {Number(m)}월 월말 리포트
          </div>
          <div className="text-xs text-slate-400">
            {klass?.name ?? ""} · {student.name}
          </div>
        </div>
      </header>

      {/* 요약 */}
      <section className="mt-5 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">제출</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {data.submitted}
            <span className="text-sm font-normal text-slate-400">
              /{data.assigned}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">평균 점수</div>
          <div className="mt-0.5 text-lg font-bold text-brand">
            {data.avg != null ? `${data.avg}점` : "-"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">점수 변화</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {data.growth == null
              ? "-"
              : data.growth > 0
                ? `+${data.growth}`
                : `${data.growth}`}
          </div>
        </div>
      </section>

      {/* 점수 흐름 그래프 */}
      <section className="mt-4">
        <MonthlyTrend items={data.items} />
      </section>

      {/* 선생님 코멘트 */}
      <section className="mt-5 rounded-xl border border-brand/20 bg-brand-light p-5">
        <h2 className="text-sm font-semibold text-brand">선생님 코멘트</h2>
        <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
          {report.content}
        </p>
      </section>

      {/* 과제별 기록 */}
      {data.items.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-slate-700">과제별 기록</h2>
          <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {data.items.map((i, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between px-4 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="text-slate-400">{i.date.slice(5)}</span>
                  <span className="ml-2 text-slate-700">{i.title}</span>
                </span>
                <span className="shrink-0">
                  {i.score != null ? (
                    <b className="text-brand">{i.score}점</b>
                  ) : i.submitted ? (
                    <span className="text-xs text-slate-400">채점중</span>
                  ) : (
                    <span className="text-xs text-slate-300">미제출</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
        목동유쌤영어 · 유스피킹
        <br />이 링크는 자녀의 학습 기록이 담겨 있으니 공유에 주의해 주세요.
      </footer>
    </main>
  );
}
