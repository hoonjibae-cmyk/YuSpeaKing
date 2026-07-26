import Link from "next/link";
import { CrownMark } from "./Logo";
import PrintButton from "./PrintButton";
import { APP_VERSION, APP_VERSION_DATE } from "@/lib/version";

// 유저 매뉴얼 공용 레이아웃 (화면 열람 + A4 인쇄/PDF 저장 겸용)
export function ManualShell({
  title,
  subtitle,
  otherHref,
  otherLabel,
  children,
}: {
  title: string;
  subtitle: string;
  otherHref: string;
  otherLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 py-6 print:bg-white print:py-0">
      {/* 툴바 (인쇄 제외) */}
      <div className="no-print mx-auto mb-4 flex max-w-[210mm] flex-wrap items-center justify-between gap-2 px-4">
        <Link href="/" className="text-sm text-slate-500 hover:underline">
          ← 유스피킹 홈
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={otherHref}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            {otherLabel}
          </Link>
          <PrintButton className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark" />
        </div>
      </div>

      {/* A4 시트 */}
      <article className="mx-auto w-full max-w-[210mm] bg-white p-[14mm] text-slate-800 shadow-lg print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-end justify-between border-b-2 border-brand pb-3">
          <div className="flex items-center gap-3">
            <CrownMark className="h-12 w-12" />
            <div>
              <h1 className="text-xl font-bold text-brand">{title}</h1>
              <p className="text-xs text-slate-500">{subtitle}</p>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-400">
            <div>목동유쌤영어 · 유스피킹</div>
            <div>
              v{APP_VERSION} · {APP_VERSION_DATE}
            </div>
          </div>
        </header>

        {children}

        <footer className="mt-8 border-t border-slate-200 pt-2 text-[11px] text-slate-400">
          궁금한 점은 담당 선생님께 문의해 주세요. · 목동유쌤영어 유스피킹
        </footer>
      </article>
    </div>
  );
}

// 큰 단원
export function Section({
  no,
  title,
  children,
}: {
  no: number | string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="flex items-center gap-2 rounded-lg bg-brand-light px-3 py-2 text-base font-bold text-brand">
        <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-xs text-white">
          {no}
        </span>
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed">
        {children}
      </div>
    </section>
  );
}

// 순서가 있는 단계
export function Step({
  no,
  title,
  children,
}: {
  no: number;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="print-avoid-break flex gap-3">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-brand text-[11px] font-bold text-brand">
        {no}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-slate-800">{title}</div>
        {children && <div className="mt-0.5 text-slate-600">{children}</div>}
      </div>
    </div>
  );
}

export function Tip({ children }: { children: React.ReactNode }) {
  return (
    <p className="print-avoid-break rounded-lg border-l-4 border-green-400 bg-green-50 px-3 py-2 text-[13px] text-green-800">
      💡 {children}
    </p>
  );
}

export function Warn({ children }: { children: React.ReactNode }) {
  return (
    <p className="print-avoid-break rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
      ⚠️ {children}
    </p>
  );
}

// 표
export function Table({
  head,
  rows,
}: {
  head: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <table className="print-avoid-break w-full border-collapse text-[13px]">
      <thead>
        <tr className="border-y border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
          {head.map((h, i) => (
            <th key={i} className="px-2 py-1.5 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-slate-100 align-top">
            {r.map((c, j) => (
              <td key={j} className="px-2 py-1.5">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
