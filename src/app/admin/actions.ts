"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { setImpersonation } from "@/lib/teacher-context";
import {
  getWeeklyReportEmails,
  isKnownModel,
  parseEmails,
  setAiModel,
  setWeeklyReportEmails,
} from "@/lib/settings";
import { sendWeeklySummary } from "@/lib/weekly-send";
import { fetchHrClasses, hrConfigured } from "@/lib/hr/client";
import { generateClassCode } from "@/lib/class-code";
import { applyClassHandover } from "@/lib/transfers";
import { todayKST } from "@/lib/date";
import { runFullSync, syncLinkedClass } from "@/lib/hr/sync";
import { regenerateFeedback, BROKEN_FEEDBACK } from "@/lib/ai/evaluate";

// 운영자가 특정 선생님으로 대행 시작 → 선생님 대시보드로 이동
export async function impersonateTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  setImpersonation(teacherId);
  redirect("/teacher");
}

// 선생님 가입 신청 승인
export async function approveTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  const admin = createAdminClient();
  await admin
    .from("teachers")
    .update({ status: "approved" })
    .eq("id", teacherId);
  // Supabase 이메일 확인이 켜져 있어도 로그인되도록 자동 확인 처리
  try {
    await admin.auth.admin.updateUserById(teacherId, { email_confirm: true });
  } catch (e) {
    console.error("[선생님승인] 이메일 자동확인 실패:", e);
  }
  revalidatePath("/admin");
}

// 선생님 가입 신청 반려
export async function rejectTeacher(formData: FormData) {
  await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId) redirect("/admin");
  const admin = createAdminClient();
  await admin
    .from("teachers")
    .update({ status: "rejected" })
    .eq("id", teacherId);
  revalidatePath("/admin");
}

// 선생님 가입 내역(계정) 삭제. 인증 유저 삭제 → teachers·반·학생·과제 cascade.
export async function deleteTeacher(formData: FormData) {
  const me = await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  if (!teacherId || teacherId === me.id) redirect("/admin"); // 자기 자신 삭제 방지

  const admin = createAdminClient();
  // Auth 유저 삭제 시 teachers(on delete cascade) → classes → students/assignments 까지 정리됨
  const { error } = await admin.auth.admin.deleteUser(teacherId);
  if (error) {
    // 인증 유저가 없거나 실패 시, 프로필 행이라도 정리
    await admin.from("teachers").delete().eq("id", teacherId);
  }
  revalidatePath("/admin");
}

// 선생님 운영자 지정 / 해제 (role 변경). 자기 자신은 변경 불가.
export async function setTeacherRole(formData: FormData) {
  const me = await requireAdmin();
  const teacherId = String(formData.get("teacherId") || "");
  const role = String(formData.get("role") || "");
  if (!teacherId || (role !== "admin" && role !== "teacher"))
    redirect("/admin");
  if (teacherId === me.id) redirect("/admin"); // 실수로 자기 권한 해제 방지

  const admin = createAdminClient();
  // 운영자로 지정 시 승인 상태도 함께 보장
  const patch = role === "admin" ? { role, status: "approved" } : { role };
  await admin.from("teachers").update(patch).eq("id", teacherId);
  revalidatePath("/admin");
}

// ---------- 운영자 설정 ----------
export async function saveAiModel(formData: FormData) {
  await requireAdmin();
  const model = String(formData.get("model") || "");
  if (!isKnownModel(model)) {
    redirect("/admin/settings");
  }
  await setAiModel(model);
  redirect("/admin/settings?saved=1");
}

// ---------- Student Card 전환 도구 ----------
//
// 모든 동작은 운영자 확인을 거친다. 여기서 하는 일은 '이어 주기' 가 대부분이고,
// 기존 자료를 바꾸는 것(담임 변경·연락처 덮어쓰기·일원화 켜기)은 화면에서 한 번 더
// 확인을 받는다.

const HR = "/admin/hr";
const back = (q: Record<string, string>, hash = "") =>
  `${HR}?${new URLSearchParams(q).toString()}${hash}`;

async function logSync(row: {
  kind: string;
  class_id?: string | null;
  student_id?: string | null;
  detail: string;
}) {
  await createAdminClient().from("hr_sync_log").insert(row);
}

