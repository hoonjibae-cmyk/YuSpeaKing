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
    .select("id, audio_path, assignment_id")
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

    // 3) Claude 2단 피드백
    const feedback = await generateFeedback(scores, assignment.passage_text);

    // 4) 저장
    await admin
      .from("submissions")
      .update({
        status: "evaluated",
        azure_scores: scores,
        overall_score: scores.pronunciation,
        student_feedback: feedback.studentFeedback,
        teacher_feedback: feedback.teacherFeedback,
        error_message: null,
      })
      .eq("id", submissionId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "평가 중 오류";
    await admin
      .from("submissions")
      .update({ status: "error", error_message: message })
      .eq("id", submissionId);
  }
}
