import "server-only";
import { createAdminClient } from "./supabase/admin";
import { normalizePhone } from "./solapi";

// 가입하지 않은 학생 — 선생님 '명단 확인' 화면과 가입 안내 알림톡이 같이 쓴다.
//
// 두 종류가 섞인다.
//  · invited : 일원화 후 Student Card 에서 들어온 학생. 유스피킹에 학생이 이미
//              있고, 개인 가입 링크(/student/join/토큰)로 아이디를 만든다.
//  · card    : 전환 중이라 아직 유스피킹 학생이 없는 Student Card 학생.
//              담임 선생님의 공용 가입 링크로 가입 신청하면, 다음 동기화 때
//              이름으로 이어진다.

export interface Uninvited {
  key: string; // 's:<학생id>' 또는 'h:<Student Card id>'
  kind: "invited" | "card";
  classId: string;
  className: string;
  name: string;
  hrStudentId: string | null;
  phone: string | null; // 보낼 번호 (학부모 우선, 없으면 학생)
  phoneOwner: "학부모" | "학생" | null;
  sentAt: string | null;
  sentCount: number;
  // invited 만: 개인 링크용 토큰
  token: string | null;
}

export function pickPhone(parent: string | null, student: string | null) {
  const p = normalizePhone(parent);
  if (p) return { phone: p, phoneOwner: "학부모" as const };
  const s = normalizePhone(student);
  if (s) return { phone: s, phoneOwner: "학생" as const };
  return { phone: null, phoneOwner: null };
}

export async function listUninvited(
  classes: { id: string; name: string }[],
): Promise<Uninvited[]> {
  if (classes.length === 0) return [];
  const admin = createAdminClient();
  const ids = classes.map((c) => c.id);
  const nameOf = new Map(classes.map((c) => [c.id, c.name]));

  const [{ data: inv }, { data: pend }] = await Promise.all([
    admin
      .from("students")
      .select(
        "id, name, class_id, hr_student_id, student_phone, parent_phone, invite_token",
      )
      .in("class_id", ids)
      .eq("status", "invited")
      .order("name"),
    admin
      .from("hr_pending_students")
      .select("class_id, hr_student_id, name, student_phone, parent_phone")
      .in("class_id", ids)
      .eq("kind", "new")
      .order("name"),
  ]);

  const rows: Uninvited[] = [
    ...(
      (inv ?? []) as {
        id: string;
        name: string;
        class_id: string;
        hr_student_id: string | null;
        student_phone: string | null;
        parent_phone: string | null;
        invite_token: string | null;
      }[]
    ).map((s) => ({
      key: `s:${s.id}`,
      kind: "invited" as const,
      classId: s.class_id,
      className: nameOf.get(s.class_id) ?? "",
      name: s.name,
      hrStudentId: s.hr_student_id,
      ...pickPhone(s.parent_phone, s.student_phone),
      sentAt: null,
      sentCount: 0,
      token: s.invite_token,
    })),
    ...(
      (pend ?? []) as {
        class_id: string;
        hr_student_id: string;
        name: string;
        student_phone: string | null;
        parent_phone: string | null;
      }[]
    ).map((p) => ({
      key: `h:${p.hr_student_id}`,
      kind: "card" as const,
      classId: p.class_id,
      className: nameOf.get(p.class_id) ?? "",
      name: p.name,
      hrStudentId: p.hr_student_id,
      ...pickPhone(p.parent_phone, p.student_phone),
      sentAt: null,
      sentCount: 0,
      token: null,
    })),
  ];

  // 보낸 기록 붙이기
  const hrIds = rows.map((r) => r.hrStudentId).filter((x): x is string => !!x);
  if (hrIds.length) {
    const { data: sent } = await admin
      .from("signup_invites")
      .select("hr_student_id, sent_at, sent_count")
      .in("hr_student_id", hrIds);
    const byHr = new Map(
      (
        (sent ?? []) as {
          hr_student_id: string;
          sent_at: string;
          sent_count: number;
        }[]
      ).map((r) => [r.hr_student_id, r]),
    );
    for (const r of rows) {
      const s = r.hrStudentId ? byHr.get(r.hrStudentId) : undefined;
      if (s) {
        r.sentAt = s.sent_at;
        r.sentCount = s.sent_count;
      }
    }
  }
  return rows;
}