// 선생님 매칭: Student Card 담임 이름 ↔ 유스피킹 선생님
export async function linkTeacher(formData: FormData) {
  const me = await requireAdmin();
  const cardName = String(formData.get("cardName") || "").trim();
  const teacherId = String(formData.get("teacherId") || "");
  if (!cardName) redirect(HR);
  const admin = createAdminClient();

  if (!teacherId) {
    await admin
      .from("teacher_links")
      .delete()
      .eq("card_teacher_name", cardName);
    revalidatePath(HR);
    redirect(back({ done: `${cardName}: 연결을 해제했어요` }, "#teachers"));
  }
  await admin.from("teacher_links").upsert(
    {
      card_teacher_name: cardName,
      teacher_id: teacherId,
      method: "manual",
      linked_at: new Date().toISOString(),
      linked_by: me.id,
    },
    { onConflict: "card_teacher_name" },
  );
  revalidatePath(HR);
  redirect(back({ done: `${cardName}: 선생님을 이었어요` }, "#teachers"));
}

// 반 매칭: Student Card 반 ↔ 유스피킹 반 (빈 값이면 해제)
export async function linkClassPair(formData: FormData) {
  const me = await requireAdmin();
  const hrClassId = String(formData.get("hrClassId") || "");
  const classId = String(formData.get("classId") || "");
  if (!hrClassId) redirect(HR);
  const admin = createAdminClient();

  if (!classId) {
    const { data: prev } = await admin
      .from("class_links")
      .select("class_id")
      .eq("hr_class_id", hrClassId)
      .maybeSingle();
    await admin.from("class_links").delete().eq("hr_class_id", hrClassId);
    if (prev) {
      const cid = (prev as { class_id: string }).class_id;
      await admin.from("hr_pending_students").delete().eq("class_id", cid);
      await admin.from("hr_match_suggestions").delete().eq("class_id", cid);
    }
    revalidatePath(HR);
    redirect(back({ done: "반 연결을 해제했어요" }, "#classes"));
  }

  let card: { name: string } | undefined;
  try {
    card = (await fetchHrClasses()).find((c) => c.hrClassId === hrClassId);
  } catch (e) {
    redirect(
      back({ error: e instanceof Error ? e.message : "반 목록 조회 실패" }),
    );
  }
  if (!card)
    redirect(back({ error: "Student Card 에서 그 반을 찾지 못했어요" }));

  // 한 유스피킹 반에는 Student Card 반 하나만 — 예전 연결을 정리한다
  await admin.from("class_links").delete().eq("class_id", classId);
  await admin.from("class_links").delete().eq("hr_class_id", hrClassId);
  const { error } = await admin.from("class_links").insert({
    class_id: classId,
    hr_class_id: hrClassId,
    hr_class_name: card!.name,
    linked_at: new Date().toISOString(),
    linked_by: me.id,
  });
  if (error) redirect(back({ error: error.message }));
  await logSync({
    kind: "class_linked",
    class_id: classId,
    detail: `↔ ${card!.name} (운영자)`,
  });

  // 이어 준 직후 학생을 맞춰 결과를 그 자리에서 보여 준다
  const r = await syncLinkedClass(classId);
  revalidatePath(HR);
  redirect(
    back(
      {
        done: r?.error
          ? `반을 이었지만 명단을 받지 못했어요 — ${r.error}`
          : `반을 이었어요 · 학생 ${r?.linked ?? 0}명 연결 · 확인 필요 ${r?.pendingAmbiguous ?? 0}명`,
      },
      "#classes",
    ),
  );
}

