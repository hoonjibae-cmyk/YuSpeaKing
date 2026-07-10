"use client";

import { useFormStatus } from "react-dom";

// 서버 액션 폼용 제출 버튼: 처리 중에는 비활성화 + 로딩 문구 표시(중복 제출 방지)
export default function SubmitButton({
  children,
  pendingText = "처리 중…",
  className = "",
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={`${className} ${
        pending ? "cursor-not-allowed opacity-70" : ""
      }`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
