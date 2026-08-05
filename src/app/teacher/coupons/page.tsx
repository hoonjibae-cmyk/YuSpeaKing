import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { grantCoupon } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { couponHelperClassIds } from "@/lib/coupon-helpers";

export const dynamic = "force-dynamic";

// 쿠폰 발급 전용 화면.
// 담임이 아닌 '보조 선생님'도 여기서 자기가 맡은 반 학생에게 쿠폰을 줄 수 있다.
export default async function CouponsPage({
  searchParams,
}: {
  searchParams: { classId?: string };
}) {
  const { effectiveId, isImpersonating, actingName } = await getTeacherContext();
  const admin = createAdminClient();

  // 내 반 + 보조 선생님으로 지정된 반
  const helperIds = await couponHelperClassIds(effectiveId);
  const [{ data: ownRaw }, { data: helperRaw }] = await Promise.all([
    admin
      .from("classes")
      .select("id, name, teacher_id")
      .eq("teacher_id", effectiveId)
      .is("archived_at", null)
      .order("name"),
    helperIds.length
      ? admin
          .from("classes")
          .select("id, name, teacher_id")
          .in("id", helperIds)
          .is("archived_at", null)
          .order("name")
      : Promise.resolve({ data: [] }),
  ]);

  type C = { id: string; name: string; teacher_id: string };
  const own = (ownRaw ?? []) as C[];
  const helper = (helperRaw ?? []) as C[];
  const classes = [
    ...own.map((c) => ({ ...c, mine: true })),
    ...helper.map((c) => ({ ...c, mine: false })),
  ];

  const classId = searchParams.classId || classes[0]?.id || "";
  const current = classes.find((c) => c.id === classId);

  // 담임 이름 (보조로 들어간 반은 누구 반인지 보여준다)
  const ownerIds = Array.from(new Set(helper.map((c) => c.teacher_id)));
  const { data: owners } = ownerIds.length
    ? await admin.from("teachers").select("id, name, email").in("id", ownerIds)
    : { data: [] };
  const ownerName = new Map(
    ((owners ?? []) as { id: string; name: string | null; email: string }[]).map(
      (t) => [t.id, t.name || t.email]
    )
  );

  // 학생 명단 + 쿠폰 개수
  const { data: studentsRaw } = classId
    ? await admin
        .from("students")
        .select("id, name, number, bonus_coupons, coupons_reset_at")
        .eq("class_id", classId)
        .eq("status", "approved")
        .order("number")
    : { data: null };
  const students = (studentsRaw ?? []) as {
    id: string;
    name: string;
    number: number | null;
    bonus_coupons: number | null;
    coupons_reset_at: string | null;
  }[];

  const couponCount = new Map<string, number>();
  if (students.length) {
    const { data: subs } = await admin
      .from("submissions")
      .select("student_id, created_at")
      .in(
        "student_id",
        students.map((s) => s.id)
      )
      .eq("status", "evaluated")
      .gte("completeness", 90);
    const resetAt = new Map(
      students.map((s) => [
        s.id,
        s.coupons_reset_at ? new Date(s.coupons_reset_at).getTime() : 0,
      ])
    );
    for (const r of (subs ?? []) as { student_id: string; created_at: string }[]) {
      if (new Date(r.created_at).getTime() > (resetAt.get(r.student_id) ?? 0)) {
        couponCount.set(r.student_id, (couponCount.get(r.student_id) ?? 0) + 1);
      }
    }
    for (const s of students) {
      couponCount.set(
        s.id,
        (couponCount.get(s.id) ?? 0) + Math.max(0, s.bonus_coupons ?? 0)
      );
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-brand">🎟️ 쿠폰 주기</h1>
      <p className="mt-1 text-sm text-slate-500">
        학생에게 칭찬 쿠폰을 직접 줄 수 있어요. 과제로 쌓인 쿠폰까지 합친 개수가
        보입니다.
      </p>

      {classes.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          쿠폰을 줄 수 있는 반이 없어요.
        </p>
      )}

      {classes.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-2">
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/teacher/coupons?classId=${c.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                c.id === classId
                  ? "border-brand bg-brand-light font-medium text-brand"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.name}
              {!c.mine && (
                <span className="ml-1 text-[11px] text-slate-400">
                  ({ownerName.get(c.teacher_id) ?? "담임"} 반)
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {current && !current.mine && (
        <p className="mt-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">
          🤝 <b>보조 선생님</b>으로 참여 중인 반이에요. 쿠폰 발급만 가능하고
          과제·채점은 담임 선생님이 관리합니다.
        </p>
      )}

      {classId && (
        <ul className="mt-4 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {students.length === 0 && (
            <li className="p-8 text-center text-sm text-slate-400">
              이 반에 학생이 없어요.
            </li>
          )}
          {students.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className="min-w-0">
                <span className="inline-block w-8 text-slate-400">
                  {s.number ?? "-"}
                </span>
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 whitespace-nowrap rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                  🎟️ {couponCount.get(s.id) ?? 0}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <form action={grantCoupon}>
                  <input type="hidden" name="classId" value={classId} />
                  <input type="hidden" name="studentId" value={s.id} />
                  <input type="hidden" name="delta" value="-1" />
                  <input
                    type="hidden"
                    name="back"
                    value={`/teacher/coupons?classId=${classId}`}
                  />
                  <SubmitButton
                    pendingText="…"
                    className="h-8 w-8 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100"
                  >
                    −
                  </SubmitButton>
                </form>
                <form action={grantCoupon}>
                  <input type="hidden" name="classId" value={classId} />
                  <input type="hidden" name="studentId" value={s.id} />
                  <input type="hidden" name="delta" value="1" />
                  <input
                    type="hidden"
                    name="back"
                    value={`/teacher/coupons?classId=${classId}`}
                  />
                  <SubmitButton
                    pendingText="…"
                    className="h-8 w-12 rounded-lg border border-violet-300 bg-violet-50 font-semibold text-violet-600 hover:bg-violet-100"
                  >
                    +1
                  </SubmitButton>
                </form>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        여기서 준 쿠폰은 학생 쿠폰함에 <b className="text-violet-600">보라색 ⭐ 쿠폰</b>
        으로 구분되어 보여요. 과제를 완성도 90% 이상으로 제출하면 쿠폰이 자동으로도
        쌓입니다.
      </p>
    </main>
  );
}
