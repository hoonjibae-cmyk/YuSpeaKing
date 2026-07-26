import Image from "next/image";

// 목동유쌤영어 마스코트 (파란 왕관 캐릭터) — 쿠폰함 등 게임화 UI용.
// 원본 이미지는 public/mascots/ 에 있고, 배포 시 자동으로 크기·포맷이 최적화된다.
const MASCOT_FILES = [
  { src: "/mascots/1.png", alt: "병아리 마스코트", width: 512, height: 331 },
  { src: "/mascots/2.png", alt: "흰곰 마스코트", width: 512, height: 595 },
  { src: "/mascots/3.png", alt: "강아지 마스코트", width: 512, height: 488 },
  { src: "/mascots/4.png", alt: "토끼 마스코트", width: 512, height: 596 },
  { src: "/mascots/5.png", alt: "햄스터 마스코트", width: 512, height: 594 },
];

export const MASCOT_COUNT = MASCOT_FILES.length;

// 순서대로 다른 마스코트를 보여준다 (쿠폰을 모으는 재미)
export function Mascot({
  index = 0,
  className = "",
}: {
  index?: number;
  className?: string;
}) {
  const m =
    MASCOT_FILES[((index % MASCOT_COUNT) + MASCOT_COUNT) % MASCOT_COUNT];
  return (
    <Image
      src={m.src}
      alt={m.alt}
      width={m.width}
      height={m.height}
      sizes="120px"
      className={`object-contain ${className}`}
    />
  );
}
