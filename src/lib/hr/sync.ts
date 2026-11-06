import "server-only";
import { randomBytes } from "crypto";
import { createAdminClient } from "../supabase/admin";
import { normalizePhone } from "../solapi";
import { notifyTeacher } from "../slack";
import { generateClassCode } from "../class-code";
import {
  applyClassHandover,
  moveStudentToClass,
  nextNumberInClass,
} from "../transfers";
import { todayKST } from "../date";
import {
  fetchHrClassList,
  fetchHrStudents,
  hrConfigured,
  type HrClass,
} from "./client";
import {
  baseName,
  matchClasses,
  matchRosters,
  matchTeachers,
  type HrStudent,
  type LocalStudent,
} from "./match";

// ============================================================
//  Student Card → 유스피킹 동기화
//
//  두 가지 상태로 돈다 (운영자 → 반 매칭 화면에서 바꾼다).
//
//  convert (전환): 처음 상태. 기존 자료를 바꾸지 않는다.
//    · 선생님·반·학생을 자동으로 맞출 수 있는 것만 잇는다
//    · 비어 있는 연락처만 채우고, 다른 번호는 '차이' 로 적어 둔다
//    · 맞추지 못한 것은 운영자 화면에 남긴다
//
//  oneway (일원화): 운영자가 전환 결과를 확인한 뒤 켠다. Student Card 를 따른다.
//    · Student Card 에 있는데 유스피킹에 없는 반·학생을 만든다
//      (학생은 아이디 없이 'invited' 로 만들고, 가입 안내 링크로 계정을 만든다)
//    · 반이 바뀐 학생은 옮기고, 담임이 바뀐 반은 담임을 바꾼다
//    · Student Card 에서 사라진 학생은 비활성(withdrawn)으로 — 기록은 남는다
//    · 바뀐 것은 모두 hr_sync_log 에 남긴다
//
//  안전장치
//    · Student Card 가 초6 필터를 적용하지 않은 명단을 주면 아무것도 만들거나
//      옮기거나 비활성화하지 않는다 (중·고등 반이 생기는 것을 막는다)
//    · 한 반이라도 명단을 못 받았으면 비활성화하지 않는다 (일시 장애로 학생이
//      통째로 빠지는 것을 막는다)
//    · 이름이 같은 학생이 유스피킹에 이미 있으면 새로 만들지 않고 '확인 필요' 로
//      돌린다 (같은 학생이 두 번 생기는 것을 막는다)
// ============================================================

export type SyncMode = "convert" | "oneway";

export interface SyncReport {
  classId: string;
  className: string;
  updated: number; // 연락처를 채운(바꾼) 학생 수
  linked: number; // 이번에 새로 이은 학생 수
  created: number; // 새로 만든 학생 수 (일원화)
  pendingNew: number; // 아직 유스피킹에 없는 학생 (전환 상태에서 남겨 둔 것)
  pendingAmbiguous: number; // 사람이 골라야 하는 건
  error?: string;
}

export interface SyncSummary {
  at: string;
  mode: SyncMode;
  filterApplied: boolean;
  reports: SyncReport[];
  teachersLinked: number;
  teachersUnmatched: string[];
  classesLinked: number;
  classesCreated: number;
  ownersChanged: number;
  studentsMoved: number;
  studentsWithdrawn: number;
  studentsRestored: number;
  warnings: string[];
}

type Admin = ReturnType<typeof createAdminClient>;

interface LocalRow {
  id: string;
  name: string;
  class_id: string;
  status: string;
  username: string | null;
  hr_student_id: string | null;
  hr_link_method: string | null;
  student_phone: string | null;
  parent_phone: string | null;
}

const LOCAL_COLS =
  "id, name, class_id, status, username, hr_student_id, hr_link_method, student_phone, parent_phone";
// 동기화가 다루는 학생 상태 (거절된 가입 신청은 학생이 아니다)
const LIVE = ["approved", "pending", "invited", "withdrawn"];

interface LogRow {
  kind: string;
  class_id?: string | null;
  student_id?: string | null;
  detail: string;
}

