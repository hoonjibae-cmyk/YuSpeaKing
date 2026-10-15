import "server-only";
import { notifyTeacherImage } from "./slack";
import { appOrigin } from "./app-url";
import { getWeeklyReportEmails } from "./settings";
import { formatWeeklySlack, gatherWeekly } from "./weekly";
import { renderWeeklyImage } from "./weekly-image";

// 주간 요약 발송. 크론과 운영자의 [지금 보내 보기] 가 같은 길을 쓴다.
//
// 그림이 본문이고, 글은 보조다. 그림을 못 만들거나 못 올리면 글로 보낸다 —
// 표가 조금 투박해도 월요일에 아무것도 안 오는 것보다 낫다.

export interface SendResult {
  sentTo: number;
  range: string;
  classes: number;
  /** 그림 대신 글로 나간 이유 (정상이면 없음) */
  fellBackTo?: string;
}

export async function sendWeeklySummary(offset = 1): Promise<SendResult> {
  const emails = await getWeeklyReportEmails();
  const summary = await gatherWeekly(offset);
  const origin = appOrigin();
  const link = origin ? `\n👉 유스피킹 운영현황: ${origin}/admin` : "";
  const text = formatWeeklySlack(summary) + link;

  if (emails.length === 0) {
    return { sentTo: 0, range: summary.range, classes: summary.classes.length };
  }

  let png: ArrayBuffer | null = null;
  let renderError: string | undefined;
  try {
    png = await renderWeeklyImage(summary);
  } catch (e) {
    renderError = e instanceof Error ? e.message : "그림 생성 실패";
    console.error("[주간요약] 그림 생성 실패 → 글로 보냄:", e);
  }

  let fellBackTo = renderError;
  for (const email of emails) {
    if (png) {
      const r = await notifyTeacherImage(email, png, {
        filename: `yuspeaking-${summary.range.replace(/[^\d]/g, "")}.png`,
        title: `유스피킹 주간 운영 요약 (${summary.range})`,
        comment: `📋 유스피킹 주간 운영 요약 · ${summary.range}${link}`,
        fallbackText: text,
      });
      if (r.fellBackTo) fellBackTo = r.fellBackTo;
    } else {
      // 그림을 못 만들었으면 글로
      const { notifyTeacher } = await import("./slack");
      await notifyTeacher(email, text);
    }
  }

  return {
    sentTo: emails.length,
    range: summary.range,
    classes: summary.classes.length,
    fellBackTo,
  };
}
