import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { coTaughtClassIds } from "@/lib/transfers";
import { todayKST, daysAgoKST, TREND_START } from "@/lib/date";
import { PERIODS, resolvePeriod, trendFrom } from "@/lib/trend";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import TrendChart, { type TrendSeries, type TrendPoint } from "@/components/TrendChart";

export default async function ClassTrendPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { p?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;

  const period = resolvePeriod(searchParams.p);
  const today = todayKST();
  const from = trendFrom(period.days);
  const windowStart = daysAgoKST(period.days);

  const [{ data: klass }, coIds, { data: studentRows }] = await Promise.all([
    db
      .from("classes")
      .select("id, name, teacher_id")
      .eq("id", classId)
      .maybeSingle(),
    coTaughtClassIds(effectiveId),
    db
      .from("students")
      .select("id, name, number")
      .eq("class_id", classId)
      .eq("status", "approved")
      .order("number"),
  ]);

  // 반 화면과 같은 접근 권한 (담임 또는 공동 관리 기간의 선생님)
  const isCoTeacher = klass ? klass.teacher_id !== effectiveId : false;
  if (!klass || (isCoTeacher && !coIds.includes(classId))) notFound();

  const students = (studentRows ?? []) as {
    id: string;
    name: string;
    number: number | null;
  }[];

  // 채점이 끝난 제출만 모은다 (점수가 없는 건 선에 올릴 수 없다)
  let subs: { student_id: string; overall_score: number; created_at: string }[] =
    [];
  if (students.length) {
    const { data } = await db
      .from("submissions")
      .select("student_id, overall_score, created_at")
      .in(
        "student_id",
        students.map((s) => s.id)
      )
      .eq("status", "evaluated")
      .not("overall_score", "is", null)
      .gte("created_at", `${from}T00:00:00Z`)
      .order("created_at", { ascending: true });
    subs = (data ?? []) as typeof subs;
  }

  const byStudent = new Map<string, TrendPoint[]>();
  for (const s of subs) {
    const d = s.created_at.slice(0, 10);
    const arr = byStudent.get(s.student_id) ?? [];
    arr.push({ d, score: Math.round(Number(s.overall_score)) });
    byStudent.set(s.student_id, arr);
  }

  const series: TrendSeries[] = students.map((st) => {
    const points = byStudent.get(st.id) ?? [];
    const avg = points.length
      ? Math.round(points.reduce((a, p) => a + p.score, 0) / points.length)
      : 0;
    const change =
      points.length >= 2
        ? points[points.length - 1].score - points[0].score
        : null;
    return { id: st.id, name: st.name, number: st.number, points, avg, change };
  });

  // 반 평균 — 날짜별로 그날 제출된 점수의 평균
  const dayTotals = new Map<string, { sum: number; n: number }>();
  for (const s of subs) {
    const d = s.created_at.slice(0, 10);
    const cur = dayTotals.get(d) ?? { sum: 0, n: 0 };
    cur.sum += Number(s.overall_score);
    cur.n += 1;
    dayTotals.set(d, cur);
  }
  const classAvg: TrendPoint[] = Array.from(dayTotals.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, v]) => ({ d, score: Math.round(v.sum / v.n) }));

  const totalSubs = subs.length;
  const overallAvg = totalSubs
    ? Math.round(
        subs.reduce((a, s) => a + Number(s.overall_score), 0) / totalSubs
      )
    : null;
  const submitted = new Set(subs.map((s) => s.student_id)).size;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link
        href={`/teacher/classes/${classId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← {klass.name}
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">📈 성적 추이</h1>
          <p className="mt-1 text-sm text-slate-500">
            {from} ~ {today} · 채점이 끝난 제출만 표시합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/teacher/trend?p=${period.key}`}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            📊 전체 반 비교
          </Link>
          <a
            href={`/api/teacher/export-scores?classId=${classId}&p=${period.key}`}
            className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            ⬇ CSV 내려받기
          </a>
        </div>
      </header>

      {/* 기간 선택 */}
      <nav className="mt-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/teacher/classes/${classId}/trend?p=${p.key}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              p.key === period.key
                ? "border-brand bg-brand-light font-medium text-brand"
                : "border-slate-300 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </nav>

      {windowStart < TREND_START && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          성적 추이는 <b>{TREND_START}</b> 제출분부터 모읍니다. 기간을 길게
          잡아도 그 이전 데이터는 표시되지 않아요. (그 전에는 채점 기준이 여러 번
          바뀌어 같은 선으로 잇기 어렵습니다)
        </p>
      )}

      {/* 요약 */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">제출 학생</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {submitted}
            <span className="text-sm font-normal text-slate-400">
              /{students.length}명
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">총 제출</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {totalSubs}건
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">반 평균</div>
          <div className="mt-0.5 text-lg font-bold text-brand">
            {overallAvg != null ? `${overallAvg}점` : "-"}
          </div>
        </div>
      </div>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        {students.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            승인된 학생이 없어요.
          </p>
        ) : (
          <TrendChart
            series={series}
            classAvg={classAvg}
            from={from}
            to={today}
          />
        )}
      </section>

      <p className="mt-3 text-[11px] text-slate-400">
        · 점수는 제출한 날짜에 찍힙니다. 같은 날 여러 명이 제출하면 반 평균은 그
        날의 평균이에요.
        <br />· 변화(▲▼)는 이 기간의 <b>첫 점수 → 마지막 점수</b> 차이입니다.
      </p>
    </main>
  );
}
