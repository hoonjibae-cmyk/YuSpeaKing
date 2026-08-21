import "server-only";
import { createAdminClient } from "./supabase/admin";
import { todayKST } from "./date";

// 제출 가능 여부 확인 (업로드 URL 발급과 제출 기록 생성이 함께 쓴다)
export type SubmitCheck =
  | { ok: false; error: string; status: number }
  | { ok: true; path: string; attempt: number };

export const SUBMISSIONS_BUCKET = "submissions";

// 녹음 파일 경로는 서버가 정한다. 클라이언트가 알려 준 경로를 믿으면
// 다른 학생의 녹음을 자기 제출로 가로챌 수 있다.
export function audioPathFor(assignmentId: string, studentId: string) {
  return `${assignmentId}/${studentId}.wav`;
}

export async function checkCanSubmit(
  studentId: string,
  classId: string,
  assignmentId: string
): Promise<SubmitCheck> {
  const admin = createAdminClient();

  const { data: assignment } = await admin
    .from("assignments")
    .select("id, class_id, due_date")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!assignment || assignment.class_id !== classId) {
    return { ok: false, error: "권한이 없어요", status: 403 };
  }

  if (assignment.due_date && assignment.due_date < todayKST()) {
    return {
      ok: false,
      error: "마감된 과제예요. 지금은 제출할 수 없어요.",
      status: 403,
    };
  }

  const { data: existing } = await admin
    .from("submissions")
    .select("attempt_count")
    .eq("assignment_id", assignmentId)
    .eq("student_id", studentId)
    .maybeSingle();
  const used = existing?.attempt_count ?? 0;
  if (used >= 1) {
    // 제출(분석)은 일괄 1회로 고정
    return {
      ok: false,
      error: "제출 횟수를 모두 사용했어요. 선생님께 문의하세요.",
      status: 403,
    };
  }

  return {
    ok: true,
    path: audioPathFor(assignmentId, studentId),
    attempt: used + 1,
  };
}
