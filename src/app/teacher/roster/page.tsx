import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createAdminClient } from "@/lib/supabase/admin";
import { hrConfigured } from "@/lib/hr/client";
import { getSyncMode } from "@/lib/hr/sync";
import { listUninvited } from "@/lib/invites";
import { alimtalkConfigured } from "@/lib/solapi";
import { appOrigin } from "@/lib/app-url";
import {
  refreshMyRoster,
  dismissPendingStudent,
  sendSignupInvites,
} from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import CopyButton from "@/components/CopyButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fmtPhone = (p: string | null) =>
  p ? p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : "—";

// 선생님 '명단 확인' — Student Card 명단과 비교해
//  · 아직 가입하지 않은 학생 (가입 안내 알림톡을 여기서 보낸다)
//  · 같은 이름이 여럿이라 확인이 필요한 학생
// 을 보여 준다.
export default async function TeacherRosterPage({
  searchParams,
}: {
  searchParams: { done?: string; error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const admin = createAdminClient();
  const mode = await getSyncMode();

  const { data: classRows } = await db
    .from("classes")
    .select("id, name")
    .eq("teacher_id", effectiveId)
    .is("archived_at", null)
    .order("name");
  const classes = (classRows ?? []) as { id: string; name: string }[];
  const byId = new Map(classes.map((c) => [c.id, c.name]));
  const ids = classes.map((c) => c.id);

  const [{ data: linkRows }, { data: ambRows }, uninvited] = await Promise.all([
    ids.length
      ? admin.from("class_links").select("class_id").in("class_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? admin
          .from("hr_pending_students")
          .select("id, class_id, name, student_phone, parent_phone")
          .in("class_id", ids)
          .eq("kind", "ambiguous")
          .order("name")
      : Promise.resolve({ data: [] }),
    listUninvited(classes),
  ]);
  const linked = new Set(
    ((linkRows ?? []) as { class_id: string }[]).map((l) => l.class_id),
  );
  const unlinked = classes.filter((c) => !linked.has(c.id));
  const ambiguous = (ambRows ?? []) as {
    id: string;
    class_id: string;
    name: string;
    student_phone: string | null;
    parent_phone: string | null;
  }[];

  const talkReady = alimtalkConfigured("invite");
  const origin = appOrigin();
  // 전환 중에는 아직 유스피킹에 없는 학생에게 담임 선생님의 가입 신청 링크를 보낸다
  const { data: me } = await admin
    .from("teachers")
    .select("signup_code")
    .eq("id", effectiveId)
    .maybeSingle();
  const hasSignupCode = !!(me as { signup_code?: string | null } | null)
    ?.signup_code;
  const sendable = (r: (typeof uninvited)[number]) =>
    !!r.phone &&
    ((r.kind === "invited" && !!r.token) ||
      (r.kind === "card" && mode === "convert" && hasSignupCode));

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
            Student Card 명단에 있는데 아직 유스피킹에 가입하지 않은 학생이에요.
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
          ⚠️ Student Card 연동이 아직 설정되지 않았어요. 운영자에게 문의해
          주세요.
        </p>
      )}
      {unlinked.length > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          🔗 아직 Student Card 반과 이어지지 않은 반이 있어요 —{" "}
          <b>{unlinked.map((c) => c.name).join(", ")}</b>. 운영자가 이어 주면
          명단을 자동으로 받아옵니다.
        </p>
      )}

      {/* ── 가입하지 않은 학생 ── */}
      <section className="mt-6">
        <h2 className="font-semibold">
          가입하지 않은 학생 ({uninvited.length})
        </h2>
        {!talkReady && uninvited.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            ⚠️ 가입 안내 알림톡이 아직 설정되지 않아 보낼 수 없어요. 대신 아래{" "}
            <b>링크 복사</b>로 직접 보내 주셔도 됩니다.
          </p>
        )}

        {uninvited.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            모든 학생이 가입했어요 🙂
          </p>
        ) : (
          <form action={sendSignupInvites} className="mt-3">
            <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
              {uninvited.map((r) => {
                const link =
                  r.kind === "invited" && r.token
                    ? `${origin}/student/join/${r.token}`
                    : null;
                return (
                  <li
                    key={r.key}
                    className="flex flex-wrap items-center gap-2.5 p-3"
                  >
                    <input
                      type="checkbox"
                      name="keys"
                      value={r.key}
                      defaultChecked={sendable(r) && !r.sentAt}
                      disabled={!sendable(r) || !talkReady}
                      className="h-4 w-4 shrink-0 disabled:opacity-30"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{r.name}</span>
                      <span className="ml-1.5 text-xs text-slate-400">
                        {byId.get(r.classId)}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {r.phoneOwner
                          ? `${r.phoneOwner} ${fmtPhone(r.phone)}`
                          : "연락처 없음"}
                        {r.sentAt
                          ? ` · ${r.sentAt.slice(5, 10).replace("-", "/")} 안내 보냄${
                              r.sentCount > 1 ? ` (${r.sentCount}회)` : ""
                            }`
                          : ""}
                      </span>
                    </span>
                    {link && (
                      <>
                        <input
                          id={`inv-${r.key}`}
                          readOnly
                          value={link}
                          className="hidden"
                        />
                        <CopyButton
                          targetId={`inv-${r.key}`}
                          className="shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                        />
                      </>
                    )}
                    {r.kind === "card" && mode === "oneway" && (
                      <span className="text-[11px] text-slate-400">
                        다음 동기화 때 가입 링크가 생겨요
                      </span>
                    )}
                    {!r.phone && (
                      <span className="text-[11px] text-amber-600">
                        Student Card 에 연락처가 없어요
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400">
                학부모 번호로 보내고, 없으면 학생 번호로 보내요.
              </span>
              <ConfirmSubmitButton
                message={
                  "선택한 학생에게 가입 안내 알림톡을 보낼까요?\n\n보낸 뒤에는 취소할 수 없어요."
                }
                className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
              >
                📩 가입 안내 알림톡 보내기
              </ConfirmSubmitButton>
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {mode === "oneway"
                ? "안내의 버튼을 누르면 학생이 아이디·비밀번호만 정하고 바로 시작해요. 선생님 승인은 필요 없어요."
                : "안내의 버튼을 누르면 가입 신청 화면이 열려요. 신청하면 다음 동기화 때 Student Card 명단과 이어집니다."}
            </p>
          </form>
        )}
      </section>

      {/* ── 확인이 필요한 학생 ── */}
      {ambiguous.length > 0 && (
        <section className="mt-8">
          <h2 className="font-semibold">
            확인이 필요한 학생 ({ambiguous.length})
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            같은 이름이 여럿이거나 이름이 달라 자동으로 잇지 못했어요. 운영자가
            Student Card 전환 도구에서 이어 줍니다.
          </p>
          <ul className="mt-2 space-y-2">
            {ambiguous.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm"
              >
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-slate-400">
                  {byId.get(p.class_id)}
                </span>
                <span className="text-xs text-slate-400">
                  학부모 {fmtPhone(p.parent_phone)}
                </span>
                <form action={dismissPendingStudent} className="ml-auto">
                  <input type="hidden" name="pendingId" value={p.id} />
                  <button className="text-xs text-slate-300 hover:text-slate-500">
                    숨기기
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
