// 목동유쌤영어 마스코트 (파란 왕관 캐릭터) — 쿠폰함 등 게임화 UI용 아이콘.
// 작은 크기(40~90px)에서도 또렷하게 보이도록 단순한 벡터로 그렸다.

const CROWN = "#1668CC";

// 캐릭터 머리 위에 얹는 파란 왕관
function Crown({ transform }: { transform?: string }) {
  return (
    <g transform={transform}>
      <path
        d="M30 27 L30 12 L40 20 L50 7 L60 20 L70 12 L70 27 Z"
        fill={CROWN}
      />
      <rect x="29" y="25" width="42" height="8" rx="4" fill={CROWN} />
      <circle cx="30" cy="10" r="4.2" fill={CROWN} />
      <circle cx="50" cy="6" r="4.6" fill={CROWN} />
      <circle cx="70" cy="10" r="4.2" fill={CROWN} />
      <circle cx="50" cy="21" r="2.8" fill="#fff" />
    </g>
  );
}

// 공통 눈 (검은 타원 + 하이라이트)
function Eyes({ cy, dx = 13, rx = 5, ry = 6.4 }: { cy: number; dx?: number; rx?: number; ry?: number }) {
  return (
    <>
      <ellipse cx={50 - dx} cy={cy} rx={rx} ry={ry} fill="#191818" />
      <ellipse cx={50 + dx} cy={cy} rx={rx} ry={ry} fill="#191818" />
      <circle cx={50 - dx + 1.7} cy={cy - 2.4} r="1.5" fill="#fff" opacity="0.9" />
      <circle cx={50 + dx + 1.7} cy={cy - 2.4} r="1.5" fill="#fff" opacity="0.9" />
    </>
  );
}

type Props = { className?: string };
const BOX = "0 0 100 100";

// 1. 병아리
function Chick({ className }: Props) {
  return (
    <svg viewBox={BOX} className={className} aria-hidden>
      <rect x="13" y="33" width="74" height="60" rx="29" fill="#FFD22E" />
      <circle cx="23" cy="73" r="7.5" fill="#F7B500" opacity="0.5" />
      <circle cx="77" cy="73" r="7.5" fill="#F7B500" opacity="0.5" />
      <path d="M31 50 Q37 45 43 49" stroke="#2A2622" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M57 49 Q63 45 69 50" stroke="#2A2622" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Eyes cy={62} />
      <path d="M38 73 Q50 71 62 73 Q60 85 50 85 Q40 85 38 73 Z" fill="#D9480F" />
      <path d="M33 71 Q50 61 67 71 Q50 78 33 71 Z" fill="#F79B1E" />
      <Crown />
    </svg>
  );
}

// 2. 흰곰
function Bear({ className }: Props) {
  return (
    <svg viewBox={BOX} className={className} aria-hidden>
      <circle cx="24" cy="45" r="11.5" fill="#F2EADA" />
      <circle cx="76" cy="45" r="11.5" fill="#F2EADA" />
      <rect x="15" y="38" width="70" height="55" rx="27" fill="#FAF4E7" />
      <ellipse cx="25" cy="74" rx="7.5" ry="5.5" fill="#F5B49C" opacity="0.6" />
      <ellipse cx="75" cy="74" rx="7.5" ry="5.5" fill="#F5B49C" opacity="0.6" />
      <path d="M32 56 Q38 51 44 55" stroke="#6B4A2F" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M56 55 Q62 51 68 56" stroke="#6B4A2F" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <Eyes cy={67} dx={12} />
      <ellipse cx="50" cy="76" rx="6.2" ry="4.8" fill="#191818" />
      <path d="M37 82 Q50 97 63 82 Z" fill="#C2410C" />
      <Crown />
    </svg>
  );
}

