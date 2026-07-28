import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveStudent } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import { todayKST } from "@/lib/date";

export const dynamic = "force-dynamic";

// 반 이동 전용 화면. 자주 쓰는 기능이 아니라 반 관리 화면과 분리해 두었다.
export default async function MoveStudentsPage({
  searchParams,
}: {
  searchParams: {
    classId?: string;
    error?: string;
    moved?: string;
    requested?: string;
    scheduled?: string;
  };
}) {
  const { db, effectiveId, isImpersonating, actingName } = await getTeacherContext();
  const admin = createAdminClient();

  const { data: myClassesRaw } = await db
    .from("classes")
    .select("id, name")
    .eq("teacher_id", effectiveId)
    .is("archived_at", null)
    .order("name");
  const myClasses = (myClassesRaw ?? []) as { id: string; name: string }[];

  const classId = searchParams.classId || myClasses[0]?.id || "";

  const [{ data: studentsRaw }, { data: otherTeachersRaw }, { data: scheduledRaw }] =
    await Promise.all([
      classId
        ? db
            .from("students")
            .select("id, name, number")
            .eq("class_id", classId)
            .eq("status", "approved")
            .order("number", { ascending: true })
        : Promise.resolve({ data: [] }),
      admin
        .from("teachers")
        .select("id, name, email")
        .eq("status", "approved")
        .neq("id", effectiveId)
        .order("name"),
      admin
        .from("transfer_requests")
        .select(
          "id, kind, student_id, class_id, target_class_id, effective_date, status, students(name), classes!transfer_requests_target_class_id_fkey(name)"
        )
        .eq("kind", "student")
        .is("applied_at", null)
        .in("status", ["pending", "accepted"])
        .or(`from_teacher_id.eq.${effectiveId},to_teacher_id.eq.${effectiveId}`)
        .order("effective_date", { ascending: true }),
    ]);

  const students = (studentsRaw ?? []) as {
    id: string;
    name: string;
    number: number | null;
  }[];
  const otherTeachers = (otherTeachersRaw ?? []) as {
    id: string;
    name: string | null;
    email: string;
  }[];
  const scheduled = (scheduledRaw ?? []) as Array<{
    id: string;
    student_id: string | null;
    effective_date: string | null;
    status: string;
    students: { name?: string } | { name?: string }[] | null;
  }>;
  const pendingByStudent = new Map(
    scheduled.map((r) => [r.student_id ?? "", r])
  );

  const today = todayKST();

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-brand">🔀 반 이동</h1>
      <p className="mt-1 text-sm text-slate-500">
        학생을 다른 반으로 옮겨요. 아이디·제출 기록·점수·배지·쿠폰이 그대로 따라갑니다.
      </p>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}
      {searchParams.moved && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ {decodeURIComponent(searchParams.moved)} 학생을 옮겼어요.
        </p>
      )}
      {searchParams.scheduled && (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          🗓️ {decodeURIComponent(searchParams.scheduled)}에 이동하도록 예약했어요.
        </p>
      )}
      {searchParams.requested && (
        <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
          📨 인수인계를 요청했어요. 상대 선생님이 수락하면 진행됩니다. (Slack 알림 발송)
        </p>
      )}

      {myClasses.length === 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          반이 없어요. 먼저 반을 만들어 주세요.
        </p>
      )}

      {/* 반 선택 */}
      {myClasses.length > 0 && (
        <nav className="mt-6 flex flex-wrap gap-2">
          {myClasses.map((c) => (
            <Link
              key={c.id}
              href={`/teacher/move?classId=${c.id}`}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                c.id === classId
                  ? "border-brand bg-brand-light font-medium text-brand"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      {/* 학생 명단 */}
      {classId && (
        <section className="mt-4 space-y-2">
          {students.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
              이 반에 학생이 없어요.
            </p>
          )}
          {students.map((s) => {
            const pending = pendingByStudent.get(s.id);
            const pName = pending
              ? (Array.isArray(pending.students)
                  ? pending.students[0]
                  : pending.students
                )?.name
              : null;
            return (
              <div
                key={s.id}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-slate-400">
                    {s.number ?? "-"}
                  </span>
                  <span className="font-medium">{s.name}</span>
                  {pending && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      {pending.status === "accepted"
                        ? `🗓️ ${pending.effective_date} 이동 예정`
                        : "📨 인수인계 요청 중"}
                    </span>
                  )}
                </div>

                {!pending && (
                  <form
                    action={moveStudent}
                    className="mt-2 flex flex-wrap items-center gap-2"
                  >
                    <input type="hidden" name="classId" value={classId} />
                    <input type="hidden" name="studentId" value={s.id} />
                    <select
                      name="target"
                      required
                      defaultValue=""
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                    >
                      <option value="" disabled>
                        옮길 곳 선택
                      </option>
                      {myClasses.filter((c) => c.id !== classId).length > 0 && (
                        <optgroup label="내 반 (요청 없이 이동)">
                          {myClasses
                            .filter((c) => c.id !== classId)
                            .map((c) => (
                              <option key={c.id} value={`class:${c.id}`}>
                                {c.name}
                              </option>
                            ))}
                        </optgroup>
                      )}
                      {otherTeachers.length > 0 && (
                        <optgroup label="다른 선생님 (인수인계 요청)">
                          {otherTeachers.map((t) => (
                            <option key={t.id} value={`teacher:${t.id}`}>
                              {t.name || t.email} 선생님
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-500">
                      이동일
                      <input
                        type="date"
                        name="effective_date"
                        defaultValue={today}
                        min={today}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <SubmitButton
                      pendingText="처리 중…"
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                    >
                      이동
                    </SubmitButton>
                  </form>
                )}
                {pending && (
                  <p className="mt-1.5 text-xs text-slate-500">
                    진행 중인 이동이 있어요.{" "}
                    <Link
                      href="/teacher/transfers"
                      className="font-medium text-brand hover:underline"
                    >
                      인수인계 화면
                    </Link>
                    에서 확인·취소할 수 있어요.
                    {pName ? "" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}

      <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500">
        · <b>내 반</b>으로 옮기면 요청 없이 바로(또는 지정한 날짜에) 이동합니다.
        <br />· <b>다른 선생님</b>을 고르면 인수인계 요청이 전송되고, 상대가 수락해야
        이동합니다.
        <br />· 반 담임 자체를 바꾸려면{" "}
        <Link href="/teacher/transfers" className="font-medium text-brand hover:underline">
          인수인계 화면
        </Link>
        을 이용하세요.
      </p>
    </main>
  );
}
