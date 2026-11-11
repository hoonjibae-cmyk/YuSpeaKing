"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacherContext, clearImpersonation } from "@/lib/teacher-context";
import { resolveNoticeAudience } from "@/lib/notices";
import { sendPushToStudents } from "@/lib/push";
import { applyClassHandover, moveStudentToClass } from "@/lib/transfers";
import { generateClassCode } from "@/lib/class-code";
import { getSyncMode } from "@/lib/hr/sync";
import { todayKST } from "@/lib/date";
import { synthesizeSpeech } from "@/lib/ai/tts";
import { normalizeVoice } from "@/lib/tts-voices";
import { hashPassword } from "@/lib/student-session";
import { notifyTeacher } from "@/lib/slack";
import { evaluateSubmission, regenerateFeedback } from "@/lib/ai/evaluate";
import { gatherMonthly } from "@/lib/monthly";
import { generateMonthlyReportDraft } from "@/lib/ai/monthly-report";
import { appOrigin } from "@/lib/app-url";
import { canGrantCoupons } from "@/lib/coupon-helpers";
import {
  alimtalkConfigured,
  bareLink,
  normalizePhone,
  sendAlimtalk,
} from "@/lib/solapi";
import { listUninvited, type Uninvited } from "@/lib/invites";
import { listParentLinks, canManageClass } from "@/lib/parent-links";
import { hrConfigured } from "@/lib/hr/client";
import { syncAll, type SyncReport } from "@/lib/hr/sync";

// 정상 속도 + 느린 샘플 음성 2종 생성 → Storage 업로드 → URL 저장
async function generateAndStoreSamples(
  assignmentId: string,
  passageText: string,
  voice?: string,
) {
  const admin = createAdminClient();
  const [normal, slow] = await Promise.all([
    synthesizeSpeech(passageText, "normal", voice),
    synthesizeSpeech(passageText, "slow", voice),
  ]);
  const normalPath = `${assignmentId}.mp3`;
  const slowPath = `${assignmentId}_slow.mp3`;
  await Promise.all([
    admin.storage
      .from("sample-audio")
      .upload(normalPath, normal, { contentType: "audio/mpeg", upsert: true }),
    admin.storage
      .from("sample-audio")
      .upload(slowPath, slow, { contentType: "audio/mpeg", upsert: true }),
  ]);
  const normalUrl = admin.storage.from("sample-audio").getPublicUrl(normalPath)
    .data.publicUrl;
  const slowUrl = admin.storage.from("sample-audio").getPublicUrl(slowPath)
    .data.publicUrl;
  await admin
    .from("assignments")
    .update({ sample_audio_url: normalUrl, sample_audio_slow_url: slowUrl })
    .eq("id", assignmentId);
}

// Student Card 일원화 중에는 반·학생을 Student Card 에서만 받는다.
// 선생님이 직접 만들면 Student Card 와 어긋난 반·학생이 섞여 같은 학생이 두 번
// 생기거나 동기화가 엉뚱한 반을 건드린다. 운영자는 정리를 위해 예외로 둔다.
async function blockedByCardSync(role: string): Promise<boolean> {
  return role !== "admin" && (await getSyncMode()) === "oneway";
}
const CARD_ONLY =
  "반과 학생은 Student Card 에서 들어옵니다. 바꿀 것이 있으면 Student Card 에서 고쳐 주세요";

// ---------- 인증 ----------

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error)
    redirect(`/teacher/login?error=${encodeURIComponent(error.message)}`);

  // 운영자는 로그인 즉시 운영자 대시보드로
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    const { data: me } = await supabase
      .from("teachers")
      .select("role")
      .eq("id", user.id)
      .single();
    if (me?.role === "admin") redirect("/admin");
  }
  redirect("/teacher");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "").trim();
  // 로그인 이메일 = Slack 이메일 (하나만 사용)
  const slackEmail = email;

  if (!email || !password || !name) {
    redirect(
      `/teacher/login?mode=signup&error=${encodeURIComponent(
        "이름·이메일·비밀번호를 모두 입력해 주세요",
      )}`,
    );
  }

  const supabase = createClient();
  const { data: signUpData, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, slack_email: slackEmail } },
  });
  if (error) {
    redirect(
      `/teacher/login?mode=signup&error=${encodeURIComponent(error.message)}`,
    );
  }

  // 자체 승인 체계를 쓰므로 Supabase 이메일 확인은 불필요 → 자동 확인 처리
  // (그렇지 않으면 'Email not confirmed'로 로그인이 막힘)
  try {
    const admin = createAdminClient();
    if (signUpData.user?.id) {
      await admin.auth.admin.updateUserById(signUpData.user.id, {
        email_confirm: true,
      });
    }
  } catch (e) {
    console.error("[선생님가입] 이메일 자동확인 실패:", e);
  }

  // 총괄관리자(admin)에게 가입 신청 Slack DM (best-effort)
  try {
    const admin = createAdminClient();
    const { data: admins } = await admin
      .from("teachers")
      .select("email, slack_email")
      .eq("role", "admin");
    const approveUrl = `${appOrigin()}/admin`;
    const text =
      `🧑‍🏫 유스피킹앱 선생님 가입 신청\n` +
      `• 이름: ${name}\n` +
      `• 이메일: ${email}\n` +
      `👉 승인하러 가기: ${approveUrl}`;
    for (const a of (admins ?? []) as {
      email?: string;
      slack_email?: string;
    }[]) {
      await notifyTeacher(a.slack_email || a.email, text);
    }
  } catch (e) {
    console.error("[선생님가입] 관리자 알림 실패:", e);
  }

  redirect("/teacher/login?signup=pending");
}

export async function signOut() {
  clearImpersonation();
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/teacher/login");
}

// 운영자 대행 종료 → 운영자 대시보드로
export async function stopImpersonating() {
  clearImpersonation();
  redirect("/admin");
}

// ---------- 반 ----------