export async function getSyncMode(): Promise<SyncMode> {
  const { data } = await createAdminClient()
    .from("app_settings")
    .select("hr_sync_mode")
    .eq("id", 1)
    .maybeSingle();
  return (data as { hr_sync_mode?: string } | null)?.hr_sync_mode === "oneway"
    ? "oneway"
    : "convert";
}

const toLocal = (r: LocalRow): LocalStudent => ({
  id: r.id,
  name: r.name,
  hrId: r.hr_student_id,
  studentPhone: r.student_phone,
  parentPhone: r.parent_phone,
  linkMethod: r.hr_link_method,
});

// 연락처: 비어 있으면 채운다. 다를 때 — 전환 상태는 그대로 두고 차이로 적고,
// 일원화 상태는 Student Card 를 따른다. Student Card 쪽이 비어 있으면 기존 번호를
// 지우지 않는다.
function contactPatch(
  mode: SyncMode,
  local: { student_phone: string | null; parent_phone: string | null },
  card: HrStudent,
): { patch: Record<string, string>; differs: boolean } {
  const patch: Record<string, string> = {};
  let differs = false;
  const pairs: [string, string | null, string | null][] = [
    [
      "student_phone",
      normalizePhone(local.student_phone),
      normalizePhone(card.studentPhone),
    ],
    [
      "parent_phone",
      normalizePhone(local.parent_phone),
      normalizePhone(card.parentPhone),
    ],
  ];
  for (const [col, mine, theirs] of pairs) {
    if (!theirs || mine === theirs) continue;
    if (!mine || mode === "oneway") patch[col] = theirs;
    else differs = true;
  }
  return { patch, differs };
}

async function writeLog(admin: Admin, rows: LogRow[]) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    await admin.from("hr_sync_log").insert(rows.slice(i, i + 200));
  }
}

async function notifyTeacherId(admin: Admin, teacherId: string, text: string) {
  try {
    const { data } = await admin
      .from("teachers")
      .select("email, slack_email")
      .eq("id", teacherId)
      .maybeSingle();
    const t = data as { email?: string; slack_email?: string } | null;
    await notifyTeacher(t?.slack_email || t?.email, text);
  } catch (e) {
    console.error("[Student Card] 슬랙 알림 실패:", e);
  }
}

// ---------- 한 반의 학생 맞추기 ----------

interface ClassCtx {
  admin: Admin;
  mode: SyncMode;
  // 학생을 새로 만들어도 되는가 (일원화 + 초6 필터 확인됨)
  canCreate: boolean;
  // 다른 반까지 포함해, 아직 Student Card 와 이어지지 않은 학생 이름들.
  // 새로 만들기 전에 '이미 있는 학생일 수 있는지' 를 보는 데 쓴다.
  unlinkedNames: Map<string, LocalRow[]>;
  log: LogRow[];
}

