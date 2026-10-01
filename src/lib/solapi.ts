import "server-only";
import crypto from "crypto";

// 솔라피(Solapi)로 카카오 알림톡 발송.
//
// 알림톡은 카카오가 미리 심사·승인한 템플릿으로만 보낼 수 있다.
// 본문을 코드에서 자유롭게 쓰는 게 아니라, 승인받은 템플릿의 #{변수} 자리에
// 값만 끼워 넣는다. 그래서 여기서 보내는 것은 '템플릿ID + 변수값'이다.
//
// 필요한 환경변수
//   SOLAPI_API_KEY      솔라피 API 키
//   SOLAPI_API_SECRET   솔라피 API 시크릿
//   SOLAPI_PFID         카카오 비즈니스 채널(발신프로필) ID
//   SOLAPI_TEMPLATE_ID  승인받은 알림톡 템플릿 ID
//   SOLAPI_SENDER       등록된 발신번호 (알림톡 실패 시 문자 대체 발송용)

const API = "https://api.solapi.com/messages/v4/send-many/detail";

export interface AlimtalkTarget {
  to: string; // 받는 번호 (숫자만)
  variables: Record<string, string>; // { "#{이름}": "강주원", ... }
}

export interface SendResult {
  ok: boolean;
  sent: number;
  failed: number;
  error?: string;
  /** 번호별 실패 사유 (있는 경우) */
  failures?: { to: string; reason: string }[];
}

export function alimtalkConfigured(): boolean {
  return Boolean(
    process.env.SOLAPI_API_KEY &&
      process.env.SOLAPI_API_SECRET &&
      process.env.SOLAPI_PFID &&
      process.env.SOLAPI_TEMPLATE_ID
  );
}

// 숫자만 남긴다. 휴대폰 번호 형태가 아니면 null.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (/^01\d{8,9}$/.test(d)) return d;
  return null;
}

function authHeader() {
  const key = process.env.SOLAPI_API_KEY!;
  const secret = process.env.SOLAPI_API_SECRET!;
  const date = new Date().toISOString();
  const salt = crypto.randomBytes(16).toString("hex");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(date + salt)
    .digest("hex");
  return `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`;
}

export async function sendAlimtalk(
  targets: AlimtalkTarget[]
): Promise<SendResult> {
  if (targets.length === 0) return { ok: true, sent: 0, failed: 0 };
  if (!alimtalkConfigured()) {
    return {
      ok: false,
      sent: 0,
      failed: targets.length,
      error:
        "알림톡 설정이 비어 있어요. 운영자 설정에서 솔라피 키·발신프로필·템플릿을 먼저 등록해 주세요.",
    };
  }

  const body = {
    messages: targets.map((t) => ({
      to: t.to,
      from: process.env.SOLAPI_SENDER || undefined,
      kakaoOptions: {
        pfId: process.env.SOLAPI_PFID,
        templateId: process.env.SOLAPI_TEMPLATE_ID,
        variables: t.variables,
        // 알림톡이 막히면(채널 차단 등) 문자로 대체 발송.
        // 발신번호가 없으면 대체 발송도 불가하므로 그때는 끈다.
        disableSms: !process.env.SOLAPI_SENDER,
      },
    })),
  };

  try {
    const res = await fetch(API, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      groupInfo?: { count?: { total?: number; registeredSuccess?: number } };
      failedMessageList?: { to?: string; statusMessage?: string }[];
      errorMessage?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        sent: 0,
        failed: targets.length,
        error: json.errorMessage || `솔라피 응답 ${res.status}`,
      };
    }

    const failures = (json.failedMessageList ?? []).map((f) => ({
      to: f.to ?? "",
      reason: f.statusMessage ?? "사유 미상",
    }));
    const failed = failures.length;
    return {
      ok: failed === 0,
      sent: targets.length - failed,
      failed,
      failures: failed ? failures : undefined,
    };
  } catch (e) {
    console.error("[알림톡] 발송 실패:", e);
    return {
      ok: false,
      sent: 0,
      failed: targets.length,
      error: e instanceof Error ? e.message : "발송 중 오류",
    };
  }
}