export async function createClass(formData: FormData) {
  const { db, effectiveId, role } = await getTeacherContext();
  if (await blockedByCardSync(role)) {
    redirect(`/teacher?error=${encodeURIComponent(CARD_ONLY)}`);
  }
  const name = String(formData.get("name") || "").trim();
  if (!name) redirect("/teacher?error=반+이름을+입력하세요");

  // 유니크 코드 확보 (충돌 시 재시도)
  let code = generateClassCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await db
      .from("classes")
      .insert({ teacher_id: effectiveId, name, class_code: code });
    if (!error) break;
    if (error.code === "23505") {
      code = generateClassCode();
      continue;
    }
    redirect(`/teacher?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/teacher");
}

// 반 이름 변경 (담임만 가능)
export async function renameClass(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const name = String(formData.get("name") || "").trim();
  if (!classId) redirect("/teacher");
  if (!name) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent("반 이름을 입력해 주세요")}`,
    );
  }

  const { error } = await db
    .from("classes")
    .update({ name })
    .eq("id", classId)
    .eq("teacher_id", effectiveId); // 담임 본인 반만
  if (error) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent(error.message)}`,
    );
  }

  revalidatePath("/teacher");
  revalidatePath(`/teacher/classes/${classId}`);
  redirect(`/teacher/classes/${classId}?renamed=${encodeURIComponent(name)}`);
}

// 반 보관(아카이브): 목록에서 숨기되 데이터는 유지
export async function archiveClass(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  if (!classId) redirect("/teacher");
  await db
    .from("classes")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", classId)
    .eq("teacher_id", effectiveId);
  revalidatePath("/teacher");
  revalidatePath("/teacher/archived");
  redirect("/teacher");
}

// 보관 반 복원
export async function unarchiveClass(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  if (!classId) redirect("/teacher/archived");
  await db
    .from("classes")
    .update({ archived_at: null })
    .eq("id", classId)
    .eq("teacher_id", effectiveId);
  revalidatePath("/teacher");
  revalidatePath("/teacher/archived");
  redirect("/teacher");
}

// ---------- 반 이동 / 인수인계 ----------

// Slack 알림 대상 이메일 조회
async function teacherContact(teacherId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("teachers")
    .select("name, email, slack_email")
    .eq("id", teacherId)
    .maybeSingle();
  return data as { name?: string; email?: string; slack_email?: string } | null;
}

async function notifyTeacherById(teacherId: string, text: string) {
  try {
    const t = await teacherContact(teacherId);
    await notifyTeacher(t?.slack_email || t?.email, text);
  } catch (e) {
    console.error("[인수인계] Slack 알림 실패:", e);
  }
}

function transfersUrl(): string {
  return `${appOrigin()}/teacher/transfers`;
}

// 학생 반 이동.
//  target = "class:<id>"   → 내 다른 반으로 즉시 이동
//  target = "teacher:<id>" → 다른 선생님께 인수인계 요청
export async function moveStudent(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const target = String(formData.get("target") || "");
  // 이동일(비우면 오늘). 미래 날짜면 그 날짜에 자동 반영된다.
  const effectiveDate =
    String(formData.get("effective_date") || "") || todayKST();
  const back = `/teacher/move?classId=${classId}`;
  if (!studentId || !target) redirect(back);

  // 내가 담임인 반의 학생인지 확인.
  // 학생 조회만으로는 모자란다 — 보조강사도 명단을 '볼' 수는 있기 때문에,
  // 반의 담임이 나인지를 따로 확인해야 남의 반 학생을 옮기지 못한다.
  const { data: srcClass } = await db
    .from("classes")
    .select("id, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!srcClass || srcClass.teacher_id !== effectiveId) redirect(back);

  const { data: student } = await db
    .from("students")
    .select("id, name, class_id")
    .eq("id", studentId)
    .eq("class_id", classId)
    .maybeSingle();
  if (!student) redirect(back);

  const [type, id] = target.split(":");

  const admin = createAdminClient();

  if (type === "class") {
    // 같은 선생님 반 내 이동 — 요청 없이 처리
    const { data: dest } = await db
      .from("classes")
      .select("id, name")
      .eq("id", id)
      .eq("teacher_id", effectiveId)
      .maybeSingle();
    if (!dest)
      redirect(
        `${back}&error=${encodeURIComponent("옮길 반을 찾을 수 없어요")}`,
      );

    if (effectiveDate <= todayKST()) {
      await moveStudentToClass(studentId, id);
      revalidatePath(`/teacher/classes/${classId}`);
      revalidatePath(`/teacher/classes/${id}`);
      redirect(`${back}&moved=${encodeURIComponent(student.name)}`);
    }

    // 미래 날짜 → 예약
    const { error: schedErr } = await admin.from("transfer_requests").insert({
      kind: "student",
      student_id: studentId,
      class_id: classId,
      target_class_id: id,
      from_teacher_id: effectiveId,
      to_teacher_id: effectiveId,
      requested_by: effectiveId,
      status: "accepted", // 같은 선생님이므로 승인 절차 없음
      effective_date: effectiveDate,
    });
    if (schedErr) {
      const msg =
        schedErr.code === "23505"
          ? "이미 이동이 예약된 학생이에요"
          : schedErr.message || "예약에 실패했어요";
      redirect(`${back}&error=${encodeURIComponent(msg)}`);
    }
    revalidatePath(back);
    redirect(`${back}&scheduled=${encodeURIComponent(effectiveDate)}`);
  }

  if (type !== "teacher") redirect(back);

  // 다른 선생님께 인수인계 요청
  const { error } = await admin.from("transfer_requests").insert({
    kind: "student",
    student_id: studentId,
    class_id: classId,
    from_teacher_id: effectiveId,
    to_teacher_id: id,
    requested_by: effectiveId,
    effective_date: effectiveDate,
  });
  if (error) {
    const msg =
      error.code === "23505"
        ? "이미 요청 중인 학생이에요"
        : error.message || "요청에 실패했어요";
    redirect(`${back}&error=${encodeURIComponent(msg)}`);
  }

  const me = await teacherContact(effectiveId);
  await notifyTeacherById(
    id,
    `🔀 유스피킹앱 학생 인수인계 요청\n` +
      `• 학생: ${student.name}\n` +
      `• 보내는 선생님: ${me?.name ?? "선생님"}\n` +
      `• 이동 예정일: ${effectiveDate}\n` +
      `👉 수락하러 가기: ${transfersUrl()}`,
  );

  revalidatePath(back);
  redirect(`${back}&requested=1`);
}

// 반 담임 인수인계 요청. direction: 'give'(내 반을 넘김) | 'take'(남의 반을 받음)
// 운영자가 하면 요청·수락 없이 바로 옮긴다.
export async function requestClassTransfer(formData: FormData) {
  const { effectiveId, role } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const otherTeacherId = String(formData.get("teacherId") || "");
  const direction = String(formData.get("direction") || "give");
  // 받아오기는 내 반이 아니므로 반 상세로 돌아갈 수 없다 → 인수인계 목록으로
  const back =
    direction === "give" ? `/teacher/classes/${classId}` : "/teacher/transfers";
  // 넘길 때만 받을 선생님을 고른다. 받아올 때는 반의 현재 담임이 상대가 된다.
  if (!classId || (direction === "give" && !otherTeacherId)) redirect(back);

  const admin = createAdminClient();
  const { data: klass } = await admin
    .from("classes")
    .select("id, name, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!klass) redirect(back);

  const give = direction === "give";
  // give: 내가 현재 담임 → 상대에게 넘김 (otherTeacherId = 받을 선생님)
  // take: 상대가 담임 → 내가 받음 (반의 현재 담임이 상대)
  const fromTeacher = give ? effectiveId : klass.teacher_id;
  const toTeacher = give ? otherTeacherId : effectiveId;

  if (klass.teacher_id !== fromTeacher) {
    redirect(
      `${back}?error=${encodeURIComponent("담임 정보가 바뀌었어요. 새로고침해 주세요")}`,
    );
  }
  if (fromTeacher === toTeacher) redirect(back);

  // 공동 관리 기간: 시작일을 넣으면 그 기간 동안 두 선생님이 함께 관리하고,
  // 종료일(= 담임 변경일)에 새 담임에게 완전히 넘어간다.
  const coteachStart = String(formData.get("coteach_start") || "") || null;
  const effectiveDate =
    String(formData.get("effective_date") || "") || todayKST();
  if (coteachStart && coteachStart > effectiveDate) {
    redirect(
      `${back}?error=${encodeURIComponent("공동 관리 시작일은 담임 변경일보다 앞서야 해요")}`,
    );
  }

  // ── 운영자: 요청·수락 단계를 건너뛰고 바로 옮긴다 ──
  // 운영자가 대행 중이어도 실제 로그인한 사람이 운영자면 여기로 온다.
  if (role === "admin") {
    // 이 반에 걸려 있던 요청(대기·예약)은 운영자 결정으로 대신한다.
    // 그대로 두면 한 반에 열린 요청은 하나뿐이라는 제약에 걸려 저장이 안 된다.
    await admin
      .from("transfer_requests")
      .update({ status: "canceled", resolved_at: new Date().toISOString() })
      .eq("kind", "class")
      .eq("class_id", classId)
      .is("applied_at", null)
      .in("status", ["pending", "accepted"]);
    // 취소된 인수인계가 줬던 공동 관리 권한도 거둔다. 한 반에 열린 인수인계는
    // 하나뿐이라 이 반의 'full' 권한은 그 건이 준 것이다. 그대로 두면 예전
    // 받을 사람이 새 담임 변경일까지 반을 계속 관리할 수 있다.
    // (보조강사 role='coupon' 은 담임과 무관하므로 건드리지 않는다)
    await admin
      .from("class_coteachers")
      .delete()
      .eq("class_id", classId)
      .eq("role", "full");

    // 기록을 먼저 남기고 옮긴다. 옮기는 도중 실패해도 '수락됨·미적용' 기록이
    // 남아 있으므로 매일 도는 예약 이동(applyDueTransfers)이 이어서 처리한다.
    // (반대로 하면 반은 옮겨졌는데 기록이 없는 상태가 생길 수 있다)
    const now = new Date().toISOString();
    const { data: rec, error: adminErr } = await admin
      .from("transfer_requests")
      .insert({
        kind: "class",
        class_id: classId,
        from_teacher_id: fromTeacher,
        to_teacher_id: toTeacher,
        requested_by: effectiveId,
        effective_date: effectiveDate,
        coteach_start: coteachStart,
        status: "accepted",
        resolved_at: now,
      })
      .select("id")
      .single();
    if (adminErr || !rec) {
      redirect(
        `${back}?error=${encodeURIComponent(adminErr?.message || "이동에 실패했어요")}`,
      );
    }

    const { dueNow } = await applyClassHandover({
      classId,
      toTeacherId: toTeacher,
      coteachStart,
      effective: effectiveDate,
    });
    // 미래 날짜면 applied_at 을 비워 두어 그날 크론이 담임을 바꾼다
    if (dueNow) {
      await admin
        .from("transfer_requests")
        .update({ applied_at: new Date().toISOString() })
        .eq("id", rec.id);
    }

    // 두 선생님 모두에게 알린다 (운영자가 처리했으니 둘 다 모르는 상태다)
    const [fromC, toC] = await Promise.all([
      teacherContact(fromTeacher),
      teacherContact(toTeacher),
    ]);
    const msg =
      `🔀 유스피킹앱 반 담임 변경 (운영자 처리)\n` +
      `• 반: ${klass.name}\n` +
      `• ${fromC?.name ?? "이전 담임"} → ${toC?.name ?? "새 담임"}\n` +
      (coteachStart
        ? `• 공동 관리: ${coteachStart} ~ ${effectiveDate}\n`
        : "") +
      (dueNow
        ? `• 지금 옮겼습니다.`
        : `• ${effectiveDate}에 자동으로 옮겨집니다.`);
    await Promise.all([
      notifyTeacherById(fromTeacher, msg),
      notifyTeacherById(toTeacher, msg),
    ]);

    revalidatePath("/teacher");
    revalidatePath("/teacher/transfers");
    revalidatePath(`/teacher/classes/${classId}`);
    // 넘긴 반은 더 이상 내 반이 아니므로 반 화면 대신 목록으로 돌아간다
    redirect(
      `/teacher/transfers?moved=${encodeURIComponent(
        dueNow
          ? `${klass.name} 반을 옮겼어요`
          : `${klass.name} 반이 ${effectiveDate}에 옮겨집니다`,
      )}`,
    );
  }

  const { error } = await admin.from("transfer_requests").insert({
    kind: "class",
    class_id: classId,
    from_teacher_id: fromTeacher,
    to_teacher_id: toTeacher,
    requested_by: effectiveId,
    effective_date: effectiveDate,
    coteach_start: coteachStart,
  });
  if (error) {
    const msg =
      error.code === "23505"
        ? "이미 인수인계 요청 중인 반이에요"
        : error.message || "요청에 실패했어요";
    redirect(`${back}?error=${encodeURIComponent(msg)}`);
  }

  const me = await teacherContact(effectiveId);
  const counterparty = give ? toTeacher : fromTeacher;
  await notifyTeacherById(
    counterparty,
    `🔀 유스피킹앱 반 인수인계 요청\n` +
      `• 반: ${klass.name}\n` +
      `• 요청: ${me?.name ?? "선생님"} 님이 ${
        give
          ? "이 반의 담임을 넘기려고 합니다"
          : "이 반의 담임을 맡으려고 합니다"
      }\n` +
      (coteachStart
        ? `• 공동 관리: ${coteachStart} ~ ${effectiveDate}\n• 담임 변경일: ${effectiveDate}\n`
        : `• 담임 변경일: ${effectiveDate}\n`) +
      `👉 수락하러 가기: ${transfersUrl()}`,
  );

  revalidatePath(back);
  redirect(`${back}?requested=1`);
}

// 요청 수락 — 상대편(요청자가 아닌 쪽)만 수락할 수 있다
export async function acceptTransfer(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const requestId = String(formData.get("requestId") || "");
  const targetClassId = String(formData.get("targetClassId") || "");
  const back = "/teacher/transfers";
  if (!requestId) redirect(back);

  const admin = createAdminClient();
  const { data: reqRow } = await admin
    .from("transfer_requests")
    .select(
      "id, kind, student_id, class_id, from_teacher_id, to_teacher_id, requested_by, status, effective_date, coteach_start",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!reqRow || reqRow.status !== "pending") redirect(back);

  // 수락 권한: 요청을 보낸 사람이 아니면서, 당사자여야 한다
  const involved =
    reqRow.from_teacher_id === effectiveId ||
    reqRow.to_teacher_id === effectiveId;
  if (!involved || reqRow.requested_by === effectiveId) {
    redirect(`${back}?error=${encodeURIComponent("수락 권한이 없어요")}`);
  }

  const today = todayKST();
  const effective = (reqRow.effective_date as string | null) || today;
  const dueNow = effective <= today;

  const update: Record<string, unknown> = {
    status: "accepted",
    resolved_at: new Date().toISOString(),
  };

  if (reqRow.kind === "student") {
    // 받는 선생님의 반 확인 후 저장 (예약이면 그 날짜에 이 반으로 이동)
    const { data: dest } = await admin
      .from("classes")
      .select("id, name")
      .eq("id", targetClassId)
      .eq("teacher_id", reqRow.to_teacher_id)
      .maybeSingle();
    if (!dest) {
      redirect(
        `${back}?error=${encodeURIComponent("옮길 반을 선택해 주세요")}`,
      );
    }
    update.target_class_id = targetClassId;
    if (dueNow) {
      await moveStudentToClass(reqRow.student_id as string, targetClassId);
      update.applied_at = new Date().toISOString();
    }
  } else {
    await applyClassHandover({
      classId: reqRow.class_id as string,
      toTeacherId: reqRow.to_teacher_id as string,
      coteachStart: (reqRow.coteach_start as string | null) ?? null,
      effective,
    });
    if (dueNow) update.applied_at = new Date().toISOString();
  }

  await admin.from("transfer_requests").update(update).eq("id", requestId);

  const me = await teacherContact(effectiveId);
  const what = reqRow.kind === "student" ? "학생" : "반";
  await notifyTeacherById(
    reqRow.requested_by,
    `✅ 유스피킹앱 인수인계 수락\n` +
      `${me?.name ?? "선생님"} 님이 요청을 수락했어요.\n` +
      (dueNow
        ? `${what} 이동이 완료되었습니다.`
        : `${effective}에 ${what} 이동이 자동으로 적용됩니다.`) +
      (reqRow.kind === "class" && reqRow.coteach_start
        ? `\n공동 관리 기간: ${reqRow.coteach_start} ~ ${effective}`
        : ""),
  );

  revalidatePath("/teacher");
  revalidatePath(back);
  redirect(`${back}?accepted=${dueNow ? "1" : encodeURIComponent(effective)}`);
}

// 요청 거절 / 취소
export async function resolveTransfer(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const requestId = String(formData.get("requestId") || "");
  const action = String(formData.get("action") || "rejected");
  const back = "/teacher/transfers";
  if (!requestId) redirect(back);

  const admin = createAdminClient();
  const { data: reqRow } = await admin
    .from("transfer_requests")
    .select(
      "id, class_id, from_teacher_id, to_teacher_id, requested_by, status, applied_at",
    )
    .eq("id", requestId)
    .maybeSingle();
  // 이미 반영된 건은 되돌리지 않는다
  if (!reqRow || reqRow.applied_at) redirect(back);
  if (reqRow.status !== "pending" && reqRow.status !== "accepted")
    redirect(back);

  const involved =
    reqRow.from_teacher_id === effectiveId ||
    reqRow.to_teacher_id === effectiveId;
  if (!involved) redirect(back);

  // 대기 중: 취소는 보낸 사람만, 거절은 받은 사람만
  // 예약 완료(accepted, 미적용): 당사자 누구나 취소 가능
  const next =
    reqRow.status === "accepted"
      ? "canceled"
      : action === "canceled"
        ? reqRow.requested_by === effectiveId
          ? "canceled"
          : null
        : reqRow.requested_by !== effectiveId
          ? "rejected"
          : null;
  if (!next) redirect(back);

  await admin
    .from("transfer_requests")
    .update({ status: next, resolved_at: new Date().toISOString() })
    .eq("id", requestId);

  // 예약을 취소하면 공동 관리 권한도 함께 회수
  if (reqRow.status === "accepted") {
    await admin
      .from("class_coteachers")
      .delete()
      .eq("class_id", reqRow.class_id)
      .eq("role", "full");
  }

  if (next === "rejected") {
    const me = await teacherContact(effectiveId);
    await notifyTeacherById(
      reqRow.requested_by,
      `🚫 유스피킹앱 인수인계 요청이 거절되었어요\n${me?.name ?? "선생님"} 님이 요청을 거절했습니다.`,
    );
  }

  revalidatePath(back);
  redirect(back);
}

// ---------- 공지사항 ----------

export async function createNotice(formData: FormData) {
  const { db, effectiveId, role } = await getTeacherContext();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const pinned = formData.get("pinned") === "on";
  // target: 'all' | 'my_classes' | 반 id
  const target = String(formData.get("target") || "").trim();

  if (!title) {
    redirect(
      `/teacher/notices?error=${encodeURIComponent("제목을 입력해 주세요")}`,
    );
  }

  let scope: "class" | "my_classes" | "all" = "my_classes";
  let classId: string | null = null;
  if (target === "all") {
    // 전체 공지는 운영자만
    if (role !== "admin") {
      redirect(
        `/teacher/notices?error=${encodeURIComponent("전체 공지는 운영자만 쓸 수 있어요")}`,
      );
    }
    scope = "all";
  } else if (target === "my_classes") {
    scope = "my_classes";
  } else {
    scope = "class";
    classId = target;
  }

  const { data: notice, error } = await db
    .from("notices")
    .insert({
      author_id: effectiveId,
      scope,
      class_id: classId,
      title,
      body,
      pinned,
    })
    .select("id, scope, class_id, author_id")
    .single();

  if (error || !notice) {
    redirect(
      `/teacher/notices?error=${encodeURIComponent(error?.message || "공지 등록 실패")}`,
    );
  }

  // 대상 학생에게 푸시 발송 (best-effort — 실패해도 공지는 등록됨)
  try {
    const audience = await resolveNoticeAudience({
      scope: notice.scope,
      class_id: notice.class_id,
      author_id: notice.author_id,
    });
    const origin = appOrigin();
    await sendPushToStudents(audience, {
      title: `📢 ${title}`,
      body: body.slice(0, 120) || "새 공지가 등록되었어요",
      studentUrl: origin ? `${origin}/student/notices` : "/student/notices",
      origin,
    });
  } catch (e) {
    console.error("[공지] 푸시 발송 실패:", e);
  }

  revalidatePath("/teacher/notices");
  redirect("/teacher/notices?posted=1");
}

export async function deleteNotice(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const noticeId = String(formData.get("noticeId") || "");
  if (noticeId) {
    await db
      .from("notices")
      .delete()
      .eq("id", noticeId)
      .eq("author_id", effectiveId);
  }
  revalidatePath("/teacher/notices");
}

// ---------- 쿠폰/보상 설정 ----------

export async function saveCouponSettings(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const goalRaw = parseInt(String(formData.get("coupon_goal") || "10"), 10);
  const goal = Number.isNaN(goalRaw) ? 10 : Math.max(1, Math.min(100, goalRaw));
  const text = String(formData.get("coupon_reward_text") || "").trim();

  // 본인 설정만 수정 (impersonation 시 대행 대상)
  const admin = createAdminClient();
  await admin
    .from("teachers")
    .update({ coupon_goal: goal, coupon_reward_text: text || null })
    .eq("id", effectiveId);

  revalidatePath("/teacher");
}

// 학부모 열람 링크 발급/재발급. 재발급하면 이전 링크는 즉시 무효가 된다.
export async function regenerateParentToken(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  if (!studentId) redirect(`/teacher/classes/${classId}`);

  // 권한이 없으면 정책에 막혀 한 줄도 바뀌지 않는다. 그 결과를 보고 다음으로
  // 넘어가야 한다 — 아래 구독 해지는 서비스 키로 돌아 정책을 타지 않으므로,
  // 확인 없이 두면 권한 없는 사람이 학부모 알림만 끊을 수 있다.
  const { data: updated } = await db
    .from("students")
    .update({ parent_token: randomBytes(16).toString("hex") })
    .eq("id", studentId)
    .eq("class_id", classId)
    .select("id");
  if (!updated?.length) redirect(`/teacher/classes/${classId}`);

  // 이전 링크로 등록된 학부모 알림 구독도 함께 해지 (죽은 링크로 알림이 가지 않도록)
  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("student_id", studentId)
    .eq("audience", "parent");

  revalidatePath(`/teacher/classes/${classId}`);
}

// 선생님이 학생에게 보너스 쿠폰을 직접 주거나 회수한다 (delta: +1 / -1)
export async function grantCoupon(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const delta = Number(formData.get("delta") || 0);
  // 보조 선생님은 쿠폰 화면에서 쓰므로 돌아갈 곳이 다르다
  const back = String(formData.get("back") || `/teacher/classes/${classId}`);
  if (!studentId || !delta) redirect(back);

  // 담임 · 보조 선생님(쿠폰 전용) · 공동 관리자만 지급 가능
  if (!(await canGrantCoupons(effectiveId, classId))) redirect(back);

  // 권한을 확인했으므로 서버 키로 좁게 처리한다
  // (보조 선생님은 students 테이블 전체 권한이 없다)
  const admin = createAdminClient();
  const { data: s } = await admin
    .from("students")
    .select("id, bonus_coupons")
    .eq("id", studentId)
    .eq("class_id", classId)
    .maybeSingle();
  if (!s) redirect(back);

  const next = Math.max(0, (s.bonus_coupons ?? 0) + delta);
  await admin
    .from("students")
    .update({ bonus_coupons: next })
    .eq("id", studentId);
  revalidatePath(back);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 보조 선생님(쿠폰 발급 전용) 지정 / 해제 — 담임만
export async function setCouponHelper(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const teacherId = String(formData.get("teacherId") || "");
  const remove = String(formData.get("remove") || "") === "1";
  const back = `/teacher/classes/${classId}`;
  if (!classId || !teacherId) redirect(back);

  const admin = createAdminClient();
  // 담임 본인만 지정할 수 있다
  const { data: klass } = await admin
    .from("classes")
    .select("id, name, teacher_id")
    .eq("id", classId)
    .maybeSingle();
  if (!klass || klass.teacher_id !== effectiveId) {
    redirect(
      `${back}?error=${encodeURIComponent("담임 선생님만 지정할 수 있어요")}`,
    );
  }
  if (teacherId === effectiveId) redirect(back);

  if (remove) {
    await admin
      .from("class_coteachers")
      .delete()
      .eq("class_id", classId)
      .eq("teacher_id", teacherId)
      .eq("role", "coupon");
    revalidatePath(back);
    redirect(`${back}?helper=removed`);
  }

  const { error } = await admin
    .from("class_coteachers")
    .upsert(
      { class_id: classId, teacher_id: teacherId, role: "coupon" },
      { onConflict: "class_id,teacher_id" },
    );
  if (error) {
    redirect(`${back}?error=${encodeURIComponent(error.message)}`);
  }

  const me = await teacherContact(effectiveId);
  await notifyTeacherById(
    teacherId,
    `🎟️ 유스피킹앱 보조 선생님으로 지정되었어요\n` +
      `• 반: ${klass.name}\n` +
      `• 지정: ${me?.name ?? "선생님"}\n` +
      `이 반 학생들에게 쿠폰을 줄 수 있어요. (과제·채점은 담임 선생님이 관리)\n` +
      `👉 쿠폰 주러 가기: ${appOrigin()}/teacher/coupons`,
  );

  revalidatePath(back);
  redirect(`${back}?helper=added`);
}

// ---------- 학생 ----------

export async function addStudent(formData: FormData) {
  const { db, role } = await getTeacherContext();
  if (await blockedByCardSync(role)) {
    redirect(
      `/teacher/classes/${String(formData.get("classId") || "")}?error=${encodeURIComponent(CARD_ONLY)}`,
    );
  }
  const classId = String(formData.get("classId") || "");
  const name = String(formData.get("name") || "").trim();
  const number = parseInt(String(formData.get("number") || ""), 10);
  if (!classId || !name || Number.isNaN(number)) {
    redirect(`/teacher/classes/${classId}?error=이름과+번호를+확인하세요`);
  }

  const { error } = await db
    .from("students")
    .insert({ class_id: classId, name, number });
  if (error) {
    const msg = error.code === "23505" ? "이미 있는 번호입니다" : error.message;
    redirect(`/teacher/classes/${classId}?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/teacher/classes/${classId}`);
}

// 여러 학생 일괄 등록 (엑셀/CSV 붙여넣기: 한 줄에 "번호,이름" 또는 "번호[탭]이름")
export async function bulkAddStudents(formData: FormData) {
  const { db, role } = await getTeacherContext();
  if (await blockedByCardSync(role)) {
    redirect(
      `/teacher/classes/${String(formData.get("classId") || "")}?error=${encodeURIComponent(CARD_ONLY)}`,
    );
  }
  const classId = String(formData.get("classId") || "");
  const raw = String(formData.get("roster") || "");
  if (!classId || !raw.trim()) redirect(`/teacher/classes/${classId}`);

  const rows: { class_id: string; number: number; name: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t
      .split(/[\t,]+|\s{2,}|\s(?=\d)/)
      .map((p) => p.trim())
      .filter(Boolean);
    // 첫 토큰이 숫자면 번호, 아니면 두 번째에서 숫자 탐색
    let number = NaN;
    let name = "";
    if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
      number = parseInt(parts[0], 10);
      name = parts.slice(1).join(" ");
    } else if (parts.length >= 2 && /^\d+$/.test(parts[parts.length - 1])) {
      number = parseInt(parts[parts.length - 1], 10);
      name = parts.slice(0, -1).join(" ");
    }
    if (!Number.isNaN(number) && name) {
      rows.push({ class_id: classId, number, name });
    }
  }

  if (rows.length === 0) {
    redirect(
      `/teacher/classes/${classId}?error=형식을+확인하세요+(예: 1,민수)`,
    );
  }

  // 번호 기준 upsert (이미 있는 번호는 이름 갱신 → 재업로드 안전)
  const { error } = await db
    .from("students")
    .upsert(rows, { onConflict: "class_id,number" });
  if (error) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent(error.message)}`,
    );
  }
  revalidatePath(`/teacher/classes/${classId}`);
}

