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
  text: string,
): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;

  if (token && email) {
    try {
      // 1) 이메일 → Slack 사용자 ID
      const look = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(
          email,
        )}`,
        { headers: { Authorization: `Bearer ${token}` } },
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
          ")",
        );
      }
    } catch (e) {
      console.error("[slack] 봇 DM 오류:", e);
    }
  }

  // 폴백: 공용 웹훅(설정된 경우)
  await notifySlack(text);
}

// ============================================================
//  그림(PNG) 보내기
//
//  표를 글로 보내면 보는 사람 기기의 글꼴·너비에 따라 열이 어긋난다.
//  그림은 어디서 봐도 같아서 주간 요약처럼 표가 든 알림에 쓴다.
//
//  슬랙 파일 업로드는 세 걸음이다.
//    1) files.getUploadURLExternal 로 올릴 주소를 받고
//    2) 그 주소로 바이트를 올린 뒤
//    3) files.completeUploadExternal 로 어느 대화에 붙일지 알려 준다
//
//  필요한 권한(scope): files:write, im:write
//  (기존 chat:write, users:read.email 에 더해)
//  권한이 없으면 글 알림으로 되돌아간다 — 못 보내는 것보다 낫다.
// ============================================================

interface SlackResult {
  ok: boolean;
  /** 그림으로 못 보낸 이유 (글로 대신 보냈을 때) */
  fellBackTo?: string;
}

async function slackApi<T>(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<T & { ok: boolean; error?: string; needed?: string }> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as T & {
    ok: boolean;
    error?: string;
    needed?: string;
  };
}

async function uploadImage(
  token: string,
  channel: string,
  png: ArrayBuffer,
  filename: string,
  title: string,
  comment: string,
): Promise<void> {
  // 1) 올릴 주소 받기 — 길이를 미리 알려 줘야 한다
  const url = new URL("https://slack.com/api/files.getUploadURLExternal");
  url.searchParams.set("filename", filename);
  url.searchParams.set("length", String(png.byteLength));
  const upRes = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const up = (await upRes.json()) as {
    ok: boolean;
    upload_url?: string;
    file_id?: string;
    error?: string;
    needed?: string;
  };
  if (!up.ok || !up.upload_url || !up.file_id) {
    throw new Error(
      `getUploadURLExternal: ${up.error ?? "실패"}${
        up.needed ? ` (필요 권한: ${up.needed})` : ""
      }`,
    );
  }

  // 2) 바이트 올리기
  const putRes = await fetch(up.upload_url, {
    method: "POST",
    body: png,
    headers: { "Content-Type": "application/octet-stream" },
  });
  if (!putRes.ok) throw new Error(`파일 업로드 실패 (${putRes.status})`);

  // 3) 대화에 붙이기
  const done = await slackApi("files.completeUploadExternal", token, {
    files: [{ id: up.file_id, title }],
    channel_id: channel,
    initial_comment: comment,
  });
  if (!done.ok) {
    throw new Error(
      `completeUploadExternal: ${done.error ?? "실패"}${
        done.needed ? ` (필요 권한: ${done.needed})` : ""
      }`,
    );
  }
}

// 담당자(email)에게 그림 한 장을 DM. 어느 단계든 막히면 글로 대신 보낸다.
export async function notifyTeacherImage(
  email: string | null | undefined,
  png: ArrayBuffer,
  opts: {
    filename: string;
    title: string;
    comment: string;
    fallbackText: string;
  },
): Promise<SlackResult> {
  const token = process.env.SLACK_BOT_TOKEN;

  if (token && email) {
    try {
      const look = await fetch(
        `https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(
          email,
        )}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const lj = (await look.json()) as {
        ok: boolean;
        user?: { id: string };
        error?: string;
      };
      if (!lj.ok || !lj.user?.id) {
        throw new Error(`users.lookupByEmail: ${lj.error ?? "사용자 없음"}`);
      }

      // DM 대화를 열어 그 채널에 붙인다 (파일은 사람이 아니라 대화에 붙는다)
      const im = await slackApi<{ channel?: { id: string } }>(
        "conversations.open",
        token,
        { users: lj.user.id },
      );
      if (!im.ok || !im.channel?.id) {
        throw new Error(
          `conversations.open: ${im.error ?? "실패"}${
            im.needed ? ` (필요 권한: ${im.needed})` : ""
          }`,
        );
      }

      await uploadImage(
        token,
        im.channel.id,
        png,
        opts.filename,
        opts.title,
        opts.comment,
      );
      return { ok: true };
    } catch (e) {
      const reason = e instanceof Error ? e.message : "알 수 없는 오류";
      console.error("[slack] 그림 전송 실패 → 글로 대신 보냄:", reason);
      await notifyTeacher(email, opts.fallbackText);
      return { ok: true, fellBackTo: reason };
    }
  }

  await notifyTeacher(email, opts.fallbackText);
  return {
    ok: true,
    fellBackTo: token ? "이메일 없음" : "SLACK_BOT_TOKEN 없음",
  };
}

// ============================================================
//  워크스페이스 멤버 목록
//
//  주간 요약 받는 사람을 손으로 타이핑하면 오타 한 글자에 알림이 조용히
//  사라진다. 슬랙에서 실제 멤버를 읽어 와 고르게 한다.
//
//  필요한 권한: users:read, users:read.email (이미 들어 있다)
// ============================================================

export interface SlackMember {
  id: string;
  /** 화면에 보일 이름 (실명 > 표시이름 > 계정명) */
  name: string;
  email: string;
}

// 목록을 못 읽어도 설정 화면은 열려야 하므로 예외 대신 null 을 돌려준다.
// 부르는 쪽은 null 이면 직접 적는 칸을 보여 준다.
export async function listSlackMembers(): Promise<SlackMember[] | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return null;

  const members: SlackMember[] = [];
  let cursor = "";

  try {
    // 멤버가 많으면 나눠서 준다. 몇 백 명 규모라 두세 번이면 끝난다.
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://slack.com/api/users.list");
      url.searchParams.set("limit", "200");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        members?: Array<{
          id: string;
          deleted?: boolean;
          is_bot?: boolean;
          name?: string;
          real_name?: string;
          profile?: {
            email?: string;
            real_name?: string;
            display_name?: string;
          };
        }>;
        response_metadata?: { next_cursor?: string };
      };
      if (!j.ok) {
        console.error("[slack] users.list 실패:", j.error);
        return null;
      }

      for (const m of j.members ?? []) {
        // 봇·탈퇴자·이메일 없는 계정은 DM 대상이 아니다
        if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
        const email = m.profile?.email;
        if (!email) continue;
        members.push({
          id: m.id,
          name:
            m.profile?.real_name ||
            m.real_name ||
            m.profile?.display_name ||
            m.name ||
            email,
          email,
        });
      }

      cursor = j.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
    }
  } catch (e) {
    console.error("[slack] 멤버 목록 조회 오류:", e);
    return null;
  }

  return members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
