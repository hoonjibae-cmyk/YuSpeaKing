import "server-only";
import { createAdminClient } from "./supabase/admin";
import { todayKST } from "./date";

// 쿠폰 발급 권한 판정.
//  · 담임          : 자기 반 전부
//  · 보조 선생님    : class_coteachers(role='coupon') 로 지정된 반
//  · 공동 관리(full): 인수인계 기간 중인 반
//
// students 테이블 RLS 는 '전체 권한'을 기준으로 하므로, 보조 선생님의 쿠폰 지급은
// 여기서 권한을 확인한 뒤 서버 키로 좁게 처리한다.

export async function canGrantCoupons(
  teacherId: string,
  classId: string
): Promise<boolean> {
  const admin = createAdminClient();

  const { data: klass } = await admin
    .from("classes")
    .select("teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (klass?.teacher_id === teacherId) return true;

  const { data: co } = await admin
    .from("class_coteachers")
    .select("role, starts_on, ends_on")
    .eq("class_id", classId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  if (!co) return false;
  if (co.role === "coupon") return true;

  // full 등급은 기간 안일 때만
  const today = todayKST();
  return (
    !!co.starts_on && !!co.ends_on && co.starts_on <= today && today <= co.ends_on
  );
}

// 내가 보조 선생님으로 지정된 반 id 목록 (기간 제한 없음)
export async function couponHelperClassIds(teacherId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_coteachers")
    .select("class_id")
    .eq("teacher_id", teacherId)
    .eq("role", "coupon");
  return ((data ?? []) as { class_id: string }[]).map((r) => r.class_id);
}

// 특정 반의 보조 선생님 목록 (담임 화면에서 관리용)
export async function listCouponHelpers(classId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("class_coteachers")
    .select("teacher_id")
    .eq("class_id", classId)
    .eq("role", "coupon");
  const ids = ((data ?? []) as { teacher_id: string }[]).map((r) => r.teacher_id);
  if (ids.length === 0) return [];
  const { data: rows } = await admin
    .from("teachers")
    .select("id, name, email")
    .in("id", ids);
  return ((rows ?? []) as { id: string; name: string | null; email: string }[]).map(
    (t) => ({ id: t.id, name: t.name || t.email })
  );
}
