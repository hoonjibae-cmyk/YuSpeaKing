import "server-only";
import { createAdminClient } from "./supabase/admin";
import { normalizePhone } from "./solapi";
import { sharedClassIds, accessFor } from "./class-access";

// 학부모 열람 링크(/parent/토큰) 알림톡 — 반 화면의 '학부모 링크 보내기' 와
// 발송 액션이 같이 쓴다.
//
// 가입 안내와 달리 **학부모 번호로만** 보낸다. 받는 사람이 학부모이고, 링크를
// 열면 자녀의 과제 기록이 보이기 때문이다. 학부모 번호가 없으면 보내지 않는다
// (학생 번호로 대신 보내지 않는다).

export interface ParentLinkRow {
  studentId: string;
  name: string;
  number: number | null;
  phone: string | null; // 정규화된 학부모 번호
  token: string | null;
  sentAt: string | null;
  sentTo: string | null;
  sentCount: number;
}

// 담임 · 인수인계 공동 관리만 보낼 수 있다 (보조강사는 보기 전용)
export async function canManageClass(
  teacherId: string,
  classId: string,
): Promise<{ ok: boolean; name: string }> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("classes")
    .select("id, name, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  const klass = data as { id: string; name: string; teacher_id: string } | null;
  if (!klass) return { ok: false, name: "" };
  const shared = await sharedClassIds(teacherId);
  const { canManage } = accessFor(
    classId,
    klass.teacher_id === teacherId,
    shared,
  );
  return { ok: canManage, name: klass.name };
}

export async function listParentLinks(
  classId: string,
): Promise<ParentLinkRow[]> {
  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("students")
    .select("id, name, number, parent_phone, parent_token")
    .eq("class_id", classId)
    .eq("status", "approved")
    .order("number", { ascending: true, nullsFirst: false })
    .order("name");
  const students = (rows ?? []) as {
    id: string;
    name: string;
    number: number | null;
    parent_phone: string | null;
    parent_token: string | null;
  }[];
  if (students.length === 0) return [];

  const { data: sent } = await admin
    .from("parent_link_sends")
    .select("student_id, sent_at, sent_to, sent_count")
    .in(
      "student_id",
      students.map((s) => s.id),
    );
  const byId = new Map(
    (
      (sent ?? []) as {
        student_id: string;
        sent_at: string;
        sent_to: string | null;
        sent_count: number;
      }[]
    ).map((r) => [r.student_id, r]),
  );

  return students.map((s) => {
    const r = byId.get(s.id);
    return {
      studentId: s.id,
      name: s.name,
      number: s.number,
      phone: normalizePhone(s.parent_phone),
      token: s.parent_token,
      sentAt: r?.sent_at ?? null,
      sentTo: r?.sent_to ?? null,
      sentCount: r?.sent_count ?? 0,
    };
  });
}
