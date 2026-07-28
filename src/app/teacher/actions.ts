"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacherContext, clearImpersonation } from "@/lib/teacher-context";
import { getRole } from "@/lib/auth";
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

// 정상 속도 + 느린 샘플 음성 2종 생성 → Storage 업로드 → URL 저장
async function generateAndStoreSamples(
  assignmentId: string,
  passageText: string,
  voice?: string
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
  const slowUrl = admin.storage.from("sample-audio").getPublicUrl(slowPath).data
    .publicUrl;
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
  if (error) redirect(`/teacher/login?error=${encodeURIComponent(error.message)}`);

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
        "이름·이메일·비밀번호를 모두 입력해 주세요"
      )}`
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
      `/teacher/login?mode=signup&error=${encodeURIComponent(error.message)}`
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
    const host = headers().get("host");
    const approveUrl = host ? `https://${host}/admin` : "/admin";
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
  const host = headers().get("host");
  return host ? `https://${host}/teacher/transfers` : "/teacher/transfers";
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
  const effectiveDate = String(formData.get("effective_date") || "") || todayKST();
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
    if (!dest) redirect(`${back}&error=${encodeURIComponent("옮길 반을 찾을 수 없어요")}`);

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
      `👉 수락하러 가기: ${transfersUrl()}`
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
    redirect(`${back}?error=${encodeURIComponent("담임 정보가 바뀌었어요. 새로고침해 주세요")}`);
  }
  if (fromTeacher === toTeacher) redirect(back);

  // 공동 관리 기간: 시작일을 넣으면 그 기간 동안 두 선생님이 함께 관리하고,
  // 종료일(= 담임 변경일)에 새 담임에게 완전히 넘어간다.
  const coteachStart = String(formData.get("coteach_start") || "") || null;
  const effectiveDate =
    String(formData.get("effective_date") || "") || todayKST();
  if (coteachStart && coteachStart > effectiveDate) {
    redirect(
      `${back}?error=${encodeURIComponent("공동 관리 시작일은 담임 변경일보다 앞서야 해요")}`
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
        give ? "이 반의 담임을 넘기려고 합니다" : "이 반의 담임을 맡으려고 합니다"
      }\n` +
      (coteachStart
        ? `• 공동 관리: ${coteachStart} ~ ${effectiveDate}\n• 담임 변경일: ${effectiveDate}\n`
        : `• 담임 변경일: ${effectiveDate}\n`) +
      `👉 수락하러 가기: ${transfersUrl()}`
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
      "id, kind, student_id, class_id, from_teacher_id, to_teacher_id, requested_by, status, effective_date, coteach_start"
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!reqRow || reqRow.status !== "pending") redirect(back);

  // 수락 권한: 요청을 보낸 사람이 아니면서, 당사자여야 한다
  const involved =
    reqRow.from_teacher_id === effectiveId || reqRow.to_teacher_id === effectiveId;
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
      redirect(`${back}?error=${encodeURIComponent("옮길 반을 선택해 주세요")}`);
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
          starts_on: coStart,
          ends_on: effective,
        },
        { onConflict: "class_id,teacher_id" }
      );
    }
    if (dueNow) {
      await admin
        .from("classes")
        .update({ teacher_id: reqRow.to_teacher_id })
        .eq("id", reqRow.class_id);
      await admin.from("class_coteachers").delete().eq("class_id", reqRow.class_id);
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
        : "")
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
    .select("id, class_id, from_teacher_id, to_teacher_id, requested_by, status, applied_at")
    .eq("id", requestId)
    .maybeSingle();
  // 이미 반영된 건은 되돌리지 않는다
  if (!reqRow || reqRow.applied_at) redirect(back);
  if (reqRow.status !== "pending" && reqRow.status !== "accepted") redirect(back);

  const involved =
    reqRow.from_teacher_id === effectiveId || reqRow.to_teacher_id === effectiveId;
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
    await admin.from("class_coteachers").delete().eq("class_id", reqRow.class_id);
  }

  if (next === "rejected") {
    const me = await teacherContact(effectiveId);
    await notifyTeacherById(
      reqRow.requested_by,
      `🚫 유스피킹앱 인수인계 요청이 거절되었어요\n${me?.name ?? "선생님"} 님이 요청을 거절했습니다.`
    );
  }

  revalidatePath(back);
  redirect(back);
}

// ---------- 공지사항 ----------

export async function createNotice(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const title = String(formData.get("title") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const pinned = formData.get("pinned") === "on";
  // target: 'all' | 'my_classes' | 반 id
  const target = String(formData.get("target") || "").trim();

  if (!title) {
    redirect(`/teacher/notices?error=${encodeURIComponent("제목을 입력해 주세요")}`);
  }

  let scope: "class" | "my_classes" | "all" = "my_classes";
  let classId: string | null = null;
  if (target === "all") {
    // 전체 공지는 운영자만
    if ((await getRole()) !== "admin") {
      redirect(
        `/teacher/notices?error=${encodeURIComponent("전체 공지는 운영자만 쓸 수 있어요")}`
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
      `/teacher/notices?error=${encodeURIComponent(error?.message || "공지 등록 실패")}`
    );
  }

  // 대상 학생에게 푸시 발송 (best-effort — 실패해도 공지는 등록됨)
  try {
    const audience = await resolveNoticeAudience({
      scope: notice.scope,
      class_id: notice.class_id,
      author_id: notice.author_id,
    });
    const host = headers().get("host");
    const origin = host ? `https://${host}` : "";
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
    await db.from("notices").delete().eq("id", noticeId).eq("author_id", effectiveId);
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

  await db
    .from("students")
    .update({ parent_token: randomBytes(16).toString("hex") })
    .eq("id", studentId)
    .eq("class_id", classId);

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
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const delta = Number(formData.get("delta") || 0);
  if (!studentId || !delta) redirect(`/teacher/classes/${classId}`);

  // 담당 반 학생인지 확인 후 증감 (음수로 내려가지 않게)
  const { data: s } = await db
    .from("students")
    .select("id, bonus_coupons")
    .eq("id", studentId)
    .eq("class_id", classId)
    .single();
  if (!s) redirect(`/teacher/classes/${classId}`);

  const next = Math.max(0, (s.bonus_coupons ?? 0) + delta);
  await db.from("students").update({ bonus_coupons: next }).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// ---------- 학생 ----------

export async function addStudent(formData: FormData) {
  const { db } = await getTeacherContext();
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
    const msg =
      error.code === "23505" ? "이미 있는 번호입니다" : error.message;
    redirect(`/teacher/classes/${classId}?error=${encodeURIComponent(msg)}`);
  }
  revalidatePath(`/teacher/classes/${classId}`);
}

