import Link from "next/link";
import { notFound } from "next/navigation";
import { getTeacherContext } from "@/lib/teacher-context";
import {
  addStudent,
  bulkAddStudents,
  deleteStudent,
  resetStudentPin,
  regenerateSample,
  deleteAssignment,
  updateAssignment,
} from "../../actions";
import SubmitButton from "@/components/SubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PassageComposer from "./PassageComposer";

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { error?: string };
}) {
  const { db, effectiveId, isImpersonating, actingName } =
    await getTeacherContext();
  const { classId } = params;

  const { data: klass } = await db
    .from("classes")
    .select("id, name, class_code")
    .eq("id", classId)
    .eq("teacher_id", effectiveId)
    .single();
  if (!klass) notFound();

  const [{ data: students }, { data: assignments }] = await Promise.all([
    db
      .from("students")
      .select("id, name, number")
      .eq("class_id", classId)
      .order("number"),
    db
      .from("assignments")
      .select(
        "id, title, passage_text, sample_audio_url, due_date, max_attempts, created_at, submissions(overall_score, status)"
      )
      .eq("class_id", classId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{klass.name}</h1>
          <Link
            href={`/teacher/classes/${classId}/monthly`}
            className="rounded-lg border border-brand bg-brand-light px-3 py-1.5 text-sm font-medium text-brand hover:bg-blue-100"
          >
            📄 월말 리포트
          </Link>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-400">반 코드 (학생 로그인용)</div>
          <div className="font-mono text-xl font-bold tracking-wider text-brand">
            {klass.class_code}
          </div>
        </div>
      </header>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {/* 학생 명단 */}
        <section>
          <h2 className="font-semibold">학생 명단 ({students?.length ?? 0})</h2>
          <form
            action={addStudent}
            className="mt-3 flex gap-2 rounded-xl border border-slate-200 bg-white p-3"
          >
            <input type="hidden" name="classId" value={classId} />
            <input
              name="number"
              type="number"
              placeholder="번호"
              required
              className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand focus:outline-none"
            />
            <input
              name="name"
              placeholder="이름"
              required
              className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 focus:border-brand focus:outline-none"
            />
            <SubmitButton
              pendingText="추가 중…"
              className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
            >
              추가
            </SubmitButton>
          </form>

          {/* 여러 명 한 번에 (엑셀/CSV) */}
          <details className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">
              📋 여러 명 한 번에 등록 (엑셀 붙여넣기)
            </summary>
            <form action={bulkAddStudents} className="mt-3 space-y-2">
              <input type="hidden" name="classId" value={classId} />
              <textarea
                name="roster"
                rows={6}
                placeholder={"엑셀에서 번호·이름 두 열을 복사해 붙여넣거나, 한 줄에 하나씩:\n1, 민수\n2, 지영\n3, 하준"}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">
                  이미 있는 번호는 이름이 갱신돼요.
                </span>
                <SubmitButton
                  pendingText="등록 중…"
                  className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                >
                  일괄 등록
                </SubmitButton>
              </div>
            </form>
          </details>

          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {(!students || students.length === 0) && (
              <li className="p-4 text-center text-sm text-slate-400">
                학생을 추가하세요
              </li>
            )}
            {students?.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <span>
                  <span className="inline-block w-8 text-slate-400">{s.number}</span>
                  {s.name}
                </span>
                <span className="flex items-center gap-3">
                  <form action={resetStudentPin}>
                    <input type="hidden" name="classId" value={classId} />
                    <input type="hidden" name="studentId" value={s.id} />
                    <button className="text-xs text-slate-400 hover:text-brand">
                      PIN 초기화
                    </button>
                  </form>
                  <form action={deleteStudent}>
                    <input type="hidden" name="classId" value={classId} />
                    <input type="hidden" name="studentId" value={s.id} />
                    <button className="text-xs text-slate-400 hover:text-red-500">
                      삭제
                    </button>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* 과제(지문) */}
        <section>
          <h2 className="font-semibold">과제 ({assignments?.length ?? 0})</h2>
          <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">
              + 새 지문 등록 (타이핑 / PDF · AI 문장 선별)
            </summary>
            <div className="mt-3">
              <PassageComposer classId={classId} />
            </div>
          </details>

          <ul className="mt-3 space-y-2">
            {(!assignments || assignments.length === 0) && (
              <li className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
                등록된 과제가 없어요
              </li>
            )}
            {assignments?.map((a) => {
              const subs =
                (a.submissions as { overall_score: number | null; status: string }[]) ??
                [];
              const subCount = subs.length;
              const evaluated = subs.filter(
                (s) => s.status === "evaluated" && s.overall_score != null
              );
              const avg = evaluated.length
                ? Math.round(
                    evaluated.reduce((t, s) => t + Number(s.overall_score), 0) /
                      evaluated.length
                  )
                : null;
              return (
                <li
                  key={a.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between">
                    <Link
                      href={`/teacher/assignments/${a.id}`}
                      className="font-medium hover:text-brand hover:underline"
                    >
                      {a.title}
                    </Link>
                    <span className="text-xs text-slate-400">
                      제출 {subCount}
                      {avg != null && ` · 평균 ${avg}점`}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    {a.sample_audio_url ? (
                      <span className="text-green-600">✓ 샘플음성 준비됨</span>
                    ) : (
                      <span className="text-amber-600">⚠ 샘플음성 없음</span>
                    )}
                    <form action={regenerateSample}>
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <SubmitButton
                        pendingText="생성 중…"
                        className="text-slate-400 hover:text-brand hover:underline"
                      >
                        샘플음성 재생성
                      </SubmitButton>
                    </form>
                    <form action={deleteAssignment} className="ml-auto">
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <SubmitButton
                        pendingText="삭제 중…"
                        className="text-slate-400 hover:text-red-500 hover:underline"
                      >
                        삭제
                      </SubmitButton>
                    </form>
                  </div>

                  {/* 과제 수정 */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-slate-400 hover:text-brand">
                      수정
                    </summary>
                    <form action={updateAssignment} className="mt-2 space-y-2">
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="assignmentId" value={a.id} />
                      <input
                        name="title"
                        defaultValue={a.title}
                        required
                        className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none"
                      />
                      <textarea
                        name="passage_text"
                        defaultValue={a.passage_text as string}
                        required
                        rows={4}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                        <label>
                          마감일
                          <input
                            name="due_date"
                            type="date"
                            defaultValue={(a.due_date as string) ?? ""}
                            className="ml-1 rounded border border-slate-300 px-2 py-1"
                          />
                        </label>
                        <label>
                          재제출
                          <input
                            name="max_attempts"
                            type="number"
                            min={1}
                            max={10}
                            defaultValue={a.max_attempts as number}
                            className="ml-1 w-14 rounded border border-slate-300 px-2 py-1"
                          />
                        </label>
                        <SubmitButton
                          pendingText="저장 중…"
                          className="ml-auto rounded-lg bg-brand px-3 py-1.5 font-medium text-white hover:bg-brand-dark"
                        >
                          저장
                        </SubmitButton>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        지문을 바꾸면 샘플음성이 자동으로 다시 생성돼요.
                      </p>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