// Student Card 반을 유스피킹에 새로 만든다 (담임 = 이어진 선생님)
export async function createClassFromCard(formData: FormData) {
  const me = await requireAdmin();
  const hrClassId = String(formData.get("hrClassId") || "");
  const teacherId = String(formData.get("teacherId") || "");
  if (!hrClassId || !teacherId) {
    redirect(back({ error: "담임 선생님을 먼저 정해 주세요" }, "#classes"));
  }
  const admin = createAdminClient();

  let card: { name: string } | undefined;
  try {
    card = (await fetchHrClasses()).find((c) => c.hrClassId === hrClassId);
  } catch (e) {
    redirect(
      back({ error: e instanceof Error ? e.message : "반 목록 조회 실패" }),
    );
  }
  if (!card)
    redirect(back({ error: "Student Card 에서 그 반을 찾지 못했어요" }));

  let classId: string | null = null;
  for (let attempt = 0; attempt < 5 && !classId; attempt++) {
    const { data, error } = await admin
      .from("classes")
      .insert({
        teacher_id: teacherId,
        name: card!.name,
        class_code: generateClassCode(),
      })
      .select("id")
      .single();
    if (!error && data) classId = (data as { id: string }).id;
    else if (error?.code !== "23505")
      redirect(back({ error: error?.message ?? "반 생성 실패" }));
  }
  if (!classId)
    redirect(back({ error: "반 코드를 만들지 못했어요. 다시 시도해 주세요" }));

  await admin.from("class_links").insert({
    class_id: classId,
    hr_class_id: hrClassId,
    hr_class_name: card!.name,
    linked_by: me.id,
  });
  await logSync({
    kind: "class_created",
    class_id: classId,
    detail: `${card!.name} (운영자)`,
  });
  const r = await syncLinkedClass(classId!);
  revalidatePath(HR);
  revalidatePath("/admin");
  redirect(
    back(
      {
        done: `${card!.name} 반을 만들었어요 · 학생 ${r?.created ?? 0}명 가입 전으로 추가`,
      },
      "#classes",
    ),
  );
}

