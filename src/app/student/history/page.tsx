import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";

type SubRow = {
  id: string;
  overall_score: number | null;
  status: string;
  student_feedback: string | null;
  audio_path: string | null;
  audio_expired: boolean;
  created_at: string;
  assignment_id: string;
  assignments: { title: string } | { title: string }[] | null;
};

function assignmentTitle(row: SubRow): string {
  const a = row.assignments;
  if (!a) return "과제";
  return Array.isArray(a) ? a[0]?.title ?? "과제" : a.title;
}

// 점수 추이 SVG 라인 차트
function ScoreTrend({ points }: { points: { score: number; label: string }[] }) {
  if (points.length < 2) return null;
  const W = 320;
  const H = 140;
  const pad = 24;
  const n = points.length;
  const x = (i: number) => pad + (i * (W - pad * 2)) / (n - 1);
  const y = (s: number) => H - pad - (s / 100) * (H - pad * 2);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.score)}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 격자선 */}
      {[0, 25, 50, 75, 100].map((g) => (
        <g key={g}>
          <line x1={pad} y1={y(g)} x2={W - pad} y2={y(g)} stroke="#eef2ff" strokeWidth="1" />
          <text x={4} y={y(g) + 3} fontSize="8" fill="#94a3b8">
            {g}
          </text>
        </g>
      ))}
      {/* 라인 */}
      <path d={path} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* 점 + 점수 */}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.score)} r="3.5" fill="#4f46e5" />
          <text x={x(i)} y={y(p.score) - 7} fontSize="8" fill="#4f46e5" textAnchor="middle">
            {p.score}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function StudentHistoryPage() {
  const session = await requireStudent();
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("submissions")
    .select(
      "id, overall_score, status, student_feedback, audio_path, audio_expired, created_at, assignment_id, assignments(title)"
    )
    .eq("student_id", session.studentId)
    .order("created_at", { ascending: true });

  const subs = (rows ?? []) as SubRow[];
  const evaluated = subs.filter(
    (s) => s.status === "evaluated" && s.overall_score != null
  );
  const trend = evaluated.map((s) => ({
    score: Math.round(Number(s.overall_score)),
    label: s.created_at.slice(0, 10),
  }));
  const avg = evaluated.length
    ? Math.round(trend.reduce((a, b) => a + b.score, 0) / trend.length)
    : null;

  // 오디오 서명 URL (비공개 버킷)
  const signed = new Map<string, string>();
  await Promise.all(
    subs
      .filter((s) => s.audio_path && !s.audio_expired)
      .map(async (s) => {
        const { data } = await admin.storage
          .from("submissions")
          .createSignedUrl(s.audio_path as string, 60 * 60);
        if (data?.signedUrl) signed.set(s.id, data.signedUrl);
      })
  );

  const display = [...subs].reverse(); // 최신순

  return (
    <main className="mx-auto max-w-lg px-6 py-8">
      <Link href="/student/home" className="text-sm text-slate-500 hover:underline">
        ← 오늘의 스피킹
      </Link>
      <h1 className="mt-3 text-xl font-bold text-brand">나의 스피킹 기록</h1>
      <p className="text-sm text-slate-500">
        {session.number}번 {session.name} · 총 {subs.length}회 제출
      </p>

      {/* 점수 추이 */}
      {trend.length >= 2 ? (
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-600">점수 변화 📈</h2>
            {avg != null && (
              <span className="text-sm text-slate-500">
                평균 <b className="text-brand">{avg}점</b>
              </span>
            )}
          </div>
          <div className="mt-2">
            <ScoreTrend points={trend} />
          </div>
        </section>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
          2회 이상 평가받으면 점수 변화 그래프가 나와요 🙂
        </p>
      )}

      {/* 제출 목록 */}
      <section className="mt-6 space-y-3">
        {display.map((s) => (
          <div key={s.id} className="rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{assignmentTitle(s)}</div>
                <div className="text-xs text-slate-400">
                  {s.created_at.slice(0, 10).replace(/-/g, ".")}
                </div>
              </div>
              {s.status === "evaluated" && s.overall_score != null ? (
                <span className="text-lg font-bold text-brand">
                  {Math.round(Number(s.overall_score))}점
                </span>
              ) : (
                <span className="text-xs text-slate-400">
                  {s.status === "error" ? "평가 오류" : "채점 중"}
                </span>
              )}
            </div>

            {(signed.get(s.id) || s.student_feedback) && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-brand">
                  다시 듣기 · 피드백 보기
                </summary>
                <div className="mt-2 space-y-2">
                  {signed.get(s.id) ? (
                    <audio src={signed.get(s.id)} controls className="w-full" />
                  ) : (
                    <p className="text-xs text-slate-400">
                      음원 보관기간이 지나 다시 들을 수 없어요. (점수는 계속 남아요)
                    </p>
                  )}
                  {s.student_feedback && (
                    <p className="whitespace-pre-wrap rounded-lg bg-brand-light p-3 text-sm text-slate-700">
                      {s.student_feedback}
                    </p>
                  )}
                </div>
              </details>
            )}
          </div>
        ))}
        {subs.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
            아직 제출한 과제가 없어요.
          </p>
        )}
      </section>
    </main>
  );
}
