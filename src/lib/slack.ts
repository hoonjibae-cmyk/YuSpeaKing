import "server-only";

// Slack Incoming Webhook 으로 알림 전송 (best-effort).
// SLACK_WEBHOOK_URL 이 없으면 조용히 건너뛴다(로컬/미설정 환경 대비).
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log("[slack] SLACK_WEBHOOK_URL 미설정 — 알림 생략:", text);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error("[slack] 알림 전송 실패:", e);
  }
}
