import { stopImpersonating } from "@/app/teacher/actions";

// 운영자가 특정 선생님으로 대행 중일 때 상단에 표시
export default function ImpersonationBanner({ name }: { name: string }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
      <span>
        👁️ <b>{name}</b> 선생님 화면을 운영자 권한으로 보고 있어요
      </span>
      <form action={stopImpersonating}>
        <button className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700">
          운영자로 돌아가기
        </button>
      </form>
    </div>
  );
}
