"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setStudentSession,
  clearStudentSession,
} from "@/lib/student-session";

// 반 코드 확인 → 명단 선택 화면으로
export async function enterClass(formData: FormData) {
  const code = String(formData.get("code") || "")
    .trim()
    .toUpperCase();
  if (!code) redirect("/student?error=반+코드를+입력하세요");

  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("id")
    .eq("class_code", code)
    .single();

  if (!klass) redirect("/student?error=반+코드를+찾을+수+없어요");
  redirect(`/student/select?code=${code}`);
}

// 명단에서 본인 선택 → 세션 발급
export async function selectStudent(formData: FormData) {
  const code = String(formData.get("code") || "")
    .trim()
    .toUpperCase();
  const studentId = String(formData.get("studentId") || "");

  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("id")
    .eq("class_code", code)
    .single();
  if (!klass) redirect("/student?error=다시+로그인해+주세요");

  const { data: student } = await admin
    .from("students")
    .select("id, name, number, class_id, pin_hash")
    .eq("id", studentId)
    .eq("class_id", klass.id)
    .single();
  if (!student) redirect(`/student/select?code=${code}&error=학생을+찾을+수+없어요`);

  // (MVP) PIN 미사용. 추후 pin_hash 검증 추가 지점.

  await setStudentSession({
    studentId: student.id,
    classId: student.class_id,
    name: student.name,
    number: student.number,
  });
  redirect("/student/home");
}

export async function studentLogout() {
  clearStudentSession();
  redirect("/student");
}
