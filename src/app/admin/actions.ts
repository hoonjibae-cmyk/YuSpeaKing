"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setImpersonation } from "@/lib/teacher-context";
import { isKnownModel, setAiModel } from "@/lib/settings";
import { fetchHrClasses, hrConfigured } from "@/lib/hr/client";
import { syncAll, syncClass } from "@/lib/hr/sync";

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
  await admin
    .from("teachers")
    .update({ status: "approved" })
    .eq("id", teacherId);
  // Supabase 이메일 확인이 켜져 있어도 로그인되도록 자동 확인 처리
  try {
    await admin.auth.admin.updateUserById(teacherId, { email_confirm: true });
  } catch (e) {
    console.error("[선생님승인] 이메일 자동확인 실패:", e);
  }
  revalidatePath("/admin");
}

// 선생님 가입 신청 반려
export async function rejectTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  const admin = createAdminClient();
  await admin
    .from("teachers")
    .update({ status: "rejected" })
    .eq("id", teacherId);
  revalidatePath("/admin");
}

// 선생님 가입 내역(계정) 삭제. 인증 유저 삭제 → teachers·반·학생·과제 cascade.
export async function deleteTeacher(formData: FormData) {
  const me = await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId || teacherId === me.id) redirect("/admin"); // 자기 자신 삭제 방지

  const admin = createAdminClient();
  // Auth 유저 삭제 시 teachers(on delete cascade) → classes → students/assignments 까지 정리됨
  const { error } = await admin.auth.admin.deleteUser(teacherId);
  if (error) {
    // 인증 유저가 없거나 실패 시, 프로필 행이라도 정리
    await admin.from("teachers").delete().eq("id", teacherId);
  }
  revalidatePath("/admin");
}

// 선생님 운영자 지정 / 해제 (role 변경). 자기 자신은 변경 불가.
export async function setTeacherRole(formData: FormData) {
  const me = await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  const role = String(formData.get("role") || "");
  if (!teacherId || (role !== "admin" && role !== "teacher"))
    redirect("/admin");
  if (teacherId === me.id) redirect("/admin"); // 실수로 자기 권한 해제 방지

  const admin = createAdminClient();
  // 운영자로 지정 시 승인 상태도 함께 보장
  const patch = role === "admin" ? { role, status: "approved" } : { role };
  await admin.from("teachers").update(patch).eq("id", teacherId);
  revalidatePath("/admin");
}

// ---------- 운영자 설정 ----------
export async function saveAiModel(formData: FormData) {
  await requireAdmin();
  const model = String(formData.get("model") || "");
  if (!isKnownModel(model)) {
    redirect("/admin/settings");
  }
  await setAiModel(model);
  redirect("/admin/settings?saved=1");
}

// ---------- HR manager 반 매칭 ----------

// 유스피킹 반 ↔ HR manager 반 잇기.
// 이름이 서로 달라도 여기서 한 번 이어 두면 그 뒤로는 ID 로 따라간다.
export async function linkHrClass(formData: FormData) {
  const me = await requireAdmin();
  const classId = String(formData.get("classId") || "");
  const hrClassId = String(formData.get("hrClassId") || "");
  if (!classId) redirect("/admin/hr");

  const admin = createAdminClient();

  // 빈 값을 고르면 연결 해제
  if (!hrClassId) {
    await admin.from("class_links").delete().eq("class_id", classId);
    await admin.from("hr_pending_students").delete().eq("class_id", classId);
    revalidatePath("/admin/hr");
    redirect("/admin/hr?done=" + encodeURIComponent("연결을 해제했어요."));
  }

  let hrName: string | null = null;
  try {
    hrName =
      (await fetchHrClasses()).find((c) => c.hrClassId === hrClassId)?.name ??
      null;
  } catch {
    // 이름은 보기 좋게 하려는 값이라, 못 가져와도 연결은 진행한다
  }

  // hr_class_id 에 unique 가 걸려 있다 — 다른 반이 이미 쓰고 있으면 알린다
  const { data: taken } = await admin
    .from("class_links")
    .select("class_id")
    .eq("hr_class_id", hrClassId)
    .neq("class_id", classId)
    .maybeSingle();
  if (taken) {
    redirect(
      "/admin/hr?error=" +
        encodeURIComponent(
          "그 HR manager 반은 이미 다른 반과 이어져 있어요. 먼저 해제해 주세요.",
        ),
    );
  }

  const { error } = await admin.from("class_links").upsert(
    {
      class_id: classId,
      hr_class_id: hrClassId,
      hr_class_name: hrName,
      linked_at: new Date().toISOString(),
      linked_by: me.id,
    },
    { onConflict: "class_id" },
  );
  if (error) {
    redirect("/admin/hr?error=" + encodeURIComponent(error.message));
  }

  // 이어 준 직후 바로 명단을 받아 와, 운영자가 결과를 그 자리에서 본다
  const { data: klass } = await admin
    .from("classes")
    .select("name")
    .eq("id", classId)
    .maybeSingle();
  const report = await syncClass(
    classId,
    (klass as { name: string } | null)?.name ?? "",
    hrClassId,
  );

  revalidatePath("/admin/hr");
  redirect(
    "/admin/hr?done=" +
      encodeURIComponent(
        report.error
          ? `이어 뒀지만 명단 조회에 실패했어요 — ${report.error}`
          : `이어 뒀어요. 연락처 ${report.updated}명 갱신 · 확인 필요 ${
              report.pendingNew + report.pendingAmbiguous
            }명`,
      ),
  );
}

// 이어진 모든 반의 명단을 지금 다시 받아 온다 (크론과 같은 일).
export async function syncAllRosters() {
  await requireAdmin();
  if (!hrConfigured()) {
    redirect(
      "/admin/hr?error=" +
        encodeURIComponent(
          "HR_API_BASE / HR_API_KEY 환경변수를 먼저 등록해 주세요.",
        ),
    );
  }

  let reports;
  try {
    reports = await syncAll();
  } catch (e) {
    console.error("[HR] 전체 동기화 실패:", e);
    redirect(
      "/admin/hr?error=" +
        encodeURIComponent(e instanceof Error ? e.message : "동기화 실패"),
    );
  }

  const failed = reports.filter((r) => r.error);
  const updated = reports.reduce((n, r) => n + r.updated, 0);
  const pending = reports.reduce(
    (n, r) => n + r.pendingNew + r.pendingAmbiguous,
    0,
  );

  revalidatePath("/admin/hr");
  redirect(
    "/admin/hr?done=" +
      encodeURIComponent(
        `${reports.length}개 반 확인 · 연락처 ${updated}명 갱신 · 확인 필요 ${pending}명` +
          (failed.length ? ` · 실패 ${failed.length}개 반` : ""),
      ),
  );
}
