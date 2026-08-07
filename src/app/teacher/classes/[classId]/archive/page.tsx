import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import { coTaughtClassIds } from "@/lib/transfers";
import { todayKST, archiveCutoffKST, ARCHIVE_AFTER_DAYS } from "@/lib/date";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import AssignmentCard, { type AssignmentRow } from "../AssignmentCard";

// 마감 후 ARCHIVE_AFTER_DAYS 일이 지난 과제 보관함.
// 반 화면에서는 빠지지만 여기서 언제든 제출 내역·점수를 그대로 볼 수 있다.
export default async function AssignmentArchivePage({
  params,
}: {
  params: { classId: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;
  const cutoff = archiveCutoffKST();

  const [{ data: klass }, coIds, { data: assignments }] = await Promise.all([
    db
      .from("classes")
      .select("id, name, teacher_id")
      .eq("id", classId)
      .maybeSingle(),
    coTaughtClassIds(effectiveId),
    db
      .from("assignments")
      .select(
        "id, title, passage_text, sample_audio_url, sample_audio_slow_url, sample_voice, due_date, created_at, submissions(overall_score, status)"
      )
      .eq("class_id", classId)
      .lte("due_date", cutoff)
      .order("due_date", { ascending: false }),
  ]);

  // 반 화면과 같은 접근 권한 (담임 또는 공동 관리 기간의 선생님)
  const isCoTeacher = klass ? klass.teacher_id !== effectiveId : false;
  if (!klass || (isCoTeacher && !coIds.includes(classId))) notFound();

  const today = todayKST();
  const rows = (assignments ?? []) as unknown as AssignmentRow[];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link
        href={`/teacher/classes/${classId}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← {klass.name}
      </Link>

      <header className="mt-3">
        <h1 className="text-xl font-bold sm:text-2xl">
          🗂️ 마감 과제 보관함 ({rows.length})
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          마감 후 {ARCHIVE_AFTER_DAYS}일이 지난 과제예요. 제출 내역·점수·피드백은
          그대로 남아 있고, 마감일을 미래로 바꾸면 다시 반 화면으로 돌아갑니다.
        </p>
      </header>

      <ul className="mt-6 space-y-2">
        {rows.length === 0 && (
          <li className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            보관된 과제가 아직 없어요
          </li>
        )}
        {rows.map((a) => (
          <AssignmentCard key={a.id} a={a} classId={classId} today={today} />
        ))}
      </ul>
    </main>
  );
}
