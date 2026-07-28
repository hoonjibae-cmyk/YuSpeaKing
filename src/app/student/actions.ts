"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  setStudentSession,
  clearStudentSession,
  hashPassword,
  verifyPassword,
} from "@/lib/student-session";
import { getActiveStudent } from "@/lib/student-guard";
import { notifyTeacher } from "@/lib/slack";

const USERNAME_RE = /^[a-zA-Z0-9._]{4,20}$/;

// ---------- 가입 신청 (승인 대기) ----------
export async function studentSignup(formData: FormData) {
  const name = String(formData.get("name") || "").trim();
  const school = String(formData.get("school") || "").trim();
  const grade = String(formData.get("grade") || "").trim();
  const classId = String(formData.get("classId") || "").trim();
  const signupCode = String(formData.get("signup_code") || "").trim();
  const username = String(formData.get("username") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("password_confirm") || "");

  const back = signupCode
    ? `/student/signup?t=${encodeURIComponent(signupCode)}`
    : "/student/signup";
  // back 에 이미 ?t= 가 붙어 있으므로 구분자를 맞춰야 한다.
  // (그렇지 않으면 ?t=CODE?error=... 가 되어 가입 링크가 깨진다)
  const backWithError = (msg: string) =>
    `${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`;
  if (!name || !school || !grade || !classId) {
    redirect(backWithError("모든 항목을 입력해 주세요"));
  }
  if (!USERNAME_RE.test(username)) {
    redirect(backWithError("아이디는 영문·숫자 4~20자로 만들어 주세요"));
  }
  if (password.length < 4) {
    redirect(backWithError("비밀번호는 4자 이상이에요"));
  }
  if (password !== passwordConfirm) {
    redirect(backWithError("비밀번호가 서로 달라요"));
  }

  const admin = createAdminClient();

  // 수강반 + 담당 선생님 확인
  const { data: klass } = await admin
    .from("classes")
    .select("id, name, teacher_id, archived_at, teachers(email, slack_email)")
    .eq("id", classId)
    .single();
  if (!klass) {
    redirect(backWithError("수강반을 선택해 주세요"));
  }
  if (klass.archived_at) {
    redirect(backWithError("보관된 반은 신청할 수 없어요. 선생님께 문의해 주세요"));
  }

  // 가입 링크(선생님)와 선택한 반의 담당 선생님이 일치하는지 확인
  if (signupCode) {
    const { data: linkTeacher } = await admin
      .from("teachers")
      .select("id")
      .eq("signup_code", signupCode)
      .maybeSingle();
    if (!linkTeacher || linkTeacher.id !== klass.teacher_id) {
      redirect(backWithError("수강반 정보가 올바르지 않아요"));
    }
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
    redirect(backWithError(msg));
  }

  // 담당 선생님에게 Slack DM (best-effort)
  const t = Array.isArray(klass.teachers) ? klass.teachers[0] : klass.teachers;
  const teacherEmail =
    (t as { email?: string; slack_email?: string } | null)?.slack_email ||
    (t as { email?: string } | null)?.email ||
    null;
  const host = headers().get("host");
  const approveUrl = host
    ? `https://${host}/teacher/classes/${classId}`
    : `/teacher/classes/${classId}`;
  await notifyTeacher(
    teacherEmail,
    `🎓 유스피킹앱 신규 학생 가입 신청\n` +
      `• 이름: ${name} (${school} ${grade})\n` +
      `• 수강반: ${klass.name}\n` +
      `• 아이디: ${username}\n` +
      `👉 승인하러 가기: ${approveUrl}`
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

// ---------- 공지 읽음 처리 ----------
export async function markNoticesRead(noticeIds: string[]) {
  if (!Array.isArray(noticeIds) || noticeIds.length === 0) return;
  const session = await getActiveStudent();
  if (!session) return;
  const admin = createAdminClient();
  await admin.from("notice_reads").upsert(
    noticeIds.map((id) => ({ notice_id: id, student_id: session.studentId })),
    { onConflict: "notice_id,student_id" }
  );
  revalidatePath("/student/home");
  revalidatePath("/student/notices");
}

// ---------- 성취 배지: 이미 축하 연출을 본 배지 기록 ----------
export async function markBadgesSeen(keys: string[]) {
  if (!Array.isArray(keys) || keys.length === 0) return;
  const session = await getActiveStudent();
  if (!session) return;
  const admin = createAdminClient();
  const { data } = await admin
    .from("students")
    .select("seen_badges")
    .eq("id", session.studentId)
    .single();
  const prev = Array.isArray(data?.seen_badges)
    ? (data!.seen_badges as string[])
    : [];
  const merged = Array.from(new Set([...prev, ...keys]));
  await admin
    .from("students")
    .update({ seen_badges: merged })
    .eq("id", session.studentId);
}

// ---------- 쿠폰함 리셋(상품 수령 완료) ----------
// 관리자(선생님)가 실물 상품 지급 후 누르는 버튼. 이 시각 이후 제출분부터 다시 적립.
export async function redeemCoupons() {
  const session = await getActiveStudent();
  if (!session) redirect("/student");
  const admin = createAdminClient();
  await admin
    .from("students")
    // 자동 적립분은 기준 시각으로, 선생님이 준 보너스 쿠폰은 0으로 되돌린다
    .update({ coupons_reset_at: new Date().toISOString(), bonus_coupons: 0 })
    .eq("id", session.studentId);
  revalidatePath("/student/home");
  redirect("/student/home?redeemed=1");
}
