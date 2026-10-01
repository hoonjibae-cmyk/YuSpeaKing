import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { currentMonth } from "@/lib/monthly";
import { alimtalkConfigured, normalizePhone } from "@/lib/solapi";
import {
  generateClassMonthlyDrafts,
  sendClassReports,
} from "@/app/teacher/actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

// 한 명당 십여 초가 걸리는 초안 생성을 반 단위로 돌린다
export const maxDuration = 300;

export default async function ClassMonthlyPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { month?: string; done?: string; error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;
  const month = /^\d{4}-\d{2}$/.test(searchParams.month || "")
    ? (searchParams.month as string)
    : currentMonth();

  const { data: klass } = await db
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .eq("teacher_id", effectiveId)
    .single();
  if (!klass) notFound();

  const { data: studentRows } = await db
    .from("students")
    .select("id, name, number, parent_phone")
    .eq("class_id", classId)
    .eq("status", "approved")
    .order("number");
  const students = (studentRows ?? []) as {
    id: string;
    name: string;
    number: number | null;
    parent_phone: string | null;
  }[];

  const ids = students.map((s) => s.id);
  const reports = new Map<
    string,
    { content: string; share_token: string | null; sent_at: string | null }
  >();
  if (ids.length) {
    const { data } = await db
      .from("monthly_reports")
      .select("student_id, content, share_token, sent_at")
      .eq("year_month", month)
      .in("student_id", ids);
    for (const r of (data ?? []) as {
      student_id: string;
      content: string;
      share_token: string | null;
      sent_at: string | null;
    }[]) {
      reports.set(r.student_id, r);
    }
  }

  const rows = students.map((s) => {
    const r = reports.get(s.id);
    const written = !!r?.content?.trim();
    const phone = normalizePhone(s.parent_phone);
    return {
      ...s,
      written,
      shared: !!r?.share_token,
      sentAt: r?.sent_at ?? null,
      phone,
      sendable: written && !!r?.share_token && !!phone,
    };
  });

  const writtenCount = rows.filter((r) => r.written).length;
  const sendable = rows.filter((r) => r.sendable);
  const talkReady = alimtalkConfigured();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link
        href={`/teacher/classes/${classId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← {klass.name}
      </Link>
      <h1 className="mt-3 text-2xl font-bold">월말 리포트</h1>

      <form method="get" className="mt-4 flex items-center gap-2">
        <input
          type="month"
          name="month"
          defaultValue={month}
          className="rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <button className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
          조회
        </button>
      </form>

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

      {/* ① 일괄 초안 생성 */}
      <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-slate-700">
          ① 초안 일괄 생성
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          아직 리포트가 없는 학생만 한 번에 만듭니다. 한 명당 십여 초 걸리고,
          시간이 모자라면 만든 만큼 저장한 뒤 남은 인원을 알려 드려요.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <form action={generateClassMonthlyDrafts}>
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="month" value={month} />
            <SubmitButton
              pendingText="작성 중… (반 전체라 몇 분 걸려요)"
              className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
            >
              없는 학생만 초안 만들기 ({students.length - writtenCount}명)
            </SubmitButton>
          </form>
          <form action={generateClassMonthlyDrafts}>
            <input type="hidden" name="classId" value={classId} />
            <input type="hidden" name="month" value={month} />
            <input type="hidden" name="redo" value="1" />
            <ConfirmSubmitButton
              message={
                "반 전체 초안을 다시 만들까요?\n\n이미 손으로 고쳐 둔 내용도 새 초안으로 덮어씁니다."
              }
              className="text-xs text-slate-400 hover:text-brand"
            >
              전체 다시 만들기
            </ConfirmSubmitButton>
          </form>
        </div>
      </section>

      {/* ② 검토 + ③ 발송 */}
      <form action={sendClassReports} className="mt-5">
        <input type="hidden" name="classId" value={classId} />
        <input type="hidden" name="month" value={month} />

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-700">
            ② 검토 후 ③ 알림톡 발송
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            이름을 눌러 내용을 확인·수정하고 <b>링크를 발급</b>한 뒤, 보낼 학생을
            체크해 발송하세요.
          </p>

          {!talkReady && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              ⚠️ 알림톡 설정이 아직 없어 발송할 수 없어요. 운영자에게 문의해
              주세요. (초안 작성과 링크 발급은 지금도 됩니다)
            </p>
          )}

          <ul className="mt-3 divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5 py-2.5">
                <input
                  type="checkbox"
                  name="studentIds"
                  value={r.id}
                  defaultChecked={r.sendable && !r.sentAt}
                  disabled={!r.sendable}
                  className="h-4 w-4 shrink-0 disabled:opacity-30"
                />
                <Link
                  href={`/teacher/students/${r.id}/monthly?month=${month}`}
                  className="min-w-0 flex-1 hover:text-brand"
                >
                  <span className="inline-block w-7 text-slate-400">
                    {r.number ?? "-"}
                  </span>
                  <span className="font-medium">{r.name}</span>
                </Link>

                <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
                  {r.written ? (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700">
                      작성됨
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-400">
                      미작성
                    </span>
                  )}
                  {r.written && !r.shared && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                      링크 미발급
                    </span>
                  )}
                  {!r.phone && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">
                      연락처 없음
                    </span>
                  )}
                  {r.sentAt && (
                    <span className="rounded-full bg-brand-light px-2 py-0.5 text-brand">
                      {r.sentAt.slice(5, 10).replace("-", "/")} 발송
                    </span>
                  )}
                </span>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="py-6 text-center text-sm text-slate-400">
                학생이 없어요.
              </li>
            )}
          </ul>

          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
            <span className="text-xs text-slate-400">
              보낼 수 있는 학생 {sendable.length}명
            </span>
            <ConfirmSubmitButton
              message={
                "선택한 학생의 학부모께 알림톡을 보낼까요?\n\n보낸 뒤에는 취소할 수 없습니다."
              }
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
            >
              알림톡 보내기
            </ConfirmSubmitButton>
          </div>
        </div>
      </form>

      <p className="mt-3 text-[11px] text-slate-400">
        · 연락처는 반 화면의 학생 명단에서 입력합니다.
        <br />· 발송 후에도 리포트를 고쳐 저장하면 <b>같은 링크에 바로 반영</b>
        되니, 다시 보내실 필요는 없어요.
      </p>
    </main>
  );
}
