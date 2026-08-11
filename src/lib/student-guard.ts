import { redirect } from "next/navigation";
import { getStudentSession } from "./student-session";
import { createAdminClient } from "./supabase/admin";
import type { StudentSession } from "./types";

// 세션 쿠키(JWT)가 유효하고 DB에 여전히 승인된 학생으로 존재할 때만 세션 반환.
// 삭제/거절/미승인 학생은 쿠키가 남아 있어도 접근을 차단한다(#6).
// 반이 보관되었는데 다른 반으로 옮겨지지 않은 학생도 비활성으로 보고 차단한다.
// 이름·번호는 선생님이 승인 시 고쳤을 수 있으므로 DB 최신값으로 갱신해 반환.
export async function getActiveStudent(): Promise<StudentSession | null> {
  const session = await getStudentSession();
  if (!session) return null;

  const admin = createAdminClient();
  // students → classes 는 class_id 하나뿐이라 조인 경로가 모호하지 않다
  const { data } = await admin
    .from("students")
    .select("id, name, number, class_id, status, classes(archived_at)")
    .eq("id", session.studentId)
    .maybeSingle();

  if (!data || data.status !== "approved") return null;

  // 보관된 반의 학생은 접근 차단 (반을 복원하거나 다른 반으로 옮기면 바로 풀린다)
  // PostgREST 가 관계를 객체로 줄 때와 배열로 줄 때가 모두 있어 양쪽을 받는다
  const embedded = (
    data as {
      classes?:
        | { archived_at: string | null }
        | { archived_at: string | null }[]
        | null;
    }
  ).classes;
  const klass = Array.isArray(embedded) ? embedded[0] : embedded;
  if (klass?.archived_at) return null;

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
