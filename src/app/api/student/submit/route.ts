import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/student-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkCanSubmit, SUBMISSIONS_BUCKET } from "@/lib/student-submit";

export const runtime = "nodejs";

// 제출 기록 생성. 녹음 파일은 이미 브라우저가 /api/student/upload-url 로 받은
// 1회용 URL 을 통해 Supabase Storage 에 직접 올려 둔 상태다.
// 여기서는 그 파일이 실제로 있는지 확인하고 레코드만 만든다(가볍고 빠르다).
// 채점(AI 평가)은 별도 /api/student/evaluate 에서 이어서 실행한다.
export async function POST(req: Request) {
  const session = await getStudentSession();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }

  const { assignmentId } = (await req.json().catch(() => ({}))) as {
    assignmentId?: string;
  };
  if (!assignmentId) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  const check = await checkCanSubmit(
    session.studentId,
    session.classId,
    assignmentId
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const admin = createAdminClient();

  // 경로는 서버가 정한 값을 그대로 쓴다(클라이언트가 보낸 경로를 믿지 않는다).
  // 업로드가 실제로 끝났는지 확인하고, 빈 파일이면 제출로 인정하지 않는다.
  const slash = check.path.lastIndexOf("/");
  const folder = check.path.slice(0, slash);
  const filename = check.path.slice(slash + 1);
  const { data: files } = await admin.storage
    .from(SUBMISSIONS_BUCKET)
    .list(folder, { limit: 100, search: filename });
  const uploaded = (files ?? []).find((f) => f.name === filename);
  const size = (uploaded?.metadata as { size?: number } | undefined)?.size ?? 0;
  if (!uploaded || size <= 0) {
    return NextResponse.json(
      { error: "녹음 파일이 올라가지 않았어요. 다시 시도해 주세요." },
      { status: 400 }
    );
  }

  const { data: submission, error: subErr } = await admin
    .from("submissions")
    .upsert(
      {
        assignment_id: assignmentId,
        student_id: session.studentId,
        audio_path: check.path,
        attempt_count: check.attempt,
        status: "submitted",
        azure_scores: null,
        overall_score: null,
        completeness: null,
        student_feedback: null,
        teacher_feedback: null,
        teacher_reviewed: false,
        error_message: null,
        // 새 제출이므로 자동 채점 재시도 횟수도 새로 시작한다
        evaluate_attempts: 0,
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

  return NextResponse.json({ ok: true, submissionId: submission.id });
}
