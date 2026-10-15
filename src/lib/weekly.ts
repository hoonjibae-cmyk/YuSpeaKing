import "server-only";
import { createAdminClient } from "./supabase/admin";
import { kstWeekWindow } from "./date";

// 한 주 동안 각 반이 어떻게 돌아갔는지 모은다.
// 경영지원·교수부장에게 월요일 낮에 보내는 요약의 재료.
//
// 세는 기준 — 모두 '그 주에 일어난 일' 이다.
//  · 과제   : 그 주에 만들어진 과제 수            (선생님이 냈는가)
//  · 제출율 : 그 주에 한 번이라도 낸 학생 / 승인 학생  (학생이 했는가)
//  · 점수   : 그 주 제출물 중 채점이 끝난 것의 평균
//  · 녹음   : 그 주 제출물의 평균 녹음 길이
//  · 미제출 : 그 주에 한 건도 내지 않은 승인 학생
//
// 마감일이 아니라 제출 시점으로 세는 이유: 마감일이 없는 과제가 섞여 있어
// 마감 기준으로 묶으면 어떤 반은 통째로 빠진다. 또 '이번 주에 반의 몇 %가
// 과제를 했나' 가 읽는 사람이 실제로 알고 싶어 하는 값이다.

export interface ClassWeek {
  classId: string;
  className: string;
  teacherName: string;
  students: number; // 승인 학생 수
  created: number; // 그 주에 만든 과제 수
  submitted: number; // 그 주에 한 번이라도 낸 학생 수
  rate: number | null; // 제출율 (%) — 학생이 없으면 null
  avgScore: number | null; // 평균 종합 점수
  avgSeconds: number | null; // 평균 녹음 시간(초)
  missing: string[]; // 그 주에 한 건도 안 낸 학생 이름
}

export interface WeeklySummary {
  range: string;
  classes: ClassWeek[];
  /** 녹음 길이가 아직 하나도 쌓이지 않았는가 (안내 문구용) */
  noDurationYet: boolean;
}

