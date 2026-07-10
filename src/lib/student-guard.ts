import { redirect } from "next/navigation";
import { getStudentSession } from "./student-session";
import type { StudentSession } from "./types";

// 학생 세션 가드: 없으면 반코드 로그인으로
export async function requireStudent(): Promise<StudentSession> {
  const session = await getStudentSession();
  if (!session) redirect("/student");
  return session;
}
