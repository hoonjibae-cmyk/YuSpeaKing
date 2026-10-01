Warning: truncated output (original token count: 14256)
Total output lines: 1632

"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacherContext, clearImpersonation } from "@/lib/teacher-context";
import { resolveNoticeAudience } from "@/lib/notices";
import { sendPushToStudents } from "@/lib/push";
import { moveStudentToClass } from "@/lib/transfers";
import { todayKST } from "@/lib/date";
import { synthesizeSpeech } from "@/lib/ai/tts";
import { normalizeVoice } from "@/lib/tts-voices";
import { hashPassword } from "@/lib/student-session";
import { notifyTeacher } from "@/lib/slack";
import { evaluateSubmission } from "@/lib/ai/evaluate";
import { gatherMonthly } from "@/lib/monthly";
import { generateMonthlyReportDraft } from "@/lib/ai/monthly-report";
import { appOrigin } from "@/lib/app-url";
import { canGrantCoupons } from "@/lib/coupon-helpers";
import { normalizePhone, sendAlimtalk } from "@/lib/solapi";
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

function generateClassCode(): string {
  // 헷갈리는 글자(0/O, 1/I) 제외한 6자리 코드
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i] % alphabet.length];
  return code;
}

export async function createClass(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
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

  // 내 반 학생인지 확인
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
export async function requestClassTransfer(formData: FormData) {
  const { effectiveId } = await getTeacherContext();
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
    // 공동 관리 기간이 있으면 새 담임에게 기간 한정 권한을 준다
    const coStart = reqRow.coteach_start as string | null;
    if (coStart) {
      await admin.from("class_coteachers").upsert(
        {
          class_id: reqRow.class_id,
          teacher_id: reqRow.to_teacher_id,
          role: "full",
          starts_on: coStart,
          ends_on: effective,
        },
        { onConflict: "class_id,teacher_id" },
      );
    }
    if (dueNow) {
      await admin
        .from("classes")
        .update({ teacher_id: reqRow.to_teacher_id })
        .eq("id", reqRow.class_id);
      await admin
        .from("class_coteachers")
        .delete()
        .eq("class_id", reqRow.class_id)
        .eq("role", "full");
      update.applied_at = new Date().toISOString();
    }
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

  revalidatePath("/teacher");…4256 tokens truncated…geText) {
    redirect(`/teacher/classes/${classId}?error=제목과+지문을+입력하세요`);
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
        "#{링크}": `${origin}/report/${rep.share_token}`,
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
