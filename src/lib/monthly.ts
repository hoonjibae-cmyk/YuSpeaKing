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

export interface WeakWord {
  word: string;
  times: number; // 틀린 횟수
  avgAccuracy: number; // 그 단어를 읽었을 때의 평균 정확도
  mostly: "발음" | "누락"; // 주로 발음이 틀린 쪽인지, 아예 빠뜨린 쪽인지
}

// 점수 말고 '어떻게 읽는 학생인가'를 보여 주는 값들.
// 월말 리포트가 숫자를 되풀이하지 않고 읽기의 특징을 쓰도록 하기 위한 재료다.
export interface SpeakingProfile {
  accuracy: number | null; // 읽은 단어의 발음 정확도
  fluency: number | null; // 끊김 없이 이어 읽는 정도
  completeness: number | null; // 지문을 끝까지 읽는 정도
  prosody: number | null; // 높낮이·리듬
  totalWords: number; // 평가된 전체 단어 수
  mispronounced: number; // 그중 발음이 틀린 단어 수
  omitted: number; // 그중 빠뜨린 단어 수
  lowCompletenessCount: number; // 끝까지 읽지 못한 제출 수 (완성도 90 미만)
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
  weakWords: string[]; // 자주 틀린 단어 top (화면 표시용)
  weakDetail: WeakWord[]; // 리포트용 상세
  profile: SpeakingProfile;
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

  // 단어 단위 집계 — 어떤 단어를, 어떻게 틀렸는지
  type Acc = { times: number; accSum: number; accN: number; mis: number; om: number };
  const bag = new Map<string, Acc>();
  let totalWords = 0;
  let mispronounced = 0;
  let omitted = 0;

  subs.forEach((s) => {
    (s.azure_scores?.words ?? []).forEach((w) => {
      totalWords++;
      const bad = w.errorType && w.errorType !== "None";
      if (w.errorType === "Omission") omitted++;
      else if (w.errorType === "Mispronunciation") mispronounced++;
      if (!bad) return;
      // the/The 를 다른 단어로 세지 않는다
      const key = w.word.toLowerCase();
      const cur = bag.get(key) ?? { times: 0, accSum: 0, accN: 0, mis: 0, om: 0 };
      cur.times++;
      if (w.errorType === "Omission") cur.om++;
      else {
        cur.mis++;
        cur.accSum += Number(w.accuracy) || 0;
        cur.accN++;
      }
      bag.set(key, cur);
    });
  });

  const weakDetail: WeakWord[] = Array.from(bag.entries())
    .sort((a, b) => b[1].times - a[1].times)
    .slice(0, 10)
    .map(([word, v]) => ({
      word,
      times: v.times,
      avgAccuracy: v.accN ? Math.round(v.accSum / v.accN) : 0,
      mostly: v.om > v.mis ? ("누락" as const) : ("발음" as const),
    }));
  const weakWords = weakDetail.map((w) => w.word).slice(0, 8);

  // 세부 점수 평균 (채점이 끝난 제출만)
  const evaluated = subs.filter(
    (s) => s.status === "evaluated" && s.azure_scores != null
  );
  const mean = (pick: (a: AzureScores) => number | undefined) => {
    const vals = evaluated
      .map((s) => pick(s.azure_scores as AzureScores))
      .filter((v): v is number => typeof v === "number");
    return vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : null;
  };

  const profile: SpeakingProfile = {
    accuracy: mean((a) => a.accuracy),
    fluency: mean((a) => a.fluency),
    completeness: mean((a) => a.completeness),
    prosody: mean((a) => a.prosody),
    totalWords,
    mispronounced,
    omitted,
    lowCompletenessCount: evaluated.filter(
      (s) => (s.azure_scores as AzureScores).completeness < 90
    ).length,
  };

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
    weakDetail,
    profile,
    approvedAt: joinDay,
    joinedThisMonth,
    beforeJoinCount,
  };
}
