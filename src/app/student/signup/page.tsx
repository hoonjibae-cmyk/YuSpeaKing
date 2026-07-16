import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { studentSignup } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import { Logo } from "@/components/Logo";

export const dynamic = "force-dynamic";

const GRADES = ["초3", "초4", "초5", "초6", "중1", "중2", "중3"];

export default async function StudentSignupPage({
  searchParams,
}: {
  searchParams: { error?: string; t?: string };
}) {
  const code = String(searchParams.t || "").trim();
  const admin = createAdminClient();

  // 선생님별 고유 가입 링크(?t=코드) — 해당 선생님만 조회
  const { data: teacher } = code
    ? await admin
        .from("teachers")
        .select("id, name, signup_code, status")
        .eq("signup_code", code)
        .eq("status", "approved")
        .maybeSingle()
    : { data: null };

  const inputCls =
    "w-full rounded-xl border border-slate-300 px-4 py-3 focus:border-brand focus:outline-none";

  // 유효한 링크가 아니면 안내
  if (!teacher) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
        <Link href="/" className="mb-6 flex flex-col items-center gap-2">
          <Logo size="md" />
          <span className="text-2xl font-bold text-brand">유스피킹</span>
        </Link>
        <div className="rounded-3xl border border-slate-200 bg-white p-7 text-center shadow-sm">
          <div className="text-3xl">🔗</div>
          <h1 className="mt-2 text-lg font-semibold">가입 링크를 확인해 주세요</h1>
          <p className="mt-2 text-sm text-slate-500">
            선생님께 받은 <b>가입 신청 링크</b>로 다시 접속해 주세요. 링크에는
            담당 선생님 정보가 담겨 있어요.
          </p>
          <Link
            href="/student"
            className="mt-4 inline-block text-sm font-medium text-brand hover:underline"
          >
            로그인으로 가기
          </Link>
        </div>
      </main>
    );
  }

  const { data: classes } = await admin
    .from("classes")
    .select("id, name")
    .eq("teacher_id", teacher.id)
    .order("name");
  const classList = (classes ?? []) as { id: string; name: string }[];

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <Link href="/" className="mb-6 flex flex-col items-center gap-2">
        <Logo size="md" />
        <span className="text-2xl font-bold text-brand">유스피킹</span>
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <h1 className="text-center text-lg font-semibold">가입 신청</h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          <b className="text-brand">{teacher.name} 선생님</b> 반 가입 신청이에요.
          <br />
          신청하면 선생님 승인 후 이용할 수 있어요.
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form action={studentSignup} className="mt-6 space-y-3">
          <input type="hidden" name="signup_code" value={teacher.signup_code} />
          <input name="name" placeholder="이름" required className={inputCls} />
          <input name="school" placeholder="학교 (예: 목동초등학교)" required className={inputCls} />

          <select name="grade" required defaultValue="" className={inputCls}>
            <option value="" disabled>
              학년 선택
            </option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

          <select name="classId" required defaultValue="" className={inputCls}>
            <option value="" disabled>
              수강반 선택
            </option>
            {classList.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {classList.length === 0 && (
            <p className="text-xs text-amber-600">
              아직 개설된 반이 없어요. 선생님께 문의해 주세요.
            </p>
          )}

          <div className="border-t border-slate-100 pt-3">
            <input
              name="username"
              placeholder="아이디 (영문·숫자 4~20자)"
              required
              autoCapitalize="none"
              autoComplete="off"
              className={inputCls}
            />
          </div>
          <input
            name="password"
            type="password"
            placeholder="비밀번호 (4자 이상)"
            required
            autoComplete="new-password"
            className={inputCls}
          />
          <input
            name="password_confirm"
            type="password"
            placeholder="비밀번호 확인"
            required
            autoComplete="new-password"
            className={inputCls}
          />

          <SubmitButton
            pendingText="신청 중…"
            className="w-full rounded-xl bg-brand py-3 text-lg font-semibold text-white transition hover:bg-brand-dark"
          >
            가입 신청하기
          </SubmitButton>
        </form>
      </div>

      <p className="mt-4 text-center text-sm text-slate-400">
        이미 승인받았나요?{" "}
        <Link href="/student" className="font-medium text-brand hover:underline">
          로그인하기
        </Link>
      </p>
    </main>
  );
}
