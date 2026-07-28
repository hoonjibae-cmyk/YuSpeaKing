import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 학부모 열람 링크 토큰으로 본인 확인 후 구독을 저장/해지한다.
// (학부모는 로그인이 없으므로 토큰이 곧 인증 수단)
async function studentIdFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("students")
    .select("id, status")
    .eq("parent_token", token)
    .maybeSingle();
  if (!data || data.status !== "approved") return null;
  return data.id as string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  } | null;

  const studentId = await studentIdFromToken(String(body?.token || ""));
  if (!studentId) {
    return NextResponse.json({ error: "링크가 올바르지 않아요" }, { status: 403 });
  }

  const endpoint = body?.endpoint;
  const p256dh = body?.keys?.p256dh;
  const auth = body?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: "구독 정보가 올바르지 않아요" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("push_subscriptions")
    .upsert(
      { student_id: studentId, endpoint, p256dh, auth, audience: "parent" },
      { onConflict: "endpoint" }
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    token?: string;
    endpoint?: string;
  } | null;

  const studentId = await studentIdFromToken(String(body?.token || ""));
  if (!studentId || !body?.endpoint) {
    return NextResponse.json({ error: "요청이 올바르지 않아요" }, { status: 400 });
  }

  const admin = createAdminClient();
  await admin
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", body.endpoint)
    .eq("student_id", studentId);
  return NextResponse.json({ ok: true });
}
