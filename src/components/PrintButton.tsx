"use client";

export default function PrintButton({
  className = "",
  children = "🖨 인쇄 / PDF 저장",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={() => window.print()} className={className}>
      {children}
    </button>
  );
}
