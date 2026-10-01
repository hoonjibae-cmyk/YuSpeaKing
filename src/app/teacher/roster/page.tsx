import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hrConfigured } from "@/lib/hr/client";
import { refreshMyRoster, dismissPendingStudent } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function TeacherRosterPage({
  searchParams,
}: {
  searchParams: { done?: string; error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const admin = createAdminClient();

  const { data: classRows } = await db
    .from("classes")
    .select("id, name")
    .eq("teacher_id", effectiveId)
    .is("archived_at", null)
    .order("name");
  const classes = (classRows ?? []) as { id: string; name: string }[];
  const byId = new Map(classes.map((c) => [c.id, c.name]));

  // 반이 HR 과 이어져 있는지
  const { data: linkRows } = classes.length
    ? await admin
        .from("class_links")
        .select("class_id, hr_class_name")
        .in(
          "class_id",
          classes.map((c) => c.id),
        )
    : { data: [] };
  const links = new Map(
    (
      (linkRows ?? []) as { class_id: string; hr_class_name: string | null }[]
    ).map((l) => [l.class_id, l.hr_class_name]),
  );

  const { data: pendRows } = classes.length
    ? await admin
        .from("hr_pending_students")
        .select(
          "id, class_id, name, kind, student_phone, parent_phone, local_student_id",
        )
        .in(
          "class_id",
          classes.map((c) => c.id),
        )
        .order("name")
    : { data: [] };
  const pending = (pendRows ?? []) as {
    id: string;
    class_id: string;
    name: string;
    kind: string;
    student_phone: string | null;
    parent_phone: string | null;
    local_student_id: string | null;
  }[];

  const unlinked = classes.filter((c) => !links.has(c.id));

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && (
        <ImpersonationBanner name={actingName} />
      )}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold sm:text-2xl">🧾 명단 확인</h1>
          <p className="mt-1 text-sm text-slate-500">
            Student Card 명단과 비교해 등록되지 않은 학생을 알려 드려요.
          </p>
        </div>
        {hrConfigured() && (
          <form action={refreshMyRoster}>
            <SubmitButton
              pendingText="확인 중…"
              className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              🔄 지금 확인
            </SubmitButton>
          </form>
        )}
      </header>

      {searchParams.done && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ {decodeURIComponent(searchParams.done)}
        </p>
      )}
      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      {!hrConfigured() && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ Student Card 연동이 아직 설정되지 않았어요. 운영자에게 문의해 주세요.
        </p>
      )}

      {unlinked.length > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          🔗 아직 Student Card 반과 이어지지 않은 반이 있어요 —{" "}
          <b>{unlinked.map((c) => c.name).join(", ")}</b>. 운영자가 이어 주면
          명단을 자동으로 받아옵니다.
        </p>
      )}

      {pending.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
          등록이 필요한 학생이 없어요 🙂
        </p>
      ) : (
        <ul className="mt-5 space-y-2">
          {pending.map((p) => (
            <li
              key={p.id}
              className="rounded-xl border border-slate-200 bg-white p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {byId.get(p.class_id) ?? ""}
                </span>
                {p.kind === "ambiguous" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    같은 이름 여러 명 · 확인 필요
                  </span>
                ) : (
                  <span className="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-medium text-brand">
                    등록 안 됨
                  </span>
                )}
              </div>

              <p className="mt-1.5 text-xs text-slate-500">
                {p.kind === "ambiguous"
                  ? "유스피킹의 같은 이름 학생과 자동으로 잇지 못했어요. 이름을 Student Card 와 똑같이 맞춰 주시면 다음 확인 때 연결됩니다."
                  : "Student Card 명단에는 있는데 유스피킹에 아직 없는 학생이에요."}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                <span className="text-slate-400">
                  학생 {p.student_phone ?? "-"} · 학부모 {p.parent_phone ?? "-"}
                </span>
                <Link
                  href={`/teacher/classes/${p.class_id}`}
                  className="text-brand hover:underline"
                >
                  반 화면에서 등록 →
                </Link>
                <form action={dismissPendingStudent} className="ml-auto">
                  <input type="hidden" name="pendingId" value={p.id} />
                  <button className="text-slate-300 hover:text-slate-500">
                    숨기기
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-[11px] text-slate-400">
        · 학생을 등록하면 다음 확인 때 목록에서 사라집니다.
        <br />· 이어진 반의 학생은{" "}
        <b>학생·학부모 연락처가 자동으로 채워집니다.</b>
      </p>
    </main>
  );
}
