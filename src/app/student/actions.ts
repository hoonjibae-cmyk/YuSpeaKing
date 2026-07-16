"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setStudentSession,
  clearStudentSession,
  hashPassword,
  verifyPassword,
} from "@/lib/student-session";
import { notifyTeacher } from "@/lib/slack";

const USERNAME_RE = /^[a-zA-Z0-9._]{4,20}$/;

// ---------- 가입 신청 (승인 대기) ----------
export async function studentSignup(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const school = String(formData.get("school") || "").trim();
  const grade = String(formData.get("grade") || "").trim();
  const classId = String(formData.get("classId") || "").trim();
  const username = String(formData.get("username") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("password_confirm") || "");

  const back = "/student/signup";
  if (!name || !school || !grade || !classId) {
    redirect(`${back}?error=${encodeURIComponent("모든 항목을 입력해 주세요")}`);
  }
  if (!USERNAME_RE.test(username)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "아이디는 영문·숫자 4~20자로 만들어 주세요"
      )}`
    );
  }
  if (password.length < 4) {
    redirect(`${back}?error=${encodeURIComponent("비밀번호는 4자 이상이에요")}`);
  }
  if (password !== passwordConfirm) {
    redirect(`${back}?error=${encodeURIComponent("비밀번호가 서로 달라요")}`);
  }

  const admin = createAdminClient();

  // 수강반 + 담당 선생님 확인
  const { data: klass } = await admin
    .from("classes")
    .select("id, name, teacher_id, teachers(email, slack_email)")
    .eq("id", classId)
    .single();
  if (!klass) {
    redirect(`${back}?error=${encodeURIComponent("수강반을 선택해 주세요")}`);
  }

  const { error } = await admin.from("students").insert({
    class_id: classId,
    name,
    school,
    grade,
    username,
    password_hash: hashPassword(password),
    status: "pending",
  });

  if (error) {
    const msg =
      error.code === "23505"
        ? "이미 사용 중인 아이디예요"
        : error.message || "가입 신청에 실패했어요";
    redirect(`${back}?error=${encodeURIComponent(msg)}`);
  }

  // 담당 선생님에게 Slack DM (best-effort)
  const t = Array.isArray(klass.teachers) ? klass.teachers[0] : klass.teachers;
  const teacherEmail =
    (t as { email?: string; slack_email?: string } | null)?.slack_email ||
    (t as { email?: string } | null)?.email ||
    null;
  await notifyTeacher(
    teacherEmail,
    `🎓 유스피킹 새 가입 신청\n` +
      `• 이름: ${name} (${school} ${grade})\n` +
      `• 수강반: ${klass.name}\n` +
      `• 아이디: ${username}\n` +
      `→ 선생님 페이지 > 반 상세에서 승인해 주세요.`
  );

  redirect(`/student?signup=done`);
}

// ---------- 로그인 (아이디 + 비밀번호) ----------
export async function studentLogin(formData: FormData) {
  const username = String(formData.get("username") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!username || !password) {
    redirect("/student?error=" + encodeURIComponent("아이디와 비밀번호를 입력하세요"));
  }

  const admin = createAdminClient();
  const { data: student } = await admin
    .from("students")
    .select("id, name, number, class_id, password_hash, status")
    .eq("username", username)
    .maybeSingle();

  if (!student || !student.password_hash) {
    redirect("/student?error=" + encodeURIComponent("아이디 또는 비밀번호가 맞지 않아요"));
  }
  if (!verifyPassword(password, student.password_hash)) {
    redirect("/student?error=" + encodeURIComponent("아이디 또는 비밀번호가 맞지 않아요"));
  }
  if (student.status === "pending") {
    redirect(
      "/student?error=" +
        encodeURIComponent("가입 승인 대기 중이에요. 선생님 승인 후 이용할 수 있어요")
    );
  }
  if (student.status === "rejected") {
    redirect(
      "/student?error=" +
        encodeURIComponent("가입이 반려되었어요. 선생님께 문의해 주세요")
    );
  }

  await setStudentSession({
    studentId: student.id,
    classId: student.class_id,
    name: student.name,
    number: student.number ?? null,
  });
  redirect("/student/home");
}

export async function studentLogout() {
  clearStudentSession();
  redirect("/student");
}
