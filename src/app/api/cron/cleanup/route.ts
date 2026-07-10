import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_DAYS = 60;

// 60일 지난 녹음 음원을 삭제한다(점수·피드백은 유지).
// Vercel Cron 이 매일 호출. CRON_SECRET 로 보호.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data: old, error } = await admin
    .from("submissions")
    .select("id, audio_path")
    .lt("created_at", cutoff)
    .eq("audio_expired", false)
    .limit(1000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!old || old.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0 });
  }

  // 스토리지 파일 삭제
  const paths = old.map((s) => s.audio_path).filter(Boolean) as string[];
  if (paths.length) {
    await admin.storage.from("submissions").remove(paths);
  }

  // 만료 표시
  const ids = old.map((s) => s.id);
  await admin
    .from("submissions")
    .update({ audio_expired: true })
    .in("id", ids);

  return NextResponse.json({ ok: true, deleted: ids.length });
}
