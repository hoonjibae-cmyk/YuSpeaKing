"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setStudentSession,
  clearStudentSession,
  setPendingStudent,
  getPendingStudent,
  clearPendingStudent,
  hashPin,
} from "@/lib/student-session";

// 1단계: 반코드 + 이름 + 번호 로 명단 매칭 → PIN 단계로
export async function studentLogin(formData: FormData) {
  const code = String(formData.get("code") || "")
    .trim()
    .toUpperCase();
  const name = String(formData.get("name") || "").trim();
  const number = parseInt(String(formData.get("number") || ""), 10);

  if (!code || !name || Number.isNaN(number)) {
    redirect("/student?error=반+코드·이름·번호를+모두+입력하세요");
  }

  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("id")
    .eq("class_code", code)
    .single();
  if (!klass) redirect("/student?error=반+코드를+찾을+수+없어요");

  // 이름 + 번호가 명단과 일치해야 입장 (명단은 노출하지 않음)
  const { data: student } = await admin
    .from("students")
    .select("id, name, number, class_id, pin_hash")
    .eq("class_id", klass.id)
    .eq("number", number)
    .ilike("name", name)
    .maybeSingle();

  if (!student) {
    redirect("/student?error=명단에서+찾을+수+없어요.+이름·번호를+확인하거나+선생님께+문의하세요");
  }

  await setPendingStudent({
    studentId: student.id,
    classId: student.class_id,
    name: student.name,
    number: student.number,
    pinSet: !!student.pin_hash,
  });
  redirect("/student/pin");
}

// 2단계: PIN 설정(첫 로그인) 또는 PIN 입력 → 세션 발급
export async function submitPin(formData: FormData) {
  const pending = await getPendingStudent();
  if (!pending) redirect("/student?error=시간이+초과되었어요.+다시+로그인해+주세요");

  const pin = String(formData.get("pin") || "").trim();
  if (!/^\d{4}$/.test(pin)) {
    redirect("/student/pin?error=PIN은+숫자+4자리예요");
  }

  const admin = createAdminClient();

  if (!pending.pinSet) {
    // 첫 로그인: PIN 설정
    const confirm = String(formData.get("pin_confirm") || "").trim();
    if (pin !== confirm) {
      redirect("/student/pin?error=PIN이+서로+달라요.+다시+입력해+주세요");
    }
    await admin
      .from("students")
      .update({ pin_hash: hashPin(pending.studentId, pin) })
      .eq("id", pending.studentId);
  } else {
    // 기존 학생: PIN 검증
    const { data: student } = await admin
      .from("students")
      .select("pin_hash")
      .eq("id", pending.studentId)
      .single();
    if (!student || student.pin_hash !== hashPin(pending.studentId, pin)) {
      redirect("/student/pin?error=PIN이+맞지+않아요");
    }
  }

  await setStudentSession({
    studentId: pending.studentId,
    classId: pending.classId,
    name: pending.name,
    number: pending.number,
  });
  clearPendingStudent();
  redirect("/student/home");
}

export async function studentLogout() {
  clearStudentSession();
  redirect("/student");
}
