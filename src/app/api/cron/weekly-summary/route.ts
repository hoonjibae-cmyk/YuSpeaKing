import { NextResponse } from "next/server";
import { getWeeklyReportEmails } from "@/lib/settings";
import { sendWeeklySummary } from "@/lib/weekly-send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 매주 월요일 낮 12시(KST) 실행.
// 지난주(월~일) 운영 요약을 경영지원·교수부장에게 Slack 으로 보낸다.
// 표는 그림 한 장으로 가고, 그림을 못 만들거나 못 올리면 글로 간다.
//
// 받는 사람은 운영자 → 설정 화면에서 지정한다. 담당자가 바뀔 때마다 코드를
// 고치고 재배포하지 않도록 설정 표에 두었다.
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

  // 받는 사람이 없으면 아무것도 하지 않는다. 반별 점수가 든 표라서
  // 지정하지 않은 곳으로 흘려보내지 않는다.
  if ((await getWeeklyReportEmails()).length === 0) {
    return NextResponse.json({ skipped: "받는 사람이 지정되지 않음" });
  }

  try {
    const r = await sendWeeklySummary(1); // 1 = 지난주
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    console.error("[크론] 주간 요약 발송 실패:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 500 },
    );
  }
}
