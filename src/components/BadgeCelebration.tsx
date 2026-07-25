"use client";

import { useEffect, useState } from "react";
import { markBadgesSeen } from "@/app/student/actions";

type NewBadge = { key: string; emoji: string; label: string };

// 새로 획득한 배지가 있으면 축하 오버레이를 띄우고, 본 배지로 기록한다.
export default function BadgeCelebration({ badges }: { badges: NewBadge[] }) {
  const [open, setOpen] = useState(badges.length > 0);

  useEffect(() => {
    if (badges.length === 0) return;
    // 축하는 한 번만 — 서버에 '본 배지'로 기록
    markBadgesSeen(badges.map((b) => b.key)).catch(() => {});
  }, [badges]);

  if (!open || badges.length === 0) return null;

  // 색종이(간단 CSS confetti)
  const confetti = Array.from({ length: 24 });
  const colors = ["#3b82f6", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899"];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
      onClick={() => setOpen(false)}
    >
      {/* confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {confetti.map((_, i) => (
          <span
            key={i}
            className="badge-confetti absolute top-0 block h-2.5 w-2.5 rounded-sm"
            style={{
              left: `${(i * 100) / confetti.length}%`,
              backgroundColor: colors[i % colors.length],
              animationDelay: `${(i % 8) * 0.15}s`,
              animationDuration: `${1.8 + (i % 5) * 0.25}s`,
            }}
          />
        ))}
      </div>

      <div
        className="badge-pop relative w-full max-w-xs rounded-3xl bg-white p-7 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-bold text-brand">🎊 축하해요! 🎊</div>
        <p className="mt-1 text-xs text-slate-500">새로운 배지를 획득했어요</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          {badges.map((b) => (
            <div key={b.key} className="flex flex-col items-center">
              <div className="badge-bounce flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-3xl shadow-md">
                {b.emoji}
              </div>
              <span className="mt-1.5 text-xs font-semibold text-slate-700">
                {b.label}
              </span>
            </div>
          ))}
        </div>

        <button
          onClick={() => setOpen(false)}
          className="mt-6 w-full rounded-xl bg-brand py-2.5 text-sm font-semibold text-white transition hover:bg-brand-dark"
        >
          좋아요! 🙌
        </button>
      </div>

      <style jsx>{`
        @keyframes badgeConfettiFall {
          0% {
            transform: translateY(-10vh) rotate(0deg);
            opacity: 1;
          }
          100% {
            transform: translateY(110vh) rotate(540deg);
            opacity: 0.9;
          }
        }
        .badge-confetti {
          animation-name: badgeConfettiFall;
          animation-timing-function: linear;
          animation-iteration-count: 1;
        }
        @keyframes badgePop {
          0% {
            transform: scale(0.7);
            opacity: 0;
          }
          60% {
            transform: scale(1.05);
            opacity: 1;
          }
          100% {
            transform: scale(1);
          }
        }
        .badge-pop {
          animation: badgePop 0.4s ease-out;
        }
        @keyframes badgeBounce {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .badge-bounce {
          animation: badgeBounce 1s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
