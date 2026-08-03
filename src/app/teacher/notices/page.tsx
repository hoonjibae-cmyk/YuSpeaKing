import Link from "next/link";
import { getTeacherContext } from "@/lib/teacher-context";
import { createNotice, deleteNotice } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import ImpersonationBanner from "@/components/ImpersonationBanner";

export const dynamic = "force-dynamic";

export default async function TeacherNoticesPage({
  searchParams,
}: {
  searchParams: { error?: string; posted?: string };
}) {
  const { db, effectiveId, role, isImpersonating, actingName } =
    await getTeacherContext();

  const [{ data: classes }, { data: notices }] = await Promise.all([
    db
      .from("classes")
      .select("id, name")
      .eq("teacher_id", effectiveId)
      .is("archived_at", null)
      .order("name"),
    db
      .from("notices")
      .select("id, title, body, scope, class_id, pinned, created_at, classes(name)")
      // 내가 쓴 공지 + 운영자 전체 공지 (대행 모드에선 RLS가 없으므로 명시적으로 제한)
      .or(`author_id.eq.${effectiveId},scope.eq.all`)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const classList = (classes ?? []) as { id: string; name: string }[];
  const list = (notices ?? []) as Array<{
    id: string;
    title: string;
    body: string;
    scope: string;
    class_id: string | null;
    pinned: boolean;
    created_at: string;
    classes: { name?: string } | { name?: string }[] | null;
  }>;

  const inputCls =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none";

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      {isImpersonating && actingName && <ImpersonationBanner name={actingName} />}
      <Link href="/teacher" className="text-sm text-slate-500 hover:underline">
        ← 반 목록
      </Link>
      <h1 className="mt-3 text-2xl font-bold text-brand">📢 공지사항</h1>
      <p className="mt-1 text-sm text-slate-500">
        학생 앱에 공지가 뜨고, 알림을 켠 학생에게는 휴대폰 알림도 전송돼요.
      </p>

      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}
      {searchParams.posted && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ 공지를 등록하고 알림을 보냈어요.
        </p>
      )}

      {/* 새 공지 */}
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <h2 className="font-semibold">새 공지 쓰기</h2>
        <form action={createNotice} className="mt-3 space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">받는 대상</label>
            <select name="target" defaultValue="my_classes" className={`mt-1 ${inputCls}`}>
              <option value="my_classes">📚 내가 담당하는 모든 반</option>
              {classList.map((c) => (
                <option key={c.id} value={c.id}>
                  🏫 {c.name} 만
                </option>
              ))}
              {role === "admin" && (
                <option value="all">🏛️ 전체 반 (운영자 공지)</option>
              )}
            </select>
          </div>
          <input name="title" placeholder="제목 (예: 8월 휴원 안내)" required className={inputCls} />
          <textarea
            name="body"
            rows={5}
            placeholder="내용을 입력하세요"
            className={inputCls}
          />
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="pinned" className="h-4 w-4" />
              📌 상단 고정
            </label>
            <SubmitButton
              pendingText="등록 중…"
              className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
            >
              공지 등록 + 알림 보내기
            </SubmitButton>
          </div>
        </form>
      </section>

      {/* 목록 */}
      <section className="mt-6 space-y-3">
        <h2 className="font-semibold">등록된 공지 ({list.length})</h2>
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            아직 등록한 공지가 없어요.
          </p>
        )}
        {list.map((n) => {
          const k = Array.isArray(n.classes) ? n.classes[0] : n.classes;
          const scopeLabel =
            n.scope === "all"
              ? "🏛️ 전체 반"
              : n.scope === "my_classes"
                ? "📚 담당 전체 반"
                : `🏫 ${k?.name ?? "반"}`;
          return (
            <article
              key={n.id}
              className="rounded-2xl border border-slate-200 bg-white p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {n.pinned && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">
                        📌 고정
                      </span>
                    )}
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                      {scopeLabel}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {n.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <h3 className="mt-1.5 font-semibold">{n.title}</h3>
                  {n.body && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                      {n.body}
                    </p>
                  )}
                </div>
                <form action={deleteNotice} className="shrink-0">
                  <input type="hidden" name="noticeId" value={n.id} />
                  <ConfirmSubmitButton
                    message="이 공지를 삭제할까요? 학생 화면에서도 사라집니다."
                    className="text-xs text-slate-400 hover:text-red-500"
                  >
                    삭제
                  </ConfirmSubmitButton>
                </form>
              </div>
            </article>
          );
        })}
      </section>
    </main>
  );
}
