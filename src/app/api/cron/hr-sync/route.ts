import { NextResponse } from "next/server";
import { hrConfigured } from "@/lib/hr/client";
import { syncAll } from "@/lib/hr/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 이어 둔 반의 HR manager 명단을 매일 새벽에 한 번 받아 온다.
//
// 결과는 hr_pending_students 에 저장되고, 선생님 화면은 그 저장된 값만 읽는다.
// 그래서 선생님이 아침에 로그인하면 버튼을 누르지 않아도 '등록 안 된 학생'
// 알림이 이미 떠 있다.
//
// Vercel Cron 이 호출. CRON_SECRET 로 보호.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  if (!hrConfigured()) {
    return NextResponse.json({ skipped: "HR 연동 미설정" });
  }

  try {
    const reports = await syncAll();
    const failed = reports.filter((r) => r.error);
    return NextResponse.json({
      classes: reports.length,
      updated: reports.reduce((n, r) => n + r.updated, 0),
      pending: reports.reduce(
        (n, r) => n + r.pendingNew + r.pendingAmbiguous,
        0,
      ),
      failed: failed.map((r) => ({ class: r.className, error: r.error })),
    });
  } catch (e) {
    console.error("[크론] HR 명단 동기화 실패:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
