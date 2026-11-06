import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchHrClassList, hrConfigured, type HrClass } from "@/lib/hr/client";
import { normalizeTeacherName } from "@/lib/hr/match";
import type { SyncSummary } from "@/lib/hr/sync";
import {
  applyCardTeacher,
  applyContactDiff,
  createClassFromCard,
  linkClassPair,
  linkStudentManual,
  linkTeacher,
  setStudentLink,
  setSyncMode,
  syncAllRosters,
} from "../actions";
import SubmitButton from "@/components/SubmitButton";
import ConfirmSubmitButton from "@/components/ConfirmSubmitButton";
import { CrownMark } from "@/components/Logo";

// 외부 API 를 부르므로 캐시하지 않고, 반이 많을 때를 위해 넉넉히 둔다
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Student Card 전환 도구.
//   1) 선생님  2) 반  3) 학생 순서로 맞춘다. 앞 단계가 맞아야 뒤 단계가 자동으로
//   더 많이 맞춰진다 (반 매칭은 담임을, 학생 매칭은 반을 기준으로 삼는다).
//   다 맞춘 뒤 '일원화' 를 켜면 그때부터 Student Card 를 따라간다.

const METHOD_LABEL: Record<string, string> = {
  id: "이전 연결",
  exact: "이름",
  suffix: "이름(구분자)",
  "name+phone": "이름+전화",
  phone: "전화번호",
  manual: "수동",
  created: "Student Card 에서 생성",
};

const pill = (tone: "ok" | "warn" | "mute" | "brand" | "bad") =>
  `inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${
    {
      ok: "bg-green-100 text-green-700",
      warn: "bg-amber-100 text-amber-700",
      mute: "bg-slate-100 text-slate-500",
      brand: "bg-brand-light text-brand",
      bad: "bg-red-100 text-red-600",
    }[tone]
  }`;

const fmtPhone = (p: string | null | undefined) =>
  p ? p.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3") : "—";