async function syncClassStudents(
  ctx: ClassCtx,
  classId: string,
  className: string,
  cards: HrStudent[],
  locals: LocalRow[],
): Promise<SyncReport> {
  const { admin, mode } = ctx;
  const report: SyncReport = {
    classId,
    className,
    updated: 0,
    linked: 0,
    created: 0,
    pendingNew: 0,
    pendingAmbiguous: 0,
  };
  const byId = new Map(locals.map((l) => [l.id, l]));

  // 다른 반 학생과 이미 이어진 Student Card 학생은 여기서 맞추지 않는다
  // (반 이동은 전체 동기화가 처리한다)
  const result = matchRosters(
    locals.filter((l) => l.status !== "withdrawn").map(toLocal),
    cards,
  );

  // 1) 이어진 학생 — ID·연결 방법·연락처
  for (const m of result.matched) {
    const row = byId.get(m.local.id)!;
    const isNew = row.hr_student_id !== m.hr.hrId;
    const { patch, differs } = contactPatch(mode, row, m.hr);
    const update: Record<string, unknown> = { ...patch };
    if (isNew) {
      update.hr_student_id = m.hr.hrId;
      update.hr_link_method = m.kind;
    }
    // 일원화: Student Card 가 재원으로 확인한 가입 신청은 승인한다
    if (mode === "oneway" && row.status === "pending") {
      update.status = "approved";
      update.approved_at = new Date().toISOString();
      ctx.log.push({
        kind: "student_approved",
        class_id: classId,
        student_id: row.id,
        detail: `${row.name} 가입 신청 자동 승인 (Student Card 재원 확인)`,
      });
    }
    if (Object.keys(update).length) {
      const { error } = await admin
        .from("students")
        .update(update)
        .eq("id", row.id);
      if (error) {
        // 같은 Student Card 학생이 이미 다른 유스피킹 학생에 이어져 있음 (고유 인덱스)
        console.error(
          "[Student Card] 학생 연결 실패:",
          row.name,
          error.message,
        );
        continue;
      }
    }
    if (isNew) {
      report.linked++;
      ctx.log.push({
        kind: "student_linked",
        class_id: classId,
        student_id: row.id,
        detail: `${row.name} ↔ ${m.hr.name} (${m.kind})`,
      });
    }
    if (Object.keys(patch).length) report.updated++;
    if (differs) {
      await admin.from("hr_contact_diffs").upsert({
        student_id: row.id,
        card_student_phone: normalizePhone(m.hr.studentPhone),
        card_parent_phone: normalizePhone(m.hr.parentPhone),
        found_at: new Date().toISOString(),
      });
    } else {
      await admin.from("hr_contact_diffs").delete().eq("student_id", row.id);
    }
  }

  // 2) 사람이 골라야 하는 후보 — 이 반 기준으로 새로 쓴다
  await admin.from("hr_match_suggestions").delete().eq("class_id", classId);
  const suggestions = result.ambiguous.flatMap((a) =>
    a.candidates.map((c) => ({
      local_student_id: a.local.id,
      hr_student_id: c.hrId,
      class_id: classId,
      hr_name: c.name,
      hr_student_phone: normalizePhone(c.studentPhone),
      hr_parent_phone: normalizePhone(c.parentPhone),
      reason: a.reason,
    })),
  );

  // 3) Student Card 에만 있는 학생
  //    일원화: 유스피킹에 만든다. 단, 이름이 같은 학생이 (다른 반이라도) 아직
  //    이어지지 않은 채 있으면 같은 학생일 수 있으니 만들지 않고 후보로 돌린다.
  const stillNew: HrStudent[] = [];
  for (const h of result.onlyInHr) {
    const twins = (ctx.unlinkedNames.get(baseName(h.name)) ?? []).filter(
      (l) => l.id !== undefined,
    );
    if (twins.length > 0) {
      for (const t of twins) {
        suggestions.push({
          local_student_id: t.id,
          hr_student_id: h.hrId,
          class_id: t.class_id,
          hr_name: h.name,
          hr_student_phone: normalizePhone(h.studentPhone),
          hr_parent_phone: normalizePhone(h.parentPhone),
          reason: "same-name",
        });
      }
      stillNew.push(h);
      continue;
    }
    if (!ctx.canCreate) {
      stillNew.push(h);
      continue;
    }
    const { data: made, error } = await admin
      .from("students")
      .insert({
        class_id: classId,
        name: h.name,
        number: await nextNumberInClass(classId),
        status: "invited",
        hr_student_id: h.hrId,
        hr_link_method: "created",
        student_phone: normalizePhone(h.studentPhone),
        parent_phone: normalizePhone(h.parentPhone),
        invite_token: randomBytes(18).toString("hex"),
        invited_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error || !made) {
      console.error("[Student Card] 학생 생성 실패:", h.name, error?.message);
      stillNew.push(h);
      continue;
    }
    report.created++;
    ctx.log.push({
      kind: "student_created",
      class_id: classId,
      student_id: (made as { id: string }).id,
      detail: `${h.name} (가입 전)`,
    });
  }

  if (suggestions.length) {
    // 같은 짝이 두 번 들어가지 않게 (주키 충돌)
    const seen = new Set<string>();
    const uniq = suggestions.filter((s) => {
      const k = `${s.local_student_id}:${s.hr_student_id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    await admin.from("hr_match_suggestions").upsert(uniq);
  }

  // 4) 선생님 화면의 '확인 필요/등록 필요' 목록 — 이 반 기준으로 새로 쓴다.
  //    Student Card 학생 한 명에 한 줄 (같은 학생이 여러 후보에 걸려도 한 줄).
  await admin.from("hr_pending_students").delete().eq("class_id", classId);
  const pendingRows = new Map<string, Record<string, unknown>>();
  for (const h of stillNew) {
    pendingRows.set(h.hrId, {
      class_id: classId,
      hr_student_id: h.hrId,
      name: h.name,
      student_phone: normalizePhone(h.studentPhone),
      parent_phone: normalizePhone(h.parentPhone),
      kind: "new",
      local_student_id: null,
    });
  }
  for (const a of result.ambiguous) {
    for (const c of a.candidates) {
      const prev = pendingRows.get(c.hrId);
      pendingRows.set(c.hrId, {
        class_id: classId,
        hr_student_id: c.hrId,
        name: c.name,
        student_phone: normalizePhone(c.studentPhone),
        parent_phone: normalizePhone(c.parentPhone),
        kind: "ambiguous",
        // 후보가 한 학생에게만 걸려 있으면 그 학생을 적어 둔다
        local_student_id: prev ? null : a.local.id,
      });
    }
  }
  if (pendingRows.size) {
    await admin
      .from("hr_pending_students")
      .insert(Array.from(pendingRows.values()));
  }

  report.pendingNew = Array.from(pendingRows.values()).filter(
    (r) => r.kind === "new",
  ).length;
  report.pendingAmbiguous = result.ambiguous.length;
  return report;
}

// ---------- 전체 동기화 ----------

// 운영자 버튼과 매일 새벽 크론이 함께 쓴다.
export async function runFullSync(): Promise<SyncSummary> {
  const admin = createAdminClient();
  const mode = await getSyncMode();
  const log: LogRow[] = [];
  const summary: SyncSummary = {
    at: new Date().toISOString(),
    mode,
    filterApplied: false,
    reports: [],
    teachersLinked: 0,
    teachersUnmatched: [],
    classesLinked: 0,
    classesCreated: 0,
    ownersChanged: 0,
    studentsMoved: 0,
    studentsWithdrawn: 0,
    studentsRestored: 0,
    warnings: [],
  };
  if (!hrConfigured()) return summary;

  const { classes: cardClasses, filterApplied } = await fetchHrClassList();
  summary.filterApplied = filterApplied;
  // 걸러지지 않은 명단으로는 아무것도 만들거나 옮기거나 비활성화하지 않는다
  const trusted = mode === "oneway" && filterApplied;
  if (!filterApplied) {
    summary.warnings.push(
      "Student Card 가 아직 초6 필터를 적용하지 않아 전 학년 명단이 왔어요. 반·학생 생성, 반 이동, 비활성화는 건너뛰었어요.",
    );
  }

  // ── 1) 선생님 ──
  const [{ data: teacherRows }, { data: tlRows }] = await Promise.all([
    admin.from("teachers").select("id, name").eq("status", "approved"),
    admin.from("teacher_links").select("card_teacher_name, teacher_id"),
  ]);
  const teacherOf = new Map(
    ((tlRows ?? []) as { card_teacher_name: string; teacher_id: string }[]).map(
      (r) => [r.card_teacher_name, r.teacher_id],
    ),
  );
  const cardTeacherNames = cardClasses
    .map((c) => c.teacherName)
    .filter((n): n is string => !!n);
  const tm = matchTeachers(
    cardTeacherNames,
    (teacherRows ?? []) as { id: string; name: string | null }[],
    new Set(teacherOf.keys()),
  );
  for (const a of tm.auto) {
    const { error } = await admin
      .from("teacher_links")
      .insert({
        card_teacher_name: a.cardName,
        teacher_id: a.teacherId,
        method: "auto",
      });
    if (!error) {
      teacherOf.set(a.cardName, a.teacherId);
      summary.teachersLinked++;
    }
  }
  summary.teachersUnmatched = [
    ...tm.unmatched,
    ...tm.ambiguous.map((a) => a.cardName),
  ];

  // ── 2) 반 ──
  const [{ data: localClassRows }, { data: linkRows }] = await Promise.all([
    admin
      .from("classes")
      .select("id, name, teacher_id")
      .is("archived_at", null),
    admin.from("class_links").select("class_id, hr_class_id"),
  ]);
  const localClasses = (localClassRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  const links = (linkRows ?? []) as { class_id: string; hr_class_id: string }[];
  const linkedLocal = new Set(links.map((l) => l.class_id));
  const linkedCard = new Set(links.map((l) => l.hr_class_id));

  // 자동으로 이을 수 있는 반 잇기 (기존 반을 바꾸지 않는 추가 작업이라 두 상태 모두)
  const auto = matchClasses(
    cardClasses.filter((c) => !linkedCard.has(c.hrClassId)),
    localClasses
      .filter((c) => !linkedLocal.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, teacherId: c.teacher_id })),
    teacherOf,
  );
  for (const a of auto) {
    const card = cardClasses.find((c) => c.hrClassId === a.hrClassId)!;
    const { error } = await admin.from("class_links").insert({
      class_id: a.classId,
      hr_class_id: a.hrClassId,
      hr_class_name: card.name,
      linked_by: null,
    });
    if (error) continue; // 동시 실행으로 먼저 이어진 경우
    links.push({ class_id: a.classId, hr_class_id: a.hrClassId });
    linkedLocal.add(a.classId);
    linkedCard.add(a.hrClassId);
    summary.classesLinked++;
    log.push({
      kind: "class_linked",
      class_id: a.classId,
      detail: `↔ ${card.name}`,
    });
  }

  // 일원화: 유스피킹에 없는 반을 만든다 (담임이 정해진 반만)
  if (trusted) {
    for (const card of cardClasses) {
      if (linkedCard.has(card.hrClassId)) continue;
      const owner = card.teacherName
        ? teacherOf.get(card.teacherName)
        : undefined;
      if (!owner || card.teacherConflict) {
        summary.warnings.push(
          `${card.name}: 담임이 ${card.teacherConflict ? "여러 명이라" : "유스피킹 선생님과 이어지지 않아"} 반을 만들지 못했어요.`,
        );
        continue;
      }
      let created: { id: string } | null = null;
      for (let attempt = 0; attempt < 5 && !created; attempt++) {
        const { data, error } = await admin
          .from("classes")
          .insert({
            teacher_id: owner,
            name: card.name,
            class_code: generateClassCode(),
          })
          .select("id")
          .single();
        if (!error && data) created = data as { id: string };
        else if (error?.code !== "23505") break;
      }
      if (!created) {
        summary.warnings.push(`${card.name}: 반을 만들지 못했어요.`);
        continue;
      }
      await admin.from("class_links").insert({
        class_id: created.id,
        hr_class_id: card.hrClassId,
        hr_class_name: card.name,
        linked_by: null,
      });
      links.push({ class_id: created.id, hr_class_id: card.hrClassId });
      linkedCard.add(card.hrClassId);
      linkedLocal.add(created.id);
      localClasses.push({ id: created.id, name: card.name, teacher_id: owner });
      summary.classesCreated++;
      log.push({
        kind: "class_created",
        class_id: created.id,
        detail: card.name,
      });
      await notifyTeacherId(
        admin,
        owner,
        `🏫 유스피킹에 새 반이 생겼어요 (Student Card 기준)\n• 반: ${card.name}\n학생들은 가입 안내를 받아 아이디를 만들면 들어옵니다.`,
      );
    }
  }

  // 일원화: 담임이 바뀐 반은 담임을 바꾼다
  const classById = new Map(localClasses.map((c) => [c.id, c]));
  const cardById = new Map(cardClasses.map((c) => [c.hrClassId, c]));
  if (trusted) {
    for (const l of links) {
      const local = classById.get(l.class_id);
      const card = cardById.get(l.hr_class_id);
      if (!local || !card || card.teacherConflict || !card.teacherName)
        continue;
      const owner = teacherOf.get(card.teacherName);
      if (!owner || owner === local.teacher_id) continue;
      const from = local.teacher_id;
      await applyClassHandover({
        classId: local.id,
        toTeacherId: owner,
        coteachStart: null,
        effective: todayKST(),
      });
      local.teacher_id = owner;
      summary.ownersChanged++;
      log.push({
        kind: "owner_changed",
        class_id: local.id,
        detail: `${local.name}: 담임 변경 (Student Card 담임 ${card.teacherName})`,
      });
      const msg = `🔀 유스피킹 반 담임 변경 (Student Card 기준)\n• 반: ${local.name}\n• 새 담임: ${card.teacherName}`;
      await Promise.all([
        notifyTeacherId(admin, from, msg),
        notifyTeacherId(admin, owner, msg),
      ]);
    }
  }

  // ── 3) 학생 ──
  // 반을 거쳐 다니는 학생(반 이동)과 사라진 학생(퇴원)을 알려면 Student Card 의
  // 초6 전체 명단이 필요하다. 이어지지 않은 반의 명단도 받아 둔다.
  const fetchList: HrClass[] = filterApplied
    ? cardClasses
    : cardClasses.filter((c) => linkedCard.has(c.hrClassId));
  const rosters = new Map<string, HrStudent[]>();
  let allFetched = true;
  for (const c of fetchList) {
    try {
      rosters.set(c.hrClassId, await fetchHrStudents(c.hrClassId));
    } catch (e) {
      allFetched = false;
      summary.warnings.push(
        `${c.name}: 명단을 받지 못했어요 (${e instanceof Error ? e.message : "오류"})`,
      );
    }
  }
  // Student Card 학생 → 그 학생이 있는 반
  const cardHome = new Map<string, { hrClassId: string; student: HrStudent }>();
  rosters.forEach((list, hrClassId) => {
    for (const s of list) cardHome.set(s.hrId, { hrClassId, student: s });
  });
  const localOfCard = new Map(links.map((l) => [l.hr_class_id, l.class_id]));

  // 이어진 반의 학생 + Student Card 와 이어진 적이 있는 모든 학생
  const linkedClassIds = links
    .map((l) => l.class_id)
    .filter((id) => classById.has(id));
  const [{ data: inLinked }, { data: everLinked }] = await Promise.all([
    linkedClassIds.length
      ? admin
          .from("students")
          .select(LOCAL_COLS)
          .in("class_id", linkedClassIds)
          .in("status", LIVE)
      : Promise.resolve({ data: [] }),
    admin
      .from("students")
      .select(LOCAL_COLS)
      .not("hr_student_id", "is", null)
      .in("status", LIVE),
  ]);
  const studentById = new Map<string, LocalRow>();
  for (const r of [
    ...((inLinked ?? []) as LocalRow[]),
    ...((everLinked ?? []) as LocalRow[]),
  ]) {
    studentById.set(r.id, r);
  }

  // 3-a) 이미 이어진 학생: 반 이동·퇴원·복귀 (일원화 + 걸러진 명단 + 빠짐없이 받았을 때만)
  const canFollow = trusted && allFetched;
  if (mode === "oneway" && filterApplied && !allFetched) {
    summary.warnings.push(
      "명단을 다 받지 못해 반 이동·비활성화는 다음 동기화로 미뤘어요.",
    );
  }
  for (const s of Array.from(studentById.values())) {
    if (!s.hr_student_id) continue;
    const home = cardHome.get(s.hr_student_id);
    if (!home) {
      if (canFollow && s.status !== "withdrawn") {
        await admin
          .from("students")
          .update({
            status: "withdrawn",
            withdrawn_at: new Date().toISOString(),
          })
          .eq("id", s.id);
        s.status = "withdrawn";
        summary.studentsWithdrawn++;
        log.push({
          kind: "student_withdrawn",
          class_id: s.class_id,
          student_id: s.id,
          detail: `${s.name}: Student Card 초6 재원 명단에 없음`,
        });
      }
      continue;
    }
    if (!canFollow) continue;
    // 돌아온 학생 — 아이디가 있으면 바로 쓸 수 있게, 없으면 가입 전으로
    if (s.status === "withdrawn") {
      const status = s.username ? "approved" : "invited";
      await admin
        .from("students")
        .update({ status, withdrawn_at: null })
        .eq("id", s.id);
      s.status = status;
      summary.studentsRestored++;
      log.push({
        kind: "student_restored",
        class_id: s.class_id,
        student_id: s.id,
        detail: `${s.name}: Student Card 에 다시 재원`,
      });
    }
    const target = localOfCard.get(home.hrClassId);
    if (target && target !== s.class_id && classById.has(target)) {
      const fromName = classById.get(s.class_id)?.name ?? "이전 반";
      await moveStudentToClass(s.id, target);
      log.push({
        kind: "student_moved",
        class_id: target,
        student_id: s.id,
        detail: `${s.name}: ${fromName} → ${classById.get(target)!.name}`,
      });
      s.class_id = target;
      summary.studentsMoved++;
    }
  }

  // 3-b) 반마다 아직 이어지지 않은 학생 맞추기
  const unlinkedNames = new Map<string, LocalRow[]>();
  for (const s of Array.from(studentById.values())) {
    if (
      s.hr_student_id ||
      s.hr_link_method === "none" ||
      s.status === "withdrawn"
    )
      continue;
    const k = baseName(s.name);
    unlinkedNames.set(k, [...(unlinkedNames.get(k) ?? []), s]);
  }
  const ctx: ClassCtx = { admin, mode, canCreate: trusted, unlinkedNames, log };

  for (const l of links) {
    const local = classById.get(l.class_id);
    if (!local) continue; // 보관된 반
    const roster = rosters.get(l.hr_class_id);
    if (!roster) {
      // 초6 이 한 명도 없어 목록에서 빠진 반은 '빈 명단', 받지 못한 반은 오류
      if (filterApplied && !cardById.has(l.hr_class_id)) {
        summary.reports.push(
          await syncClassStudents(
            ctx,
            local.id,
            local.name,
            [],
            studentsIn(studentById, local.id),
          ),
        );
      } else {
        summary.reports.push({
          classId: local.id,
          className: local.name,
          updated: 0,
          linked: 0,
          created: 0,
          pendingNew: 0,
          pendingAmbiguous: 0,
          error: "명단을 받지 못했어요",
        });
      }
      continue;
    }
    // 다른 반 학생과 이미 이어진 Student Card 학생은 이 반의 신규 후보가 아니다
    const takenElsewhere = new Set(
      Array.from(studentById.values())
        .filter((s) => s.hr_student_id && s.class_id !== local.id)
        .map((s) => s.hr_student_id as string),
    );
    summary.reports.push(
      await syncClassStudents(
        ctx,
        local.id,
        local.name,
        roster.filter((h) => !takenElsewhere.has(h.hrId)),
        studentsIn(studentById, local.id),
      ),
    );
  }

  await writeLog(admin, log);
  await admin
    .from("app_settings")
    .update({ hr_synced_at: summary.at, hr_last_report: summary })
    .eq("id", 1);

  return summary;
}

function studentsIn(map: Map<string, LocalRow>, classId: string): LocalRow[] {
  return Array.from(map.values()).filter((s) => s.class_id === classId);
}

// 예전 호출부와의 호환.
//  · teacherId 없음 → 전체 동기화
//  · teacherId 있음 → 그 선생님 반의 학생만 다시 맞춘다 (반 이동·비활성화·반 생성은
//    전체 동기화만 한다 — 전체 명단을 봐야 판단할 수 있기 때문)
export async function syncAll(teacherId?: string): Promise<SyncReport[]> {
  if (!hrConfigured()) return [];
  if (!teacherId) return (await runFullSync()).reports;
  const { data } = await createAdminClient()
    .from("classes")
    .select("id")
    .eq("teacher_id", teacherId)
    .is("archived_at", null);
  return syncClassesById(((data ?? []) as { id: string }[]).map((c) => c.id));
}

// 반 하나만 (운영자가 반을 이은 직후 결과를 바로 보여 줄 때)
export async function syncLinkedClass(
  classId: string,
): Promise<SyncReport | null> {
  if (!hrConfigured()) return null;
  return (await syncClassesById([classId]))[0] ?? null;
}

// 주어진 반들의 학생만 다시 맞춘다
async function syncClassesById(classIds: string[]): Promise<SyncReport[]> {
  if (classIds.length === 0) return [];
  const admin = createAdminClient();
  const mode = await getSyncMode();
  const [{ data: classRows }, { data: linkRows }, list] = await Promise.all([
    admin
      .from("classes")
      .select("id, name")
      .in("id", classIds)
      .is("archived_at", null),
    admin.from("class_links").select("class_id, hr_class_id"),
    fetchHrClassList(),
  ]);
  const mine = new Map(
    ((classRows ?? []) as { id: string; name: string }[]).map((c) => [
      c.id,
      c.name,
    ]),
  );
  const myLinks = (
    (linkRows ?? []) as { class_id: string; hr_class_id: string }[]
  ).filter((l) => mine.has(l.class_id));

  const { data: allUnlinked } = await admin
    .from("students")
    .select(LOCAL_COLS)
    .is("hr_student_id", null)
    .in("status", ["approved", "pending", "invited"]);
  const unlinkedNames = new Map<string, LocalRow[]>();
  for (const s of (allUnlinked ?? []) as LocalRow[]) {
    if (s.hr_link_method === "none") continue;
    const k = baseName(s.name);
    unlinkedNames.set(k, [...(unlinkedNames.get(k) ?? []), s]);
  }
  const ctx: ClassCtx = {
    admin,
    mode,
    canCreate: mode === "oneway" && list.filterApplied,
    unlinkedNames,
    log: [],
  };

  const reports: SyncReport[] = [];
  for (const l of myLinks) {
    const name = mine.get(l.class_id)!;
    let roster: HrStudent[];
    try {
      roster = await fetchHrStudents(l.hr_class_id);
    } catch (e) {
      reports.push({
        classId: l.class_id,
        className: name,
        updated: 0,
        linked: 0,
        created: 0,
        pendingNew: 0,
        pendingAmbiguous: 0,
        error: e instanceof Error ? e.message : "명단 조회 실패",
      });
      continue;
    }
    const { data: locals } = await admin
      .from("students")
      .select(LOCAL_COLS)
      .eq("class_id", l.class_id)
      .in("status", LIVE);
    const { data: elsewhere } = await admin
      .from("students")
      .select("hr_student_id")
      .neq("class_id", l.class_id)
      .in("hr_student_id", roster.map((r) => r.hrId).concat(["-"]));
    const taken = new Set(
      ((elsewhere ?? []) as { hr_student_id: string }[]).map(
        (r) => r.hr_student_id,
      ),
    );
    reports.push(
      await syncClassStudents(
        ctx,
        l.class_id,
        name,
        roster.filter((h) => !taken.has(h.hrId)),
        (locals ?? []) as LocalRow[],
      ),
    );
  }
  await writeLog(admin, ctx.log);
  return reports;
}

// 선생님 화면 알림용 — 저장된 건수만 센다 (외부 API 호출 없음).
// 일원화 상태에서는 '가입 전(invited)' 학생도 함께 센다.
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

  const [{ count: pend }, { count: invited }] = await Promise.all([
    admin
      .from("hr_pending_students")
      .select("id", { count: "exact", head: true })
      .in("class_id", ids),
    admin
      .from("students")
      .select("id", { count: "exact", head: true })
      .in("class_id", ids)
      .eq("status", "invited"),
  ]);
  return (pend ?? 0) + (invited ?? 0);
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
