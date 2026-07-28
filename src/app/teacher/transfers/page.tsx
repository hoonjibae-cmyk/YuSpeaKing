import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { acceptTransfer, resolveTransfer, requestClassTransfer } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";

interface Req {
  id: string;
  kind: string;
  student_id: string | null;
  class_id: string;
  from_teacher_id: string;
  to_teacher_id: string;
  requested_by: string;
  created_at: string;
}

export default async function TransfersPage({
  searchParams,
}: {
  searchParams: { error?: string; accepted?: string };
}) {
  const { effectiveId, isImpersonating, actingName } = await getTeacherContext();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("transfer_requests")
    .select(
      "id, kind, student_id, class_id, from_teacher_id, to_teacher_id, requested_by, created_at"
    )
    .eq("status", "pending")
    .or(`from_teacher_id.eq.${effectiveId},to_teacher_id.eq.${effectiveId}`)
    .order("created_at", { ascending: false });

  const list = (rows ?? []) as Req[];
  const incoming = list.filter((r) => r.requested_by !== effectiveId);
  const outgoing = list.filter((r) => r.requested_by === effectiveId);

  // 표시에 필요한 이름들 한 번에 조회
  const teacherIds = Array.from(
    new Set(list.flatMap((r) => [r.from_teacher_id, r.to_teacher_id]))
  );
  const studentIds = list.map((r) => r.student_id).filter(Boolean) as string[];
  const classIds = list.map((r) => r.class_id);

  const [{ data: teachers }, { data: students }, { data: classes }, { data: myClasses }] =
    await Promise.all([
      teacherIds.length
        ? admin.from("teachers").select("id, name, email").in("id", teacherIds)
        : Promise.resolve({ data: [] }),
      studentIds.length
        ? admin.from("students").select("id, name").in("id", studentIds)
        : Promise.resolve({ data: [] }),
      classIds.length
        ? admin.from("classes").select("id, name").in("id", classIds)
        : Promise.resolve({ data: [] }),
      admin
        .from("classes")
        .select("id, name")
        .eq("teacher_id", effectiveId)
        .is("archived_at", null)
        .order("name"),
    ]);

  const tName = new Map(
    ((teachers ?? []) as { id: string; name: string; email: string }[]).map((t) => [
      t.id,
      t.name || t.email,
    ])
  );
  const sName = new Map(
    ((students ?? []) as { id: string; name: string }[]).map((s) => [s.id, s.name])
  );
  const cName = new Map(
    ((classes ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name])
  );
  const mine = (myClasses ?? []) as { id: string; name: string }[];

  // 다른 선생님의 반 (담임을 맡아오기 요청용)
  const { data: otherClassesRaw } = await admin
    .from("classes")
    .select("id, name, teacher_id, teachers(name, email)")
    .neq("teacher_id", effectiveId)
    .is("archived_at", null)
    .order("name");
  const otherClasses = ((otherClassesRaw ?? []) as Array<{
    id: string;
    name: string;
    teacher_id: string;
    teachers: { name?: string; email?: string } | { name?: string; email?: string }[] | null;
  }>).map((c) => {
    const t = Array.isArray(c.teachers) ? c.teachers[0] : c.teachers;
    return { id: c.id, name: c.name, teacher: t?.name || t?.email || "선생님" };
  });

  function describe(r: Req) {
    if (r.kind === "student") {
      return {
        title: `🎓 학생 인수인계 — ${sName.get(r.student_id ?? "") ?? "학생"}`,
        detail: `${tName.get(r.from_teacher_id) ?? "선생님"} (${
          cName.get(r.class_id) ?? "반"
        }) → ${tName.get(r.to_teacher_id) ?? "선생님"}`,
      };
    }
    return {
      title: `🏫 반 인수인계 — ${cName.get(r.class_id) ?? "반"}`,
      detail: `담임 ${tName.get(r.from_teacher_id) ?? "선생님"} → ${
        tName.get(r.to_teacher_id) ?? "선생님"
      }`,
    };
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-brand">🔀 인수인계</h1>
      <p className="mt-1 text-sm text-slate-500">
        학생·반을 다른 선생님과 주고받아요. 수락하면 계정·제출 기록·점수·쿠폰이
        그대로 따라갑니다.
      </p>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}
      {searchParams.accepted && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ 인수인계가 완료되었어요.
        </p>
      )}

      {/* 다른 선생님 반 맡아오기 */}
      {otherClasses.length > 0 && (
        <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <summary className="cursor-pointer font-semibold text-slate-700">
            🏫 다른 선생님 반 맡아오기
          </summary>
          <p className="mt-2 text-xs text-slate-500">
            내가 새 담임을 맡게 될 때 사용해요. 현재 담임 선생님이 수락하면 반 전체가
            넘어옵니다. (반을 넘겨줄 때는 해당 반 화면에서 요청하세요.)
          </p>
          <form
            action={requestClassTransfer}
            className="mt-3 flex flex-wrap items-center gap-2"
          >
            <input type="hidden" name="direction" value="take" />
            <select
              name="classId"
              required
              defaultValue=""
              className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
            >
              <option value="" disabled>
                맡아올 반 선택
              </option>
              {otherClasses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.teacher} 선생님)
                </option>
              ))}
            </select>
            <SubmitButton
              pendingText="요청 중…"
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              인수인계 요청
            </SubmitButton>
          </form>
        </details>
      )}

      {/* 받은 요청 */}
      <section className="mt-6">
        <h2 className="font-semibold">받은 요청 ({incoming.length})</h2>
        <div className="mt-3 space-y-3">
          {incoming.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              받은 요청이 없어요.
            </p>
          )}
          {incoming.map((r) => {
            const d = describe(r);
            return (
              <article
                key={r.id}
                className="rounded-2xl border border-brand/30 bg-brand-light p-5"
              >
                <div className="font-semibold text-slate-800">{d.title}</div>
                <div className="mt-0.5 text-xs text-slate-500">{d.detail}</div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={acceptTransfer} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="requestId" value={r.id} />
                    {r.kind === "student" && (
                      <select
                        name="targetClassId"
                        required
                        defaultValue={mine[0]?.id ?? ""}
                        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                      >
                        <option value="" disabled>
                          받을 반 선택
                        </option>
                        {mine.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <SubmitButton
                      pendingText="처리 중…"
                      className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                    >
                      수락
                    </SubmitButton>
                  </form>
                  <form action={resolveTransfer}>
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="action" value="rejected" />
                    <ConfirmSubmitButton
                      message="이 인수인계 요청을 거절할까요?"
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-50"
                    >
                      거절
                    </ConfirmSubmitButton>
                  </form>
                </div>
                {r.kind === "student" && mine.length === 0 && (
                  <p className="mt-2 text-xs text-red-500">
                    받을 반이 없어요. 먼저 반을 만들어 주세요.
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* 보낸 요청 */}
      <section className="mt-8">
        <h2 className="font-semibold">보낸 요청 ({outgoing.length})</h2>
        <div className="mt-3 space-y-3">
          {outgoing.length === 0 && (
            <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              보낸 요청이 없어요.
            </p>
          )}
          {outgoing.map((r) => {
            const d = describe(r);
            return (
              <article
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-slate-800">{d.title}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{d.detail}</div>
                  <div className="mt-1 text-[11px] text-amber-600">상대 선생님의 수락을 기다리는 중</div>
                </div>
                <form action={resolveTransfer} className="shrink-0">
                  <input type="hidden" name="requestId" value={r.id} />
                  <input type="hidden" name="action" value="canceled" />
                  <ConfirmSubmitButton
                    message="요청을 취소할까요?"
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    취소
                  </ConfirmSubmitButton>
                </form>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}
