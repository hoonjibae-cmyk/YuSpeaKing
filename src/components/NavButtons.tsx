"use client";

import { useRouter, usePathname } from "next/navigation";

// 모든 화면 공통 뒤로가기 / 새로고침 버튼 (좌하단 고정). 랜딩(/)에서는 숨김.
export default function NavButtons() {
  const router = useRouter();
  const pathname = usePathname();
  if (pathname === "/") return null;

  const btn =
    "flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/90 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-brand active:scale-95";

  return (
    <div className="fixed bottom-3 left-3 z-40 flex gap-1.5 pb-[env(safe-area-inset-bottom)]">
      <button
        type="button"
        onClick={() => router.back()}
        aria-label="뒤로 가기"
        title="뒤로 가기"
        className={btn}
      >
        <span className="text-lg leading-none">←</span>
      </button>
      <button
        type="button"
        onClick={() => router.refresh()}
        aria-label="새로고침"
        title="새로고침"
        className={btn}
      >
        <span className="text-base leading-none">⟳</span>
      </button>
    </div>
  );
}
