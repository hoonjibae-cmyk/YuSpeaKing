import "server-only";
import { createAdminClient } from "./supabase/admin";

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
