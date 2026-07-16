import "server-only";
import { createAdminClient } from "./supabase/admin";

// 요율(근사치) — 실제 청구는 각 콘솔 현재가 기준. 필요 시 여기서 조정.
const RATES = {
  // gpt-4o-mini-tts (~$0.015/분): 입력 글자당으로 환산한 근사치.
  // 로깅은 입력 글자수만 기록하므로 오디오 출력비 + 정상/느린 2종 생성을 접어 넣은 값.
  ttsPerChar: 0.02 / 1000,
  azurePerSecond: 1 / 3600, // Azure STT 표준 ~$1 / hour
  claudeInputPerTok: 2 / 1_000_000, // Sonnet 5 인트로 $2 / 1M
  claudeOutputPerTok: 10 / 1_000_000, // Sonnet 5 인트로 $10 / 1M
};

type Kind =
  | "tts"
  | "azure"
  | "claude_feedback"
  | "claude_monthly"
  | "claude_select";

interface UsageInput {
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  audioSeconds?: number;
  chars?: number;
}

function estimateCost(kind: Kind, u: UsageInput): number {
  switch (kind) {
    case "tts":
      return (u.chars ?? 0) * RATES.ttsPerChar;
    case "azure":
      return (u.audioSeconds ?? 0) * RATES.azurePerSecond;
    case "claude_feedback":
    case "claude_monthly":
    case "claude_select":
      return (
        (u.inputTokens ?? 0) * RATES.claudeInputPerTok +
        (u.outputTokens ?? 0) * RATES.claudeOutputPerTok
      );
  }
}

// 사용량 1건 기록 (실패해도 본 흐름을 막지 않음)
export async function logUsage(kind: Kind, u: UsageInput): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("usage_logs").insert({
      kind,
      model: u.model ?? null,
      input_tokens: u.inputTokens ?? null,
      output_tokens: u.outputTokens ?? null,
      audio_seconds: u.audioSeconds ?? null,
      chars: u.chars ?? null,
      cost_usd: estimateCost(kind, u),
    });
  } catch (e) {
    console.error("[usage] 기록 실패:", e);
  }
}
