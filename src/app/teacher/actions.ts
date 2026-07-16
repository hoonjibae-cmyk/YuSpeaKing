"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacherContext, clearImpersonation } from "@/lib/teacher-context";
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
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name, slack_email: slackEmail } },
  });
  if (error) {
    redirect(
      `/teacher/login?mode=signup&error=${encodeURIComponent(error.message)}`
    );
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
  const { data: rows } = await db
    .from("students")
    .select("number")
    .eq("class_id", targetClassId)
    .not("number", "is", null)
    .order("number", { ascending: false })
    .limit(1);
  const number = Number(rows?.[0]?.number ?? 0) + 1;

  const update: Record<string, unknown> = {
    status: "approved",
    class_id: targetClassId,
    number,
  };
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
  const maxAttempts = Math.min(
    10,
    Math.max(1, parseInt(String(formData.get("max_attempts") || "2"), 10) || 2)
  );
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
  const maxAttempts = Math.min(
    10,
    Math.max(1, parseInt(String(formData.get("max_attempts") || "2"), 10) || 2)
  );
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
    .select("id, name, class_id, classes!inner(teacher_id)")
    .eq("id", studentId)
    .eq("classes.teacher_id", effectiveId)
    .single();
  return data as { id: string; name: string; class_id: string } | null;
}

// AI 월말 리포트 초안 생성
export async function generateMonthlyDraft(formData: FormData) {
  const { db, effectiveId } = await getTeacherContext();
  const studentId = String(formData.get("studentId") || "");
  const month = String(formData.get("month") || "");
  const student = await ownedStudent(db, effectiveId, studentId);
  if (!student || !month) redirect("/teacher");

  const data = await gatherMonthly(db, student.id, student.class_id, month);
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
