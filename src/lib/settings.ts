import "server-only";
import { createAdminClient } from "./supabase/admin";

// 이 프로그램이 쓸 수 있는 Claude 모델.
// 운영자 화면에서 고르면 재배포 없이 바로 바뀐다.
export const AI_MODELS = [
  {
    id: "claude-opus-5",
    label: "Opus 5",
    note: "가장 똑똑함 · 느리고 비쌈",
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    note: "성능과 비용의 균형 (권장)",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5",
    note: "가장 빠르고 저렴 · 긴 글은 다소 거침",
  },
] as const;

export const DEFAULT_AI_MODEL = "claude-sonnet-5";

export function isKnownModel(id: string) {
  return AI_MODELS.some((m) => m.id === id);
}

// 매 AI 호출마다 DB 를 치지 않도록 잠깐 담아 둔다.
// 운영자가 바꾸면 길어도 1분 안에 반영된다.
let cached: { value: string; at: number } | null = null;
const TTL_MS = 60_000;

export async function getAiModel(): Promise<string> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;

  let value = process.env.ANTHROPIC_MODEL || DEFAULT_AI_MODEL;
  try {
    const { data } = await createAdminClient()
      .from("app_settings")
      .select("ai_model")
      .eq("id", 1)
      .maybeSingle();
    const saved = (data as { ai_model?: string | null } | null)?.ai_model;
    if (saved && isKnownModel(saved)) value = saved;
  } catch (e) {
    // 설정을 못 읽어도 채점·피드백은 돌아가야 한다
    console.error("[설정] AI 모델 조회 실패, 기본값 사용:", e);
  }

  cached = { value, at: Date.now() };
  return value;
}

export async function setAiModel(model: string): Promise<void> {
  if (!isKnownModel(model)) throw new Error("알 수 없는 모델입니다.");
  await createAdminClient()
    .from("app_settings")
    .update({ ai_model: model })
    .eq("id", 1);
  cached = null; // 즉시 반영
}
