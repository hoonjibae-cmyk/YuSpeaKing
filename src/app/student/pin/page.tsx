import Link from "next/link";
import { redirect } from "next/navigation";
import { getPendingStudent } from "@/lib/student-session";
import { submitPin } from "../actions";
import SubmitButton from "@/components/SubmitButton";

export default async function StudentPinPage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  const pending = await getPendingStudent();
  if (!pending) redirect("/student");

  const setting = !pending.pinSet; // 첫 로그인이면 PIN 설정

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-16">
      <Link href="/student" className="mb-6 text-center text-sm text-slate-500 hover:underline">
        ← 처음으로
      </Link>

      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-lg font-semibold">
          {pending.number}번 {pending.name}
        </h1>
        <p className="mt-1 text-center text-sm text-slate-500">
          {setting
            ? "나만의 PIN 4자리를 정해요 🔒"
            : "PIN 4자리를 입력해요 🔒"}
        </p>

        {searchParams.error && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-600">
            {decodeURIComponent(searchParams.error)}
          </p>
        )}

        <form action={submitPin} className="mt-6 space-y-3">
          <input
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            placeholder="● ● ● ●"
            required
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.5em] focus:border-brand focus:outline-none"
          />
          {setting && (
            <input
              name="pin_confirm"
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              placeholder="PIN 다시 입력"
              required
              autoComplete="off"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-center text-lg tracking-[0.4em] focus:border-brand focus:outline-none"
            />
          )}
          <SubmitButton
            pendingText="확인 중…"
            className="w-full rounded-xl bg-brand py-3 text-lg font-semibold text-white transition hover:bg-brand-dark"
          >
            {setting ? "PIN 정하고 시작하기" : "입장하기"}
          </SubmitButton>
        </form>

        {setting && (
          <p className="mt-4 text-center text-xs text-slate-400">
            PIN은 다음에 로그인할 때 필요해요. 잊지 않게 기억해 두세요!
          </p>
        )}
      </div>
    </main>
  );
}
