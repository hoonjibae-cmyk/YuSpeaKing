import Image from "next/image";

// 목동유쌤영어 실제 로고 (public/logo.png · 왕관 + 워드마크 포함)
const LOGO_W = 312;
const LOGO_H = 276;

// 작은 포인트용 로고 (헤더 등)
export function CrownMark({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/logo.png"
      alt="목동유쌤영어"
      width={LOGO_W}
      height={LOGO_H}
      className={`object-contain ${className}`}
    />
  );
}

// 메인 로고 (랜딩·로그인 등)
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const h = size === "lg" ? "h-24" : size === "sm" ? "h-8" : "h-14";
  return (
    <Image
      src="/logo.png"
      alt="목동유쌤영어"
      width={LOGO_W}
      height={LOGO_H}
      priority
      className={`${h} w-auto`}
    />
  );
}
