import { redirect } from "next/navigation";
import { getStudentSession } from "./student-session";
import { createAdminClient } from "./supabase/admin";
import type { StudentSession } from "./types";

// 세션 쿠키(JWT)가 유효하고 DB에 여전히 승인된 학생으로 존재할 때만 세션 반환.
// 삭제/거절/미승인 학생은 쿠키가 남아 있어도 접근을 차단한다(#6).
// 이름·번호는 선생님이 승인 시 고쳤을 수 있으므로 DB 최신값으로 갱신해 반환.
export async function getActiveStudent(): Promise<StudentSession | null> {
  const session = await getStudentSession();
  if (!session) return null;

  const admin = createAdminClient();
  const { data } = await admin
    .from("students")
    .select("id, name, number, class_id, status")
    .eq("id", session.studentId)
    .maybeSingle();

  if (!data || data.status !== "approved") return null;

  return {
    studentId: data.id,
    classId: data.class_id,
    name: data.name,
    number: data.number ?? null,
  };
}

// 학생 세션 가드: 유효하지 않으면 로그인으로
export async function requireStudent(): Promise<StudentSession> {
  const session = await getActiveStudent();
  if (!session) redirect("/student");
  return session;
}
