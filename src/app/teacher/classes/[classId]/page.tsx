import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { getTeacherContext } from "@/lib/teacher-context";
import {
  addStudent,
  bulkAddStudents,
  deleteStudent,
  approveStudent,
  rejectStudent,
  resetStudentPassword,
  regenerateSample,
  deleteAssignment,
  updateAssignment,
} from "../../actions";
import SubmitButton from "@/components/SubmitButton";
import CopyButton from "@/components/CopyButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";
import PassageComposer from "./PassageComposer";

export default async function ClassDetailPage({
  params,
  searchParams,
}: {
  params: { classId: string };
  searchParams: { error?: string; pwreset?: string };
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
      .select("id, name, number, school, grade, username, status, created_at")
      .eq("class_id", classId)
      .order("created_at", { ascending: true }),
    db
      .from("assignments")
      .select(
        "id, title, passage_text, sample_audio_url, sample_audio_slow_url, due_date, max_attempts, created_at, submissions(overall_score, status)"
      )
      .eq("class_id", classId)
      .order("created_at", { ascending: false }),
  ]);

  type Row = {
    id: string;
    name: string;
    number: number | null;
    school: string | null;
    grade: string | null;
    username: string | null;
    status: string | null;
  };
  const roster = (students ?? []) as Row[];
  const pending = roster.filter((s) => s.status === "pending");
  const approved = roster
    .filter((s) => s.status !== "pending" && s.status !== "rejected")
    .sort((a, b) => (a.number ?? 9999) - (b.number ?? 9999));

  // 이 선생님의 학생 가입 코드 + 반 목록(승인 시 반 변경용)
  const [{ data: meRow }, { data: myClassesRaw }] = await Promise.all([
    db.from("teachers").select("signup_code").eq("id", effectiveId).single(),
    db.from("classes").select("id, name").eq("teacher_id", effectiveId).order("name"),
  ]);
  const signupCode = (meRow as { signup_code?: string } | null)?.signup_code;
  const myClasses = (myClassesRaw ?? []) as { id: string; name: string }[];

  const host = headers().get("host");
  const base = host ? `https://${host}` : "";
  const signupUrl = signupCode
    ? `${base}/student/signup?t=${signupCode}`
    : `${base}/student/signup`;

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

      {searchParams.pwreset &&
        (() => {
          const [uname, temp] = decodeURIComponent(searchParams.pwreset!).split(
            "|"
          );
          return (
            <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              🔑 비밀번호가 재설정됐어요 — 아이디 <b>{uname}</b> · 임시 비밀번호{" "}
              <b className="font-mono">{temp}</b> (학생에게 전달하고, 로그인 후
              바꾸도록 안내해 주세요)
            </p>
          );
        })()}

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        {/* 학생 명단 */}
        <section>
          <h2 className="font-semibold">학생 명단 ({approved.length})</h2>

          {/* 가입 신청 링크 */}
          <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="text-xs font-medium text-slate-500">
              학생 가입 신청 링크 (학생들에게 공유)
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                id="signup-url"
                readOnly
                value={signupUrl}
                className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600"
              />
              <CopyButton
                targetId="signup-url"
                className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
              />
            </div>
          </div>

          {/* 승인 대기 (정보 수정 후 승인 가능) */}
          {pending.length > 0 && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="text-sm font-semibold text-amber-700">
                가입 신청 대기 {pending.length}건
              </div>
              <p className="mt-0.5 text-[11px] text-amber-600">
                학생이 잘못 적은 정보가 있으면 고친 뒤 승인하세요.
              </p>
              <ul className="mt-2 space-y-2">
                {pending.map((s) => (
                  <li key={s.id} className="rounded-lg bg-white p-3">
                    <div className="text-xs text-slate-400">
                      아이디 <span className="font-mono">{s.username}</span>
                    </div>
                    <form action={approveStudent} className="mt-2 space-y-2">
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="studentId" value={s.id} />
                      <div className="flex gap-2">
                        <input
                          name="name"
                          defaultValue={s.name}
                          placeholder="이름"
                          className="w-24 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                        />
                        <input
                          name="school"
                          defaultValue={s.school ?? ""}
                          placeholder="학교"
                          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                        />
                        <input
                          name="grade"
                          defaultValue={s.grade ?? ""}
                          placeholder="학년"
                          className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          name="targetClassId"
                          defaultValue={classId}
                          className="flex-1 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
                        >
                          {myClasses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <SubmitButton
                          pendingText="승인 중…"
                          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-dark"
                        >
                          승인
                        </SubmitButton>
                      </div>
                    </form>
                    <form action={rejectStudent} className="mt-1 text-right">
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="studentId" value={s.id} />
                      <button className="text-xs text-slate-400 hover:text-red-500">
                        거절
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 승인된 학생 목록 */}
          <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {approved.length === 0 && (
              <li className="p-4 text-center text-sm text-slate-400">
                아직 승인된 학생이 없어요
              </li>
            )}
            {approved.map((s) => (
              <li key={s.id} className="flex items-center justify-between px-4 py-2.5">
                <span className="min-w-0">
                  <span className="inline-block w-8 text-slate-400">
                    {s.number ?? "-"}
                  </span>
                  {s.name}
                  {s.username && (
                    <span className="ml-2 text-xs text-slate-400">
                      @{s.username}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {s.username && (
                    <form action={resetStudentPassword}>
                      <input type="hidden" name="classId" value={classId} />
                      <input type="hidden" name="studentId" value={s.id} />
                      <button className="text-xs text-slate-400 hover:text-brand">
                        비번 재설정
                      </button>
                    </form>
                  )}
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

          {/* 선생님이 직접 명단만 추가 (로그인 계정 없이) */}
          <details className="mt-2 rounded-xl border border-slate-200 bg-white p-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-500">
              선생님이 직접 명단 추가 (로그인 계정 없이 번호·이름만)
            </summary>
            <form action={addStudent} className="mt-3 flex gap-2">
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
            <form action={bulkAddStudents} className="mt-2 space-y-2">
              <input type="hidden" name="classId" value={classId} />
              <textarea
                name="roster"
                rows={4}
                placeholder={"엑셀에서 번호·이름 두 열을 복사해 붙여넣거나, 한 줄에 하나씩:\n1, 민수\n2, 지영"}
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
                  {/* 샘플음성 미리듣기 */}
                  {a.sample_audio_url && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="w-24 shrink-0 text-xs text-slate-500">
                          🎧 원어민 속도
                        </span>
                        <audio
                          src={a.sample_audio_url as string}
                          controls
                          preload="none"
                          className="h-8 w-full"
                        />
                      </div>
                      {a.sample_audio_slow_url && (
                        <div className="flex items-center gap-2">
                          <span className="w-24 shrink-0 text-xs text-slate-500">
                            🐢 천천히
                          </span>
                          <audio
                            src={a.sample_audio_slow_url as string}
                            controls
                            preload="none"
                            className="h-8 w-full"
                          />
                        </div>
                      )}
                    </div>
                  )}

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
                      <p className="text-[11px] text-amber-600">
                        💡 재제출은 특별한 사유가 없으면 2회를 넘기지 않길 권장해요.
                      </p>
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
