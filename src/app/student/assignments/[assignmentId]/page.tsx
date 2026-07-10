import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";
import Recorder from "./Recorder";

export default async function StudentAssignmentPage({
  params,
}: {
  params: { assignmentId: string };
}) {
  const session = await requireStudent();
  const admin = createAdminClient();

  const { data: assignment } = await admin
    .from("assignments")
    .select("id, class_id, title, passage_text, sample_audio_url")
    .eq("id", params.assignmentId)
    .single();

  if (!assignment) notFound();
  if (assignment.class_id !== session.classId) redirect("/student/home");

  const { data: submission } = await admin
    .from("submissions")
    .select("status, overall_score, student_feedback")
    .eq("assignment_id", assignment.id)
    .eq("student_id", session.studentId)
    .maybeSingle();

  const alreadySubmitted =
    !!submission &&
    ["submitted", "evaluating", "evaluated"].includes(submission.status);

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <Link href="/student/home" className="text-sm text-slate-500 hover:underline">
        ← 과제 목록
      </Link>
      <h1 className="mt-3 text-xl font-bold">{assignment.title}</h1>

      {/* 1. 원어민 샘플 듣기 */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-500">
          1. 원어민 발음 듣기 🎧
        </h2>
        {assignment.sample_audio_url ? (
          <audio
            src={assignment.sample_audio_url}
            controls
            className="mt-2 w-full"
          />
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
        <h2 className="text-sm font-semibold text-slate-500">
          3. 직접 읽으며 녹음하기 🎙️
        </h2>
        <div className="mt-2">
          <Recorder
            assignmentId={assignment.id}
            alreadySubmitted={alreadySubmitted}
          />
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
        </section>
      )}
    </main>
  );
}