export async function deleteStudent(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  await db.from("students").delete().eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 학생 PIN 초기화 (분실 시 → 다음 로그인에서 새로 설정)
export async function resetStudentPin(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  await db.from("students").update({ pin_hash: null }).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 가입 신청 승인: 정보(이름·학교·학년·수강반) 수정 반영 + 대상 반 다음 번호 부여
export async function approveStudent(formData: FormData) {
  const { db, role } = await getTeacherContext();
  if (await blockedByCardSync(role)) {
    redirect(
      `/teacher/classes/${String(formData.get("classId") || "")}?error=${encodeURIComponent(CARD_ONLY)}`,
    );
  }
  const classId = String(formData.get("classId") || ""); // 현재 페이지 반(재검증용)
  const studentId = String(formData.get("studentId") || "");
  const name = String(formData.get("name") || "").trim();
  const school = String(formData.get("school") || "").trim();
  const grade = String(formData.get("grade") || "").trim();
  const targetClassId =
    String(formData.get("targetClassId") || "").trim() || classId;
  if (!studentId) redirect(`/teacher/classes/${classId}`);

  // 대상 반의 다음 번호 자동 부여
  const [{ data: rows }, { data: current }] = await Promise.all([
    db
      .from("students")
      .select("number")
      .eq("class_id", targetClassId)
      .not("number", "is", null)
      .order("number", { ascending: false })
      .limit(1),
    db
      .from("students")
      .select("approved_at, parent_token")
      .eq("id", studentId)
      .maybeSingle(),
  ]);
  const number = Number(rows?.[0]?.number ?? 0) + 1;

  const update: Record<string, unknown> = {
    status: "approved",
    class_id: targetClassId,
    number,
  };
  // 최초 승인 시점만 기록 (재승인해도 원래 등록일은 유지)
  if (!current?.approved_at) update.approved_at = new Date().toISOString();
  // 학부모 열람 링크 토큰 발급 (없을 때만)
  if (!current?.parent_token)
    update.parent_token = randomBytes(16).toString("hex");
  if (name) update.name = name;
  if (school) update.school = school;
  if (grade) update.grade = grade;

  await db.from("students").update(update).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 가입 신청 반려
export async function rejectStudent(formData: FormData) {
  const { db, role } = await getTeacherContext();
  if (await blockedByCardSync(role)) {
    redirect(
      `/teacher/classes/${String(formData.get("classId") || "")}?error=${encodeURIComponent(CARD_ONLY)}`,
    );
  }
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  await db.from("students").update({ status: "rejected" }).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 학생 비밀번호 재설정(분실 시): 임시 비밀번호 생성 → 선생님이 학생에게 전달
function genTempPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(6);
  let pw = "";
  for (let i = 0; i < 6; i++) pw += alphabet[bytes[i] % alphabet.length];
  return pw;
}

export async function resetStudentPassword(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const { data: s } = await db
    .from("students")
    .select("username")
    .eq("id", studentId)
    .single();
  if (!s) redirect(`/teacher/classes/${classId}`);

  const temp = genTempPassword();
  await db
    .from("students")
    .update({ password_hash: hashPassword(temp) })
    .eq("id", studentId);

  redirect(
    `/teacher/classes/${classId}?pwreset=${encodeURIComponent(
      `${s.username ?? ""}|${temp}`,
    )}`,
  );
}

// ---------- 과제 (지문 등록 + TTS 샘플음성) ----------

export async function createAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const title = String(formData.get("title") || "").trim();
  const passageText = String(formData.get("passage_text") || "").trim();
  const dueDate = String(formData.get("due_date") || "") || null;
  const maxAttempts = 1; // 제출(분석)은 일괄 1회로 고정
  const voice = normalizeVoice(String(formData.get("voice") || ""));

  if (!classId || !title || !passageText) {
    redirect(`/teacher/classes/${classId}?error=제목과+지문을+입력하세요`);
  }
  if (passageText.includes("[?]")) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent(
        "지문에 읽지 못한 단어([?])가 남아 있어요. 고친 뒤 등록해 주세요.",
      )}`,
    );
  }

  const { data: assignment, error } = await db
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      passage_text: passageText,
      due_date: dueDate,
      max_attempts: maxAttempts,
      sample_voice: voice,
    })
    .select()
    .single();

  if (error || !assignment) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent(
        error?.message || "과제 생성 실패",
      )}`,
    );
  }

  // 샘플 음성 생성 (best-effort: 실패해도 과제는 생성됨. 나중에 재생성 가능)
  try {
    await generateAndStoreSamples(assignment.id, passageText, voice);
  } catch (e) {
    console.error("[TTS] 샘플음성 생성 실패:", e);
  }

  revalidatePath(`/teacher/classes/${classId}`);
}