// 유스피킹 반의 담임을 Student Card 담임으로 바꾼다 (기존 자료 변경 — 화면에서 확인)
export async function applyCardTeacher(formData: FormData) {
  await requireAdmin();
  const classId = String(formData.get("classId") || "");
  const teacherId = String(formData.get("teacherId") || "");
  if (!classId || !teacherId) redirect(HR);
  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("name, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!klass) redirect(HR);
  const k = klass as { name: string; teacher_id: string };
  if (k.teacher_id !== teacherId) {
    await applyClassHandover({
      classId,
      toTeacherId: teacherId,
      coteachStart: null,
      effective: todayKST(),
    });
    await logSync({
      kind: "owner_changed",
      class_id: classId,
      detail: `${k.name}: 담임 변경 (운영자, Student Card 기준)`,
    });
  }
  revalidatePath(HR);
  redirect(
    back(
      { done: `${k.name}: 담임을 Student Card 기준으로 바꿨어요` },
      "#classes",
    ),
  );
}

// 학생 수동 연결: 유스피킹 학생 ↔ Student Card 학생
export async function linkStudentManual(formData: FormData) {
  await requireAdmin();
  const studentId = String(formData.get("studentId") || "");
  const hrStudentId = String(formData.get("hrStudentId") || "");
  if (!studentId || !hrStudentId) redirect(back({}, "#students"));
  const admin = createAdminClient();

  const { data: pend } = await admin
    .from("hr_pending_students")
    .select("student_phone, parent_phone, name, class_id")
    .eq("hr_student_id", hrStudentId)
    .maybeSingle();
  const { data: stu } = await admin
    .from("students")
    .select("name, class_id, student_phone, parent_phone, status")
    .eq("id", studentId)
    .maybeSingle();
  if (!stu) redirect(back({}, "#students"));
  const s = stu as {
    name: string;
    class_id: string;
    student_phone: string | null;
    parent_phone: string | null;
    status: string;
  };
  const p = pend as {
    student_phone: string | null;
    parent_phone: string | null;
    name: string;
  } | null;

  // 비어 있는 연락처만 채운다 (기존 번호는 그대로)
  const patch: Record<string, unknown> = {
    hr_student_id: hrStudentId,
    hr_link_method: "manual",
  };
  if (!s.student_phone && p?.student_phone)
    patch.student_phone = p.student_phone;
  if (!s.parent_phone && p?.parent_phone) patch.parent_phone = p.parent_phone;

  const { error } = await admin
    .from("students")
    .update(patch)
    .eq("id", studentId);
  if (error) {
    redirect(
      back(
        {
          error:
            error.code === "23505"
              ? "그 Student Card 학생은 이미 다른 유스피킹 학생과 이어져 있어요"
              : error.message,
        },
        "#students",
      ),
    );
  }
  await Promise.all([
    admin.from("hr_pending_students").delete().eq("hr_student_id", hrStudentId),
    admin
      .from("hr_match_suggestions")
      .delete()
      .eq("local_student_id", studentId),
    admin
      .from("hr_match_suggestions")
      .delete()
      .eq("hr_student_id", hrStudentId),
  ]);
  await logSync({
    kind: "student_linked",
    class_id: s.class_id,
    student_id: studentId,
    detail: `${s.name} ↔ ${p?.name ?? hrStudentId} (운영자)`,
  });
  revalidatePath(HR);
  redirect(back({ done: `${s.name}: 이었어요` }, "#students"));
}

// 학생 연결 해제 / 'Student Card 에 없음' 표시 / 표시 해제
export async function setStudentLink(formData: FormData) {
  await requireAdmin();
  const studentId = String(formData.get("studentId") || "");
  const action = String(formData.get("action") || "");
  if (!studentId) redirect(back({}, "#students"));
  const admin = createAdminClient();
  const patch =
    action === "none"
      ? { hr_student_id: null, hr_link_method: "none" }
      : { hr_student_id: null, hr_link_method: null };
  await admin.from("students").update(patch).eq("id", studentId);
  await admin
    .from("hr_match_suggestions")
    .delete()
    .eq("local_student_id", studentId);
  await admin.from("hr_contact_diffs").delete().eq("student_id", studentId);
  revalidatePath(HR);
  redirect(
    back(
      {
        done:
          action === "none"
            ? "Student Card 에 없는 학생으로 표시했어요 (다시 맞추지 않아요)"
            : "연결을 풀었어요. 다음 동기화 때 다시 맞춥니다",
      },
      "#students",
    ),
  );
}

// 연락처 차이: Student Card 번호로 바꾼다 (기존 번호 변경 — 화면에서 확인)
export async function applyContactDiff(formData: FormData) {
  await requireAdmin();
  const studentId = String(formData.get("studentId") || "");
  if (!studentId) redirect(back({}, "#students"));
  const admin = createAdminClient();
  const { data } = await admin
    .from("hr_contact_diffs")
    .select("card_student_phone, card_parent_phone")
    .eq("student_id", studentId)
    .maybeSingle();
  const d = data as {
    card_student_phone: string | null;
    card_parent_phone: string | null;
  } | null;
  if (d) {
    const patch: Record<string, string> = {};
    if (d.card_student_phone) patch.student_phone = d.card_student_phone;
    if (d.card_parent_phone) patch.parent_phone = d.card_parent_phone;
    if (Object.keys(patch).length) {
      await admin.from("students").update(patch).eq("id", studentId);
    }
    await admin.from("hr_contact_diffs").delete().eq("student_id", studentId);
  }
  revalidatePath(HR);
  redirect(
    back({ done: "연락처를 Student Card 번호로 바꿨어요" }, "#students"),
  );
}

// 지금 동기화
export async function syncAllRosters() {
  await requireAdmin();
  if (!hrConfigured()) {
    redirect(
      back({ error: "STUDENT_CARD_ROSTER_KEY 환경변수를 먼저 등록해 주세요." }),
    );
  }
  let msg = "";
  try {
    const s = await runFullSync();
    const linked = s.reports.reduce((n, r) => n + r.linked, 0);
    const created = s.reports.reduce((n, r) => n + r.created, 0);
    const amb = s.reports.reduce((n, r) => n + r.pendingAmbiguous, 0);
    msg =
      `선생님 ${s.teachersLinked}명 · 반 ${s.classesLinked + s.classesCreated}개 · 학생 ${linked}명 이음` +
      (created ? ` · 가입 전 학생 ${created}명 추가` : "") +
      (s.studentsMoved ? ` · 반 이동 ${s.studentsMoved}명` : "") +
      (s.studentsWithdrawn ? ` · 비활성 ${s.studentsWithdrawn}명` : "") +
      (amb ? ` · 확인 필요 ${amb}명` : "");
  } catch (e) {
    console.error("[Student Card] 동기화 실패:", e);
    redirect(back({ error: e instanceof Error ? e.message : "동기화 실패" }));
  }
  revalidatePath(HR);
  redirect(back({ done: msg }));
}

// 일원화 켜기 / 끄기
export async function setSyncMode(formData: FormData) {
  await requireAdmin();
  const mode =
    String(formData.get("mode") || "") === "oneway" ? "oneway" : "convert";
  await createAdminClient()
    .from("app_settings")
    .update({ hr_sync_mode: mode })
    .eq("id", 1);
  await logSync({
    kind: "mode_changed",
    detail:
      mode === "oneway" ? "일원화 켬 (운영자)" : "전환 상태로 되돌림 (운영자)",
  });
  revalidatePath(HR);
  revalidatePath("/teacher");
  redirect(
    back({
      done:
        mode === "oneway"
          ? "일원화를 켰어요. 다음 동기화부터 Student Card 를 따릅니다 (지금 동기화를 누르면 바로 적용)"
          : "전환 상태로 되돌렸어요. 자동 생성·이동·비활성화를 멈춥니다",
    }),
  );
}

// ---------- 주간 요약 ----------

export async function saveWeeklyReportEmails(formData: FormData) {
  await requireAdmin();

  // 두 가지 방법으로 들어온다.
  //  · picked : 슬랙 멤버 목록에서 체크한 것 (평소)
  //  · emails : 목록을 못 읽었을 때 직접 적은 것
  // 둘을 합쳐 두면, 목록에 없는 사람(외부 게스트 등)을 더해 둘 수도 있다.
  const picked = formData.getAll("picked").map(String);
  const raw = [String(formData.get("emails") || ""), ...picked].join("\n");
  const { ok, bad } = parseEmails(raw);

  // 형태가 틀린 값이 섞여 있으면 저장하지 않고 알린다. 조용히 버리면
  // 담당자는 등록했다고 믿는데 알림만 안 오는 상태가 된다.
  if (bad.length) {
    redirect(
      "/admin/settings?error=" +
        encodeURIComponent(
          `이메일 형식이 아닌 값이 있어요 — ${bad.slice(0, 3).join(", ")}`,
        ),
    );
  }

  await setWeeklyReportEmails(ok);
  redirect("/admin/settings?saved=weekly");
}

// 지금 바로 한 번 보내 보기 (월요일까지 기다리지 않고 내용을 확인한다).
// 지정된 사람 전원에게 실제로 가므로, 화면에서 한 번 더 확인을 받는다.
export async function sendWeeklyReportNow() {
  await requireAdmin();
  const emails = await getWeeklyReportEmails();
  if (emails.length === 0) {
    redirect(
      "/admin/settings?error=" +
        encodeURIComponent("받는 사람을 먼저 지정해 주세요."),
    );
  }

  let note = "";
  try {
    const r = await sendWeeklySummary(1);
    // 그림이 아니라 글로 나갔으면 왜 그런지 알려 준다. 그러지 않으면
    // '보냈다' 는 말만 보고 그림이 간 줄로 안다.
    if (r.fellBackTo) note = ` — 그림 대신 글로 보냈어요 (${r.fellBackTo})`;
  } catch (e) {
    console.error("[주간요약] 수동 발송 실패:", e);
    redirect(
      "/admin/settings?error=" +
        encodeURIComponent(e instanceof Error ? e.message : "발송 실패"),
    );
  }

  redirect(
    "/admin/settings?saved=" +
      encodeURIComponent(`sent:${emails.length}${note}`),
  );
}

// ---------- 피드백 다시 만들기 ----------
//
// 피드백 생성이 실패해 '정리하는 중' 이나 예전 기본 문구가 남은 제출을 찾아,
// 저장된 점수로 피드백만 다시 만든다 (녹음을 다시 채점하지 않는다).
// 한 번 누를 때 FEEDBACK_BATCH 건씩 — 한 건에 20~40초 걸려 함수 실행시간을 넘기지 않게.
const FEEDBACK_BATCH = 8;
const FEEDBACK_CONCURRENCY = 4;

export async function regenerateBrokenFeedback() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin
    .from("submissions")
    .select("id")
    .eq("status", "evaluated")
    .in("student_feedback", BROKEN_FEEDBACK)
    .order("created_at", { ascending: false })
    .limit(FEEDBACK_BATCH);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length === 0) {
    redirect(`/admin?fb=${encodeURIComponent("다시 만들 피드백이 없어요")}`);
  }

  let ok = 0;
  let failed = 0;
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: FEEDBACK_CONCURRENCY }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        try {
          await regenerateFeedback(id);
          ok++;
        } catch (e) {
          failed++;
          console.error("[피드백 다시 만들기] 실패:", id, e);
        }
      }
    }),
  );

  revalidatePath("/admin");
  const msg = [`피드백 ${ok}건을 다시 만들었어요`];
  if (failed) msg.push(`${failed}건 실패 — 잠시 뒤 다시 눌러 주세요`);
  redirect(`/admin?fb=${encodeURIComponent(msg.join(" · "))}`);
}
