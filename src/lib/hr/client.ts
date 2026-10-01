import "server-only";
import type { HrStudent } from "./match";

// Student Card is the canonical source of current classes and enrolled students.
// The old Hr* names are retained inside YuSpeaKing for database compatibility.
const ROSTER_URL = "https://card.yussam.com/api/integrations/yuspeaking";
const CLASS_ID = /^(?:aca:\d+|legacy:[a-f0-9]{64})$/;

export interface HrClass {
  hrClassId: string;
  name: string;
  teacherName?: string | null;
}

export function hrConfigured(): boolean {
  return (process.env.STUDENT_CARD_ROSTER_KEY?.length ?? 0) >= 32;
}

async function cardFetch(path: string): Promise<unknown> {
  if (!hrConfigured()) {
    throw new Error("Student Card 연동이 설정되지 않았어요. 운영자에게 문의해 주세요.");
  }
  const response = await fetch(`${ROSTER_URL}${path}`, {
    headers: {
      "x-yuspeaking-roster-key": process.env.STUDENT_CARD_ROSTER_KEY!,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Student Card 명단 조회 실패 (${response.status})`);
  }
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function completeItems(value: unknown, field: string): unknown[] {
  if (!isRecord(value) || value.ok !== true || value.complete !== true || !Array.isArray(value[field])) {
    throw new Error("Student Card 명단 응답 형식이 올바르지 않습니다.");
  }
  return value[field] as unknown[];
}

export async function fetchHrClasses(): Promise<HrClass[]> {
  const classes = completeItems(await cardFetch("/classes"), "classes");
  return classes.map((value) => {
    if (!isRecord(value) || typeof value.id !== "string" || !CLASS_ID.test(value.id)
      || typeof value.name !== "string" || !value.name.trim()) {
      throw new Error("Student Card 반 목록에 잘못된 항목이 있습니다.");
    }
    return {
      hrClassId: value.id,
      name: value.name.trim(),
      teacherName: typeof value.teacherName === "string" ? value.teacherName : null,
    };
  });
}

export async function fetchHrStudents(hrClassId: string): Promise<HrStudent[]> {
  if (!CLASS_ID.test(hrClassId)) throw new Error("Student Card 반 ID 형식이 올바르지 않습니다.");
  const raw = await cardFetch(`/classes/${encodeURIComponent(hrClassId)}/students`);
  if (!isRecord(raw) || raw.classId !== hrClassId) {
    throw new Error("Student Card 반 명단의 ID가 요청한 반과 다릅니다.");
  }
  const students = completeItems(raw, "students");
  return students.map((value) => {
    if (!isRecord(value) || !/^\d+$/.test(String(value.id ?? ""))
      || typeof value.name !== "string" || !value.name.trim()
      || (value.studentPhone != null && typeof value.studentPhone !== "string")
      || (value.parentPhone != null && typeof value.parentPhone !== "string")) {
      throw new Error("Student Card 학생 명단에 잘못된 항목이 있습니다.");
    }
    return {
      hrId: String(value.id),
      name: value.name.trim(),
      studentPhone: typeof value.studentPhone === "string" ? value.studentPhone : null,
      parentPhone: typeof value.parentPhone === "string" ? value.parentPhone : null,
    };
  });
}
