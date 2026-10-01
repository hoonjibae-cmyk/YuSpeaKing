import type { MonthlyItem } from "@/lib/monthly";

// 월말 리포트에 넣는 그 달의 점수 흐름.
// 학부모가 보는 화면이라 조작 요소 없이 그림만 그린다(서버 렌더).
export default function MonthlyTrend({ items }: { items: MonthlyItem[] }) {
  const scored = items.filter(
    (i): i is MonthlyItem & { score: number } => i.score != null
  );
  if (scored.length === 0) return null;

  const W = 640;
  const H = 210;
  const PAD_L = 34;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 42;

  const n = scored.length;
  // 한 점뿐이면 가운데에 찍는다
  const x = (i: number) =>
    n === 1
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L + (i * (W - PAD_L - PAD_R)) / (n - 1);
  const y = (s: number) => H - PAD_B - (s / 100) * (H - PAD_T - PAD_B);

  const path = scored
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i)} ${y(p.score)}`)
    .join(" ");

  const avg = Math.round(scored.reduce((a, p) => a + p.score, 0) / n);

  return (
    <figure className="rounded-xl border border-slate-200 bg-white p-4">
      <figcaption className="mb-2 text-sm font-semibold text-slate-700">
        이번 달 점수 흐름
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {[0, 50, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              y1={y(g)}
              x2={W - PAD_R}
              y2={y(g)}
              stroke="#e9effb"
              strokeWidth="1"
            />
            <text x={6} y={y(g) + 3.5} fontSize="10" fill="#94a3b8">
              {g}
            </text>
          </g>
        ))}

        {/* 평균선 */}
        <line
          x1={PAD_L}
          y1={y(avg)}
          x2={W - PAD_R}
          y2={y(avg)}
          stroke="#94a3b8"
          strokeWidth="1"
          strokeDasharray="5 4"
        />
        <text x={W - PAD_R} y={y(avg) - 5} fontSize="10" fill="#94a3b8" textAnchor="end">
          평균 {avg}
        </text>

        {n > 1 && (
          <path
            d={path}
            fill="none"
            stroke="#2b52a0"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {scored.map((p, i) => (
          <g key={i}>
            <circle cx={x(i)} cy={y(p.score)} r="4" fill="#1e3a75" />
            <text
              x={x(i)}
              y={y(p.score) - 10}
              fontSize="11"
              fill="#1e3a75"
              fontWeight="600"
              textAnchor="middle"
            >
              {p.score}
            </text>
            <text
              x={x(i)}
              y={H - 24}
              fontSize="9.5"
              fill="#94a3b8"
              textAnchor="middle"
            >
              {Number(p.date.slice(5, 7))}/{Number(p.date.slice(8, 10))}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-slate-400">
        채점이 끝난 제출만 날짜순으로 표시했습니다.
      </p>
    </figure>
  );
}
