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
  /** 한 반에 담임이 여럿으로 적혀 있음 — Student Card 는 이때 담임을 비워 준다 */
  teacherConflict?: boolean;
  studentCount?: number;
}

// 유스피킹은 초6 만 운영한다. Student Card 에 이 학년만 달라고 요청한다.
// Student Card 가 이 필터를 아직 모르면(업데이트 전) 전 학년이 오므로, 응답의
// filter 가 우리 요청과 같은지 확인해 '걸러진 명단' 인지 판단한다.
export const GRADE_FILTER = { schoolLevel: "초등", grade: 6 } as const;
const GRADE_QUERY = `?schoolLevel=${encodeURIComponent(GRADE_FILTER.schoolLevel)}&grade=${GRADE_FILTER.grade}`;

function filterApplied(raw: unknown): boolean {
  if (!isRecord(raw) || !isRecord(raw.filter)) return false;
  return (
    raw.filter.schoolLevel === GRADE_FILTER.schoolLevel &&
    Number(raw.filter.grade) === GRADE_FILTER.grade
  );
}

export function hrConfigured(): boolean {
  return (process.env.STUDENT_CARD_ROSTER_KEY?.length ?? 0) >= 32;
}

async function cardFetch(path: string): Promise<unknown> {
  if (!hrConfigured()) {
    throw new Error(
      "Student Card 연동이 설정되지 않았어요. 운영자에게 문의해 주세요.",
    );
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
  if (
    !isRecord(value) ||
    value.ok !== true ||
    value.complete !== true ||
    !Array.isArray(value[field])
  ) {
    throw new Error("Student Card 명단 응답 형식이 올바르지 않습니다.");
  }
  return value[field] as unknown[];
}

export async function fetchHrClasses(): Promise<HrClass[]> {
  return (await fetchHrClassList()).classes;
}

// 반 목록 + 초6 필터가 실제로 적용됐는지.
// 필터가 적용되지 않은 명단으로는 반·학생을 새로 만들지 않는다 (중·고등 반이
// 유스피킹에 생겨 버린다). 부르는 쪽이 이 값을 보고 판단한다.
export async function fetchHrClassList(): Promise<{
  classes: HrClass[];
  filterApplied: boolean;
}> {
  const raw = await cardFetch(`/classes${GRADE_QUERY}`);
  const classes = completeItems(raw, "classes");
  return {
    filterApplied: filterApplied(raw),
    classes: classes.map((value) => {
      if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !CLASS_ID.test(value.id) ||
        typeof value.name !== "string" ||
        !value.name.trim()
      ) {
        throw new Error("Student Card 반 목록에 잘못된 항목이 있습니다.");
      }
      return {
        hrClassId: value.id,
        name: value.name.trim(),
        teacherName:
          typeof value.teacherName === "string" && value.teacherName.trim()
            ? value.teacherName.trim()
            : null,
        teacherConflict: value.teacherConflict === true,
        studentCount:
          typeof value.studentCount === "number"
            ? value.studentCount
            : undefined,
      };
    }),
  };
}

export async function fetchHrStudents(hrClassId: string): Promise<HrStudent[]> {
  if (!CLASS_ID.test(hrClassId))
    throw new Error("Student Card 반 ID 형식이 올바르지 않습니다.");
  const raw = await cardFetch(
    `/classes/${encodeURIComponent(hrClassId)}/students${GRADE_QUERY}`,
  );
  if (!isRecord(raw) || raw.classId !== hrClassId) {
    throw new Error("Student Card 반 명단의 ID가 요청한 반과 다릅니다.");
  }
  const students = completeItems(raw, "students");
  return students.map((value) => {
    if (
      !isRecord(value) ||
      !/^\d+$/.test(String(value.id ?? "")) ||
      typeof value.name !== "string" ||
      !value.name.trim() ||
      (value.studentPhone != null && typeof value.studentPhone !== "string") ||
      (value.parentPhone != null && typeof value.parentPhone !== "string")
    ) {
      throw new Error("Student Card 학생 명단에 잘못된 항목이 있습니다.");
    }
    return {
      hrId: String(value.id),
      name: value.name.trim(),
      studentPhone:
        typeof value.studentPhone === "string" ? value.studentPhone : null,
      parentPhone:
        typeof value.parentPhone === "string" ? value.parentPhone : null,
    };
  });
}