// 여러 학생 일괄 등록 (엑셀/CSV 붙여넣기: 한 줄에 "번호,이름" 또는 "번호[탭]이름")
export async function bulkAddStudents(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const raw = String(formData.get("roster") || "");
  if (!classId || !raw.trim()) redirect(`/teacher/classes/${classId}`);

  const rows: { class_id: string; number: number; name: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/[\t,]+|\s{2,}|\s(?=\d)/).map((p) => p.trim()).filter(Boolean);
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
    redirect(`/teacher/classes/${classId}?error=형식을+확인하세요+(예: 1,민수)`);
  }

  // 번호 기준 upsert (이미 있는 번호는 이름 갱신 → 재업로드 안전)
  const { error } = await db
    .from("students")
    .upsert(rows, { onConflict: "class_id,number" });
  if (error) {
    redirect(`/teacher/classes/${classId}?error=${encodeURIComponent(error.message)}`);
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
  const { db } = await getTeacherContext();
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
  if (!current?.parent_token) update.parent_token = randomBytes(16).toString("hex");
  if (name) update.name = name;
  if (school) update.school = school;
  if (grade) update.grade = grade;

  await db.from("students").update(update).eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 가입 신청 반려
export async function rejectStudent(formData: FormData) {
  const { db } = await getTeacherContext();
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
      `${s.username ?? ""}|${temp}`
    )}`
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
        error?.message || "과제 생성 실패"
      )}`
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
  if (sub) await evaluateSubmission(submissionId);

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
        current.sample_voice ?? undefined
      );
    } catch (e) {
      console.error("[TTS] 수정 후 재생성 실패:", e);
    }
  }

  revalidatePath(`/teacher/classes/${classId}`);
}

// 과제 삭제 (중복 정리 등)
export async function deleteAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");
  // submissions 는 ON DELETE CASCADE
  await db.from("assignments").delete().eq("id", assignmentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// ---------- 월말 리포트 ----------

// 학생이 실효 교사 소유인지 확인 후 {id,name,class_id} 반환
async function ownedStudent(
  db: Awaited<ReturnType<typeof getTeacherContext>>["db"],
  effectiveId: string,
  studentId: string
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
    student.approved_at
  );
  let content: string;
  try {
    content = await generateMonthlyReportDraft(student.name, month, data);
  } catch (e) {
    console.error("[월말리포트] 생성 실패:", e);
    redirect(
      `/teacher/students/${studentId}/monthly?month=${month}&error=${encodeURIComponent(
        "초안 생성 실패 (Anthropic 키 확인)"
      )}`
    );
  }

  await db
    .from("monthly_reports")
    .upsert(
      { student_id: studentId, year_month: month, content },
      { onConflict: "student_id,year_month" }
    );
  revalidatePath(`/teacher/students/${studentId}/monthly`);
}

// 월말 리포트 저장(수정)
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
      { onConflict: "student_id,year_month" }
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
    : assignment.sample_voice ?? undefined;
  if (picked) {
    await db
      .from("assignments")
      .update({ sample_voice: voice })
      .eq("id", assignmentId);
  }

  try {
    await generateAndStoreSamples(assignment.id, assignment.passage_text, voice);
  } catch (e) {
    console.error("[TTS] 재생성 실패:", e);
    redirect(`/teacher/classes/${classId}?error=샘플음성+생성+실패+(OpenAI+키+확인)`);
  }

  revalidatePath(`/teacher/classes/${classId}`);
}
