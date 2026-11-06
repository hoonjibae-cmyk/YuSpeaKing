import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { claimInvite } from "../../actions";
import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

// 가입 안내 알림톡의 버튼이 여는 곳. 링크 하나가 학생 한 명이다.
export default async function StudentJoinPage({
  params,
  searchParams,
}: {
  params: { token: string };
  searchParams: { error?: string; used?: string };
}) {
  const token = String(params.token || "");
  const admin = createAdminClient();
  const { data } = /^[a-f0-9]{20,}$/.test(token)
    ? await admin
        .from("students")
        .select("name, class_id, status")
        .eq("invite_token", token)
        .maybeSingle()
    : { data: null };
  const student = data as {
    name: string;
    class_id: string;
    status: string;
  } | null;
  const { data: klass } = student
    ? await admin
        .from("classes")
        .select("name")
        .eq("id", student.class_id)
        .maybeSingle()
    : { data: null };

  const inputCls =
    "w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none";
  const shell = (body: React.ReactNode) => (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-2xl font-bold text-brand">유스피킹</span>
      </Link>
      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        {body}
      </div>
    </main>
  );

  // 이미 쓴 링크이거나 잘못된 링크
  if (!student || student.status !== "invited") {
    return shell(
      <div className="text-center">
        <div className="text-3xl">🔗</div>
        <h1 className="mt-2 text-lg font-semibold">
          {searchParams.used || student
            ? "이미 가입을 마친 링크예요"
            : "링크를 확인할 수 없어요"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          아이디를 이미 만들었다면 로그인해 주세요. 아이디가 기억나지 않으면
          담당 선생님께 말씀해 주세요.
        </p>
        <Link
          href="/student"
          className="mt-5 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white"
        >
          로그인하러 가기
        </Link>
      </div>,
    );
  }

  return shell(
    <>
      <h1 className="text-lg font-semibold">
        {student.name} 학생, 환영해요 👋
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        <b>{(klass as { name?: string } | null)?.name ?? ""}</b> 반으로 등록되어
        있어요. 앞으로 쓸 아이디와 비밀번호만 정하면 바로 시작할 수 있어요.
      </p>
      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}
      <form action={claimInvite} className="mt-5 space-y-3">
        <input type="hidden" name="token" value={token} />
        <div>
          <label className="text-sm font-medium text-slate-600">아이디</label>
          <input
            name="username"
            required
            autoComplete="username"
            autoCapitalize="none"
            placeholder="영문·숫자 4~20자"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">비밀번호</label>
          <input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            placeholder="4자 이상"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600">
            비밀번호 확인
          </label>
          <input
            name="password_confirm"
            type="password"
            required
            autoComplete="new-password"
            className={`mt-1 ${inputCls}`}
          />
        </div>
        <SubmitButton
          pendingText="만드는 중…"
          className="w-full rounded-xl bg-brand py-3 font-semibold text-white hover:bg-brand-dark"
        >
          가입하고 시작하기
        </SubmitButton>
      </form>
      <p className="mt-4 text-center text-[11px] text-slate-400">
        아이디와 비밀번호는 잊어버리지 않게 꼭 적어 두세요.
      </p>
    </>,
  );
}
