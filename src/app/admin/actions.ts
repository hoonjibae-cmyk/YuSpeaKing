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