export async function gatherWeekly(offset = 1): Promise<WeeklySummary> {
  const admin = createAdminClient();
  const { startUtc, endUtc, range } = kstWeekWindow(offset);

  // 보관한 반은 운영이 끝난 반이라 뺀다. 그러지 않으면 학기가 끝난 반이
  // 매주 '제출 0%' 로 올라와 표가 금세 못 읽을 만큼 길어진다.
  const [{ data: classRows }, { data: teacherRows }] = await Promise.all([
    admin
      .from("classes")
      .select("id, name, teacher_id")
      .is("archived_at", null)
      .order("name"),
    admin.from("teachers").select("id, name, email"),
  ]);

  const classes = (classRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  if (classes.length === 0) {
    return { range, classes: [], noDurationYet: false };
  }
  const classIds = classes.map((c) => c.id);

  const teacherName = new Map(
    (
      (teacherRows ?? []) as {
        id: string;
        name: string | null;
        email: string | null;
      }[]
    ).map((t) => [t.id, t.name || t.email || "이름 없음"]),
  );

  // Supabase 는 한 번에 1000행까지만 돌려준다. 말없이 잘리면 제출이 통째로
  // 빠진 요약이 나가므로, 한 주치로 좁히고 한도도 넉넉히 적어 둔다.
  const ROW_LIMIT = 10_000;

  const [{ data: studentRows }, { data: createdRows }, { data: subRows }] =
    await Promise.all([
      admin
        .from("students")
        .select("id, name, class_id, number")
        .in("class_id", classIds)
        .eq("status", "approved")
        .order("number")
        .limit(ROW_LIMIT),
      admin
        .from("assignments")
        .select("id, class_id")
        .in("class_id", classIds)
        .gte("created_at", startUtc)
        .lt("created_at", endUtc)
        .limit(ROW_LIMIT),
      // 그 주에 들어온 제출물
      admin
        .from("submissions")
        .select(
          "student_id, assignment_id, overall_score, status, audio_seconds",
        )
        .gte("created_at", startUtc)
        .lt("created_at", endUtc)
        .limit(ROW_LIMIT),
    ]);

  const students = (studentRows ?? []) as {
    id: string;
    name: string;
    class_id: string;
    number: number | null;
  }[];
  const created = (createdRows ?? []) as { id: string; class_id: string }[];
  const subs = (subRows ?? []) as {
    student_id: string;
    assignment_id: string;
    overall_score: number | null;
    status: string | null;
    audio_seconds: number | null;
  }[];

  // 제출물에서 반을 알려면 과제를 거쳐야 한다. 과제를 전부 읽으면 해가 갈수록
  // 1000행에 걸리므로, 그 주에 실제로 제출된 과제만 집어서 읽는다.
  // (묶어 조회하면 조인 경로가 모호해져 따로 읽고 코드에서 잇는다)
  const usedAssignmentIds = Array.from(
    new Set(subs.map((s) => s.assignment_id)),
  );
  const assignClass = new Map<string, string>();
  for (let i = 0; i < usedAssignmentIds.length; i += 200) {
    const { data } = await admin
      .from("assignments")
      .select("id, class_id")
      .in("id", usedAssignmentIds.slice(i, i + 200));
    for (const a of (data ?? []) as { id: string; class_id: string }[]) {
      assignClass.set(a.id, a.class_id);
    }
  }

  const createdByClass = new Map<string, number>();
  for (const a of created) {
    createdByClass.set(a.class_id, (createdByClass.get(a.class_id) ?? 0) + 1);
  }

  const submittersByClass = new Map<string, Set<string>>();
  const scoresByClass = new Map<string, number[]>();
  const secondsByClass = new Map<string, number[]>();
  for (const s of subs) {
    const cid = assignClass.get(s.assignment_id);
    if (!cid) continue;
    if (!submittersByClass.has(cid)) submittersByClass.set(cid, new Set());
    submittersByClass.get(cid)!.add(s.student_id);
    if (s.status === "evaluated" && s.overall_score != null) {
      scoresByClass.set(cid, [
        ...(scoresByClass.get(cid) ?? []),
        Number(s.overall_score),
      ]);
    }
    if (s.audio_seconds != null) {
      secondsByClass.set(cid, [
        ...(secondsByClass.get(cid) ?? []),
        Number(s.audio_seconds),
      ]);
    }
  }

  const avg = (xs?: number[]) =>
    xs && xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null;

  const rows: ClassWeek[] = classes.map((c) => {
    const mine = students.filter((s) => s.class_id === c.id);
    const didSubmit = submittersByClass.get(c.id) ?? new Set<string>();
    const score = avg(scoresByClass.get(c.id));
    const seconds = avg(secondsByClass.get(c.id));
    return {
      classId: c.id,
      className: c.name,
      teacherName: teacherName.get(c.teacher_id) ?? "담당 미지정",
      students: mine.length,
      created: createdByClass.get(c.id) ?? 0,
      submitted: didSubmit.size,
      rate: mine.length
        ? Math.round((didSubmit.size / mine.length) * 100)
        : null,
      avgScore: score == null ? null : Math.round(score),
      avgSeconds: seconds == null ? null : Math.round(seconds),
      missing: mine.filter((s) => !didSubmit.has(s.id)).map((s) => s.name),
    };
  });

  return {
    range,
    classes: rows,
    // 아직 한 건도 길이가 쌓이지 않았으면 '0초' 가 아니라 이유를 알려 준다
    noDurationYet:
      subs.length > 0 && subs.every((s) => s.audio_seconds == null),
  };
}

// 분:초 (예: 2분 7초). 슬랙 표에 들어간다.
export function mmss(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}분 ${s}초` : `${s}초`;
}

// ---------- 슬랙 메시지 ----------

// 한글은 고정폭 글꼴에서도 두 칸을 차지한다. 글자 수로 맞추면 표가 어긋난다.
function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w +=
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6)
        ? 2
        : 1;
  }
  return w;
}

function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - width(s)));
}
function padL(s: string, n: number): string {
  return " ".repeat(Math.max(0, n - width(s))) + s;
}

// 미제출 명단이 길어지면 표보다 명단이 길어진다. 반마다 이만큼만 적는다.
const MAX_MISSING = 15;

export function formatWeeklySlack(sum: WeeklySummary): string {
  // 학생이 없는 반은 숫자가 전부 비어 표만 길어진다
  const rows = sum.classes.filter((c) => c.students > 0);
  if (rows.length === 0) {
    return `📋 유스피킹 주간 운영 요약\n🗓 ${sum.range}\n\n운영 중인 반이 없어요.`;
  }

  const byTeacher = new Map<string, ClassWeek[]>();
  for (const c of rows) {
    byTeacher.set(c.teacherName, [...(byTeacher.get(c.teacherName) ?? []), c]);
  }

  // 반 이름 칸은 가장 긴 이름에 맞춘다 (반 이름 길이가 제각각이라 고정하면 깨진다)
  const nameW = Math.max(6, ...rows.map((c) => width(c.className)));

  const out: string[] = [`📋 유스피킹 주간 운영 요약`, `🗓 ${sum.range}`, ""];

  for (const [teacher, list] of Array.from(byTeacher.entries())) {
    out.push(`▸ *${teacher} 선생님*`);
    const header =
      pad("반", nameW) +
      padL("과제", 6) +
      padL("제출율", 14) +
      padL("평균점수", 10) +
      padL("평균녹음", 12);
    const body = list.map(
      (c) =>
        pad(c.className, nameW) +
        padL(String(c.created), 6) +
        padL(
          c.rate == null ? "—" : `${c.rate}% (${c.submitted}/${c.students})`,
          14,
        ) +
        padL(c.avgScore == null ? "—" : String(c.avgScore), 10) +
        padL(mmss(c.avgSeconds), 12),
    );
    out.push("```\n" + [header, ...body].join("\n") + "\n```");
  }

  // 전체 합계 — 반이 여럿일 때만 의미가 있다
  if (rows.length > 1) {
    const students = rows.reduce((t, c) => t + c.students, 0);
    const submitted = rows.reduce((t, c) => t + c.submitted, 0);
    const created = rows.reduce((t, c) => t + c.created, 0);
    const rate = students ? Math.round((submitted / students) * 100) : 0;
    out.push(
      `합계 — 과제 ${created}개 · 제출율 ${rate}% (${submitted}/${students}명)`,
    );
  }

  // 미제출 명단
  const missing = rows.filter((c) => c.missing.length > 0);
  out.push("");
  if (missing.length === 0) {
    out.push("✅ 지난주 모든 학생이 한 번 이상 제출했어요.");
  } else {
    const total = missing.reduce((t, c) => t + c.missing.length, 0);
    out.push(`⚠️ *지난주 한 건도 제출하지 않은 학생 ${total}명*`);
    for (const c of missing) {
      const shown = c.missing.slice(0, MAX_MISSING).join(", ");
      const more =
        c.missing.length > MAX_MISSING
          ? ` 외 ${c.missing.length - MAX_MISSING}명`
          : "";
      out.push(
        `• ${c.className} (${c.teacherName}) ${c.missing.length}명 — ${shown}${more}`,
      );
    }
  }

  if (sum.noDurationYet) {
    out.push(
      "",
      "ℹ️ 평균 녹음 시간은 이 기능을 켠 뒤 들어온 제출물부터 집계돼요.",
    );
  }

  return out.join("\n");
}