// ---------- 제출물 검토 (M4) ----------

// 교사가 상세 리포트(교사용 피드백)를 수정하고 검토완료 처리
export async function updateSubmissionReview(formData: FormData) {
  const { db } = await getTeacherContext();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");
  const teacherFeedback = String(formData.get("teacher_feedback") || "");
  const reviewed = formData.get("teacher_reviewed") === "on";

  await db
    .from("submissions")
    .update({ teacher_feedback: teacherFeedback, teacher_reviewed: reviewed })
    .eq("id", submissionId);

  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

// 학생에게 재제출 기회 다시 주기 (시도 횟수 초기화)
export async function resetAttempts(formData: FormData) {
  const { db } = await getTeacherContext();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");
  await db
    .from("submissions")
    .update({ attempt_count: 0 })
    .eq("id", submissionId);
  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

// 저장된 점수로 피드백만 다시 만든다 (녹음은 다시 채점하지 않는다)
export async function regenerateSubmissionFeedback(formData: FormData) {
  const { db } = await getTeacherContext();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");
  const back = `/teacher/assignments/${assignmentId}`;

  // 볼 수 있는 제출인지 정책(RLS)으로 확인한다
  const { data: sub } = await db
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!sub) redirect(back);

  try {
    await regenerateFeedback(submissionId);
  } catch (e) {
    console.error("[피드백 다시 만들기] 실패:", submissionId, e);
    redirect(
      `${back}?error=${encodeURIComponent("피드백을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.")}`,
    );
  }
  revalidatePath(back);
}

// 평가 실패/재시도 시 재평가
export async function reevaluateSubmission(formData: FormData) {
  const { db } = await getTeacherContext();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");

  const { data: sub } = await db
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .single();
  if (sub) {
    // 선생님이 직접 누른 재평가는 자동 재시도 한도를 새로 열어 준다
    await db
      .from("submissions")
      .update({ evaluate_attempts: 0 })
      .eq("id", submissionId);
    await evaluateSubmission(submissionId);
  }

  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

// 과제 수정 (제목·지문·마감·재제출 횟수). 지문이 바뀌면 샘플음성 재생성.
export async function updateAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");
  const title = String(formData.get("title") || "").trim();
  const passageText = String(formData.get("passage_text") || "").trim();
  const dueDate = String(formData.get("due_date") || "") || null;
  const maxAttempts = 1; // 제출(분석)은 일괄 1회로 고정
  if (!assignmentId || !title || !passageText) {
    redirect(`/teacher/classes/${classId}?error=제목과+지문을+입력하세요`);
  }

  const { data: current } = await db
    .from("assignments")
    .select("passage_text, sample_voice")
    .eq("id", assignmentId)
    .single();

  await db
    .from("assignments")
    .update({
      title,
      passage_text: passageText,
      due_date: dueDate,
      max_attempts: maxAttempts,
    })
    .eq("id", assignmentId);

  // 지문이 바뀌었으면 기존에 고른 음성으로 샘플음성 재생성 (best-effort)
  if (current && current.passage_text !== passageText) {
    try {
      await generateAndStoreSamples(
        assignmentId,
        passageText,
        current.sample_voice ?? undefined,
      );
    } catch (e) {
      console.error("[TTS] 수정 후 재생성 실패:", e);
    }
  }

  // 마감일을 바꾸면 보관함↔진행 목록 사이를 오갈 수 있어 양쪽 다 갱신한다
  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/archive`);
}

// 과제 삭제 (중복 정리 등)
export async function deleteAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");
  // submissions 는 ON DELETE CASCADE
  await db.from("assignments").delete().eq("id", assignmentId);
  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/archive`);
}

