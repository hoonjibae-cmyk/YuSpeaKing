import Link from "next/link";
import { notFound } from "next/navigation";
import { sharedClassIds, accessFor } from "@/lib/class-access";
import { getTeacherContext } from "@/lib/teacher-context";
import { gatherMonthly, currentMonth } from "@/lib/monthly";
import {
  generateMonthlyDraft,
  saveMonthlyReport,
  shareMonthlyReport,
} from "@/app/teacher/actions";
import MonthlyTrend from "@/components/MonthlyTrend";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { appOrigin } from "@/lib/app-url";
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
    .select("id, name, number, class_id, approved_at")
    .eq("id", studentId)
    .single();
  if (!student) notFound();

  // 담임만 걸러 내면 공동 관리 선생님과 보조강사가 들어오지 못한다.
  // 볼 수 있는지로 판정하고, 쓰기 버튼은 canManage 로 가린다.
  const [{ data: klass }, shared] = await Promise.all([
    db
      .from("classes")
      .select("id, name, teacher_id")
      .eq("id", student.class_id)
      .maybeSingle(),
    sharedClassIds(effectiveId),
  ]);
  if (!klass) notFound();
  const { canView, canManage } = accessFor(
    student.class_id,
    klass.teacher_id === effectiveId,
    shared,
  );
  if (!canView) notFound();

  const data = await gatherMonthly(
    db,
    student.id,
    student.class_id,
    month,
    student.approved_at,
  );

  const { data: report } = await db
    .from("monthly_reports")
    .select("content, updated_at, share_token")
    .eq("student_id", studentId)
    .eq("year_month", month)
    .maybeSingle();

  const shareToken = (report as { share_token?: string | null } | null)
    ?.share_token;
  const shareUrl = shareToken ? `${appOrigin()}/report/${shareToken}` : null;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && (
        <ImpersonationBanner name={actingName} />
      )}
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
        <Stat
          label="제출률"
          value={`${data.rate}%`}
          sub={`${data.submitted}/${data.assigned}`}
        />
        <Stat label="평균" value={data.avg != null ? `${data.avg}점` : "-"} />
        <Stat
          label="성장"
          value={
            data.growth != null
              ? `${data.growth > 0 ? "+" : ""}${data.growth}`
              : "-"
          }
          sub={
            data.firstScore != null
              ? `${data.firstScore}→${data.lastScore}`
              : undefined
          }
        />
        <Stat label="취약단어" value={`${data.weakWords.length}개`} />
      </section>

      {/* 선생님만 보는 안내. 리포트 본문에는 등록 관련 내용이 들어가지 않는다. */}
      {data.beforeJoinCount > 0 && (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          제출률은 <b>등록 이후 출제된 과제</b>만으로 계산했어요 (이전 과제{" "}
          {data.beforeJoinCount}개 제외). 이 내용은 학부모께 가는 리포트에는
          들어가지 않습니다.
        </p>
      )}

      {/* 이 달 점수 흐름 — 학부모 링크에도 같은 그래프가 들어간다 */}
      <div className="mt-4">
        <MonthlyTrend items={data.items} />
      </div>

      {/* AI 초안이 보는 재료 — 선생님이 초안을 판단할 때 같이 보시라고 노출 */}
      <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer text-slate-600">
          읽기 특징 (AI 초안이 참고하는 값)
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["정확도", data.profile.accuracy],
            ["유창성", data.profile.fluency],
            ["완성도", data.profile.completeness],
            ["억양", data.profile.prosody],
          ].map(([label, v]) => (
            <div
              key={label as string}
              className="rounded-lg bg-slate-50 px-2 py-1.5 text-center"
            >
              <div className="text-[11px] text-slate-400">{label}</div>
              <div className="font-semibold text-slate-700">
                {v == null ? "-" : (v as number)}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          평가된 단어 {data.profile.totalWords}개 중 발음 오류{" "}
          {data.profile.mispronounced}개 · 빠뜨림 {data.profile.omitted}개 ·
          끝까지 읽지 못한 녹음 {data.profile.lowCompletenessCount}건
        </p>
        {data.weakDetail.length > 0 && (
          <ul className="mt-2 space-y-1">
            {data.weakDetail.map((w) => (
              <li key={w.word} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">
                  {w.word}
                </span>
                <span className="text-slate-400">
                  {w.times}회 · 주로 {w.mostly}
                  {w.mostly === "발음" ? ` · 정확도 ${w.avgAccuracy}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* 과제별 내역 */}
      <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer text-slate-600">
          과제별 내역 ({data.items.length})
        </summary>
        <ul className="mt-2 divide-y divide-slate-100">
          {data.items.map((i, idx) => (
            <li key={idx} className="flex items-center justify-between py-1.5">
              <span className="text-slate-600">
                <span className="text-slate-400">{i.date}</span> {i.title}
              </span>
              <span className={i.submitted ? "text-brand" : "text-slate-300"}>
                {i.submitted
                  ? i.score != null
                    ? `${i.score}점`
                    : "채점중"
                  : "미제출"}
              </span>
            </li>
          ))}
          {data.items.length === 0 && (
            <li className="py-2 text-center text-slate-400">
              이 달 과제가 없어요.
            </li>
          )}
        </ul>
      </details>

      {/* 리포트 초안 생성 */}
      <div className="mt-6 flex items-center justify-between">
        <h2 className="font-semibold">학부모 발송용 리포트</h2>
        {canManage && (
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
        )}
      </div>

      {/* 리포트 편집/저장 — 보조강사는 내용만 읽는다 */}
      {canManage ? (
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
      ) : (
        <p className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
          {report?.content?.trim() || "아직 작성된 리포트가 없어요."}
        </p>
      )}

      {/* 학부모께 보낼 웹링크 — 발급은 담임·공동관리만 */}
      {canManage && (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            🔗 학부모 발송용 링크
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            링크를 열면 위 코멘트와 <b>점수 흐름 그래프</b>, 과제별 기록이
            보입니다. 저장한 내용이 그대로 나가니 <b>다듬은 뒤 발급</b>해
            주세요.
          </p>

          {shareUrl ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <input
                  id="report-link"
                  readOnly
                  value={shareUrl}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
                />
                <CopyButton
                  targetId="report-link"
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
                />
              </div>
              <form action={shareMonthlyReport} className="mt-2">
                <input type="hidden" name="studentId" value={studentId} />
                <input type="hidden" name="month" value={month} />
                <ConfirmSubmitButton
                  message={
                    "링크를 새로 만들까요?\n\n기존에 학부모께 보낸 링크는 즉시 열리지 않게 됩니다."
                  }
                  className="text-xs text-slate-400 hover:text-brand"
                >
                  링크 재발급
                </ConfirmSubmitButton>
              </form>
              <p className="mt-2 text-[11px] text-slate-400">
                리포트를 수정해 저장하면 <b>같은 링크에 바로 반영</b>됩니다.
                링크를 다시 보낼 필요는 없어요.
              </p>
            </>
          ) : (
            <form action={shareMonthlyReport} className="mt-3">
              <input type="hidden" name="studentId" value={studentId} />
              <input type="hidden" name="month" value={month} />
              <SubmitButton
                pendingText="발급 중…"
                className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
              >
                링크 발급
              </SubmitButton>
            </form>
          )}
        </section>
      )}
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
