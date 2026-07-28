import "server-only";
import webpush from "web-push";
import { createAdminClient } from "./supabase/admin";

// 웹푸시 발송. VAPID 키가 없으면 조용히 건너뛴다(앱 안 공지는 그대로 동작).
function configured(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  );
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

// 지정한 학생들에게 푸시 발송. 만료된 구독(410/404)은 정리한다.
export async function sendPushToStudents(
  studentIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (!configured() || studentIds.length === 0) return { sent: 0, failed: 0 };

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:admin@yussam.com",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const admin = createAdminClient();
  const { data: subs } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("student_id", studentIds);

  const list = (subs ?? []) as {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }[];
  if (list.length === 0) return { sent: 0, failed: 0 };

  const text = JSON.stringify(payload);
  const stale: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    list.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          text
        );
        sent++;
      } catch (e) {
        failed++;
        const code = (e as { statusCode?: number }).statusCode;
        // 구독이 만료·해지된 경우 정리
        if (code === 404 || code === 410) stale.push(s.id);
      }
    })
  );

  if (stale.length) {
    await admin.from("push_subscriptions").delete().in("id", stale);
  }
  return { sent, failed };
}
