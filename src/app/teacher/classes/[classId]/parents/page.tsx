import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { alimtalkConfigured } from "@/lib/solapi";
import { listParentLinks, canManageClass } from "@/lib/parent-links";
import { sendParentLinks } from "../../../actions";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const fmtPhone = (p: string | null) =>
  p ? p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : "—";

// 학부모 링크 보내기 — 반 학생의 학부모께 열람 링크(/parent/토큰)를 알림톡으로 보낸다.
// 학부모 번호로만 보낸다 (없으면 반 화면 '📱 연락처' 에 먼저 적어야 한다).
export default async function ParentLinksPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { done?: string; error?: string };
}) {
  const { effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;
  const access = await canManageClass(effectiveId, classId);
  if (!access.ok) notFound();

  const rows = await listParentLinks(classId);
  const talkReady = alimtalkConfigured("parent");
  const noPhone = rows.filter((r) => !r.phone).length;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && (
        <ImpersonationBanner name={actingName} />
      )}
      <Link
        href={`/teacher/classes/${classId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← {access.name}
      </Link>

      <header className="mt-3">
        <h1 className="text-xl font-bold sm:text-2xl">👨‍👩‍👧 학부모 링크 보내기</h1>
        <p className="mt-1 text-sm text-slate-500">
          학부모께 자녀의 과제 기록을 볼 수 있는 링크를 알림톡으로 보내요.
          <b> 학부모 번호로만</b> 보냅니다.
        </p>
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
      {!talkReady && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ 학부모 링크 알림톡이 아직 설정되지 않아 보낼 수 없어요. 반 화면의
          학생마다 있는 <b>링크 복사</b>로 직접 보내 주셔도 됩니다.
        </p>
      )}
      {noPhone > 0 && (
        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          📱 학부모 번호가 없는 학생 {noPhone}명은 보낼 수 없어요. 반 화면의
          학생 옆 <b>연락처</b>에 먼저 적어 주세요.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
          아직 가입한 학생이 없어요
        </p>
      ) : (
        <form action={sendParentLinks} className="mt-6">
          <input type="hidden" name="classId" value={classId} />
          <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
            {rows.map((r) => (
              <li
                key={r.studentId}
                className="flex flex-wrap items-center gap-2.5 p-3"
              >
                <input
                  type="checkbox"
                  name="studentIds"
                  value={r.studentId}
                  defaultChecked={!!r.phone && !r.sentAt}
                  disabled={!r.phone || !talkReady}
                  className="h-4 w-4 shrink-0 disabled:opacity-30"
                />
                <span className="min-w-0 flex-1">
                  <span className="inline-block w-7 text-slate-400">
                    {r.number ?? "-"}
                  </span>
                  <span className="font-medium">{r.name}</span>
                  <span className="block pl-7 text-xs text-slate-400">
                    {r.phone
                      ? `학부모 ${fmtPhone(r.phone)}`
                      : "학부모 번호 없음"}
                    {r.sentAt
                      ? ` · ${r.sentAt.slice(5, 10).replace("-", "/")} 보냄${
                          r.sentCount > 1 ? ` (${r.sentCount}회)` : ""
                        }`
                      : ""}
                    {r.sentAt && r.sentTo && r.phone && r.sentTo !== r.phone
                      ? ` · 그때는 ${fmtPhone(r.sentTo)}로 보냄`
                      : ""}
                    {!r.token ? " · 링크는 보낼 때 만들어져요" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">
              이미 보낸 학생은 체크가 꺼져 있어요. 다시 보내려면 체크해 주세요.
            </span>
            <ConfirmSubmitButton
              message={
                "선택한 학생의 학부모께 열람 링크 알림톡을 보낼까요?\n\n보낸 뒤에는 취소할 수 없어요."
              }
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
            >
              📩 학부모 링크 알림톡 보내기
            </ConfirmSubmitButton>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            반 화면에서 링크를 <b>재발급</b>하면 이전에 보낸 링크는 열리지
            않아요. 재발급했다면 여기서 다시 보내 주세요.
          </p>
        </form>
      )}
    </main>
  );
}
