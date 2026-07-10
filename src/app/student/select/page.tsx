import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectStudent } from "../actions";

export default async function StudentSelectPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string };
}) {
  const code = (searchParams.code || "").trim().toUpperCase();
  if (!code) redirect("/student");

  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("id, name")
    .eq("class_code", code)
    .single();
  if (!klass) redirect("/student?error=반+코드를+찾을+수+없어요");

  const { data: students } = await admin
    .from("students")
    .select("id, name, number")
    .eq("class_id", klass.id)
    .order("number");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6 py-12">
      <Link href="/student" className="text-sm text-slate-500 hover:underline">
        ← 반 코드 다시 입력
      </Link>
      <h1 className="mt-3 text-xl font-bold">{klass.name}</h1>
      <p className="text-sm text-slate-500">본인 이름을 눌러줘요</p>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3">
        {(!students || students.length === 0) && (
          <p className="col-span-2 rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
            아직 등록된 학생이 없어요. 선생님께 문의하세요.
          </p>
        )}
        {students?.map((s) => (
          <form key={s.id} action={selectStudent}>
            <input type="hidden" name="code" value={code} />
            <input type="hidden" name="studentId" value={s.id} />
            <button className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-5 text-center transition hover:border-brand hover:shadow-sm">
              <div className="text-xs text-slate-400">{s.number}번</div>
              <div className="mt-1 text-lg font-semibold">{s.name}</div>
            </button>
          </form>
        ))}
      </div>
    </main>
  );
}
