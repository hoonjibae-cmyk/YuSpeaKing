"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTeacherContext, clearImpersonation } from "@/lib/teacher-context";
import { synthesizeSpeech } from "@/lib/ai/tts";
import { evaluateSubmission } from "@/lib/ai/evaluate";

// 정상 속도 + 느린(0.75배) 샘플 음성 2종 생성 → Storage 업로드 → URL 저장
async function generateAndStoreSamples(assignmentId: string, passageText: string) {
  const admin = createAdminClient();
  const [normal, slow] = await Promise.all([
    synthesizeSpeech(passageText, 1.0),
    synthesizeSpeech(passageText, 0.75),
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
  redirect("/teacher");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "");
  const supabase = createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) redirect(`/teacher/login?error=${encodeURIComponent(error.message)}`);
  redirect("/teacher/login?signup=1");
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

// ---------- 과제 (지문 등록 + TTS 샘플음성) ----------

export async function createAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const title = String(formData.get("title") || "").trim();
  const passageText = String(formData.get("passage_text") || "").trim();
  const dueDate = String(formData.get("due_date") || "") || null;
  const maxAttempts = Math.min(
    10,
    Math.max(1, parseInt(String(formData.get("max_attempts") || "3"), 10) || 3)
  );

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
    await generateAndStoreSamples(assignment.id, passageText);
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

// 과제 삭제 (중복 정리 등)
export async function deleteAssignment(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");
  // submissions 는 ON DELETE CASCADE
  await db.from("assignments").delete().eq("id", assignmentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 샘플 음성 재생성 (TTS 실패했거나 지문 수정 후)
export async function regenerateSample(formData: FormData) {
  const { db } = await getTeacherContext();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");

  const { data: assignment } = await db
    .from("assignments")
    .select("id, passage_text")
    .eq("id", assignmentId)
    .single();
  if (!assignment) redirect(`/teacher/classes/${classId}`);

  try {
    await generateAndStoreSamples(assignment.id, assignment.passage_text);
  } catch (e) {
    console.error("[TTS] 재생성 실패:", e);
    redirect(`/teacher/classes/${classId}?error=샘플음성+생성+실패+(OpenAI+키+확인)`);
  }

  revalidatePath(`/teacher/classes/${classId}`);
}
