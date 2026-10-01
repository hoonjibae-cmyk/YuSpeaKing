import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchHrClasses, hrConfigured, type HrClass } from "@/lib/hr/client";
import { normalizeClassName } from "@/lib/hr/match";
import { linkHrClass, syncAllRosters } from "../actions";
import SubmitButton from "@/components/SubmitButton";
import { CrownMark } from "@/components/Logo";

// 외부 API 를 부르므로 캐시하지 않고, 반이 많을 때를 위해 넉넉히 둔다
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export default async function AdminHrPage({
  searchParams,
}: {
  searchParams: { done?: string; error?: string };
}) {
  await requireAdmin();
  const admin = createAdminClient();

  // classes ↔ teachers 는 경로가 여럿이라 묶어 조회하면 모호해진다. 따로 받는다.
  const [{ data: classRows }, { data: teacherRows }, { data: linkRows }] =
    await Promise.all([
      admin
        .from("classes")
        .select("id, name, teacher_id")
        .is("archived_at", null)
        .order("name"),
      admin.from("teachers").select("id, name"),
      admin.from("class_links").select("class_id, hr_class_id, hr_class_name"),
    ]);

  const classes = (classRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  const teacherName = new Map(
    ((teacherRows ?? []) as { id: string; name: string | null }[]).map((t) => [
      t.id,
      t.name ?? "",
    ]),
  );
  const links = new Map(
    (
      (linkRows ?? []) as {
        class_id: string;
        hr_class_id: string;
        hr_class_name: string | null;
      }[]
    ).map((l) => [l.class_id, l]),
  );

  // 반별 '확인 필요' 학생 수
  const pendingByClass = new Map<string, number>();
  if (classes.length) {
    const { data: pend } = await admin
      .from("hr_pending_students")
      .select("class_id")
      .in(
        "class_id",
        classes.map((c) => c.id),
      );
    for (const r of (pend ?? []) as { class_id: string }[]) {
      pendingByClass.set(r.class_id, (pendingByClass.get(r.class_id) ?? 0) + 1);
    }
  }

  // Student Card 반 목록. 못 가져오면 화면은 그대로 두고 이유만 알린다.
  let hrClasses: HrClass[] = [];
  let hrError: string | null = null;
  if (hrConfigured()) {
    try {
      hrClasses = await fetchHrClasses();
    } catch (e) {
      hrError = e instanceof Error ? e.message : "반 목록 조회 실패";
    }
  }

  const usedHr = new Set(Array.from(links.values()).map((l) => l.hr_class_id));
  // 이름이 같으면 자동으로 골라 둔다 (운영자는 확인만 하고 누르면 된다)
  const hrByName = new Map<string, HrClass[]>();
  for (const h of hrClasses) {
    const k = normalizeClassName(h.name);
    hrByName.set(k, [...(hrByName.get(k) ?? []), h]);
  }

  const { data: settings } = await admin
    .from("app_settings")
    .select("hr_synced_at")
    .eq("id", 1)
    .maybeSingle();
  const syncedAt = (settings as { hr_synced_at?: string | null } | null)
    ?.hr_synced_at;

  const rows = classes.map((c) => {
    const link = links.get(c.id);
    const guess = !link
      ? (hrByName.get(normalizeClassName(c.name)) ?? []).filter(
          (h) => !usedHr.has(h.hrClassId),
        )
      : [];
    return {
      ...c,
      link,
      // 후보가 딱 하나일 때만 미리 골라 둔다
      suggested: guess.length === 1 ? guess[0] : null,
      pending: pendingByClass.get(c.id) ?? 0,
    };
  });

  const unlinked = rows.filter((r) => !r.link);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/admin" className="text-sm text-slate-500 hover:underline">
        ← 운영자
      </Link>
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CrownMark className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold text-brand">반 매칭</h1>
            <p className="text-sm text-slate-500">
              유스피킹 반 ↔ Student Card 반을 이어 주면 학생 명단과 연락처를
              자동으로 받아옵니다.
            </p>
          </div>
        </div>
        {hrConfigured() && (
          <form action={syncAllRosters}>
            <SubmitButton
              pendingText="확인 중…"
              className="whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
            >
              🔄 전체 명단 다시 받기
            </SubmitButton>
          </form>
        )}
      </header>

      {searchParams.done && (
        <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          ✅ {decodeURIComponent(searchParams.done)}
        </p>
      )}
      {searchParams.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {decodeURIComponent(searchParams.error)}
        </p>
      )}

      {!hrConfigured() && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ Student Card 연동이 아직 설정되지 않았어요. Vercel 환경변수{" "}
          <b className="font-mono text-xs">STUDENT_CARD_ROSTER_KEY</b> 를 등록해 주세요.
        </p>
      )}
      {hrError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Student Card 반 목록을 받아오지 못했어요 — {hrError}
        </p>
      )}

      {unlinked.length > 0 && hrConfigured() && !hrError && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          🔗 아직 이어지지 않은 반 <b>{unlinked.length}개</b> — 이어 주기 전에는
          그 반의 명단·연락처를 받아오지 않습니다.
        </p>
      )}

      <p className="mt-4 text-xs text-slate-400">
        마지막 확인{" "}
        {syncedAt
          ? new Date(syncedAt).toLocaleString("ko-KR", {
              timeZone: "Asia/Seoul",
            })
          : "없음"}
        {hrClasses.length > 0 && ` · Student Card 반 ${hrClasses.length}개`}
      </p>

      <ul className="mt-5 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className={`rounded-xl border p-4 ${
              r.link
                ? "border-slate-200 bg-white"
                : "border-amber-200 bg-amber-50/50"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.name}</span>
              <span className="text-xs text-slate-400">
                {teacherName.get(r.teacher_id) || "담당 미지정"} 선생님
              </span>
              {r.link ? (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  이어짐 · {r.link.hr_class_name || r.link.hr_class_id}
                </span>
              ) : (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  매칭 안 됨
                </span>
              )}
              {r.pending > 0 && (
                <span className="rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-medium text-brand">
                  확인 필요 {r.pending}명
                </span>
              )}
            </div>

            <form
              action={linkHrClass}
              className="mt-2.5 flex flex-wrap items-center gap-2"
            >
              <input type="hidden" name="classId" value={r.id} />
              <select
                name="hrClassId"
                defaultValue={
                  r.link?.hr_class_id ?? r.suggested?.hrClassId ?? ""
                }
                disabled={hrClasses.length === 0}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
              >
                <option value="">— 연결 안 함 —</option>
                {hrClasses.map((h) => (
                  <option key={h.hrClassId} value={h.hrClassId}>
                    {h.name}
                    {h.teacherName ? ` (${h.teacherName})` : ""}
                    {usedHr.has(h.hrClassId) &&
                    h.hrClassId !== r.link?.hr_class_id
                      ? " · 다른 반에 연결됨"
                      : ""}
                  </option>
                ))}
              </select>
              <SubmitButton
                pendingText="연결 중…"
                className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-40"
              >
                {r.link ? "변경" : "연결"}
              </SubmitButton>
            </form>

            {!r.link && r.suggested && (
              <p className="mt-1.5 text-[11px] text-slate-400">
                이름이 같은 반을 미리 골라 뒀어요 — 확인하고 연결을 누르세요.
              </p>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            활성 반이 없어요.
          </li>
        )}
      </ul>

      <p className="mt-4 text-[11px] text-slate-400">
        · 한 번 이어 두면 반 이름을 바꿔도 연결은 유지됩니다.
        <br />· 학생은 이름으로 맞추되, Student Card 쪽 이름 뒤 구분자(예:
        홍길동A)는 같은 이름 후보가 하나뿐일 때만 자동으로 잇습니다.
        <br />· 명단은 매일 새벽에 자동으로 다시 받아옵니다.
      </p>
    </main>
  );
}
