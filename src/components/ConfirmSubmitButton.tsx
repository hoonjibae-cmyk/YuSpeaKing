"use client";

// 서버 액션 폼용 제출 버튼: 클릭 시 확인창을 띄우고, 취소하면 제출을 막는다.
export default function ConfirmSubmitButton({
  message,
  className = "",
  children,
}: {
  message: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