// ---------- 월말 리포트 ----------

// 학생이 실효 교사 소유인지 확인 후 {id,name,class_id} 반환
async function ownedStudent(
  db: Awaited<ReturnType<typeof getTeacherContext>>["db"],
  effectiveId: string,
  studentId: string,
) {
  const { data } = await db
    .from("students")
    .select("id, name, class_id, approved_at, classes!inner(teacher_id)")
    .eq("id", studentId)
    .eq("classes.teacher_id", effectiveId)
    .single();
  return data as {
    id: string;
    name: string;
    class_id: string;
    approved_at: string | null;
  } | null;
}

// AI 월말 리포트 초안 생성
export async function generateMonthlyDraft(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const studentId = String(formData.get("studentId") || "");
  const month = String(formData.get("month") || "");
  const student = await ownedStudent(db, effectiveId, studentId);
  if (!student || !month) redirect("/teacher");

  const data = await gatherMonthly(
    db,
    student.id,
    student.class_id,
    month,
    student.approved_at,
  );
  let content: string;
  try {
    content = await generateMonthlyReportDraft(student.name, month, data);
  } catch (e) {
    console.error("[월말리포트] 생성 실패:", e);
    redirect(
      `/teacher/students/${studentId}/monthly?month=${month}&error=${encodeURIComponent(
        "초안 생성 실패 (Anthropic 키 확인)",
      )}`,
    );
  }

  await db
    .from("monthly_reports")
    .upsert(
      { student_id: studentId, year_month: month, content },
      { onConflict: "student_id,year_month" },
    );
  revalidatePath(`/teacher/students/${studentId}/monthly`);
}

