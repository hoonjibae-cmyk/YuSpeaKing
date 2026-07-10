// 목동유쌤영어 로고.
// NOTE: 정확한 원본 로고 이미지를 쓰려면 public/logo.png 로 업로드한 뒤
// 아래 CrownMark 대신 <img src="/logo.png" .../> 로 교체하면 됩니다.

export function CrownMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 100"
      role="img"
      aria-label="목동유쌤영어"
      className={className}
    >
      <defs>
        <linearGradient id="crown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b6bb8" />
          <stop offset="1" stopColor="#1e3a75" />
        </linearGradient>
      </defs>
      {/* 왕관: 4개의 뾰족한 첨탑 + 아래 곡선 밑변 */}
      <path
        fill="url(#crown)"
        d="M8 84
           C8 84 6 40 30 40
           L38 8 L52 40
           C52 40 54 30 60 30
           C66 30 68 40 68 40
           L82 8 L90 40
           C114 40 112 84 112 84
           C90 96 30 96 8 84 Z"
      />
      {/* 첨탑 끝 장식 점 */}
      <g fill="#1e3a75">
        <circle cx="38" cy="6" r="3" />
        <circle cx="82" cy="6" r="3" />
        <circle cx="60" cy="28" r="3" />
      </g>
      {/* 가운데 진자(추) — 로고 포인트 */}
      <g stroke="#ffffff" strokeWidth="3" fill="#ffffff">
        <line x1="60" y1="46" x2="60" y2="66" />
        <circle cx="60" cy="70" r="6" />
      </g>
      {/* 좌우 원형 홈 */}
      <circle cx="34" cy="66" r="5" fill="#ffffff" opacity="0.85" />
      <circle cx="86" cy="66" r="5" fill="#ffffff" opacity="0.85" />
    </svg>
  );
}

// 마크 + 워드마크 세로 로고
export function Logo({
  size = "md",
  withText = true,
}: {
  size?: "sm" | "md" | "lg";
  withText?: boolean;
}) {
  const markSize =
    size === "lg" ? "h-16 w-16" : size === "sm" ? "h-6 w-6" : "h-10 w-10";
  const textSize =
    size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-lg";
  return (
    <span className="inline-flex items-center gap-2">
      <CrownMark className={markSize} />
      {withText && (
        <span className={`font-extrabold tracking-tight text-[#1e3a75] ${textSize}`}>
          목동유쌤영어
        </span>
      )}
    </span>
  );
}
