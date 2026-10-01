import "server-only";
import { createAdminClient } from "../supabase/admin";
import { normalizePhone } from "../solapi";
import { fetchHrClasses, fetchHrStudents, hrConfigured } from "./client";
import { matchRosters, normalizeClassName, type HrStudent, type LocalStudent } from "./match";

// 이어 둔 반의 명단을 Student Card 에서 받아 유스피킹과 맞춘다.
//
// 맞춘 결과로 하는 일은 둘뿐이다.
//  1) 이미 있는 학생: HR 학생 ID 와 연락처를 채워 넣는다
//  2) 없는 학생/애매한 학생: hr_pending_students 에 쌓아 두고, 선생님 화면이
//     그것만 읽어 알림을 띄운다 (화면이 켜질 때마다 외부 API 를 부르지 않도록)

export interface SyncReport {
  classId: string;
  className: string;
  updated: number; // 연락처를 채운 학생 수
  pendingNew: number; // 등록해야 할 신규 학생
  pendingAmbiguous: number; // 사람이 골라야 하는 건
  error?: string;
}

export async function syncClass(
  classId: string,
  className: string,
  hrClassId: string,
): Promise<SyncReport> {
  const admin = createAdminClient();
  const base: SyncReport = {
    classId,
    className,
    updated: 0,
    pendingNew: 0,
    pendingAmbiguous: 0,
  };

  let hrs: HrStudent[];
  try {
    hrs = await fetchHrStudents(hrClassId);
  } catch (e) {
    return {
      ...base,
      error: e instanceof Error ? e.message : "명단 조회 실패",
    };
  }

  const { data: rows } = await admin
    .from("students")
    .select("id, name, hr_student_id")
    .eq("class_id", classId)
    .eq("status", "approved");

  const locals: LocalStudent[] = (
    (rows ?? []) as { id: string; name: string; hr_student_id: string | null }[]
  ).map((r) => ({ id: r.id, name: r.name, hrId: r.hr_student_id }));

  const result = matchRosters(locals, hrs);

  // 1) 이어진 학생의 ID·연락처 갱신
  for (const m of result.matched) {
    const patch: Record<string, string | null> = {
      hr_student_id: m.hr.hrId,
    };
    const sp = normalizePhone(m.hr.studentPhone);
    const pp = normalizePhone(m.hr.parentPhone);
    if (sp) patch.student_phone = sp;
    if (pp) patch.parent_phone = pp;
    const { error } = await admin
      .from("students")
      .update(patch)
      .eq("id", m.local.id);
    if (!error) base.updated++;
  }

  // 2) 대기 목록을 이 반 기준으로 새로 쓴다 (지난 결과는 지우고 현재만 남긴다)
  await admin.from("hr_pending_students").delete().eq("class_id", classId);

  const pending = [
    ...result.onlyInHr.map((h) => ({
      class_id: classId,
      hr_student_id: h.hrId,
      name: h.name,
      student_phone: normalizePhone(h.studentPhone),
      parent_phone: normalizePhone(h.parentPhone),
      kind: "new" as const,
      local_student_id: null as string | null,
    })),
    ...result.ambiguous.flatMap((a) =>
      a.candidates.map((c) => ({
        class_id: classId,
        hr_student_id: c.hrId,
        name: c.name,
        student_phone: normalizePhone(c.studentPhone),
        parent_phone: normalizePhone(c.parentPhone),
        kind: "ambiguous" as const,
        local_student_id: a.local.id,
      })),
    ),
  ];

  if (pending.length) {
    await admin.from("hr_pending_students").insert(pending);
  }

  base.pendingNew = result.onlyInHr.length;
  base.pendingAmbiguous = result.ambiguous.length;
  return base;
}

