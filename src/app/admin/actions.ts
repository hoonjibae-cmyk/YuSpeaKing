"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setImpersonation } from "@/lib/teacher-context";

// 운영자가 특정 선생님으로 대행 시작 → 선생님 대시보드로 이동
export async function impersonateTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  setImpersonation(teacherId);
  redirect("/teacher");
}

// 선생님 가입 신청 승인
export async function approveTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  const admin = createAdminClient();
  await admin.from("teachers").update({ status: "approved" }).eq("id", teacherId);
  revalidatePath("/admin");
}

// 선생님 가입 신청 반려
export async function rejectTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  const admin = createAdminClient();
  await admin.from("teachers").update({ status: "rejected" }).eq("id", teacherId);
  revalidatePath("/admin");
}

// 선생님 운영자 지정 / 해제 (role 변경). 자기 자신은 변경 불가.
export async function setTeacherRole(formData: FormData) {
  const me = await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  const role = String(formData.get("role") || "");
  if (!teacherId || (role !== "admin" && role !== "teacher")) redirect("/admin");
  if (teacherId === me.id) redirect("/admin"); // 실수로 자기 권한 해제 방지

  const admin = createAdminClient();
  // 운영자로 지정 시 승인 상태도 함께 보장
  const patch =
    role === "admin" ? { role, status: "approved" } : { role };
  await admin.from("teachers").update(patch).eq("id", teacherId);
  revalidatePath("/admin");
}
