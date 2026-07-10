"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTeacher } from "@/lib/auth";
import { synthesizeSpeech } from "@/lib/ai/tts";
import { evaluateSubmission } from "@/lib/ai/evaluate";

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
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/teacher/login");
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
  const teacher = await requireTeacher();
  const name = String(formData.get("name") || "").trim();
  if (!name) redirect("/teacher?error=반+이름을+입력하세요");

  const supabase = createClient();

  // 유니크 코드 확보 (충돌 시 재시도)
  let code = generateClassCode();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await supabase
      .from("classes")
      .insert({ teacher_id: teacher.id, name, class_code: code });
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
  await requireTeacher();
  const classId = String(formData.get("classId") || "");
  const name = String(formData.get("name") || "").trim();
  const number = parseInt(String(formData.get("number") || ""), 10);
  if (!classId || !name || Number.isNaN(number)) {
    redirect(`/teacher/classes/${classId}?error=이름과+번호를+확인하세요`);
  }

  const supabase = createClient();
  const { error } = await supabase
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
  await requireTeacher();
  const classId = String(formData.get("classId") || "");
  const studentId = String(formData.get("studentId") || "");
  const supabase = createClient();
  await supabase.from("students").delete().eq("id", studentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// ---------- 과제 (지문 등록 + TTS 샘플음성) ----------

export async function createAssignment(formData: FormData) {
  await requireTeacher();
  const classId = String(formData.get("classId") || "");
  const title = String(formData.get("title") || "").trim();
  const passageText = String(formData.get("passage_text") || "").trim();
  const dueDate = String(formData.get("due_date") || "") || null;

  if (!classId || !title || !passageText) {
    redirect(`/teacher/classes/${classId}?error=제목과+지문을+입력하세요`);
  }

  const supabase = createClient();
  const { data: assignment, error } = await supabase
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      passage_text: passageText,
      due_date: dueDate,
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
    const audio = await synthesizeSpeech(passageText);
    const admin = createAdminClient();
    const path = `${assignment.id}.mp3`;
    const { error: upErr } = await admin.storage
      .from("sample-audio")
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    if (!upErr) {
      const { data: pub } = admin.storage.from("sample-audio").getPublicUrl(path);
      await supabase
        .from("assignments")
        .update({ sample_audio_url: pub.publicUrl })
        .eq("id", assignment.id);
    }
  } catch (e) {
    console.error("[TTS] 샘플음성 생성 실패:", e);
  }

  revalidatePath(`/teacher/classes/${classId}`);
}

// ---------- 제출물 검토 (M4) ----------

// 교사가 상세 리포트(교사용 피드백)를 수정하고 검토완료 처리
export async function updateSubmissionReview(formData: FormData) {
  await requireTeacher();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");
  const teacherFeedback = String(formData.get("teacher_feedback") || "");
  const reviewed = formData.get("teacher_reviewed") === "on";

  const supabase = createClient();
  // RLS 로 본인 반 제출만 수정 가능
  await supabase
    .from("submissions")
    .update({ teacher_feedback: teacherFeedback, teacher_reviewed: reviewed })
    .eq("id", submissionId);

  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

// 평가 실패/재시도 시 재평가
export async function reevaluateSubmission(formData: FormData) {
  await requireTeacher();
  const assignmentId = String(formData.get("assignmentId") || "");
  const submissionId = String(formData.get("submissionId") || "");

  // 소유권 확인 (RLS)
  const supabase = createClient();
  const { data: sub } = await supabase
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .single();
  if (sub) await evaluateSubmission(submissionId);

  revalidatePath(`/teacher/assignments/${assignmentId}`);
}

// 과제 삭제 (중복 정리 등)
export async function deleteAssignment(formData: FormData) {
  await requireTeacher();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");
  const supabase = createClient();
  // RLS 로 본인 반 과제만 삭제 가능 (submissions 는 ON DELETE CASCADE)
  await supabase.from("assignments").delete().eq("id", assignmentId);
  revalidatePath(`/teacher/classes/${classId}`);
}

// 샘플 음성 재생성 (TTS 실패했거나 지문 수정 후)
export async function regenerateSample(formData: FormData) {
  await requireTeacher();
  const classId = String(formData.get("classId") || "");
  const assignmentId = String(formData.get("assignmentId") || "");

  const supabase = createClient();
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, passage_text")
    .eq("id", assignmentId)
    .single();
  if (!assignment) redirect(`/teacher/classes/${classId}`);

  try {
    const audio = await synthesizeSpeech(assignment.passage_text);
    const admin = createAdminClient();
    const path = `${assignment.id}.mp3`;
    await admin.storage
      .from("sample-audio")
      .upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    const { data: pub } = admin.storage.from("sample-audio").getPublicUrl(path);
    await supabase
      .from("assignments")
      .update({ sample_audio_url: pub.publicUrl })
      .eq("id", assignment.id);
  } catch (e) {
    console.error("[TTS] 재생성 실패:", e);
    redirect(`/teacher/classes/${classId}?error=샘플음성+생성+실패+(OpenAI+키+확인)`);
  }

  revalidatePath(`/teacher/classes/${classId}`);
}
