import "server-only";

// ============================================================
//  Slack 알림
//  - 담당 선생님에게 개인 DM: 봇 토큰(SLACK_BOT_TOKEN)으로 이메일 → 사용자 조회 → DM
//  - 폴백: 공용 Incoming Webhook(SLACK_WEBHOOK_URL) 이 있으면 그 채널로
// ============================================================

// 공용 웹훅으로 전송 (best-effort). 미설정 시 조용히 생략.
export async function notifySlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log("[slack] 웹훅 미설정 — 알림 생략:", text);
    return;
  }
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) {
    console.error("[slack] 웹훅 전송 실패:", e);
  }
}

// 담당 선생님(email)에게 개인 DM. 실패하면 공용 웹훅으로 폴백.
export async function notifyTeacher(
  email: string | null | undefined,
  text: string
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;

  if (token && email) {
    try {
      // 1) 이메일 → Slack 사용자 ID
      const look = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(
          email
        )}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const lj = (await look.json()) as {
        ok: boolean;
        user?: { id: string };
        error?: string;
      };

      if (lj.ok && lj.user?.id) {
        // 2) 해당 사용자에게 DM
        const post = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: JSON.stringify({ channel: lj.user.id, text }),
        });
        const pj = (await post.json()) as { ok: boolean; error?: string };
        if (pj.ok) return;
        console.error("[slack] chat.postMessage 실패:", pj.error);
      } else {
        console.error(
          "[slack] users.lookupByEmail 실패:",
          lj.error,
          "(email:",
          email,
          ")"
        );
      }
    } catch (e) {
      console.error("[slack] 봇 DM 오류:", e);
    }
  }

  // 폴백: 공용 웹훅(설정된 경우)
  await notifySlack(text);
}
