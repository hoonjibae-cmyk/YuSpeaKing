import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AzureScores } from "./types";

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// 'YYYY-MM' → { start: 'YYYY-MM-01', endExclusive: 다음달 1일 }
export function monthRange(month: string): { start: string; endExclusive: string } {
  const [y, m] = month.split("-").map(Number);
  const start = `${month}-01`;
  const end = new Date(y, m, 1); // m은 1-based라 자동으로 다음달
  const endExclusive = `${end.getFullYear()}-${String(
    end.getMonth() + 1
  ).padStart(2, "0")}-01`;
  return { start, endExclusive };
}

export interface MonthlyItem {
  title: string;
  date: string; // YYYY-MM-DD (과제 생성일)
  submitted: boolean;
  score: number | null;
}

export interface MonthlyData {
  assigned: number;
  submitted: number;
  rate: number;
  avg: number | null;
  firstScore: number | null;
  lastScore: number | null;
  growth: number | null; // lastScore - firstScore
  items: MonthlyItem[];
  weakWords: string[]; // 자주 틀린 단어 top
  approvedAt: string | null; // 가입 승인일 (YYYY-MM-DD)
  joinedThisMonth: boolean; // 이 달에 등록한 신입생인지
  beforeJoinCount: number; // 등록 이전에 출제되어 집계에서 제외한 과제 수
}

// 특정 학생의 한 달치 과제·제출·평가 집계.
// 가입 승인일(approvedAt) 이전에 출제된 과제는 그 학생에게 부여된 적이 없으므로
// 제출률 계산에서 제외한다. (신입생이 낮은 제출률로 평가되는 문제 방지)
export async function gatherMonthly(
  db: SupabaseClient,
  studentId: string,
  classId: string,
  month: string,
  approvedAt?: string | null
): Promise<MonthlyData> {
  const { start, endExclusive } = monthRange(month);

  const { data: assignments } = await db
    .from("assignments")
    .select("id, title, created_at")
    .eq("class_id", classId)
    .gte("created_at", start)
    .lt("created_at", endExclusive)
    .order("created_at", { ascending: true });

  const all = (assignments ?? []) as {
    id: string;
    title: string;
    created_at: string;
  }[];

  // 등록일 이전 과제는 제외 (날짜 단위로 비교 — 등록 당일 과제는 포함)
  const joinDay = approvedAt ? approvedAt.slice(0, 10) : null;
  const list = joinDay
    ? all.filter((a) => a.created_at.slice(0, 10) >= joinDay)
    : all;
  const beforeJoinCount = all.length - list.length;
  const joinedThisMonth =
    !!joinDay && joinDay >= start && joinDay < endExclusive;

  const ids = list.map((a) => a.id);

  let subs: {
    assignment_id: string;
    overall_score: number | null;
    status: string;
    azure_scores: AzureScores | null;
    created_at: string;
  }[] = [];
  if (ids.length) {
    const { data } = await db
      .from("submissions")
      .select("assignment_id, overall_score, status, azure_scores, created_at")
      .eq("student_id", studentId)
      .in("assignment_id", ids);
    subs = (data ?? []) as typeof subs;
  }
  const subByAssignment = new Map(subs.map((s) => [s.assignment_id, s]));

  const items: MonthlyItem[] = list.map((a) => {
    const s = subByAssignment.get(a.id);
    const evaluated = s && s.status === "evaluated" && s.overall_score != null;
    return {
      title: a.title,
      date: a.created_at.slice(0, 10),
      submitted: !!s,
      score: evaluated ? Math.round(Number(s!.overall_score)) : null,
    };
  });

  const scored = subs
    .filter((s) => s.status === "evaluated" && s.overall_score != null)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((s) => Number(s.overall_score));

  const avg = scored.length
    ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length)
    : null;
  const firstScore = scored.length ? Math.round(scored[0]) : null;
  const lastScore = scored.length ? Math.round(scored[scored.length - 1]) : null;
  const growth =
    firstScore != null && lastScore != null ? lastScore - firstScore : null;

  // 취약 단어 집계
  const wordCount = new Map<string, number>();
  subs.forEach((s) => {
    (s.azure_scores?.words ?? []).forEach((w) => {
      if (w.errorType && w.errorType !== "None") {
        wordCount.set(w.word, (wordCount.get(w.word) ?? 0) + 1);
      }
    });
  });
  const weakWords = Array.from(wordCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w);

  return {
    assigned: list.length,
    submitted: subs.length,
    rate: list.length ? Math.round((subs.length / list.length) * 100) : 0,
    avg,
    firstScore,
    lastScore,
    growth,
    items,
    weakWords,
    approvedAt: joinDay,
    joinedThisMonth,
    beforeJoinCount,
  };
}
