import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { CrownMark } from "@/components/Logo";
import { todayKST } from "@/lib/date";
import { getStudentNotices } from "@/lib/notices";
import { currentMonth, monthRange } from "@/lib/monthly";
import PushToggle from "@/components/PushToggle";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "자녀 학습 현황 · 유스피킹",
  robots: { index: false, follow: false },
};

// 학부모 열람 페이지 — 로그인 없이 고유 링크로 접속. 읽기 전용.
export default async function ParentViewPage({
  params,
}: {
  params: { token: string };
}) {
  const admin = createAdminClient();

  const { data: student } = await admin
    .from("students")
    .select("id, name, number, school, grade, class_id, status, approved_at")
    .eq("parent_token", params.token)
    .maybeSingle();

  // 토큰이 없거나 재학 중이 아니면 접근 불가
  if (!student || student.status !== "approved") notFound();

  const [{ data: klass }, { data: assignments }, { data: subs }] =
    await Promise.all([
      // teachers 를 붙여 읽으면 조인 경로가 모호해 실패한다 → 반만 읽고 따로 조회
      admin
        .from("classes")
        .select("name, teacher_id")
        .eq("id", student.class_id)
        .maybeSingle(),
      admin
        .from("assignments")
        .select("id, title, due_date, created_at")
        .eq("class_id", student.class_id)
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("submissions")
        .select(
          "assignment_id, overall_score, status, student_feedback, audio_path, audio_expired, created_at"
        )
        .eq("student_id", student.id),
    ]);

  type Sub = {
    assignment_id: string;
    overall_score: number | null;
    status: string;
    student_feedback: string | null;
    audio_path: string | null;
    audio_expired: boolean | null;
    created_at: string;
  };
  const subList = (subs ?? []) as Sub[];
  const subMap = new Map(subList.map((s) => [s.assignment_id, s]));

  // 등록일 이후 과제만 (신입생이 불리하게 보이지 않도록)
  const joinDay = student.approved_at ? student.approved_at.slice(0, 10) : null;
  const list = ((assignments ?? []) as {
    id: string;
    title: string;
    due_date: string | null;
    created_at: string;
  }[]).filter((a) => !joinDay || a.created_at.slice(0, 10) >= joinDay);

  // 녹음 재생용 서명 URL (1시간)
  const audioUrls = new Map<string, string>();
  await Promise.all(
    subList
      .filter((s) => s.audio_path && !s.audio_expired)
      .map(async (s) => {
        const { data } = await admin.storage
          .from("submissions")
          .createSignedUrl(s.audio_path as string, 60 * 60);
        if (data?.signedUrl) audioUrls.set(s.assignment_id, data.signedUrl);
      })
  );

  // 이번 달 / 지난달 평균 (성장 추이)
  const thisMonth = currentMonth();
  const [ty, tm] = thisMonth.split("-").map(Number);
  const prevMonth = `${tm === 1 ? ty - 1 : ty}-${String(tm === 1 ? 12 : tm - 1).padStart(2, "0")}`;
  const avgOf = (month: string) => {
    const { start, endExclusive } = monthRange(month);
    const vals = subList
      .filter(
        (s) =>
          s.status === "evaluated" &&
          s.overall_score != null &&
          s.created_at.slice(0, 10) >= start &&
          s.created_at.slice(0, 10) < endExclusive
      )
      .map((s) => Number(s.overall_score));
    return vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
  };
  const avgThis = avgOf(thisMonth);
  const avgPrev = avgOf(prevMonth);
  const diff = avgThis != null && avgPrev != null ? avgThis - avgPrev : null;

  const today = todayKST();
  const done = list.filter((a) => subMap.has(a.id)).length;

  const notices = await getStudentNotices(student.id, student.class_id);
  const { data: report } = await admin
    .from("monthly_reports")
    .select("year_month, content")
    .eq("student_id", student.id)
    .order("year_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  const k = klass as { name?: string; teacher_id?: string } | null;
  const { data: teacher } = k?.teacher_id
    ? await admin.from("teachers").select("name").eq("id", k.teacher_id).maybeSingle()
    : { data: null };

  return (
    <main className="mx-auto max-w-lg px-5 py-8">
      <header className="flex items-center gap-3">
        <CrownMark className="h-9 w-9 shrink-0" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold text-brand">
            {student.name} 학생 학습 현황
          </h1>
          <p className="truncate text-xs text-slate-500">
            {k?.name ?? ""}
            {teacher?.name ? ` · ${teacher.name} 선생님` : ""}
          </p>
        </div>
      </header>

      {/* 요약 */}
      <section className="mt-5 grid grid-cols-3 gap-2">
        <Stat label="제출" value={`${done}/${list.length}`} sub="최근 과제" />
        <Stat
          label="이번 달 평균"
          value={avgThis != null ? `${avgThis}점` : "-"}
        />
        <Stat
          label="지난달 대비"
          value={
            diff != null ? `${diff > 0 ? "▲" : diff < 0 ? "▼" : ""}${Math.abs(diff)}` : "-"
          }
          sub={avgPrev != null ? `지난달 ${avgPrev}점` : undefined}
        />
      </section>

      {/* 공지 알림 받기 */}
      <PushToggle
        vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        parentToken={params.token}
        label="🔔 학원 공지 알림 받기"
      />

      {/* 공지 */}
      {notices.length > 0 && (
        <section className="mt-5">
          <h2 className="text-sm font-semibold text-slate-600">📢 학원 공지</h2>
          <div className="mt-2 space-y-2">
            {notices.slice(0, 3).map((n) => (
              <article
                key={n.id}
                className="rounded-xl border border-slate-200 bg-white p-3"
              >
                <div className="flex items-center gap-2">
                  {n.pinned && (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600">
                      필독
                    </span>
                  )}
                  <span className="text-[11px] text-slate-400">
                    {n.created_at.slice(0, 10)}
                  </span>
                </div>
                <div className="mt-1 text-sm font-semibold">{n.title}</div>
                {n.body && (
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-slate-600">
                    {n.body}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {/* 과제별 현황 */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-600">📚 과제별 현황</h2>
        <div className="mt-2 space-y-2">
          {list.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              아직 등록된 과제가 없어요.
            </p>
          )}
          {list.map((a) => {
            const s = subMap.get(a.id);
            const overdue = !!a.due_date && a.due_date < today;
            const url = audioUrls.get(a.id);
            return (
              <article
                key={a.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.title}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {a.due_date ? `마감 ${a.due_date}` : "상시 과제"}
                    </div>
                  </div>
                  {s ? (
                    <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                      ✅ 제출
                      {s.status === "evaluated" && s.overall_score != null
                        ? ` ${Math.round(Number(s.overall_score))}점`
                        : ""}
                    </span>
                  ) : (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                        overdue
                          ? "bg-slate-100 text-slate-400"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {overdue ? "미제출" : "❌ 아직"}
                    </span>
                  )}
                </div>

                {url && (
                  <audio src={url} controls preload="none" className="mt-2 h-9 w-full" />
                )}
                {s?.student_feedback && (
                  <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                    {s.student_feedback}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 월말 리포트 */}
      {report?.content && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-slate-600">
            📄 {report.year_month} 월말 리포트
          </h2>
          <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700">
            {report.content}
          </p>
        </section>
      )}

      <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[11px] text-slate-400">
        목동유쌤영어 · 유스피킹 · 학부모 열람 페이지
        <br />
        이 주소는 자녀 정보가 담겨 있으니 공유하지 말아 주세요.
      </footer>
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
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-bold text-brand">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}
