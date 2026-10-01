import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeacher } from "@/lib/slack";
import { appOrigin } from "@/lib/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 매일 오후 2시(KST) 실행.
// Student Card 명단에는 있는데 유스피킹에 가입도 가입 신청도 없는 학생을
// 담당 선생님에게 Slack DM 으로 알린다.
//
// 저장된 결과(hr_pending_students)만 읽는다. 이 표는 새벽 4시 동기화
// (/api/cron/hr-sync)가 채워 두므로, 여기서 외부 API 를 다시 부르지 않는다.
// Student Card 가 잠시 멈춰 있어도 알림은 그대로 나간다.
//
// Vercel Cron 이 호출. CRON_SECRET 로 보호.

// 한 반에 이름을 몇 명까지 적을지 (너무 길면 DM 이 읽기 어려워진다)
const MAX_NAMES = 10;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const origin = appOrigin(new URL(req.url).origin);

  // 보관한 반은 운영이 끝난 반이라 알리지 않는다
  const { data: classRows } = await admin
    .from("classes")
    .select("id, name, teacher_id")
    .is("archived_at", null)
    .order("name");
  const classes = (classRows ?? []) as {
    id: string;
    name: string;
    teacher_id: string;
  }[];
  if (classes.length === 0) {
    return NextResponse.json({ ok: true, teachersNotified: 0 });
  }

  const { data: pendRows } = await admin
    .from("hr_pending_students")
    .select("class_id, name, kind")
    .in(
      "class_id",
      classes.map((c) => c.id)
    )
    .order("name");
  const pending = (pendRows ?? []) as {
    class_id: string;
    name: string;
    kind: string;
  }[];
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, teachersNotified: 0 });
  }

  const { data: teacherRows } = await admin
    .from("teachers")
    .select("id, name, email, slack_email");
  const teachers = (teacherRows ?? []) as {
    id: string;
    name: string | null;
    email: string | null;
    slack_email: string | null;
  }[];

  // 반별로 모은다 — 'new' 는 등록 대상, 'ambiguous' 는 사람이 골라야 하는 건
  const newByClass = new Map<string, string[]>();
  const ambiguousByClass = new Map<string, number>();
  for (const p of pending) {
    if (p.kind === "ambiguous") {
      ambiguousByClass.set(
        p.class_id,
        (ambiguousByClass.get(p.class_id) ?? 0) + 1
      );
      continue;
    }
    newByClass.set(p.class_id, [...(newByClass.get(p.class_id) ?? []), p.name]);
  }

  let sent = 0;
  for (const t of teachers) {
    const mine = classes.filter((c) => c.teacher_id === t.id);

    const lines: string[] = [];
    let newTotal = 0;
    let ambiguousTotal = 0;

    for (const c of mine) {
      const names = newByClass.get(c.id) ?? [];
      const amb = ambiguousByClass.get(c.id) ?? 0;
      newTotal += names.length;
      ambiguousTotal += amb;
      if (names.length === 0) continue;

      const shown = names.slice(0, MAX_NAMES).join(", ");
      const more =
        names.length > MAX_NAMES ? ` 외 ${names.length - MAX_NAMES}명` : "";
      lines.push(`• ${c.name} (${names.length}명) — ${shown}${more}`);
    }

    // 알릴 것이 없으면 보내지 않는다 (조용한 날은 조용하게)
    if (newTotal === 0 && ambiguousTotal === 0) continue;

    // 확인 필요 건만 남은 날에 '등록되지 않은 학생 0명' 이라고 쓰지 않도록
    const parts =
      newTotal > 0
        ? [
            `🧾 유스피킹 · 아직 등록되지 않은 학생 ${newTotal}명`,
            "",
            "Student Card 명단에는 있는데, 유스피킹에 가입도 가입 신청도 안 된 학생이에요.",
            "",
            ...lines,
          ]
        : ["🧾 유스피킹 · 명단에서 확인이 필요한 학생이 있어요"];
    if (ambiguousTotal > 0) {
      parts.push(
        "",
        `⚠️ 이름이 같은 학생이 여럿이라 직접 확인이 필요한 건 ${ambiguousTotal}명 있어요.`
      );
    }
    parts.push("", `👉 명단 확인: ${origin}/teacher/roster`);

    await notifyTeacher(t.slack_email || t.email, parts.join("\n"));
    sent++;
  }

  return NextResponse.json({ ok: true, teachersNotified: sent });
}
