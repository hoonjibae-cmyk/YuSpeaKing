import Link from "next/link";
import { getRole } from "@/lib/auth";
import { getTeacherContext } from "@/lib/teacher-context";
import { createClass, signOut, saveCouponSettings } from "./actions";
import SubmitButton from "@/components/SubmitButton";
import { CrownMark } from "@/components/Logo";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export default async function TeacherDashboard({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const role = await getRole();

  const { data: classes } = await db
    .from("classes")
    .select("id, name, class_code, created_at, students(count), assignments(count)")
    .eq("teacher_id", effectiveId)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  // 보관된 반 개수 (보관반 목록 진입용)
  const { count: archivedCount } = await db
    .from("classes")
    .select("id", { count: "exact", head: true })
    .eq("teacher_id", effectiveId)
    .not("archived_at", "is", null);

  // 쿠폰/보상 설정
  const { data: couponRow } = await db
    .from("teachers")
    .select("coupon_goal, coupon_reward_text")
    .eq("id", effectiveId)
    .single();
  const couponGoal = couponRow?.coupon_goal ?? 25;
  const couponRewardText = couponRow?.coupon_reward_text ?? "";

  // 반별 가입 승인 대기 수
  const classIds = (classes ?? []).map((c) => c.id);
  const pendingByClass = new Map<string, number>();
  if (classIds.length) {
    const { data: pend } = await db
      .from("students")
      .select("class_id")
      .eq("status", "pending")
      .in("class_id", classIds);
    for (const r of (pend ?? []) as { class_id: string }[]) {
      pendingByClass.set(r.class_id, (pendingByClass.get(r.class_id) ?? 0) + 1);
    }
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CrownMark className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold text-brand">유스피킹 · 선생님</h1>
            <p className="text-sm text-slate-500">
              {isImpersonating ? `${actingName} 선생님` : "내 반 관리"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/manual/teacher"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            📘 사용 설명서
          </Link>
          <Link
            href="/teacher/archived"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            🗂️ 보관반{archivedCount ? ` (${archivedCount})` : ""}
          </Link>
          {role === "admin" && !isImpersonating && (
            <Link
              href="/admin"
              className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
            >
              운영자 대시보드
            </Link>
          )}
          <form action={signOut}>
            <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      {/* 반 만들기 */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">새 반 만들기</h2>
        <form action={createClass} className="mt-3 flex gap-2">
          <input
            name="name"
            placeholder="예: 6학년 A반"
            required
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
          <SubmitButton
            pendingText="만드는 중…"
            className="rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
          >
            만들기
          </SubmitButton>
        </form>
      </section>

      {/* 쿠폰/보상 설정 */}
      <section className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6">
        <details>
          <summary className="cursor-pointer font-semibold text-amber-800">
            🎟️ 쿠폰·보상 설정
          </summary>
          <p className="mt-2 text-xs text-amber-700">
            학생이 과제를 <b>완성도 90% 이상</b>으로 제출하면 쿠폰 1개가 쌓여요.
            아래에서 정한 개수를 다 모으면 학생 화면에 상품 안내가 떠요. 학생이{" "}
            <b>데스크 선생님</b>께 화면을 보여드리고 상품을 받은 뒤, 데스크
            선생님이 <b>‘관리자 확인’</b> 버튼을 누르면 쿠폰함이 초기화돼요.
            <br />
            칭찬할 일이 있을 때는 반 화면의 학생 명단에서 <b>🎟️ 특별 쿠폰</b>을
            직접 줄 수도 있어요.
          </p>
          <form action={saveCouponSettings} className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-600">
                목표 쿠폰 개수
                <input
                  name="coupon_goal"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={couponGoal}
                  className="ml-2 w-20 rounded-lg border border-slate-300 px-3 py-1.5 focus:border-brand focus:outline-none"
                />
                <span className="ml-1 text-sm text-slate-500">개</span>
              </label>
            </div>
            <div>
              <label className="text-sm text-slate-600">상품 안내 문구</label>
              <textarea
                name="coupon_reward_text"
                rows={2}
                defaultValue={couponRewardText}
                placeholder={`예: 쿠폰 ${couponGoal}개를 모았어요! 데스크 선생님께 보여주고 상품을 받아 가세요 🎁`}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
            </div>
            <SubmitButton
              pendingText="저장 중…"
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
            >
              쿠폰 설정 저장
            </SubmitButton>
          </form>
        </details>
      </section>

      {/* 반 목록 */}
      <section className="mt-6 space-y-3">
        {(!classes || classes.length === 0) && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            아직 반이 없어요. 위에서 새 반을 만들어 보세요.
          </p>
        )}
        {classes?.map((c) => {
          const studentCount = (c.students as { count: number }[])?.[0]?.count ?? 0;
          const assignmentCount =
            (c.assignments as { count: number }[])?.[0]?.count ?? 0;
          return (
            <Link
              key={c.id}
              href={`/teacher/classes/${c.id}`}
              className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand hover:shadow-sm"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  {(pendingByClass.get(c.id) ?? 0) > 0 && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                      가입 신청 {pendingByClass.get(c.id)}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  학생 {studentCount}명 · 과제 {assignmentCount}개
                </div>
              </div>
              <span className="text-sm text-brand">관리 →</span>
            </Link>
          );
        })}
      </section>
    </main>
  );
}
