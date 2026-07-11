import "server-only";
import { createAdminClient } from "./supabase/admin";

// 요율(근사치) — 실제 청구는 각 콘솔 현재가 기준. 필요 시 여기서 조정.
const RATES = {
  ttsPerChar: 0.03 / 1000, // OpenAI tts-1-hd $0.030 / 1K chars
  azurePerSecond: 1 / 3600, // Azure STT 표준 ~$1 / hour
  claudeInputPerTok: 2 / 1_000_000, // Sonnet 5 인트로 $2 / 1M
  claudeOutputPerTok: 10 / 1_000_000, // Sonnet 5 인트로 $10 / 1M
};

type Kind = "tts" | "azure" | "claude_feedback" | "claude_monthly";

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
