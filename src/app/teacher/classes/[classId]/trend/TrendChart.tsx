"use client";

import { useState } from "react";

export interface TrendPoint {
  d: string; // YYYY-MM-DD
  score: number;
}

export interface TrendSeries {
  id: string;
  name: string;
  number: number | null;
  points: TrendPoint[];
  avg: number;
  change: number | null; // 첫 점수 → 마지막 점수 변화
}

// 학생별 선 색 (반 평균은 브랜드색으로 따로 그린다)
const COLORS = [
  "#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6",
  "#ec4899", "#84cc16", "#f97316", "#14b8a6", "#6366f1",
  "#d946ef", "#0ea5e9", "#a3a3a3", "#dc2626", "#7c3aed",
];

const W = 680;
const H = 260;
const PAD_L = 30;
const PAD_R = 14;
const PAD_T = 14;
const PAD_B = 28;

function fmtDate(d: string) {
  return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

export default function TrendChart({
  series,
  classAvg,
  from,
  to,
}: {
  series: TrendSeries[];
  classAvg: TrendPoint[];
  from: string;
  to: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);

  const t0 = Date.parse(`${from}T00:00:00Z`);
  const t1 = Date.parse(`${to}T00:00:00Z`);
  const span = t1 - t0;

  // 기간이 하루뿐이면 가운데에 찍는다 (0으로 나누기 방지)
  const x = (d: string) =>
    span <= 0
      ? PAD_L + (W - PAD_L - PAD_R) / 2
      : PAD_L +
        ((Date.parse(`${d}T00:00:00Z`) - t0) / span) * (W - PAD_L - PAD_R);
  const y = (s: number) => H - PAD_B - (s / 100) * (H - PAD_T - PAD_B);

  const line = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.d)} ${y(p.score)}`).join(" ");

  // x축 눈금 5개
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const t = t0 + (span * i) / 4;
    return new Date(t).toISOString().slice(0, 10);
  });

  const hasAny = series.some((s) => s.points.length > 0);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* 가로 격자 */}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line
              x1={PAD_L}
              y1={y(g)}
              x2={W - PAD_R}
              y2={y(g)}
              stroke="#e9effb"
              strokeWidth="1"
            />
            <text x={4} y={y(g) + 3.5} fontSize="9" fill="#94a3b8">
              {g}
            </text>
          </g>
        ))}

        {/* x축 날짜 */}
        {ticks.map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 8}
            fontSize="9"
            fill="#94a3b8"
            textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"}
          >
            {fmtDate(t)}
          </text>
        ))}

        {/* 학생별 선 */}
        {series.map((s, i) => {
          if (s.points.length === 0) return null;
          const on = picked === null || picked === s.id;
          const color = COLORS[i % COLORS.length];
          return (
            <g key={s.id} opacity={on ? 1 : 0.12}>
              {s.points.length > 1 && (
                <path
                  d={line(s.points)}
                  fill="none"
                  stroke={color}
                  strokeWidth={picked === s.id ? 2.8 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {(picked === s.id || s.points.length === 1) &&
                s.points.map((p, j) => (
                  <circle
                    key={j}
                    cx={x(p.d)}
                    cy={y(p.score)}
                    r={picked === s.id ? 3.4 : 2.4}
                    fill={color}
                  />
                ))}
            </g>
          );
        })}

        {/* 반 평균 (굵게) */}
        {classAvg.length > 1 && (
          <path
            d={line(classAvg)}
            fill="none"
            stroke="#2b52a0"
            strokeWidth={picked === null ? 3.2 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="6 4"
            opacity={picked === null ? 1 : 0.35}
          />
        )}

        {!hasAny && (
          <text
            x={W / 2}
            y={H / 2}
            fontSize="12"
            fill="#94a3b8"
            textAnchor="middle"
          >
            이 기간에 채점된 제출이 없어요
          </text>
        )}
      </svg>

      <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-5 border-t-2 border-dashed border-brand" />
          반 평균
        </span>
        <span>학생 이름을 누르면 그 학생만 선명하게 보여요</span>
      </div>

      {/* 학생 목록 — 누르면 해당 선만 강조 */}
      <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {series.map((s, i) => {
          const color = COLORS[i % COLORS.length];
          const on = picked === s.id;
          const last = s.points[s.points.length - 1];
          return (
            <li key={s.id}>
              <button
                onClick={() => setPicked(on ? null : s.id)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left transition ${
                  on ? "bg-brand-light" : "hover:bg-slate-50"
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span className="w-7 shrink-0 text-xs text-slate-400">
                  {s.number ?? "-"}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                {s.points.length === 0 ? (
                  <span className="text-xs text-slate-300">제출 없음</span>
                ) : (
                  <>
                    <span className="shrink-0 text-xs text-slate-400">
                      {s.points.length}회 · 평균 {s.avg}
                    </span>
                    <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-700">
                      {last.score}
                    </span>
                    <span
                      className={`w-11 shrink-0 text-right text-xs tabular-nums ${
                        s.change == null
                          ? "text-slate-300"
                          : s.change > 0
                            ? "text-green-600"
                            : s.change < 0
                              ? "text-red-500"
                              : "text-slate-400"
                      }`}
                    >
                      {s.change == null
                        ? "—"
                        : s.change > 0
                          ? `▲${s.change}`
                          : s.change < 0
                            ? `▼${Math.abs(s.change)}`
                            : "—"}
                    </span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
