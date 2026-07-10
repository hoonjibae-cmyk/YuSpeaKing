import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AzureScores, SubmissionStatus } from "@/lib/types";
import {
  updateSubmissionReview,
  reevaluateSubmission,
  resetAttempts,
} from "../../actions";
import SubmitButton from "@/components/SubmitButton";

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  submitted: "제출됨",
  evaluating: "평가중",
  evaluated: "평가완료",
  error: "오류",
};

export default async function AssignmentDashboard({
  params,
}: {
  params: { assignmentId: string };
}) {
  await requireTeacher();
  const supabase = createClient();
  const { assignmentId } = params;

  // RLS: 본인 반 과제만
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, class_id, title, passage_text, max_attempts")
    .eq("id", assignmentId)
    .single();
  if (!assignment) notFound();

  const [{ data: students }, { data: submissions }] = await Promise.all([
    supabase
      .from("students")
      .select("id, name, number")
      .eq("class_id", assignment.class_id)
      .order("number"),
    supabase
      .from("submissions")
      .select(
        "id, student_id, status, overall_score, azure_scores, teacher_feedback, student_feedback, teacher_reviewed, audio_path, error_message, attempt_count"
      )
      .eq("assignment_id", assignmentId),
  ]);

  const subByStudent = new Map((submissions ?? []).map((s) => [s.student_id, s]));

  // 비공개 오디오 서명 URL 생성 (admin)
  const admin = createAdminClient();
  const signedUrls = new Map<string, string>();
  await Promise.all(
    (submissions ?? [])
      .filter((s) => s.audio_path)
      .map(async (s) => {
        const { data } = await admin.storage
          .from("submissions")
          .createSignedUrl(s.audio_path, 60 * 60);
        if (data?.signedUrl) signedUrls.set(s.id, data.signedUrl);
      })
  );

  const submittedCount = submissions?.length ?? 0;
  const total = students?.length ?? 0;

  // 통계 집계
  const scores = (submissions ?? [])
    .filter((s) => s.status === "evaluated" && s.overall_score != null)
    .map((s) => Number(s.overall_score));
  const avgScore = scores.length
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : null;
  const maxScore = scores.length ? Math.round(Math.max(...scores)) : null;
  const minScore = scores.length ? Math.round(Math.min(...scores)) : null;
  const submissionRate = total ? Math.round((submittedCount / total) * 100) : 0;
  const nonSubmitters = (students ?? []).filter(
    (s) => !subByStudent.has(s.id)
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link
        href={`/teacher/classes/${assignment.class_id}`}
        className="text-sm text-slate-500 hover:underline"
      >
        ← 반으로
      </Link>
      <h1 className="mt-3 text-2xl font-bold">{assignment.title}</h1>

      {/* 통계 요약 */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="제출률" value={`${submissionRate}%`} sub={`${submittedCount}/${total}명`} />
        <StatCard label="평균 점수" value={avgScore != null ? `${avgScore}점` : "-"} />
        <StatCard label="최고" value={maxScore != null ? `${maxScore}점` : "-"} />
        <StatCard label="최저" value={minScore != null ? `${minScore}점` : "-"} />
      </div>
      {total > 0 && nonSubmitters.length === 0 ? (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          ✅ 전원 제출 완료! ({total}명 모두)
        </p>
      ) : nonSubmitters.length > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          미제출 {nonSubmitters.length}명:{" "}
          {nonSubmitters.map((s) => `${s.number} ${s.name}`).join(", ")}
        </p>
      ) : null}

      <div className="mt-6 space-y-3">
        {students?.map((student) => {
          const sub = subByStudent.get(student.id);
          const scores = sub?.azure_scores as AzureScores | null;
          return (
            <div
              key={student.id}
              className="rounded-2xl border border-slate-200 bg-white"
            >
              <div className="flex items-center justify-between px-5 py-3">
                <div className="font-medium">
                  <span className="inline-block w-8 text-slate-400">
                    {student.number}
                  </span>
                  {student.name}
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {sub ? (
                    <>
                      <span
                        className={
                          sub.status === "evaluated"
                            ? "text-green-600"
                            : sub.status === "error"
                            ? "text-red-500"
                            : "text-slate-500"
                        }
                      >
                        {STATUS_LABEL[sub.status as SubmissionStatus]}
                      </span>
                      {sub.overall_score != null && (
                        <span className="font-bold text-brand">
                          {Math.round(sub.overall_score)}점
                        </span>
                      )}
                      {sub.teacher_reviewed && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">
                          검토완료
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-slate-300">미제출</span>
                  )}
                </div>
              </div>

              {sub && (
                <details className="border-t border-slate-100 px-5 py-4">
                  <summary className="cursor-pointer text-sm font-medium text-brand">
                    상세 리포트 열기
                  </summary>

                  <div className="mt-4 space-y-4">
                    {/* 오디오 */}
                    {signedUrls.get(sub.id) && (
                      <audio
                        src={signedUrls.get(sub.id)}
                        controls
                        className="w-full"
                      />
                    )}

                    {/* 오류 */}
                    {sub.status === "error" && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                        평가 오류: {sub.error_message}
                      </p>
                    )}

                    {/* Azure 세부 점수 */}
                    {scores && (
                      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                        <ScoreCell label="종합" value={scores.pronunciation} />
                        <ScoreCell label="정확도" value={scores.accuracy} />
                        <ScoreCell label="유창성" value={scores.fluency} />
                        <ScoreCell label="완성도" value={scores.completeness} />
                        <ScoreCell label="억양" value={scores.prosody} />
                      </div>
                    )}

                    {/* 취약 단어 */}
                    {scores?.words && scores.words.some((w) => w.errorType && w.errorType !== "None") && (
                      <div className="text-sm">
                        <span className="text-slate-500">취약 단어: </span>
                        {scores.words
                          .filter((w) => w.errorType && w.errorType !== "None")
                          .map((w, i) => (
                            <span
                              key={i}
                              className="mr-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-amber-700"
                            >
                              {w.word}
                            </span>
                          ))}
                      </div>
                    )}

                    {/* 학생에게 보인 간단 피드백 (참고) */}
                    {sub.student_feedback && (
                      <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
                        <div className="text-xs font-medium text-slate-400">
                          학생에게 표시된 간단 피드백
                        </div>
                        <p className="mt-1 whitespace-pre-wrap">
                          {sub.student_feedback}
                        </p>
                      </div>
                    )}

                    {/* 교사용 상세 리포트 (수정 가능) */}
                    <form action={updateSubmissionReview} className="space-y-2">
                      <input type="hidden" name="assignmentId" value={assignmentId} />
                      <input type="hidden" name="submissionId" value={sub.id} />
                      <label className="text-xs font-medium text-slate-500">
                        교사용 상세 리포트 (학부모 안내용 — 수정 가능)
                      </label>
                      <textarea
                        name="teacher_feedback"
                        defaultValue={sub.teacher_feedback ?? ""}
                        rows={8}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            name="teacher_reviewed"
                            defaultChecked={sub.teacher_reviewed}
                          />
                          검토완료로 표시
                        </label>
                        <SubmitButton
                          pendingText="저장 중…"
                          className="rounded-lg bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark"
                        >
                          저장
                        </SubmitButton>
                      </div>
                    </form>

                    {/* 시도 횟수 & 액션 */}
                    <div className="flex flex-wrap items-center gap-4 pt-1">
                      <span className="text-xs text-slate-400">
                        제출 {sub.attempt_count ?? 0}/{assignment.max_attempts}회
                      </span>
                      <form action={reevaluateSubmission}>
                        <input type="hidden" name="assignmentId" value={assignmentId} />
                        <input type="hidden" name="submissionId" value={sub.id} />
                        <SubmitButton
                          pendingText="재평가 중… (십여 초)"
                          className="text-xs text-slate-400 hover:text-brand hover:underline"
                        >
                          AI 재평가 실행
                        </SubmitButton>
                      </form>
                      {(sub.attempt_count ?? 0) >= assignment.max_attempts && (
                        <form action={resetAttempts}>
                          <input type="hidden" name="assignmentId" value={assignmentId} />
                          <input type="hidden" name="submissionId" value={sub.id} />
                          <SubmitButton
                            pendingText="처리 중…"
                            className="text-xs text-brand hover:underline"
                          >
                            재제출 기회 주기
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-bold text-brand">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function ScoreCell({ label, value }: { label: string; value?: number | null }) {
  return (
    <div className="rounded-lg bg-slate-50 p-2 text-center">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-bold text-slate-700">
        {value == null ? "-" : Math.round(value)}
      </div>
    </div>
  );
}
