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
  /** 학생 기기에서 알림을 눌렀을 때 열 주소 */
  studentUrl?: string;
  /** 학부모 기기용 주소의 앞부분 (예: https://도메인) — /parent/{토큰} 이 붙는다 */
  origin?: string;
}

// 지정한 학생들의 기기(학생·학부모)로 푸시 발송. 만료된 구독(410/404)은 정리한다.
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
    .select("id, endpoint, p256dh, auth, student_id, audience")
    .in("student_id", studentIds);

  const list = (subs ?? []) as {
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    student_id: string;
    audience: string | null;
  }[];
  if (list.length === 0) return { sent: 0, failed: 0 };

  // 학부모 기기는 학생 화면 대신 본인 열람 링크로 열어야 한다
  const parentTokens = new Map<string, string>();
  if (list.some((s) => s.audience === "parent")) {
    const { data: rows } = await admin
      .from("students")
      .select("id, parent_token")
      .in(
        "id",
        Array.from(
          new Set(list.filter((s) => s.audience === "parent").map((s) => s.student_id))
        )
      );
    for (const r of (rows ?? []) as { id: string; parent_token: string | null }[]) {
      if (r.parent_token) parentTokens.set(r.id, r.parent_token);
    }
  }

  const stale: string[] = [];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    list.map(async (s) => {
      const isParent = s.audience === "parent";
      const token = isParent ? parentTokens.get(s.student_id) : undefined;
      const url = isParent
        ? token && payload.origin
          ? `${payload.origin}/parent/${token}`
          : undefined
        : payload.studentUrl;
      // 학부모인데 링크를 만들 수 없으면 보내지 않는다(잘못된 화면으로 유도 방지)
      if (isParent && !url) return;

      const text = JSON.stringify({
        title: payload.title,
        body: payload.body,
        url,
      });
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
