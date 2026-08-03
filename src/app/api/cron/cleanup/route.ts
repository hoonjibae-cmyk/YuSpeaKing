import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyDueTransfers } from "@/lib/transfers";

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

  // 적용일이 된 반/학생 이동 예약을 반영 (선생님이 접속하지 않아도 진행되도록)
  let transfersApplied = 0;
  try {
    transfersApplied = await applyDueTransfers();
  } catch (e) {
    console.error("[크론] 예약 이동 적용 실패:", e);
  }

  const admin = createAdminClient();

  // 채점 도중 함수 실행시간이 끝나 'evaluating' 에서 멈춘 제출을 되살린다.
  // (그대로 두면 선생님 화면에 '평가중'으로 영영 남는다)
  let stuckFixed = 0;
  try {
    const stuckBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data: stuck } = await admin
      .from("submissions")
      .select("id")
      .eq("status", "evaluating")
      .lt("created_at", stuckBefore)
      .limit(50);
    const ids = ((stuck ?? []) as { id: string }[]).map((s) => s.id);
    if (ids.length) {
      await admin
        .from("submissions")
        .update({
          status: "error",
          error_message:
            "채점이 시간 안에 끝나지 않았어요. [AI 재평가 실행]으로 다시 시도해 주세요.",
        })
        .in("id", ids);
      stuckFixed = ids.length;
    }
  } catch (e) {
    console.error("[크론] 멈춘 채점 정리 실패:", e);
  }

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
    return NextResponse.json({ ok: true, deleted: 0, transfersApplied, stuckFixed });
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

  return NextResponse.json({ ok: true, deleted: ids.length, transfersApplied, stuckFixed });
}