export default async function AdminHrPage({
  searchParams,
}: {
  searchParams: { done?: string; error?: string };
}) {
  await requireAdmin();
  const admin = createAdminClient();

  // ── 저장된 자료 (외부 호출 없음) ──
  const [
    { data: teacherRows },
    { data: tlRows },
    { data: classRows },
    { data: linkRows },
    { data: settingRow },
    { data: logRows },
  ] = await Promise.all([
    admin
      .from("teachers")
      .select("id, name, email")
      .eq("status", "approved")
      .order("name"),
    admin.from("teacher_links").select("card_teacher_name, teacher_id, method"),
    admin
      .from("classes")
      .select("id, name, teacher_id")
      .is("archived_at", null)
      .order("name"),
    admin.from("class_links").select("class_id, hr_class_id, hr_class_name"),
    admin
      .from("app_settings")
      .select("hr_sync_mode, hr_synced_at, hr_last_report")
      .eq("id", 1)
      .maybeSingle(),
    admin
      .from("hr_sync_log")
      .select("id, at, kind, detail")
      .order("at", { ascending: false })
      .limit(30),
  ]);

  const teachers = (teacherRows ?? []) as {
    id: string;
    name: string | null;
    email: string;
  }[];
  const tName = new Map(teachers.map((t) => [t.id, t.name || t.email]));
  const teacherLinks = new Map(
    (
      (tlRows ?? []) as {
        card_teacher_name: string;
        teacher_id: string;
        method: string;
      }[]
    ).map((r) => [r.card_teacher_name, r]),
  );
  const classes = (classRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  const classById = new Map(classes.map((c) => [c.id, c]));
  const links = (linkRows ?? []) as {
    class_id: string;
    hr_class_id: string;
    hr_class_name: string | null;
  }[];
  const linkByCard = new Map(links.map((l) => [l.hr_class_id, l]));
  const linkByLocal = new Map(links.map((l) => [l.class_id, l]));
  const settings = settingRow as {
    hr_sync_mode?: string;
    hr_synced_at?: string | null;
    hr_last_report?: SyncSummary | null;
  } | null;
  const mode = settings?.hr_sync_mode === "oneway" ? "oneway" : "convert";
  const lastReport = settings?.hr_last_report ?? null;

  const linkedIds = links
    .map((l) => l.class_id)
    .filter((id) => classById.has(id));
  const [
    { data: stuRows },
    { data: pendRows },
    { data: sugRows },
    { data: diffRows },
  ] = linkedIds.length
    ? await Promise.all([
        admin
          .from("students")
          .select(
            "id, name, class_id, status, username, hr_student_id, hr_link_method, student_phone, parent_phone",
          )
          .in("class_id", linkedIds)
          .in("status", ["approved", "pending", "invited", "withdrawn"])
          .order("name"),
        admin
          .from("hr_pending_students")
          .select(
            "class_id, hr_student_id, name, kind, student_phone, parent_phone",
          )
          .in("class_id", linkedIds),
        admin
          .from("hr_match_suggestions")
          .select(
            "local_student_id, hr_student_id, class_id, hr_name, hr_student_phone, hr_parent_phone, reason",
          )
          .in("class_id", linkedIds),
        admin
          .from("hr_contact_diffs")
          .select("student_id, card_student_phone, card_parent_phone"),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  type Stu = {
    id: string;
    name: string;
    class_id: string;
    status: string;
    username: string | null;
    hr_student_id: string | null;
    hr_link_method: string | null;
    student_phone: string | null;
    parent_phone: string | null;
  };
  const students = (stuRows ?? []) as Stu[];
  const pending = (pendRows ?? []) as {
    class_id: string;
    hr_student_id: string;
    name: string;
    kind: string;
    student_phone: string | null;
    parent_phone: string | null;
  }[];
  const suggestions = (sugRows ?? []) as {
    local_student_id: string;
    hr_student_id: string;
    class_id: string;
    hr_name: string;
    hr_student_phone: string | null;
    hr_parent_phone: string | null;
    reason: string;
  }[];
  const diffs = new Map(
    (
      (diffRows ?? []) as {
        student_id: string;
        card_student_phone: string | null;
        card_parent_phone: string | null;
      }[]
    ).map((d) => [d.student_id, d]),
  );

  // ── Student Card 반 목록 (실시간) ──
  let cardClasses: HrClass[] = [];
  let filterApplied = false;
  let cardError: string | null = null;
  if (hrConfigured()) {
    try {
      const r = await fetchHrClassList();
      cardClasses = r.classes;
      filterApplied = r.filterApplied;
    } catch (e) {
      cardError = e instanceof Error ? e.message : "반 목록 조회 실패";
    }
  }

  // ── 1) 선생님 ──
  const cardTeacherNames = Array.from(
    new Set(
      cardClasses.map((c) => c.teacherName).filter((n): n is string => !!n),
    ),
  ).sort((a, b) => a.localeCompare(b, "ko"));
  const classesPerTeacher = (n: string) =>
    cardClasses.filter((c) => c.teacherName === n).length;
  const suggestTeacher = (n: string) => {
    const hit = teachers.filter(
      (t) => normalizeTeacherName(t.name ?? "") === normalizeTeacherName(n),
    );
    return hit.length === 1 ? hit[0].id : "";
  };
  const unlinkedTeachers = cardTeacherNames.filter((n) => !teacherLinks.has(n));
  const conflictClasses = cardClasses.filter((c) => c.teacherConflict);

  // ── 2) 반 ──
  const ownerFor = (c: HrClass) =>
    c.teacherName
      ? (teacherLinks.get(c.teacherName)?.teacher_id ?? null)
      : null;
  const unlinkedCards = cardClasses.filter((c) => !linkByCard.has(c.hrClassId));
  const cardIds = new Set(cardClasses.map((c) => c.hrClassId));
  const orphanLocals = classes.filter(
    (c) =>
      !linkByLocal.has(c.id) ||
      (cardClasses.length > 0 &&
        !cardIds.has(linkByLocal.get(c.id)!.hr_class_id)),
  );
  const ownerMismatch = cardClasses.filter((c) => {
    const l = linkByCard.get(c.hrClassId);
    const owner = ownerFor(c);
    return (
      l &&
      owner &&
      classById.get(l.class_id) &&
      classById.get(l.class_id)!.teacher_id !== owner
    );
  });

  // ── 3) 학생 ──
  const perClass = linkedIds.map((cid) => {
    const mine = students.filter((s) => s.class_id === cid);
    const sug = suggestions.filter((s) => s.class_id === cid);
    const sugByLocal = new Map<string, typeof sug>();
    for (const s of sug)
      sugByLocal.set(s.local_student_id, [
        ...(sugByLocal.get(s.local_student_id) ?? []),
        s,
      ]);
    const onlyLocal = mine.filter(
      (s) =>
        !s.hr_student_id &&
        s.hr_link_method !== "none" &&
        s.status !== "withdrawn" &&
        !sugByLocal.has(s.id),
    );
    const cardFree = pending.filter((p) => p.class_id === cid);
    return {
      cid,
      name: classById.get(cid)!.name,
      linked: mine.filter((s) => s.hr_student_id),
      phoneLinked: mine.filter(
        (s) =>
          s.hr_link_method === "phone" || s.hr_link_method === "name+phone",
      ),
      sugByLocal,
      onlyLocal,
      noCard: mine.filter((s) => s.hr_link_method === "none"),
      cardFree,
      invited: mine.filter((s) => s.status === "invited"),
      withdrawn: mine.filter((s) => s.status === "withdrawn"),
      diffs: mine.filter((s) => diffs.has(s.id)),
      local: mine,
    };
  });
  const totals = {
    review: perClass.reduce((n, c) => n + c.sugByLocal.size, 0),
    onlyLocal: perClass.reduce((n, c) => n + c.onlyLocal.length, 0),
    diffs: perClass.reduce((n, c) => n + c.diffs.length, 0),
    invited: perClass.reduce((n, c) => n + c.invited.length, 0),
    cardOnly: perClass.reduce(
      (n, c) => n + c.cardFree.filter((p) => p.kind === "new").length,
      0,
    ),
  };
  const blockers =
    unlinkedTeachers.length +
    unlinkedCards.length +
    totals.review +
    totals.onlyLocal;

  const card = "rounded-2xl border border-slate-200 bg-white p-5";
  const sel =
    "min-w-0 rounded-lg border border-slate-300 px-2 py-1.5 text-sm focus:border-brand focus:outline-none";
  const btn =
    "shrink-0 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-dark";
  const btnGhost =
    "shrink-0 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100";

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/admin" className="text-sm text-slate-500 hover:underline">
        ← 운영자
      </Link>
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <CrownMark className="h-9 w-9" />
          <div>
            <h1 className="text-2xl font-bold text-brand">Student Card 연동</h1>
            <p className="text-sm text-slate-500">
              선생님 → 반 → 학생 순서로 맞추고, 다 맞으면 일원화를 켭니다.
            </p>
          </div>
        </div>
        {hrConfigured() && (
          <form action={syncAllRosters}>
            <SubmitButton
              pendingText="동기화 중… (반이 많으면 1~2분)"
              className={btnGhost}
            >
              🔄 지금 동기화
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
          ⚠️ Student Card 연동이 설정되지 않았어요. Vercel 환경변수{" "}
          <b className="font-mono text-xs">STUDENT_CARD_ROSTER_KEY</b> 를 32자
          이상으로 등록해 주세요.
        </p>
      )}
      {cardError && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          Student Card 반 목록을 받아오지 못했어요 — {cardError}
        </p>
      )}
      {hrConfigured() && !cardError && !filterApplied && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
          ⚠️ Student Card 가 아직 <b>초6 필터</b>를 지원하지 않아 <b>전 학년</b>{" "}
          반이 보여요. 이 상태에서는 반·학생을 새로 만들거나 옮기지 않아요.
          (Student Card 쪽 업데이트가 필요합니다)
        </p>
      )}

      {/* ── 상태 · 일원화 ── */}
      <section className={`mt-6 ${card}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            지금 상태{" "}
            {mode === "oneway" ? (
              <span className={pill("brand")}>
                일원화 — Student Card 를 따름
              </span>
            ) : (
              <span className={pill("warn")}>
                전환 중 — 기존 자료를 바꾸지 않음
              </span>
            )}
          </h2>
          <span className="text-xs text-slate-400">
            마지막 동기화{" "}
            {settings?.hr_synced_at
              ? new Date(settings.hr_synced_at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })
              : "없음"}
          </span>
        </div>

        <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {[
            [
              "담임이 이어지지 않은 Student Card 선생님",
              unlinkedTeachers.length,
              "#teachers",
            ],
            [
              "유스피킹 반과 이어지지 않은 Student Card 반",
              unlinkedCards.length,
              "#classes",
            ],
            ["사람이 골라야 하는 학생", totals.review, "#students"],
            ["유스피킹에만 있는 학생", totals.onlyLocal, "#students"],
            ["연락처가 다른 학생", totals.diffs, "#students"],
            [
              "가입 전 학생 (Student Card 에서 들어옴)",
              totals.invited,
              "#students",
            ],
          ].map(([label, n, href]) => (
            <li key={label as string}>
              <a
                href={href as string}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 hover:bg-slate-100"
              >
                <span className="text-slate-600">{label}</span>
                <span
                  className={
                    (n as number) > 0
                      ? "font-semibold text-amber-600"
                      : "text-slate-400"
                  }
                >
                  {n as number}
                </span>
              </a>
            </li>
          ))}
        </ul>

        {lastReport?.warnings?.length ? (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-amber-600">
              지난 동기화 알림 {lastReport.warnings.length}건
            </summary>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
              {lastReport.warnings.map((w, i) => (
                <li key={i}>· {w}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="mt-4 border-t border-slate-100 pt-4">
          {mode === "convert" ? (
            <form action={setSyncMode} className="space-y-2">
              <input type="hidden" name="mode" value="oneway" />
              <p className="text-xs text-slate-500">
                일원화를 켜면 매일 새벽 동기화가{" "}
                <b>Student Card 를 그대로 따라갑니다</b> — 없는 반·학생을
                만들고, 반이 바뀐 학생을 옮기고, 담임을 바꾸고, Student Card
                에서 사라진 학생을 비활성으로 돌립니다(기록은 남아요). 선생님의
                반 만들기·학생 추가·가입 승인은 막힙니다.
              </p>
              {blockers > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  아직 맞추지 않은 항목이 <b>{blockers}건</b> 있어요. 이대로
                  켜면 이어지지 않은 반·학생은 자동으로 따라가지 않고, 맞추지
                  못한 학생은 같은 사람이 새로 만들어질 수 있어요. 위 목록을
                  먼저 정리하는 것을 권합니다.
                </p>
              )}
              <ConfirmSubmitButton
                message={
                  "일원화를 켤까요?\n\n다음 동기화부터 Student Card 를 따라 반·학생을 만들고, 옮기고, 비활성화합니다. 바뀐 내용은 모두 아래 '자동 변경 기록' 에 남아요."
                }
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
              >
                Student Card 일원화 켜기
              </ConfirmSubmitButton>
            </form>
          ) : (
            <form
              action={setSyncMode}
              className="flex flex-wrap items-center gap-3"
            >
              <input type="hidden" name="mode" value="convert" />
              <span className="text-xs text-slate-500">
                문제가 생기면 전환 상태로 되돌려 자동 변경을 멈출 수 있어요.
                (이미 바뀐 것은 그대로)
              </span>
              <ConfirmSubmitButton
                message={
                  "전환 상태로 되돌릴까요?\n\n자동 생성·이동·비활성화를 멈춥니다."
                }
                className={btnGhost}
              >
                전환 상태로 되돌리기
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </section>

      {/* ── 1) 선생님 ── */}
      <section id="teachers" className={`mt-6 ${card}`}>
        <h2 className="font-semibold">① 선생님 매칭</h2>
        <p className="mt-1 text-xs text-slate-500">
          Student Card 는 담임을 <b>이름으로만</b> 알려 줘요.
          호칭(T·쌤·선생님)을 떼고 같은 이름이 한 분뿐이면 자동으로 이어
          두었어요.
        </p>
        {conflictClasses.length > 0 && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            담임이 여러 명으로 적혀 있어 담임을 알 수 없는 반:{" "}
            <b>{conflictClasses.map((c) => c.name).join(", ")}</b> — Student
            Card 에서 정리해 주세요.
          </p>
        )}
        <ul className="mt-3 divide-y divide-slate-100">
          {cardTeacherNames.map((n) => {
            const link = teacherLinks.get(n);
            return (
              <li key={n} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="w-32 shrink-0 font-medium">{n}</span>
                <span className="text-xs text-slate-400">
                  반 {classesPerTeacher(n)}개
                </span>
                {link ? (
                  <span
                    className={pill(link.method === "manual" ? "brand" : "ok")}
                  >
                    {link.method === "manual" ? "수동" : "자동"} ·{" "}
                    {tName.get(link.teacher_id) ?? "?"}
                  </span>
                ) : (
                  <span className={pill("warn")}>미연결</span>
                )}
                <form
                  action={linkTeacher}
                  className="ml-auto flex items-center gap-2"
                >
                  <input type="hidden" name="cardName" value={n} />
                  <select
                    name="teacherId"
                    defaultValue={link?.teacher_id ?? suggestTeacher(n)}
                    className={sel}
                  >
                    <option value="">— 연결 안 함 —</option>
                    {teachers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name || t.email}
                      </option>
                    ))}
                  </select>
                  <SubmitButton pendingText="…" className={btn}>
                    저장
                  </SubmitButton>
                </form>
              </li>
            );
          })}
          {cardTeacherNames.length === 0 && (
            <li className="py-6 text-center text-sm text-slate-400">
              {hrConfigured()
                ? "Student Card 에서 담임 정보를 받지 못했어요."
                : "연동 설정 후 표시됩니다."}
            </li>
          )}
        </ul>
      </section>

      {/* ── 2) 반 ── */}
      <section id="classes" className={`mt-6 ${card}`}>
        <h2 className="font-semibold">② 반 매칭</h2>
        <p className="mt-1 text-xs text-slate-500">
          Student Card {filterApplied ? "초6 " : ""}반마다 유스피킹 반을 하나씩
          잇습니다. 이름이 같은 반은 자동으로 이어 두었어요. 유스피킹에 없는
          반은 <b>새로 만들 수</b> 있어요.
        </p>
        <ul className="mt-3 space-y-2">
          {cardClasses.map((c) => {
            const l = linkByCard.get(c.hrClassId);
            const local = l ? classById.get(l.class_id) : undefined;
            const owner = ownerFor(c);
            const mismatch = local && owner && local.teacher_id !== owner;
            return (
              <li
                key={c.hrClassId}
                className={`rounded-xl border p-3 ${local ? "border-slate-200" : "border-amber-200 bg-amber-50/40"}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="text-xs text-slate-400">
                    담임{" "}
                    {c.teacherConflict ? "여러 명" : (c.teacherName ?? "—")}
                    {owner
                      ? ` → ${tName.get(owner)}`
                      : c.teacherName
                        ? " (미연결)"
                        : ""}{" "}
                    · 학생 {c.studentCount ?? "?"}명
                  </span>
                  {local ? (
                    <span className={pill("ok")}>이어짐</span>
                  ) : (
                    <span className={pill("warn")}>미연결</span>
                  )}
                  {mismatch && (
                    <span className={pill("bad")}>
                      담임 다름: 유스피킹 {tName.get(local!.teacher_id)}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <form
                    action={linkClassPair}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <input type="hidden" name="hrClassId" value={c.hrClassId} />
                    <select
                      name="classId"
                      defaultValue={local?.id ?? ""}
                      className={`${sel} flex-1`}
                    >
                      <option value="">— 유스피킹 반 선택 —</option>
                      {classes.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.name} ({tName.get(x.teacher_id) ?? "?"})
                          {linkByLocal.has(x.id) &&
                          linkByLocal.get(x.id)!.hr_class_id !== c.hrClassId
                            ? " · 다른 반에 연결됨"
                            : ""}
                        </option>
                      ))}
                    </select>
                    <SubmitButton pendingText="…" className={btn}>
                      {local ? "변경" : "연결"}
                    </SubmitButton>
                  </form>
                  {!local && (
                    <form action={createClassFromCard}>
                      <input
                        type="hidden"
                        name="hrClassId"
                        value={c.hrClassId}
                      />
                      <input
                        type="hidden"
                        name="teacherId"
                        value={owner ?? ""}
                      />
                      {owner && !c.teacherConflict ? (
                        <ConfirmSubmitButton
                          message={`유스피킹에 '${c.name}' 반을 새로 만들까요?\n\n담임: ${tName.get(owner)}\n학생은 '가입 전' 으로 들어오고, 가입 안내로 계정을 만듭니다.`}
                          className={btnGhost}
                        >
                          ＋ 새 반으로 만들기
                        </ConfirmSubmitButton>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          담임을 먼저 이어야 만들 수 있어요
                        </span>
                      )}
                    </form>
                  )}
                  {mismatch && (
                    <form action={applyCardTeacher}>
                      <input type="hidden" name="classId" value={local!.id} />
                      <input type="hidden" name="teacherId" value={owner!} />
                      <ConfirmSubmitButton
                        message={`'${local!.name}' 반의 담임을 ${tName.get(local!.teacher_id)} → ${tName.get(owner!)} 로 바꿀까요?\n\n학생·과제·기록은 그대로 따라갑니다.`}
                        className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                      >
                        Student Card 담임으로 바꾸기
                      </ConfirmSubmitButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
          {cardClasses.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              Student Card 반 목록이 비어 있어요.
            </li>
          )}
        </ul>

        {orphanLocals.length > 0 && cardClasses.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-500">
              Student Card {filterApplied ? "초6 " : ""}반과 이어지지 않은
              유스피킹 반 {orphanLocals.length}개
            </summary>
            <p className="mt-1 text-[11px] text-slate-400">
              Student Card 에 해당 반이 없거나 이름이 달라 이어지지 않은
              반이에요. 위에서 이어 주거나, 끝난 반이면 반 화면에서 보관하세요.
            </p>
            <ul className="mt-1 text-xs text-slate-600">
              {orphanLocals.map((c) => (
                <li key={c.id}>
                  · {c.name} ({tName.get(c.teacher_id) ?? "?"})
                </li>
              ))}
            </ul>
          </details>
        )}
        {ownerMismatch.length > 0 && (
          <p className="mt-3 text-[11px] text-slate-400">
            담임이 다른 반 {ownerMismatch.length}개 — 전환 상태에서는 바꾸지
            않아요. 일원화를 켜면 다음 동기화 때 Student Card 담임으로 바뀝니다.
          </p>
        )}
      </section>

      {/* ── 3) 학생 ── */}
      <section id="students" className={`mt-6 ${card}`}>
        <h2 className="font-semibold">③ 학생 매칭</h2>
        <p className="mt-1 text-xs text-slate-500">
          이어진 반마다 <b>이름 → 전화번호</b> 순으로 맞췄어요. 동명이인은
          전화번호로 골랐고, 학부모 번호만 같은 경우는 형제자매일 수 있어
          자동으로 잇지 않았어요.
        </p>

        <div className="mt-3 space-y-2">
          {perClass.map((c) => {
            const attention =
              c.sugByLocal.size + c.onlyLocal.length + c.diffs.length;
            return (
              <details
                key={c.cid}
                open={attention > 0}
                className="rounded-xl border border-slate-200 p-3 open:bg-slate-50/50"
              >
                <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className={pill("ok")}>이어짐 {c.linked.length}</span>
                  {c.sugByLocal.size > 0 && (
                    <span className={pill("warn")}>
                      확인 필요 {c.sugByLocal.size}
                    </span>
                  )}
                  {c.onlyLocal.length > 0 && (
                    <span className={pill("warn")}>
                      유스피킹에만 {c.onlyLocal.length}
                    </span>
                  )}
                  {c.diffs.length > 0 && (
                    <span className={pill("warn")}>
                      연락처 다름 {c.diffs.length}
                    </span>
                  )}
                  {c.invited.length > 0 && (
                    <span className={pill("brand")}>
                      가입 전 {c.invited.length}
                    </span>
                  )}
                  {c.cardFree.filter((p) => p.kind === "new").length > 0 && (
                    <span className={pill("mute")}>
                      Student Card 에만{" "}
                      {c.cardFree.filter((p) => p.kind === "new").length}
                    </span>
                  )}
                  {c.withdrawn.length > 0 && (
                    <span className={pill("mute")}>
                      비활성 {c.withdrawn.length}
                    </span>
                  )}
                </summary>

                <div className="mt-3 space-y-4 text-sm">
                  {/* 확인 필요 */}
                  {c.sugByLocal.size > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-amber-700">
                        사람이 골라야 하는 학생
                      </h3>
                      <ul className="mt-1 space-y-2">
                        {Array.from(c.sugByLocal.entries()).map(
                          ([lid, cands]) => {
                            const l = c.local.find((s) => s.id === lid);
                            if (!l) return null;
                            return (
                              <li
                                key={lid}
                                className="rounded-lg bg-white p-2 ring-1 ring-slate-200"
                              >
                                <div className="text-sm">
                                  <b>{l.name}</b>{" "}
                                  <span className="text-xs text-slate-400">
                                    학생 {fmtPhone(l.student_phone)} · 학부모{" "}
                                    {fmtPhone(l.parent_phone)}
                                  </span>
                                  <span className={`ml-1 ${pill("mute")}`}>
                                    {cands[0].reason === "parent-phone"
                                      ? "학부모 번호만 같음"
                                      : "같은 이름 여럿"}
                                  </span>
                                </div>
                                <ul className="mt-1 space-y-1">
                                  {cands.map((h) => (
                                    <li
                                      key={h.hr_student_id}
                                      className="flex flex-wrap items-center gap-2 text-xs"
                                    >
                                      <span className="font-medium text-slate-700">
                                        {h.hr_name}
                                      </span>
                                      <span className="text-slate-400">
                                        학생 {fmtPhone(h.hr_student_phone)} ·
                                        학부모 {fmtPhone(h.hr_parent_phone)}
                                      </span>
                                      <form
                                        action={linkStudentManual}
                                        className="ml-auto"
                                      >
                                        <input
                                          type="hidden"
                                          name="studentId"
                                          value={lid}
                                        />
                                        <input
                                          type="hidden"
                                          name="hrStudentId"
                                          value={h.hr_student_id}
                                        />
                                        <SubmitButton
                                          pendingText="…"
                                          className="rounded border border-brand px-2 py-0.5 text-[11px] font-medium text-brand hover:bg-brand-light"
                                        >
                                          이 학생으로 잇기
                                        </SubmitButton>
                                      </form>
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            );
                          },
                        )}
                      </ul>
                    </div>
                  )}

                  {/* 유스피킹에만 */}
                  {c.onlyLocal.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-amber-700">
                        유스피킹에만 있는 학생 — Student Card 학생과 잇거나,
                        없는 학생으로 표시하세요
                      </h3>
                      <ul className="mt-1 space-y-1.5">
                        {c.onlyLocal.map((s) => (
                          <li
                            key={s.id}
                            className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 ring-1 ring-slate-200"
                          >
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs text-slate-400">
                              {s.status === "pending"
                                ? "가입 승인 대기 · "
                                : ""}
                              학부모 {fmtPhone(s.parent_phone)}
                            </span>
                            <form
                              action={linkStudentManual}
                              className="ml-auto flex items-center gap-1.5"
                            >
                              <input
                                type="hidden"
                                name="studentId"
                                value={s.id}
                              />
                              <select
                                name="hrStudentId"
                                required
                                defaultValue=""
                                className={`${sel} text-xs`}
                              >
                                <option value="" disabled>
                                  Student Card 학생 선택
                                </option>
                                {c.cardFree.map((p) => (
                                  <option
                                    key={p.hr_student_id}
                                    value={p.hr_student_id}
                                  >
                                    {p.name} ({fmtPhone(p.parent_phone)})
                                  </option>
                                ))}
                              </select>
                              <SubmitButton
                                pendingText="…"
                                className="rounded-lg bg-brand px-2 py-1 text-xs font-medium text-white"
                              >
                                잇기
                              </SubmitButton>
                            </form>
                            <form action={setStudentLink}>
                              <input
                                type="hidden"
                                name="studentId"
                                value={s.id}
                              />
                              <input type="hidden" name="action" value="none" />
                              <ConfirmSubmitButton
                                message={`${s.name} 학생을 'Student Card 에 없는 학생' 으로 표시할까요?\n\n앞으로 자동으로 맞추지 않습니다. (테스트 계정 등)`}
                                className="text-[11px] text-slate-400 hover:text-slate-600"
                              >
                                없는 학생으로 표시
                              </ConfirmSubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                      {c.cardFree.length === 0 && (
                        <p className="mt-1 text-[11px] text-slate-400">
                          이 반에 남은 Student Card 학생이 없어요. 다른 반
                          학생이거나 Student Card 에 없는 학생일 수 있어요.
                        </p>
                      )}
                    </div>
                  )}

                  {/* 연락처 다름 */}
                  {c.diffs.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-amber-700">
                        연락처가 다른 학생 — 전환 중에는 기존 번호를 그대로
                        둡니다
                      </h3>
                      <ul className="mt-1 space-y-1">
                        {c.diffs.map((s) => {
                          const d = diffs.get(s.id)!;
                          return (
                            <li
                              key={s.id}
                              className="flex flex-wrap items-center gap-2 text-xs"
                            >
                              <span className="w-20 font-medium text-slate-700">
                                {s.name}
                              </span>
                              <span className="text-slate-500">
                                학부모 {fmtPhone(s.parent_phone)} →{" "}
                                <b>{fmtPhone(d.card_parent_phone)}</b> · 학생{" "}
                                {fmtPhone(s.student_phone)} →{" "}
                                <b>{fmtPhone(d.card_student_phone)}</b>
                              </span>
                              <form
                                action={applyContactDiff}
                                className="ml-auto"
                              >
                                <input
                                  type="hidden"
                                  name="studentId"
                                  value={s.id}
                                />
                                <ConfirmSubmitButton
                                  message={`${s.name} 학생의 연락처를 Student Card 번호로 바꿀까요?`}
                                  className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-100"
                                >
                                  Student Card 번호로
                                </ConfirmSubmitButton>
                              </form>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* 전화번호로 이은 학생 — 검토용 */}
                  {c.phoneLinked.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500">
                        전화번호로 이은 학생 (확인 권장)
                      </h3>
                      <ul className="mt-1 space-y-1">
                        {c.phoneLinked.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="font-medium text-slate-700">
                              {s.name}
                            </span>
                            <span className={pill("mute")}>
                              {METHOD_LABEL[s.hr_link_method ?? ""] ??
                                s.hr_link_method}
                            </span>
                            <form action={setStudentLink} className="ml-auto">
                              <input
                                type="hidden"
                                name="studentId"
                                value={s.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="unlink"
                              />
                              <ConfirmSubmitButton
                                message={`${s.name} 학생의 연결을 풀까요?`}
                                className="text-[11px] text-slate-400 hover:text-red-500"
                              >
                                연결 풀기
                              </ConfirmSubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Student Card 에만 */}
                  {c.cardFree.filter((p) => p.kind === "new").length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500">
                        Student Card 에만 있는 학생 —{" "}
                        {mode === "oneway"
                          ? "다음 동기화 때 가입 전으로 들어옵니다"
                          : "일원화를 켜면 가입 전으로 들어옵니다"}
                      </h3>
                      <p className="mt-1 text-xs text-slate-600">
                        {c.cardFree
                          .filter((p) => p.kind === "new")
                          .map((p) => p.name)
                          .join(", ")}
                      </p>
                    </div>
                  )}

                  {/* 없는 학생 표시 */}
                  {c.noCard.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-slate-500">
                        “Student Card 에 없음” 으로 표시한 학생
                      </h3>
                      <ul className="mt-1 space-y-1">
                        {c.noCard.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-center gap-2 text-xs"
                          >
                            <span className="text-slate-600">{s.name}</span>
                            <form action={setStudentLink} className="ml-auto">
                              <input
                                type="hidden"
                                name="studentId"
                                value={s.id}
                              />
                              <input
                                type="hidden"
                                name="action"
                                value="unlink"
                              />
                              <SubmitButton
                                pendingText="…"
                                className="text-[11px] text-slate-400 hover:text-brand"
                              >
                                표시 해제
                              </SubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {attention === 0 && c.phoneLinked.length === 0 && (
                    <p className="text-xs text-slate-400">
                      손볼 것이 없어요 🙂
                    </p>
                  )}
                </div>
              </details>
            );
          })}
          {perClass.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-400">
              이어진 반이 없어요. ② 반 매칭부터 해 주세요.
            </p>
          )}
        </div>
      </section>

      {/* ── 자동 변경 기록 ── */}
      <section className={`mt-6 ${card}`}>
        <h2 className="font-semibold">자동 변경 기록 (최근 30건)</h2>
        <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
          {(
            (logRows ?? []) as {
              id: number;
              at: string;
              kind: string;
              detail: string;
            }[]
          ).map((r) => (
            <li key={r.id} className="flex gap-2">
              <span className="w-28 shrink-0 text-slate-400">
                {new Date(r.at).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                  month: "2-digit",
                  day: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="w-24 shrink-0 text-slate-400">
                {LOG_LABEL[r.kind] ?? r.kind}
              </span>
              <span>{r.detail}</span>
            </li>
          ))}
          {(logRows ?? []).length === 0 && (
            <li className="text-slate-400">아직 기록이 없어요.</li>
          )}
        </ul>
      </section>
    </main>
  );
}

const LOG_LABEL: Record<string, string> = {
  class_linked: "반 연결",
  class_created: "반 생성",
  owner_changed: "담임 변경",
  student_linked: "학생 연결",
  student_created: "학생 추가",
  student_approved: "가입 승인",
  student_moved: "반 이동",
  student_withdrawn: "비활성",
  student_restored: "복귀",
  invite_sent: "가입 안내",
  parent_link_sent: "학부모 링크",
  mode_changed: "상태 변경",
};
