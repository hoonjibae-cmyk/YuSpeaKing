"use client";

import { useState } from "react";

// 지정한 textarea(id)의 현재 내용을 클립보드로 복사
export default function CopyButton({
  targetId,
  className = "",
}: {
  targetId: string;
  className?: string;
}) {
  const [done, setDone] = useState(false);
  async function copy() {
    const el = document.getElementById(targetId) as HTMLTextAreaElement | null;
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.value);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      el.select();
      document.execCommand("copy");
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }
  }
  return (
    <button type="button" onClick={copy} className={className}>
      {done ? "복사됨 ✓" : "복사하기"}
    </button>
  );
}
