import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { todayKST, TREND_START, daysAgoKST } from "@/lib/date";
import {
  PERIODS,
  dailyAverage,
  fetchScoreRows,
  resolvePeriod,
  trendFrom,
  visibleClasses,
} from "@/lib/trend";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import TrendChart, { type TrendSeries } from "@/components/TrendChart";

export default async function AllClassesTrendPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();

  const period = resolvePeriod(searchParams.p);
  const today = todayKST();
  const from = trendFrom(period.days);
  const windowStart = daysAgoKST(period.days);

  const classes = await visibleClasses(db, effectiveId);
  const rows = await fetchScoreRows(db, classes, from);

  // 반 하나가 선 하나
  const byClass = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byClass.get(r.classId) ?? [];
    arr.push(r);
    byClass.set(r.classId, arr);
  }

  const series: TrendSeries[] = classes.map((c) => {
    const mine = byClass.get(c.id) ?? [];
    const points = dailyAverage(mine);
    const avg = mine.length
      ? Math.round(mine.reduce((a, r) => a + r.overall, 0) / mine.length)
      : 0;
    const change =
      points.length >= 2
        ? points[points.length - 1].score - points[0].score
        : null;
    return { id: c.id, name: c.name, number: null, points, avg, change };
  });

  const overall = dailyAverage(rows);
  const totalAvg = rows.length
    ? Math.round(rows.reduce((a, r) => a + r.overall, 0) / rows.length)
    : null;
  const studentCount = new Set(rows.map((r) => r.studentId)).size;

  const csvHref = `/api/teacher/export-scores?p=${period.key}`;

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">📊 전체 반 비교</h1>
          <p className="mt-1 text-sm text-slate-500">
            {from} ~ {today} · 내가 맡은 반의 평균 점수 추이
          </p>
        </div>
        <a
          href={csvHref}
          className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          ⬇ CSV 내려받기
        </a>
      </header>

      <nav className="mt-4 flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`/teacher/trend?p=${p.key}`}
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
          성적 추이는 <b>{TREND_START}</b> 제출분부터 모읍니다. 그 전에는 채점
          기준이 여러 번 바뀌어 같은 선으로 잇기 어렵습니다.
        </p>
      )}

      <div className="mt-4 grid grid-cols-4 gap-2">
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">반</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {classes.length}개
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">제출 학생</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {studentCount}명
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">총 제출</div>
          <div className="mt-0.5 text-lg font-bold text-slate-700">
            {rows.length}건
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
          <div className="text-xs text-slate-400">전체 평균</div>
          <div className="mt-0.5 text-lg font-bold text-brand">
            {totalAvg != null ? `${totalAvg}점` : "-"}
          </div>
        </div>
      </div>

      <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
        {classes.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">
            운영 중인 반이 없어요.
          </p>
        ) : (
          <TrendChart
            series={series}
            classAvg={overall}
            from={from}
            to={today}
            avgLabel="전체 평균"
            pickHint="반 이름을 누르면 그 반만 선명하게 보여요"
            showNumber={false}
          />
        )}
      </section>

      <p className="mt-3 text-[11px] text-slate-400">
        · 반별 선은 <b>그날 제출된 점수의 평균</b>입니다. 제출이 없는 날은 점이
        찍히지 않아요.
        <br />· 반마다 학생 수와 과제 난이도가 다르니, 반끼리의 절대 비교보다{" "}
        <b>같은 반의 흐름</b>을 보시는 게 정확합니다.
      </p>

      <div className="mt-5 space-y-2">
        {classes.map((c) => (
          <Link
            key={c.id}
            href={`/teacher/classes/${c.id}/trend?p=${period.key}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-brand hover:text-brand"
          >
            <span>{c.name} — 학생별 추이 보기</span>
            <span className="text-xs text-slate-400">→</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
