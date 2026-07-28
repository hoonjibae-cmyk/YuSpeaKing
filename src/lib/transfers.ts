import "server-only";
import { createAdminClient } from "./supabase/admin";
import { todayKST } from "./date";

// 대상 반의 다음 출석번호. 반을 옮길 때 번호 충돌(unique(class_id, number))을 막는다.
export async function nextNumberInClass(classId: string): Promise<number> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("students")
    .select("number")
    .eq("class_id", classId)
    .not("number", "is", null)
    .order("number", { ascending: false })
    .limit(1);
  return Number((data?.[0] as { number?: number } | undefined)?.number ?? 0) + 1;
}

// 학생을 다른 반으로 이동 (계정·제출·점수·쿠폰·배지는 student_id 에 묶여 그대로 따라간다)
export async function moveStudentToClass(studentId: string, targetClassId: string) {
  const admin = createAdminClient();
  const number = await nextNumberInClass(targetClassId);
  await admin
    .from("students")
    .update({ class_id: targetClassId, number })
    .eq("id", studentId);
}

// 오늘 기준으로 공동 관리 권한이 살아 있는 반 id 목록
export async function coTaughtClassIds(teacherId: string): Promise<string[]> {
  const admin = createAdminClient();
  const today = todayKST();
  const { data } = await admin
    .from("class_coteachers")
    .select("class_id")
    .eq("teacher_id", teacherId)
    .lte("starts_on", today)
    .gte("ends_on", today);
  return ((data ?? []) as { class_id: string }[]).map((r) => r.class_id);
}

// 예약된 이동 중 적용일이 된 것들을 실제로 반영한다.
// (매일 크론 + 선생님 대시보드 진입 시 호출 — 여러 번 불려도 안전하다)
export async function applyDueTransfers(): Promise<number> {
  const admin = createAdminClient();
  const today = todayKST();

  const { data } = await admin
    .from("transfer_requests")
    .select("id, kind, student_id, class_id, target_class_id, to_teacher_id")
    .eq("status", "accepted")
    .is("applied_at", null)
    .lte("effective_date", today);

  const due = (data ?? []) as {
    id: string;
    kind: string;
    student_id: string | null;
    class_id: string;
    target_class_id: string | null;
    to_teacher_id: string;
  }[];
  if (due.length === 0) return 0;

  for (const r of due) {
    try {
      if (r.kind === "student") {
        if (r.target_class_id && r.student_id) {
          await moveStudentToClass(r.student_id, r.target_class_id);
        }
      } else {
        await admin
          .from("classes")
          .update({ teacher_id: r.to_teacher_id })
          .eq("id", r.class_id);
        // 담임이 바뀌었으므로 공동 관리 권한은 정리
        await admin.from("class_coteachers").delete().eq("class_id", r.class_id);
      }
      await admin
        .from("transfer_requests")
        .update({ applied_at: new Date().toISOString() })
        .eq("id", r.id);
    } catch (e) {
      console.error("[인수인계] 예약 적용 실패:", r.id, e);
    }
  }
  return due.length;
}
