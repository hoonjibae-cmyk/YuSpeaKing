import Link from "next/link";
import { requireStudent } from "@/lib/student-guard";
import { getStudentNotices } from "@/lib/notices";
import NoticeReadMarker from "@/components/NoticeReadMarker";
import PushToggle from "@/components/PushToggle";

export const dynamic = "force-dynamic";

export default async function StudentNoticesPage() {
  const session = await requireStudent();
  const notices = await getStudentNotices(session.studentId, session.classId);
  const unreadIds = notices.filter((n) => !n.read).map((n) => n.id);

  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      {/* 이 화면을 열면 모두 읽음 처리 */}
      <NoticeReadMarker noticeIds={unreadIds} />

      <Link href="/student/home" className="text-sm text-slate-500 hover:underline">
        ← 오늘의 스피킹
      </Link>
      <h1 className="mt-3 text-xl font-bold text-brand">📢 공지사항</h1>

      <PushToggle vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />

      <section className="mt-5 space-y-3">
        {notices.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
            아직 공지가 없어요 🙂
          </p>
        )}
        {notices.map((n) => (
          <article
            key={n.id}
            className={`rounded-2xl border bg-white p-5 ${
              n.read ? "border-slate-200" : "border-brand/40 shadow-sm"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              {n.pinned && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-600">
                  📌 필독
                </span>
              )}
              {!n.read && (
                <span className="rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-white">
                  NEW
                </span>
              )}
              <span className="text-[11px] text-slate-400">
                {n.authorName ? `${n.authorName} 선생님 · ` : ""}
                {n.created_at.slice(0, 10)}
              </span>
            </div>
            <h2 className="mt-1.5 font-semibold">{n.title}</h2>
            {n.body && (
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                {n.body}
              </p>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
