import { redirect } from "next/navigation";
import { getTeacher } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "../actions";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

export default async function TeacherPendingPage({
  searchParams,
}: {
  searchParams: { rejected?: string };
}) {
  const user = await getTeacher();
  if (!user) redirect("/teacher/login");

  // 이미 승인됐다면 대시보드로
  const supabase = createClient();
  const { data: me } = await supabase
    .from("teachers")
    .select("status, role")
    .eq("id", user.id)
    .single();
  if (me?.role === "admin" || me?.status === "approved") redirect("/teacher");

  const rejected = searchParams.rejected === "1" || me?.status === "rejected";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-xl font-bold text-brand">유스피킹</span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="text-4xl">{rejected ? "🚫" : "⏳"}</div>
        <h1 className="mt-3 text-lg font-semibold">
          {rejected ? "가입이 반려되었어요" : "가입 승인 대기 중이에요"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {rejected
            ? "총괄관리자에게 문의해 주세요."
            : "총괄관리자가 가입 신청을 확인하고 승인하면 이용할 수 있어요. 승인 후 다시 로그인해 주세요."}
        </p>

        <form action={signOut} className="mt-6">
          <button className="w-full rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100">
            로그아웃
          </button>
        </form>
      </div>
    </main>
  );
}
