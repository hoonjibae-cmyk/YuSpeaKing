import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/student-session";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// 학생 녹음 제출: 오디오 업로드 + submission 레코드 생성
// (M3에서 이 뒤에 AI 평가 트리거를 연결)
export async function POST(req: Request) {
  const session = await getStudentSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }

  const form = await req.formData();
  const assignmentId = String(form.get("assignmentId") || "");
  const audio = form.get("audio");

  if (!assignmentId || !(audio instanceof Blob)) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 과제가 이 학생의 반 것인지 확인
  const { data: assignment } = await admin
    .from("assignments")
    .select("id, class_id")
    .eq("id", assignmentId)
    .single();
  if (!assignment || assignment.class_id !== session.classId) {
    return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });
  }

  // 오디오 업로드 (submissions 버킷, 비공개)
  const ext = audio.type.includes("wav") ? "wav" : "webm";
  const path = `${assignmentId}/${session.studentId}.${ext}`;
  const buffer = Buffer.from(await audio.arrayBuffer());

  const { error: upErr } = await admin.storage
    .from("submissions")
    .upload(path, buffer, {
      contentType: audio.type || "audio/webm",
      upsert: true,
    });
  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  // submission 레코드 upsert (재제출 시 덮어쓰기)
  const { data: submission, error: subErr } = await admin
    .from("submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: session.studentId,
        audio_path: path,
        status: "submitted",
        azure_scores: null,
        overall_score: null,
        student_feedback: null,
        teacher_feedback: null,
        teacher_reviewed: false,
        error_message: null,
      },
      { onConflict: "assignment_id,student_id" }
    )
    .select("id")
    .single();

  if (subErr || !submission) {
    return NextResponse.json(
      { error: subErr?.message || "제출 저장 실패" },
      { status: 500 }
    );
  }

  // TODO(M3): 여기서 AI 평가 파이프라인 트리거 → status 'evaluating' → 'evaluated'

  return NextResponse.json({ ok: true, submissionId: submission.id });
}
