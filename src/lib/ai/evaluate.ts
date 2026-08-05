import "server-only";
import { createAdminClient } from "../supabase/admin";
import { assessPronunciation } from "./pronunciation";
import { assessPronunciationOpenAI } from "./pronunciation-openai";
import type { AzureScores } from "../types";
import { generateFeedback } from "./feedback";

// 평가 엔진 선택: Azure 키가 있으면 정밀 발음평가, 없으면 OpenAI(Whisper) 대체.
function assessSpeech(wav: Buffer, referenceText: string): Promise<AzureScores> {
  const hasAzure =
    !!process.env.AZURE_SPEECH_KEY && !!process.env.AZURE_SPEECH_REGION;
  return hasAzure
    ? assessPronunciation(wav, referenceText)
    : assessPronunciationOpenAI(wav, referenceText);
}

// 제출된 녹음 1건을 평가: Azure 발음평가 → Claude 2단 피드백 → DB 업데이트.
// 실패해도 예외를 던지지 않고 submission.status='error' 로 기록한다.
export async function evaluateSubmission(submissionId: string): Promise<void> {
  const admin = createAdminClient();

  const { data: submission } = await admin
    .from("submissions")
    .select("id, audio_path, assignment_id, student_id")
    .eq("id", submissionId)
    .single();
  if (!submission) return;

  const { data: assignment } = await admin
    .from("assignments")
    .select("passage_text")
    .eq("id", submission.assignment_id)
    .single();
  if (!assignment) return;

  await admin
    .from("submissions")
    .update({ status: "evaluating", error_message: null })
    .eq("id", submissionId);

  try {
    // 1) 오디오 다운로드 (WAV)
    const { data: file, error: dlErr } = await admin.storage
      .from("submissions")
      .download(submission.audio_path);
    if (dlErr || !file) throw new Error(dlErr?.message || "오디오 다운로드 실패");
    const wav = Buffer.from(await file.arrayBuffer());

    // 2) 발음평가 (Azure 우선, 없으면 OpenAI Whisper 대체)
    const scores = await assessSpeech(wav, assignment.passage_text);

    // 3) 점수를 먼저 확정 저장한다.
    //    긴 녹음은 피드백 생성까지 가기 전에 함수 실행시간이 끝날 수 있는데,
    //    그때 'evaluating' 으로 영영 멈추지 않도록 여기서 먼저 완료 처리한다.
    await admin
      .from("submissions")
      .update({
        status: "evaluated",
        azure_scores: scores,
        overall_score: scores.pronunciation,
        // 쿠폰 집계를 가볍게 하려고 완성도는 칼럼으로도 저장한다
        completeness: scores.completeness,
        student_feedback:
          "채점이 끝났어요! 자세한 피드백을 정리하는 중이에요 🙂",
        error_message: null,
      })
      .eq("id", submissionId);

    // 4) Claude 2단 피드백 (등록일·누적 제출 횟수를 함께 전달해
    //    신입생에게 과거 이력을 전제한 코멘트가 나가지 않도록 한다)
    //    여기서 실패해도 점수는 이미 저장되어 있다.
    try {
      const [{ data: student }, { count: subCount }] = await Promise.all([
        admin
          .from("students")
          .select("approved_at")
          .eq("id", submission.student_id)
          .maybeSingle(),
        admin
          .from("submissions")
          .select("id", { count: "exact", head: true })
          .eq("student_id", submission.student_id),
      ]);
      const feedback = await generateFeedback(scores, assignment.passage_text, {
        approvedAt: (student?.approved_at as string | null) ?? null,
        submissionCount: subCount ?? undefined,
      });
      await admin
        .from("submissions")
        .update({
          student_feedback: feedback.studentFeedback,
          teacher_feedback: feedback.teacherFeedback,
        })
        .eq("id", submissionId);
    } catch (e) {
      console.error("[평가] 피드백 생성 실패(점수는 저장됨):", e);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "평가 중 오류";
    await admin
      .from("submissions")
      .update({ status: "error", error_message: message })
      .eq("id", submissionId);
  }
}
