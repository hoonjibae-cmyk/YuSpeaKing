import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/student-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateSubmission } from "@/lib/ai/evaluate";

export const runtime = "nodejs";
export const maxDuration = 60; // Azure 연속 인식 + Claude 호출 시간 확보

// 제출된 녹음 채점: 학생이 제출 직후 이 라우트를 호출한다.
// 제출 저장과 분리되어 있어, 채점이 오래 걸리거나 실패해도 제출 자체는 유효하다.
export async function POST(req: Request) {
  const session = await getStudentSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }

  const { submissionId } = (await req.json().catch(() => ({}))) as {
    submissionId?: string;
  };
  if (!submissionId) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  // 본인 제출물인지 확인
  const admin = createAdminClient();
  const { data: submission } = await admin
    .from("submissions")
    .select("id, student_id")
    .eq("id", submissionId)
    .single();
  if (!submission || submission.student_id !== session.studentId) {
    return NextResponse.json({ error: "권한이 없어요" }, { status: 403 });
  }

  // 채점 실행 (실패해도 내부에서 status='error' 처리 후 정상 반환)
  await evaluateSubmission(submissionId);

  const { data: updated } = await admin
    .from("submissions")
    .select("status")
    .eq("id", submissionId)
    .single();

  return NextResponse.json({ ok: true, status: updated?.status ?? "submitted" });
}
