"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { setImpersonation } from "@/lib/teacher-context";

// 운영자가 특정 선생님으로 대행 시작 → 선생님 대시보드로 이동
export async function impersonateTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  setImpersonation(teacherId);
  redirect("/teacher");
}