// 월말 리포트 저장(수정)
// ---------- 반별 월말 리포트 일괄 처리 ----------

// 반 전체 학생의 리포트 초안을 한 번에 만든다.
// 한 명당 십여 초가 걸려 함수 시간이 모자랄 수 있으므로, 예산 안에서 만들 수
// 있는 만큼만 만들고 몇 명이 남았는지 알려 준다. 다시 누르면 이어서 만든다.
const BULK_BUDGET_MS = 240_000;

export async function generateClassMonthlyDrafts(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const month = String(formData.get("month") || "");
  const redo = String(formData.get("redo") || "") === "1";
  const back = `/teacher/classes/${classId}/monthly?month=${month}`;

  const { data: klass } = await db
    .from("classes")
    .select("id")
    .eq("id", classId)
    .eq("teacher_id", effectiveId)
    .maybeSingle();
  if (!klass || !month) redirect("/teacher");

  const { data: studentRows } = await db
    .from("students")
    .select("id, name, class_id, approved_at")
    .eq("class_id", classId)
    .eq("status", "approved")
    .order("number");
  const students = (studentRows ?? []) as {
    id: string;
    name: string;
    class_id: string;
    approved_at: string | null;
  }[];

  const { data: existing } = await db
    .from("monthly_reports")
    .select("student_id, content")
    .eq("year_month", month)
    .in(
      "student_id",
      students.map((s) => s.id),
    );
  const has = new Set(
    ((existing ?? []) as { student_id: string; content: string }[])
      .filter((r) => r.content?.trim())
      .map((r) => r.student_id),
  );

  const todo = redo ? students : students.filter((s) => !has.has(s.id));

  const started = Date.now();
  let made = 0;
  let failed = 0;
  for (const st of todo) {
    if (Date.now() - started > BULK_BUDGET_MS) break;
    try {
      const data = await gatherMonthly(
        db,
        st.id,
        st.class_id,
        month,
        st.approved_at,
      );
      const content = await generateMonthlyReportDraft(st.name, month, data);
      await db
        .from("monthly_reports")
        .upsert(
          { student_id: st.id, year_month: month, content },
          { onConflict: "student_id,year_month" },
        );
      made++;
    } catch (e) {
      console.error("[월말리포트] 일괄 생성 실패:", st.name, e);
      failed++;
    }
  }

  const left = todo.length - made - failed;
  const msg =
    `초안 ${made}명 작성` +
    (failed ? ` · ${failed}명 실패` : "") +
    (left > 0 ? ` · ${left}명 남음 (다시 눌러 주세요)` : "");
  revalidatePath(back);
  redirect(`${back}&done=${encodeURIComponent(msg)}`);
}

// 검토가 끝난 리포트를 학부모께 알림톡으로 보낸다.
// 선택한 학생만, 링크가 발급되어 있고 연락처가 있는 경우에만 보낸다.
export async function sendClassReports(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const month = String(formData.get("month") || "");
  const picked = formData.getAll("studentIds").map(String);
  const back = `/teacher/classes/${classId}/monthly?month=${month}`;

  const { data: klass } = await db
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .eq("teacher_id", effectiveId)
    .maybeSingle();
  if (!klass || !month) redirect("/teacher");
  if (picked.length === 0) {
    redirect(
      `${back}&error=${encodeURIComponent("보낼 학생을 선택해 주세요")}`,
    );
  }

  const { data: studentRows } = await db
    .from("students")
    .select("id, name, parent_phone")
    .eq("class_id", classId)
    .eq("status", "approved")
    .in("id", picked);
  const students = (studentRows ?? []) as {
    id: string;
    name: string;
    parent_phone: string | null;
  }[];

  const { data: reportRows } = await db
    .from("monthly_reports")
    .select("student_id, share_token, content")
    .eq("year_month", month)
    .in("student_id", picked);
  const reports = new Map(
    (
      (reportRows ?? []) as {
        student_id: string;
        share_token: string | null;
        content: string;
      }[]
    ).map((r) => [r.student_id, r]),
  );

  const origin = appOrigin();
  // 알림톡 버튼은 템플릿에 https:// 가 고정으로 박혀 있고, 그 뒤를 이 주소로
  // 채운다. 그래서 origin 이 'https://호스트' 모양이 아니면 버튼이 깨진다.
  // (NEXT_PUBLIC_APP_URL 을 https:// 없이 적어 둔 경우가 여기 걸린다.
  //  환경변수가 아예 비어 있으면 요청 호스트로 채워지므로 여기 걸리지 않는다)
  // 보내고 나면 되돌릴 수 없으니 아예 보내지 않고 알린다.
  if (!/^https?:\/\/[^/]+/i.test(origin)) {
    redirect(
      `${back}&error=${encodeURIComponent(
        "리포트 주소를 만들 수 없어요. 운영자에게 NEXT_PUBLIC_APP_URL 설정을 문의해 주세요.",
      )}`,
    );
  }
  const [y, m] = month.split("-");
  const monthLabel = `${Number(y)}년 ${Number(m)}월`;

  const targets: { to: string; variables: Record<string, string> }[] = [];
  const sentIds: string[] = [];
  const skipped: string[] = [];

  for (const st of students) {
    const rep = reports.get(st.id);
    const phone = normalizePhone(st.parent_phone);
    if (!rep?.content?.trim() || !rep.share_token) {
      skipped.push(`${st.name}(링크 없음)`);
      continue;
    }
    if (!phone) {
      skipped.push(`${st.name}(연락처 없음)`);
      continue;
    }
    targets.push({
      to: phone,
      variables: {
        "#{이름}": st.name,
        "#{월}": monthLabel,
        // 프로토콜은 템플릿의 `https://#{링크}` 쪽에 고정돼 있다
        "#{링크}": bareLink(`${origin}/report/${rep.share_token}`),
      },
    });
    sentIds.push(st.id);
  }

  if (targets.length === 0) {
    redirect(
      `${back}&error=${encodeURIComponent(
        `보낼 수 있는 학생이 없어요. ${skipped.join(", ")}`,
      )}`,
    );
  }

  const result = await sendAlimtalk(targets);

  if (result.sent > 0) {
    await db
      .from("monthly_reports")
      .update({ sent_at: new Date().toISOString() })
      .eq("year_month", month)
      .in("student_id", sentIds);
  }

  const parts = [`${result.sent}명 발송`];
  if (result.failed) parts.push(`${result.failed}명 실패`);
  if (skipped.length) parts.push(`제외: ${skipped.join(", ")}`);
  if (result.error) parts.push(result.error);

  revalidatePath(back);
  redirect(
    `${back}&${result.ok ? "done" : "error"}=${encodeURIComponent(parts.join(" · "))}`,
  );
}

