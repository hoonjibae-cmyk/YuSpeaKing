import { NextResponse } from "next/server";
import { notifyTeacher } from "@/lib/slack";
import { appOrigin } from "@/lib/app-url";
import { getWeeklyReportEmails } from "@/lib/settings";
import { formatWeeklySlack, gatherWeekly } from "@/lib/weekly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// 매주 월요일 낮 12시(KST) 실행.
// 지난주(월~일) 운영 요약을 경영지원·교수부장에게 Slack DM 으로 보낸다.
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

  const emails = await getWeeklyReportEmails();
  if (emails.length === 0) {
    // 받는 사람이 없으면 공용 웹훅으로 흘려보내지 않는다.
    // 반별 점수가 든 표라서, 지정하지 않은 곳에 뿌려지면 안 된다.
    return NextResponse.json({ skipped: "받는 사람이 지정되지 않음" });
  }

  const summary = await gatherWeekly(1); // 1 = 지난주
  const origin = appOrigin(new URL(req.url).origin);
  const text =
    formatWeeklySlack(summary) + `\n\n👉 유스피킹 운영현황: ${origin}/admin`;

  for (const email of emails) {
    await notifyTeacher(email, text);
  }

  return NextResponse.json({
    ok: true,
    range: summary.range,
    classes: summary.classes.length,
    sentTo: emails.length,
  });
}
