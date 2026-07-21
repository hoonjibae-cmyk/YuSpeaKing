import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AzureScores } from "@/lib/types";
import WordHighlights from "@/components/WordHighlights";
import Recorder from "./Recorder";
import { todayKST } from "@/lib/date";

export default async function StudentAssignmentPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  const session = await requireStudent();
  const admin = createAdminClient();

  // 과제·제출 조회는 서로 독립적이라 병렬 처리 (id는 params 로 이미 확정)
  const [assignmentRes, submissionRes] = await Promise.all([
    admin
      .from("assignments")
      .select(
        "id, class_id, title, passage_text, sample_audio_url, sample_audio_slow_url, max_attempts, due_date"
      )
      .eq("id", params.assignmentId)
      .single(),
    admin
      .from("submissions")
      .select(
        "status, overall_score, student_feedback, attempt_count, azure_scores"
      )
      .eq("assignment_id", params.assignmentId)
      .eq("student_id", session.studentId)
      .maybeSingle(),
  ]);

  const assignment = assignmentRes.data;
  const submission = submissionRes.data;

  if (!assignment) notFound();
  if (assignment.class_id !== session.classId) redirect("/student/home");

  const alreadySubmitted =
    !!submission &&
    ["submitted", "evaluating", "evaluated"].includes(submission.status);

  const usedAttempts = submission?.attempt_count ?? 0;
  const remainingAttempts = Math.max(0, assignment.max_attempts - usedAttempts);
  // 마감이 지난 과제는 제출 잠금(음성 청취는 가능)
  const isPast = !!assignment.due_date && assignment.due_date < todayKST();

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <Link href="/student/home" className="text-sm text-slate-500 hover:underline">
        ← 과제 목록
      </Link>
      <h1 className="mt-3 text-xl font-bold">{assignment.title}</h1>

      {/* 1. 원어민 샘플 듣기 (천천히 / 원어민 속도) */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-500">
          1. 원어민 발음 듣기 🎧
        </h2>
        {assignment.sample_audio_url ? (
          <div className="mt-2 space-y-3">
            {assignment.sample_audio_slow_url && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="mb-1 text-xs font-medium text-brand">
                  🐢 또박또박 듣기 (단어 하나하나 발음에 집중해요)
                </div>
                <audio
                  src={assignment.sample_audio_slow_url}
                  controls
                  className="w-full"
                />
              </div>
            )}
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-1 text-xs font-medium text-slate-500">
                🎧 원어민 속도 (익숙해지면 이걸로!)
              </div>
              <audio
                src={assignment.sample_audio_url}
                controls
                className="w-full"
              />
            </div>
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            샘플 음성을 준비 중이에요.
          </p>
        )}
      </section>

      {/* 2. 지문 */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-500">2. 지문 읽기 📖</h2>
        <div className="mt-2 whitespace-pre-wrap rounded-2xl border border-slate-200 bg-white p-5 text-lg leading-relaxed">
          {assignment.passage_text}
        </div>
      </section>

      {/* 3. 녹음 & 제출 */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-500">
            3. 직접 읽으며 녹음하기 🎙️
          </h2>
          {!isPast && (
            <span
              className={`text-xs font-medium ${
                remainingAttempts <= 0 ? "text-red-500" : "text-slate-500"
              }`}
            >
              남은 제출 {remainingAttempts}/{assignment.max_attempts}회
            </span>
          )}
        </div>
        <div className="mt-2">
          {isPast ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
              <div className="text-2xl">🔒</div>
              <p className="mt-2 text-sm font-medium text-slate-600">
                마감된 과제예요. 지금은 새로 제출할 수 없어요.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                지문과 원어민 음성은 계속 듣고 연습할 수 있어요.
              </p>
            </div>
          ) : (
            <Recorder
              assignmentId={assignment.id}
              alreadySubmitted={alreadySubmitted}
              remainingAttempts={remainingAttempts}
            />
          )}
        </div>
      </section>

      {/* 평가 결과 (M3에서 채워짐) */}
      {submission?.status === "evaluated" && submission.student_feedback && (
        <section className="mt-6 rounded-2xl border border-brand/30 bg-brand-light p-5">
          <h2 className="font-semibold text-brand">AI 발음 피드백 ✨</h2>
          {submission.overall_score != null && (
            <div className="mt-2 text-3xl font-bold text-brand">
              {Math.round(submission.overall_score)}점
            </div>
          )}
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
            {submission.student_feedback}
          </p>
          {(submission.azure_scores as AzureScores | null)?.words && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-brand">
                내가 읽은 단어 (색으로 확인해요)
              </div>
              <WordHighlights
                words={(submission.azure_scores as AzureScores).words}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
