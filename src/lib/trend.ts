import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { daysAgoKST, TREND_START } from "./date";
import { coTaughtClassIds } from "./transfers";

// 성적 추이 화면과 CSV 내보내기가 같은 데이터를 보도록 조회를 한곳에 모은다.
// (두 곳이 각자 조회하면 기간·필터가 어긋나 숫자가 달라진다)

export const PERIODS = [
  { key: "1m", label: "최근 1개월", days: 30 },
  { key: "6m", label: "최근 6개월", days: 182 },
  { key: "1y", label: "최근 1년", days: 365 },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export function resolvePeriod(p?: string) {
  return PERIODS.find((x) => x.key === p) ?? PERIODS[0];
}

// 기간 시작일과 데이터 시작일 중 더 늦은 쪽
export function trendFrom(days: number) {
  const windowStart = daysAgoKST(days);
  return windowStart > TREND_START ? windowStart : TREND_START;
}

type DB = SupabaseClient;

export interface ScoreRow {
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  studentNumber: number | null;
  assignmentTitle: string;
  date: string; // YYYY-MM-DD
  overall: number;
  accuracy: number | null;
  fluency: number | null;
  prosody: number | null;
  completeness: number | null;
}

// 선생님이 볼 수 있는 반 (담임 + 공동 관리, 보관된 반 제외)
export async function visibleClasses(db: DB, teacherId: string) {
  const coIds = await coTaughtClassIds(teacherId);
  const q = db
    .from("classes")
    .select("id, name")
    .is("archived_at", null)
    .order("name");
  const { data } = await (coIds.length
    ? q.or(`teacher_id.eq.${teacherId},id.in.(${coIds.join(",")})`)
    : q.eq("teacher_id", teacherId));
  return (data ?? []) as { id: string; name: string }[];
}

// 주어진 반들의 채점 완료 제출을 한 줄씩 펼쳐서 돌려준다 (오래된 순)
export async function fetchScoreRows(
  db: DB,
  classes: { id: string; name: string }[],
  from: string
): Promise<ScoreRow[]> {
  if (classes.length === 0) return [];
  const classIds = classes.map((c) => c.id);
  const className = new Map(classes.map((c) => [c.id, c.name]));

  // 조인 경로가 모호해지지 않도록 따로 읽어 코드에서 잇는다
  const [{ data: studentRows }, { data: assignmentRows }] = await Promise.all([
    db
      .from("students")
      .select("id, name, number, class_id")
      .in("class_id", classIds)
      .eq("status", "approved"),
    db.from("assignments").select("id, title, class_id").in("class_id", classIds),
  ]);

  const students = new Map(
    ((studentRows ?? []) as {
      id: string;
      name: string;
      number: number | null;
      class_id: string;
    }[]).map((s) => [s.id, s])
  );
  const assignments = new Map(
    ((assignmentRows ?? []) as { id: string; title: string }[]).map((a) => [
      a.id,
      a.title,
    ])
  );
  if (students.size === 0) return [];

  const { data: subs } = await db
    .from("submissions")
    .select("student_id, assignment_id, overall_score, completeness, azure_scores, created_at")
    .in("student_id", Array.from(students.keys()))
    .eq("status", "evaluated")
    .not("overall_score", "is", null)
    .gte("created_at", `${from}T00:00:00Z`)
    .order("created_at", { ascending: true });

  const num = (v: unknown) => (v == null ? null : Number(v));

  return ((subs ?? []) as {
    student_id: string;
    assignment_id: string;
    overall_score: number;
    completeness: number | null;
    azure_scores: Record<string, unknown> | null;
    created_at: string;
  }[])
    .map((s) => {
      const st = students.get(s.student_id);
      if (!st) return null;
      const az = s.azure_scores ?? {};
      return {
        classId: st.class_id,
        className: className.get(st.class_id) ?? "",
        studentId: st.id,
        studentName: st.name,
        studentNumber: st.number,
        assignmentTitle: assignments.get(s.assignment_id) ?? "과제",
        date: s.created_at.slice(0, 10),
        overall: Math.round(Number(s.overall_score)),
        accuracy: num(az.accuracy),
        fluency: num(az.fluency),
        prosody: num(az.prosody),
        completeness: num(s.completeness),
      } satisfies ScoreRow;
    })
    .filter((r): r is ScoreRow => r !== null);
}

// 날짜별 평균을 낸다 (그래프의 한 선)
export function dailyAverage(rows: { date: string; overall: number }[]) {
  const bucket = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const cur = bucket.get(r.date) ?? { sum: 0, n: 0 };
    cur.sum += r.overall;
    cur.n += 1;
    bucket.set(r.date, cur);
  }
  return Array.from(bucket.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([d, v]) => ({ d, score: Math.round(v.sum / v.n) }));
}