// 이어져 있는 모든 반을 동기화. 운영자 버튼과 크론이 함께 쓴다.
// teacherId 를 주면 그 선생님의 반만 (선생님이 자기 반만 새로고침할 때)
export async function syncAll(teacherId?: string): Promise<SyncReport[]> {
  if (!hrConfigured()) return [];
  const admin = createAdminClient();

  // 이름이 양쪽에서 모두 유일한 반만 자동으로 잇는다. 이름이 다르거나
  // 같은 이름의 반이 여러 개면 운영자에게 남겨 둔다.
  const [{ data: localRows, error: localError }, { data: existingLinks, error: linkError }, cardClasses] = await Promise.all([
    admin.from("classes").select("id, name, teacher_id").is("archived_at", null),
    admin.from("class_links").select("class_id, hr_class_id"),
    fetchHrClasses(),
  ]);
  if (localError || linkError) throw localError || linkError;
  const locals = ((localRows ?? []) as { id: string; name: string; teacher_id: string }[])
    .filter((row) => !teacherId || row.teacher_id === teacherId);
  const linkedLocal = new Set(((existingLinks ?? []) as { class_id: string; hr_class_id: string }[]).map((row) => row.class_id));
  const linkedCard = new Set(((existingLinks ?? []) as { class_id: string; hr_class_id: string }[]).map((row) => row.hr_class_id));
  const allLocalNameCounts = new Map<string, number>();
  for (const row of (localRows ?? []) as { id: string; name: string }[]) {
    const name = normalizeClassName(row.name);
    allLocalNameCounts.set(name, (allLocalNameCounts.get(name) ?? 0) + 1);
  }
  const cardByName = new Map<string, typeof cardClasses>();
  for (const row of cardClasses) {
    const name = normalizeClassName(row.name);
    cardByName.set(name, [...(cardByName.get(name) ?? []), row]);
  }
  for (const row of locals) {
    if (linkedLocal.has(row.id)) continue;
    const name = normalizeClassName(row.name);
    const candidates = cardByName.get(name) ?? [];
    if (!name || allLocalNameCounts.get(name) !== 1 || candidates.length !== 1) continue;
    const candidate = candidates[0];
    if (linkedCard.has(candidate.hrClassId)) continue;
    const { error } = await admin.from("class_links").insert({
      class_id: row.id,
      hr_class_id: candidate.hrClassId,
      hr_class_name: candidate.name,
      linked_by: null,
    });
    if (error) {
      // 동시 실행 중 다른 요청이 먼저 연결한 경우만 건너뛴다.
      if (error.code === "23505") continue;
      throw error;
    }
    linkedLocal.add(row.id);
    linkedCard.add(candidate.hrClassId);
  }

  const { data: links, error: readError } = await admin
    .from("class_links")
    .select("class_id, hr_class_id, classes(name, teacher_id, archived_at)");
  if (readError) throw readError;

  const rows = (links ?? []) as Array<{
    class_id: string;
    hr_class_id: string;
    classes:
      | { name: string; teacher_id: string; archived_at: string | null }
      | { name: string; teacher_id: string; archived_at: string | null }[]
      | null;
  }>;

  const reports: SyncReport[] = [];
  for (const r of rows) {
    const c = Array.isArray(r.classes) ? r.classes[0] : r.classes;
    if (!c) continue;
    // 보관한 반은 운영이 끝난 반이라 건드리지 않는다
    if (c.archived_at) continue;
    if (teacherId && c.teacher_id !== teacherId) continue;
    reports.push(await syncClass(r.class_id, c.name, r.hr_class_id));
  }

  await admin
    .from("app_settings")
    .update({ hr_synced_at: new Date().toISOString() })
    .eq("id", 1);

  return reports;
}

// 선생님 화면 알림용 — 저장된 대기 건수만 센다 (외부 API 호출 없음)
export async function pendingCountForTeacher(
  teacherId: string,
): Promise<number> {
  const admin = createAdminClient();
  const { data: classes } = await admin
    .from("classes")
    .select("id")
    .eq("teacher_id", teacherId)
    .is("archived_at", null);
  const ids = ((classes ?? []) as { id: string }[]).map((c) => c.id);
  if (ids.length === 0) return 0;

  const { count } = await admin
    .from("hr_pending_students")
    .select("id", { count: "exact", head: true })
    .in("class_id", ids);
  return count ?? 0;
}

// 운영자 화면 알림용 — Student Card 반과 아직 이어지지 않은 활성 반 수.
export async function unlinkedClassCount(): Promise<number> {
  const admin = createAdminClient();
  const [{ data: classes }, { data: links }] = await Promise.all([
    admin.from("classes").select("id").is("archived_at", null),
    admin.from("class_links").select("class_id"),
  ]);
  const linked = new Set(
    ((links ?? []) as { class_id: string }[]).map((l) => l.class_id),
  );
  return ((classes ?? []) as { id: string }[]).filter((c) => !linked.has(c.id))
    .length;
}