// 학부모 연락처 저장 (알림톡 발송에 쓰인다)
export async function saveParentPhone(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const raw = String(formData.get("phone") || "");
  const student = await ownedStudent(db, effectiveId, studentId);
  if (!student) redirect("/teacher");

  // 빈 값이면 지운다. 형식이 틀리면 저장하지 않고 알린다.
  const phone = raw.trim() ? normalizePhone(raw) : null;
  if (raw.trim() && !phone) {
    redirect(
      `/teacher/classes/${classId}?error=${encodeURIComponent(
        "연락처 형식을 확인해 주세요 (예: 010-1234-5678)",
      )}`,
    );
  }

  await db.from("students").update({ parent_phone: phone }).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 월말 리포트 공유 링크 발급 / 재발급.
// 선생님이 직접 누를 때만 링크가 생기므로, 다듬기 전의 초안이 새어 나가지 않는다.
export async function shareMonthlyReport(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const studentId = String(formData.get("studentId") || "");
  const month = String(formData.get("month") || "");
  const student = await ownedStudent(db, effectiveId, studentId);
  if (!student || !month) redirect("/teacher");

  const { data: row } = await db
    .from("monthly_reports")
    .select("content")
    .eq("student_id", studentId)
    .eq("year_month", month)
    .maybeSingle();
  if (!row?.content?.trim()) {
    redirect(
      `/teacher/students/${studentId}/monthly?month=${month}&error=${encodeURIComponent(
        "리포트 내용을 먼저 저장해 주세요",
      )}`,
    );
  }

  await db
    .from("monthly_reports")
    .update({ share_token: crypto.randomUUID().replace(/-/g, "") })
    .eq("student_id", studentId)
    .eq("year_month", month);

  revalidatePath(`/teacher/students/${studentId}/monthly`);
}

export async function saveMonthlyReport(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const studentId = String(formData.get("studentId") || "");
  const month = String(formData.get("month") || "");
  const content = String(formData.get("content") || "");
  const student = await ownedStudent(db, effectiveId, studentId);
  if (!student || !month) redirect("/teacher");

  await db
    .from("monthly_reports")
    .upsert(
      { student_id: studentId, year_month: month, content },
      { onConflict: "student_id,year_month" },
    );
  revalidatePath(`/teacher/students/${studentId}/monthly`);
}

// 샘플 음성 재생성 (TTS 실패했거나 지문 수정 후)
export async function regenerateSample(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");

  const { data: assignment } = await db
    .from("assignments")
    .select("id, passage_text, sample_voice")
    .eq("id", assignmentId)
    .single();
  if (!assignment) redirect(`/teacher/classes/${classId}`);

  // 재생성 시 선생님이 새 음성을 고르면 반영, 아니면 기존 음성 유지
  const picked = String(formData.get("voice") || "").trim();
  const voice = picked
    ? normalizeVoice(picked)
    : (assignment.sample_voice ?? undefined);
  if (picked) {
    await db
      .from("assignments")
      .update({ sample_voice: voice })
      .eq("id", assignmentId);
  }

  try {
    await generateAndStoreSamples(
      assignment.id,
      assignment.passage_text,
      voice,
    );
  } catch (e) {
    console.error("[TTS] 재생성 실패:", e);
    redirect(
      `/teacher/classes/${classId}?error=샘플음성+생성+실패+(OpenAI+키+확인)`,
    );
  }

  revalidatePath(`/teacher/classes/${classId}`);
  revalidatePath(`/teacher/classes/${classId}/archive`);
}

// ---------- Student Card 명단 ----------

// 내 반 명단을 지금 다시 확인. 결과는 hr_pending_students 에 쌓이고
// 화면은 그것만 읽으므로, 이 버튼을 누를 때만 외부 API 를 부른다.
export async function refreshMyRoster() {
  const { effectiveId } = await getTeacherContext();

  if (!hrConfigured()) {
    redirect(
      `/teacher/roster?error=${encodeURIComponent(
        "Student Card 연동이 설정되지 않았어요. 운영자에게 문의해 주세요.",
      )}`,
    );
  }

  let reports: SyncReport[];
  try {
    reports = await syncAll(effectiveId);
  } catch (e) {
    console.error("[HR] 명단 확인 실패:", e);
    redirect(
      `/teacher/roster?error=${encodeURIComponent(
        e instanceof Error ? e.message : "명단을 받아오지 못했어요.",
      )}`,
    );
  }

  const failed = reports.filter((r) => r.error);
  if (failed.length && failed.length === reports.length) {
    redirect(
      `/teacher/roster?error=${encodeURIComponent(
        `명단을 받아오지 못했어요 — ${failed[0].error ?? ""}`,
      )}`,
    );
  }

  const updated = reports.reduce((n, r) => n + r.updated, 0);
  const pending = reports.reduce(
    (n, r) => n + r.pendingNew + r.pendingAmbiguous,
    0,
  );
  const msg =
    reports.length === 0
      ? "이어진 반이 없어요. 운영자가 반을 이어 주면 명단을 받아옵니다."
      : `${reports.length}개 반을 확인했어요. 연락처 ${updated}명 갱신 · 확인 필요 ${pending}명` +
        (failed.length ? ` (${failed.length}개 반은 조회 실패)` : "");

  revalidatePath("/teacher/roster");
  revalidatePath("/teacher");
  redirect(`/teacher/roster?done=${encodeURIComponent(msg)}`);
}

// 대기 목록에서 한 건 숨기기 (퇴원했거나 유스피킹에 등록할 필요가 없는 학생).
// 다음 동기화에서 다시 올라오면 또 보인다 — 영구 무시가 아니라 '이번엔 넘기기'.
export async function dismissPendingStudent(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
  const pendingId = String(formData.get("pendingId") || "");
  if (!pendingId) redirect("/teacher/roster");

  const admin = createAdminClient();
  // 남의 반 건을 지우지 못하도록 내 반인지 확인한다
  const { data: row } = await admin
    .from("hr_pending_students")
    .select("id, class_id")
    .eq("id", pendingId)
    .maybeSingle();
  if (!row) redirect("/teacher/roster");

  const { data: klass } = await admin
    .from("classes")
    .select("id")
    .eq("id", (row as { class_id: string }).class_id)
    .eq("teacher_id", effectiveId)
    .maybeSingle();
  if (!klass) redirect("/teacher/roster");

  await admin.from("hr_pending_students").delete().eq("id", pendingId);
  revalidatePath("/teacher/roster");
  revalidatePath("/teacher");
}

// ---------- 가입 안내 알림톡 ----------

// 가입하지 않은 학생에게 가입 안내를 보낸다.
// 학생 번호로 보내고, 학생 번호가 없으면 학부모 번호로 대신 보낸다 (결과에 따로 알린다).
//  · 가입 전(invited) 학생: 개인 가입 링크 — 누르면 바로 아이디를 만든다
//  · 전환 중이라 아직 유스피킹에 없는 학생: 담임 선생님의 가입 신청 링크
export async function sendSignupInvites(formData: FormData) {
  const { effectiveId, role } = await getTeacherContext();
  const back = "/teacher/roster";
  const keys = formData.getAll("keys").map(String).filter(Boolean);
  if (keys.length === 0) {
    redirect(
      `${back}?error=${encodeURIComponent("보낼 학생을 선택해 주세요")}`,
    );
  }
  if (!alimtalkConfigured("invite")) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "가입 안내 알림톡이 아직 설정되지 않았어요 (SOLAPI_INVITE_TEMPLATE_ID). 운영자에게 문의해 주세요.",
      )}`,
    );
  }

  const admin = createAdminClient();
  // 내 반만 (운영자는 대행 중인 선생님의 반)
  const { data: classRows } = await admin
    .from("classes")
    .select("id, name, teacher_id")
    .eq("teacher_id", effectiveId)
    .is("archived_at", null);
  const myClasses = (classRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  const all = await listUninvited(myClasses);
  const picked = all.filter((r) => keys.includes(r.key));

  const origin = appOrigin();
  if (!/^https?:\/\/[^/]+/i.test(origin)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "가입 링크 주소를 만들 수 없어요. 운영자에게 NEXT_PUBLIC_APP_URL 설정을 문의해 주세요.",
      )}`,
    );
  }

  // 전환 중 학생에게 줄 공용 가입 링크 (일원화 중에는 공용 가입이 막혀 있다)
  const oneway = (await getSyncMode()) === "oneway";
  const { data: me } = await admin
    .from("teachers")
    .select("signup_code")
    .eq("id", effectiveId)
    .maybeSingle();
  const signupCode =
    (me as { signup_code?: string | null } | null)?.signup_code ?? null;

  const targets: { to: string; variables: Record<string, string> }[] = [];
  const sentKeys: Uninvited[] = [];
  const skipped: string[] = [];
  for (const r of picked) {
    if (!r.phone) {
      skipped.push(`${r.name}(연락처 없음)`);
      continue;
    }
    let link: string | null = null;
    if (r.kind === "invited" && r.token)
      link = `${origin}/student/join/${r.token}`;
    else if (r.kind === "card" && !oneway && signupCode)
      link = `${origin}/student/signup?t=${encodeURIComponent(signupCode)}`;
    if (!link) {
      skipped.push(`${r.name}(링크 없음)`);
      continue;
    }
    targets.push({
      to: r.phone,
      variables: {
        "#{이름}": r.name,
        "#{반}": r.className,
        // 템플릿 버튼에 https:// 가 고정되어 있다 (월말 리포트와 같은 규칙)
        "#{링크}": bareLink(link),
      },
    });
    sentKeys.push(r);
  }

  if (targets.length === 0) {
    redirect(
      `${back}?error=${encodeURIComponent(`보낼 수 있는 학생이 없어요. ${skipped.join(", ")}`)}`,
    );
  }

  const result = await sendAlimtalk(targets, "invite");

  if (result.sent > 0) {
    const failedTo = new Set((result.failures ?? []).map((f) => f.to));
    const now = new Date().toISOString();
    for (const r of sentKeys) {
      if (!r.hrStudentId || failedTo.has(r.phone!)) continue;
      await admin.from("signup_invites").upsert(
        {
          hr_student_id: r.hrStudentId,
          sent_at: now,
          sent_to: r.phone,
          sent_count: r.sentCount + 1,
        },
        { onConflict: "hr_student_id" },
      );
    }
    await admin.from("hr_sync_log").insert({
      kind: "invite_sent",
      detail: `가입 안내 ${result.sent}명 (${role === "admin" ? "운영자" : "선생님"})`,
    });
  }

  const viaParent = sentKeys
    .filter((r) => r.phoneOwner === "학부모")
    .map((r) => r.name);
  const parts = [`${result.sent}명에게 가입 안내를 보냈어요`];
  // 학부모 번호로 대신 간 학생은 선생님이 알아야 학생에게 따로 말해 줄 수 있다
  if (viaParent.length)
    parts.push(`학생 번호가 없어 학부모 번호로 보냄: ${viaParent.join(", ")}`);
  if (result.failed) parts.push(`${result.failed}명 실패`);
  if (skipped.length) parts.push(`제외: ${skipped.join(", ")}`);
  if (result.error) parts.push(result.error);
  revalidatePath(back);
  redirect(
    `${back}?${result.ok ? "done" : "error"}=${encodeURIComponent(parts.join(" · "))}`,
  );
}

