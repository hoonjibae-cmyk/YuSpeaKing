import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeacher } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 매일 오후 10시(KST) 실행. 지난 24시간 제출 현황을 담임(반 담당 선생님)에게 Slack DM.
// Vercel Cron 이 호출. CRON_SECRET 로 보호.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const origin = new URL(req.url).origin;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [teachersRes, classesRes, studentsRes, assignmentsRes] =
    await Promise.all([
      admin.from("teachers").select("id, name, email, slack_email"),
      admin.from("classes").select("id, name, teacher_id"),
      admin.from("students").select("id, class_id, status"),
      admin.from("assignments").select("id, class_id"),
    ]);

  const teachers = (teachersRes.data ?? []) as {
    id: string;
    name: string | null;
    email: string | null;
    slack_email: string | null;
  }[];
  const classes = (classesRes.data ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  const students = (studentsRes.data ?? []) as {
    id: string;
    class_id: string;
    status: string | null;
  }[];
  const assignments = (assignmentsRes.data ?? []) as {
    id: string;
    class_id: string;
  }[];

  // 지난 24시간 제출 (assignment_id → class 매핑으로 반별 집계)
  const { data: recentSubs } = await admin
    .from("submissions")
    .select("student_id, assignment_id, created_at")
    .gte("created_at", cutoff);

  const assignmentClass = new Map(assignments.map((a) => [a.id, a.class_id]));

  // 반별 승인 학생 수
  const studentsByClass = new Map<string, number>();
  for (const s of students) {
    if (s.status === "approved") {
      studentsByClass.set(
        s.class_id,
        (studentsByClass.get(s.class_id) ?? 0) + 1
      );
    }
  }

  // 반별 지난 24시간 제출 학생(중복 제거)
  const submittersByClass = new Map<string, Set<string>>();
  for (const s of (recentSubs ?? []) as {
    student_id: string;
    assignment_id: string;
  }[]) {
    const classId = assignmentClass.get(s.assignment_id);
    if (!classId) continue;
    if (!submittersByClass.has(classId))
      submittersByClass.set(classId, new Set());
    submittersByClass.get(classId)!.add(s.student_id);
  }

  // 선생님별 메시지 구성 → DM
  let sent = 0;
  for (const t of teachers) {
    const myClasses = classes.filter((c) => c.teacher_id === t.id);
    // 학생이 있는 반만
    const lines: string[] = [];
    for (const c of myClasses) {
      const total = studentsByClass.get(c.id) ?? 0;
      if (total === 0) continue;
      const submitted = submittersByClass.get(c.id)?.size ?? 0;
      const rate = Math.round((submitted / total) * 100);
      lines.push(`• ${c.name} — 제출 ${submitted}명 / ${total}명 (${rate}%)`);
    }
    if (lines.length === 0) continue;

    const text =
      `📊 유스피킹 오늘의 제출 현황 (최근 24시간)\n` +
      lines.join("\n") +
      `\n👉 유스피킹 바로가기: ${origin}/teacher`;

    await notifyTeacher(t.slack_email || t.email, text);
    sent++;
  }

  return NextResponse.json({ ok: true, teachersNotified: sent });
}
