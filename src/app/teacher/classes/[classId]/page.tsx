import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  addStudent,
  deleteStudent,
  createAssignment,
  regenerateSample,
  deleteAssignment,
} from "../../actions";
import SubmitButton from "@/components/SubmitButton";

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { error?: string };
}) {
  await requireTeacher();
  const supabase = createClient();
  const { classId } = params;

  const { data: klass } = await supabase
    .from("classes")
    .select("id, name, class_code")
    .eq("id", classId)
    .single();
  if (!klass) notFound();

  const [{ data: students }, { data: assignments }] = await Promise.all([
    supabase
      .from("students")
      .select("id, name, number")
      .eq("class_id", classId)
      .order("number"),
    supabase
      .from("assignments")
      .select(
        "id, title, sample_audio_url, due_date, created_at, submissions(overall_score, status)"
      )
      .eq("class_id", classId)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>

      <header className="mt-3 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{klass.name}</h1>
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
                <form action={deleteStudent}>
                  <input type="hidden" name="classId" value={classId} />
                  <input type="hidden" name="studentId" value={s.id} />
                  <button className="text-xs text-slate-400 hover:text-red-500">
                    삭제
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>

        {/* 과제(지문) */}
        <section>
          <h2 className="font-semibold">과제 ({assignments?.length ?? 0})</h2>
          <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-sm font-medium text-brand">
              + 새 지문 등록
            </summary>
            <form action={createAssignment} className="mt-3 space-y-2">
              <input type="hidden" name="classId" value={classId} />
              <input
                name="title"
                placeholder="과제 제목 (예: Unit 3 - My Day)"
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
              <textarea
                name="passage_text"
                placeholder="영어 지문을 입력하세요. 저장 시 원어민 샘플 음성이 자동 생성됩니다."
                required
                rows={5}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
              <div className="flex flex-wrap gap-4">
                <label className="block text-sm text-slate-500">
                  마감일 (선택)
                  <input
                    name="due_date"
                    type="date"
                    className="ml-2 rounded-lg border border-slate-300 px-2 py-1 focus:border-brand focus:outline-none"
                  />
                </label>
                <label className="block text-sm text-slate-500">
                  재제출 허용 횟수
                  <input
                    name="max_attempts"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={3}
                    className="ml-2 w-16 rounded-lg border border-slate-300 px-2 py-1 focus:border-brand focus:outline-none"
                  />
                </label>
              </div>
              <SubmitButton
                pendingText="샘플음성 만드는 중… (몇 초 걸려요)"
                className="w-full rounded-lg bg-brand py-2 font-medium text-white hover:bg-brand-dark"
              >
                등록 (샘플음성 생성)
              </SubmitButton>
            </form>
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
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
