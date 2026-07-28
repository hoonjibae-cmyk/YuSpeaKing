import { NextResponse } from "next/server";
import { getActiveStudent } from "@/lib/student-guard";
import { createAdminClient } from "@/lib/supabase/admin";

// 학생 기기의 웹푸시 구독 정보를 저장/해지한다.
export async function POST(req: Request) {
  const session = await getActiveStudent();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "구독 정보가 올바르지 않아요" }, { status: 400 });
  }

  const admin = createAdminClient();
  // 같은 기기(endpoint)가 다시 구독하면 최신 학생으로 갱신
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      { student_id: session.studentId, endpoint, p256dh, auth },
      { onConflict: "endpoint" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const session = await getActiveStudent();
  if (!session) {
    return NextResponse.json({ error: "로그인이 필요해요" }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { endpoint?: string } | null;
  if (!body?.endpoint) {
    return NextResponse.json({ error: "endpoint 가 필요해요" }, { status: 400 });
  }
  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("student_id", session.studentId);
  return NextResponse.json({ ok: true });
}