// 학부모 열람 링크 알림톡 — 학부모 번호로만 보낸다.
// 링크가 아직 없는 학생은 여기서 새로 만든다 (이미 있는 링크는 바꾸지 않는다:
// 바꾸면 전에 보낸 링크가 죽는다).
export async function sendParentLinks(formData: FormData) {
  const { effectiveId, role } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const back = `/teacher/classes/${classId}/parents`;
  const ids = formData.getAll("studentIds").map(String).filter(Boolean);

  const access = await canManageClass(effectiveId, classId);
  if (!access.ok) redirect("/teacher");
  if (ids.length === 0) {
    redirect(
      `${back}?error=${encodeURIComponent("보낼 학생을 선택해 주세요")}`,
    );
  }
  if (!alimtalkConfigured("parent")) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "학부모 링크 알림톡이 아직 설정되지 않았어요 (SOLAPI_PARENT_TEMPLATE_ID). 운영자에게 문의해 주세요.",
      )}`,
    );
  }
  const origin = appOrigin();
  if (!/^https?:\/\/[^/]+/i.test(origin)) {
    redirect(
      `${back}?error=${encodeURIComponent(
        "링크 주소를 만들 수 없어요. 운영자에게 NEXT_PUBLIC_APP_URL 설정을 문의해 주세요.",
      )}`,
    );
  }

  const admin = createAdminClient();
  const picked = (await listParentLinks(classId)).filter((r) =>
    ids.includes(r.studentId),
  );

  const targets: { to: string; variables: Record<string, string> }[] = [];
  const sentRows: typeof picked = [];
  const skipped: string[] = [];
  for (const r of picked) {
    if (!r.phone) {
      skipped.push(`${r.name}(학부모 번호 없음)`);
      continue;
    }
    let token = r.token;
    if (!token) {
      token = randomBytes(16).toString("hex");
      // 그 사이 다른 사람이 만들었으면 덮어쓰지 않는다
      const { data: set } = await admin
        .from("students")
        .update({ parent_token: token })
        .eq("id", r.studentId)
        .is("parent_token", null)
        .select("id");
      if (!set?.length) {
        const { data: again } = await admin
          .from("students")
          .select("parent_token")
          .eq("id", r.studentId)
          .maybeSingle();
        token =
          (again as { parent_token: string | null } | null)?.parent_token ??
          null;
      }
      if (!token) {
        skipped.push(`${r.name}(링크 만들기 실패)`);
        continue;
      }
    }
    targets.push({
      to: r.phone,
      variables: {
        "#{이름}": r.name,
        "#{반}": access.name,
        // 템플릿 버튼에 https:// 가 고정되어 있다 (월말 리포트와 같은 규칙)
        "#{링크}": bareLink(`${origin}/parent/${token}`),
      },
    });
    sentRows.push(r);
  }

  if (targets.length === 0) {
    revalidatePath(back);
    redirect(
      `${back}?error=${encodeURIComponent(`보낼 수 있는 학생이 없어요. ${skipped.join(", ")}`)}`,
    );
  }

  const result = await sendAlimtalk(targets, "parent");

  if (result.sent > 0) {
    const failedTo = new Set((result.failures ?? []).map((f) => f.to));
    const now = new Date().toISOString();
    for (const r of sentRows) {
      if (failedTo.has(r.phone!)) continue;
      await admin.from("parent_link_sends").upsert(
        {
          student_id: r.studentId,
          sent_at: now,
          sent_to: r.phone,
          sent_count: r.sentCount + 1,
        },
        { onConflict: "student_id" },
      );
    }
    await admin.from("hr_sync_log").insert({
      kind: "parent_link_sent",
      detail: `학부모 링크 ${result.sent}명 · ${access.name} (${role === "admin" ? "운영자" : "선생님"})`,
    });
  }

  const parts = [`${result.sent}명의 학부모께 링크를 보냈어요`];
  if (result.failed) parts.push(`${result.failed}명 실패`);
  if (skipped.length) parts.push(`제외: ${skipped.join(", ")}`);
  if (result.error) parts.push(result.error);
  revalidatePath(back);
  revalidatePath(`/teacher/classes/${classId}`);
  redirect(
    `${back}?${result.ok ? "done" : "error"}=${encodeURIComponent(parts.join(" · "))}`,
  );
}
