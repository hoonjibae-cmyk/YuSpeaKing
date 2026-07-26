import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { studentLogout, redeemCoupons } from "../actions";
import { CrownMark } from "@/components/Logo";
import { todayKST } from "@/lib/date";
import type { AzureScores } from "@/lib/types";
import BadgeCelebration from "@/components/BadgeCelebration";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { Mascot } from "@/components/Mascots";

export default async function StudentHome({
  searchParams,
}: {
  searchParams: { redeemed?: string };
}) {
  const session = await requireStudent();
  const admin = createAdminClient();
  const today = todayKST();

  // 서로 독립적인 조회는 병렬로 (왕복 시간 단축)
  const [assignmentsRes, subsRes, studentCountRes, studentRowRes, classRes] =
    await Promise.all([
      admin
        .from("assignments")
        .select("id, title, due_date, created_at")
        .eq("class_id", session.classId)
        .order("created_at", { ascending: false }),
      admin
        .from("submissions")
        .select("assignment_id, status, overall_score, azure_scores, created_at")
        .eq("student_id", session.studentId),
      admin
        .from("students")
        .select("id", { count: "exact", head: true })
        .eq("class_id", session.classId)
        .eq("status", "approved"),
      admin
        .from("students")
        .select("seen_badges, coupons_reset_at")
        .eq("id", session.studentId)
        .single(),
      admin
        .from("classes")
        .select("teachers(coupon_goal, coupon_reward_text)")
        .eq("id", session.classId)
        .single(),
    ]);

  const allAssignments = assignmentsRes.data;
  const subs = subsRes.data;
  const classStudentCount = studentCountRes.count;
  const studentRow = studentRowRes.data as {
    seen_badges: string[] | null;
    coupons_reset_at: string | null;
  } | null;
  const teacherSettings = (() => {
    const t = classRes.data?.teachers;
    return (Array.isArray(t) ? t[0] : t) as
      | { coupon_goal: number | null; coupon_reward_text: string | null }
      | null
      | undefined;
  })();

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
  // 지금 이어지고 있는 연속 제출(최신 과제부터) — 실시간 응원 문구용
  let currentStreak = 0;
  for (const a of allAssignments ?? []) {
    if (subMap.has(a.id)) currentStreak++;
    else break;
  }
  // 지금까지 달성한 '최고' 연속 기록 — 한 번 달성한 배지는 사라지지 않도록 최댓값 사용
  let bestStreak = 0;
  let run = 0;
  for (const a of allAssignments ?? []) {
    if (subMap.has(a.id)) {
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }

  // 전체 배지 목록(획득/미획득 모두 표시 — 쿠폰칸처럼 미리 보여주기)
  const ALL_BADGES = [
    { key: "first", emoji: "🎉", label: "첫 스피킹", earned: submittedCount >= 1 },
    { key: "streak5", emoji: "⚡", label: "5회 연속", earned: bestStreak >= 5 },
    { key: "streak10", emoji: "🔥", label: "10회 연속", earned: bestStreak >= 10 },
    { key: "streak20", emoji: "🌟", label: "20회 연속", earned: bestStreak >= 20 },
    { key: "streak30", emoji: "👑", label: "30회 연속", earned: bestStreak >= 30 },
    { key: "score80", emoji: "🥉", label: "80점 클럽", earned: bestScore >= 80 },
    { key: "score90", emoji: "🏆", label: "90점 클럽", earned: bestScore >= 90 },
    { key: "score100", emoji: "⭐", label: "만점!", earned: bestScore >= 100 },
  ];
  const seenBadges = Array.isArray(studentRow?.seen_badges)
    ? studentRow!.seen_badges!
    : [];
  const newBadges = ALL_BADGES.filter(
    (b) => b.earned && !seenBadges.includes(b.key)
  ).map((b) => ({ key: b.key, emoji: b.emoji, label: b.label }));

  // ---- 쿠폰함: 완성도 90% 이상으로 제출한 과제 1개당 쿠폰 1개 ----
  const couponGoal = Math.max(1, teacherSettings?.coupon_goal ?? 10);
  const rewardText = teacherSettings?.coupon_reward_text?.trim() || "";
  const resetAtMs = studentRow?.coupons_reset_at
    ? new Date(studentRow.coupons_reset_at).getTime()
    : 0;
  const couponCount = (subs ?? []).filter((s) => {
    if (s.status !== "evaluated") return false;
    const comp = (s.azure_scores as AzureScores | null)?.completeness ?? null;
    if (comp == null || comp < 90) return false;
    const ts = s.created_at ? new Date(s.created_at as string).getTime() : 0;
    return ts > resetAtMs;
  }).length;
  const couponFull = couponCount >= couponGoal;

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
          <Link
            href="/manual/student"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
            title="사용 설명서"
          >
            ❓
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

      {/* 새 배지 획득 축하 연출 */}
      <BadgeCelebration badges={newBadges} />

      {/* 성취 배지 — 미획득 배지도 흐릿하게 미리 보여주기(쿠폰칸 스타일) */}
      <section className="mt-5 rounded-2xl border border-brand/20 bg-brand-light p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-brand">나의 성취 🏅</span>
          {currentStreak >= 2 && (
            <span className="text-xs font-medium text-brand">
              🔥 {currentStreak}회 연속 제출 중!
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {ALL_BADGES.map((b) => (
            <div
              key={b.key}
              className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition ${
                b.earned
                  ? "border-amber-200 bg-white shadow-sm"
                  : "border-dashed border-slate-200 bg-white/40"
              }`}
            >
              <span
                className={`text-2xl ${b.earned ? "" : "opacity-25 grayscale"}`}
              >
                {b.emoji}
              </span>
              <span
                className={`text-[11px] font-medium ${
                  b.earned ? "text-slate-700" : "text-slate-400"
                }`}
              >
                {b.label}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          흐릿한 배지도 계속 도전하면 컬러로 바뀌어요! 연속 제출은 최고 기록으로
          남아요.
        </p>
      </section>

      {/* 쿠폰함 */}
      <section className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-amber-700">
            🎟️ 나의 쿠폰함
          </span>
          <span className="text-xs font-semibold text-amber-700">
            {couponCount} / {couponGoal}개
          </span>
        </div>
        {searchParams.redeemed && (
          <p className="mt-2 rounded-lg bg-white px-3 py-2 text-xs font-medium text-green-700">
            ✅ 쿠폰함이 새로 시작됐어요. 다시 모아볼까요?
          </p>
        )}
        <p className="mt-1 text-[11px] text-amber-600">
          과제를 <b>완성도 90% 이상</b>으로 제출하면 쿠폰 1개가 쌓여요!
        </p>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {Array.from({ length: couponGoal }).map((_, i) => {
            const filled = i < couponCount;
            return (
              <div
                key={i}
                className={`flex aspect-square items-center justify-center rounded-xl p-1 ${
                  filled
                    ? "border border-amber-300 bg-white shadow-sm"
                    : "border border-dashed border-amber-300 bg-white/40"
                }`}
              >
                <Mascot
                  index={i}
                  className={`h-full w-full ${
                    filled ? "" : "opacity-30 grayscale"
                  }`}
                />
              </div>
            );
          })}
        </div>

        {couponFull && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-white p-4 text-center">
            <div className="flex items-end justify-center gap-1">
              <Mascot index={0} className="h-12 w-12" />
              <Mascot index={1} className="h-14 w-14" />
              <Mascot index={2} className="h-12 w-12" />
            </div>
            <p className="mt-2 text-sm font-bold text-amber-700">
              🎁 쿠폰을 모두 모았어요!
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
              {rewardText || "선생님께 보여주고 상품을 받아 가세요!"}
            </p>

            <form action={redeemCoupons} className="mt-4">
              <ConfirmSubmitButton
                message={
                  "⚠️ 상품을 받은 뒤 선생님(관리자)만 눌러 주세요.\n\n지금 누르면 모아둔 쿠폰이 모두 0개로 초기화됩니다. 정말 초기화할까요?"
                }
                className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
              >
                관리자 확인 (상품 지급 완료)
              </ConfirmSubmitButton>
            </form>
            <p className="mt-2 text-[11px] font-medium text-red-500">
              ⚠️ 이 버튼은 <b>선생님이 상품을 준 뒤</b>에 누르는 버튼이에요. 누르면
              쿠폰함이 <b>0개로 초기화</b>돼요. 학생은 누르지 마세요!
            </p>
          </div>
        )}
      </section>

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
