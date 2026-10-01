import "server-only";
import type { HrStudent } from "./match";

// ============================================================
//  HR manager 연동 어댑터
//
//  ⚠️ 이 파일만 실제 API 규격에 맞춰 채우면 나머지는 그대로 돌아간다.
//     아래 두 함수가 돌려주는 모양만 지키면 된다.
//
//  필요한 환경변수
//    HR_API_BASE   예: https://hr.yussam.com/api
//    HR_API_KEY    인증 키
// ============================================================

export interface HrClass {
  hrClassId: string;
  name: string;
  /** HR 쪽 담당 선생님 식별값 (이메일 또는 사번). 매칭 확인용 */
  teacherEmail?: string | null;
}

export function hrConfigured(): boolean {
  return Boolean(process.env.HR_API_BASE && process.env.HR_API_KEY);
}

class HrNotConfigured extends Error {
  constructor() {
    super(
      "HR manager 연동이 설정되지 않았어요. HR_API_BASE / HR_API_KEY 를 등록해 주세요.",
    );
  }
}

async function hrFetch<T>(path: string): Promise<T> {
  if (!hrConfigured()) throw new HrNotConfigured();
  const base = process.env.HR_API_BASE!.replace(/\/$/, "");

  const res = await fetch(`${base}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.HR_API_KEY}`,
      Accept: "application/json",
    },
    // 명단은 자주 바뀌지 않지만, 동기화는 최신값을 봐야 한다
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HR manager 응답 ${res.status} ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// 반 목록. 운영자가 유스피킹 반과 이어 줄 때 쓴다.
//
// TODO: 실제 엔드포인트·응답 필드에 맞춰 경로와 매핑을 고칠 것.
export async function fetchHrClasses(): Promise<HrClass[]> {
  const raw = await hrFetch<
    Array<{
      id?: string | number;
      classId?: string | number;
      name?: string;
      className?: string;
      teacherEmail?: string;
    }>
  >("/classes");

  return (Array.isArray(raw) ? raw : []).map((c) => ({
    hrClassId: String(c.id ?? c.classId ?? ""),
    name: String(c.name ?? c.className ?? ""),
    teacherEmail: c.teacherEmail ?? null,
  }));
}

// 한 반의 학생 명단 + 연락처.
//
// TODO: 실제 엔드포인트·응답 필드에 맞춰 경로와 매핑을 고칠 것.
export async function fetchHrStudents(hrClassId: string): Promise<HrStudent[]> {
  const raw = await hrFetch<
    Array<{
      id?: string | number;
      studentId?: string | number;
      name?: string;
      studentName?: string;
      phone?: string;
      studentPhone?: string;
      parentPhone?: string;
      guardianPhone?: string;
    }>
  >(`/classes/${encodeURIComponent(hrClassId)}/students`);

  return (Array.isArray(raw) ? raw : []).map((s) => ({
    hrId: String(s.id ?? s.studentId ?? ""),
    name: String(s.name ?? s.studentName ?? "").trim(),
    studentPhone: s.studentPhone ?? s.phone ?? null,
    parentPhone: s.parentPhone ?? s.guardianPhone ?? null,
  }));
}