// 3. 강아지
function Dog({ className }: Props) {
  return (
    <svg viewBox={BOX} className={className} aria-hidden>
      <ellipse cx="18" cy="68" rx="11" ry="23" fill="#C4863C" />
      <ellipse cx="82" cy="68" rx="11" ry="23" fill="#C4863C" />
      <rect x="21" y="37" width="58" height="55" rx="25" fill="#D3954A" />
      <path d="M42 38 h16 v26 a8 8 0 0 1 -16 0 Z" fill="#F5E6CB" />
      <ellipse cx="50" cy="76" rx="19" ry="14" fill="#F5E6CB" />
      <ellipse cx="26" cy="74" rx="7" ry="5" fill="#E98C6A" opacity="0.5" />
      <ellipse cx="74" cy="74" rx="7" ry="5" fill="#E98C6A" opacity="0.5" />
      <path d="M32 55 Q38 51 44 55" stroke="#8A5A24" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M56 55 Q62 51 68 55" stroke="#8A5A24" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <Eyes cy={64} dx={13} rx={4.6} ry={5.8} />
      <ellipse cx="50" cy="72" rx="6" ry="4.6" fill="#191818" />
      <path d="M38 80 Q44 87 50 80 Q56 87 62 80" stroke="#2A2622" strokeWidth="2.8" fill="none" strokeLinecap="round" />
      <Crown />
    </svg>
  );
}

// 4. 토끼
function Rabbit({ className }: Props) {
  return (
    <svg viewBox={BOX} className={className} aria-hidden>
      <ellipse cx="34" cy="26" rx="9" ry="24" fill="#F0917C" />
      <ellipse cx="34" cy="27" rx="4.2" ry="17" fill="#FBEBDD" />
      <ellipse cx="66" cy="26" rx="9" ry="24" fill="#F0917C" />
      <ellipse cx="66" cy="27" rx="4.2" ry="17" fill="#FBEBDD" />
      <rect x="18" y="44" width="64" height="49" rx="24" fill="#F0917C" />
      <ellipse cx="50" cy="74" rx="25" ry="19" fill="#FBF1E4" />
      <ellipse cx="29" cy="79" rx="6.5" ry="5" fill="#F0917C" opacity="0.45" />
      <ellipse cx="71" cy="79" rx="6.5" ry="5" fill="#F0917C" opacity="0.45" />
      <Eyes cy={71} dx={12} rx={4.8} ry={6} />
      <ellipse cx="50" cy="79" rx="3.6" ry="2.8" fill="#F0917C" />
      <path d="M43 85 Q50 92 57 85 Q50 89 43 85 Z" fill="#D9694F" />
      <Crown transform="translate(24 32) scale(0.62)" />
    </svg>
  );
}

// 5. 햄스터
function Hamster({ className }: Props) {
  return (
    <svg viewBox={BOX} className={className} aria-hidden>
      <circle cx="26" cy="45" r="8.5" fill="#EFA531" />
      <circle cx="74" cy="45" r="8.5" fill="#EFA531" />
      <rect x="16" y="39" width="68" height="54" rx="26" fill="#F5B942" />
      <ellipse cx="50" cy="77" rx="21" ry="15" fill="#FBE6B6" />
      <ellipse cx="24" cy="72" rx="7" ry="5" fill="#E98C4A" opacity="0.4" />
      <ellipse cx="76" cy="72" rx="7" ry="5" fill="#E98C4A" opacity="0.4" />
      <Eyes cy={64} dx={14} rx={5.4} ry={6.6} />
      <ellipse cx="50" cy="72" rx="4.4" ry="3.4" fill="#F0803C" />
      <path d="M50 75 Q44 80 40 76" stroke="#B4762A" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M50 75 Q56 80 60 76" stroke="#B4762A" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M44 79 Q50 88 56 79 Z" fill="#E8613C" />
      <Crown />
    </svg>
  );
}

export const MASCOTS = [Chick, Bear, Dog, Rabbit, Hamster];

// 순서대로 다른 마스코트를 보여준다 (쿠폰을 모으는 재미)
export function Mascot({
  index = 0,
  className = "",
}: {
  index?: number;
  className?: string;
}) {
  const C = MASCOTS[((index % MASCOTS.length) + MASCOTS.length) % MASCOTS.length];
  return <C className={className} />;
}
