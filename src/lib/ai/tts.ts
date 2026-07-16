import "server-only";
import { logUsage } from "../usage";
import { normalizeVoice } from "../tts-voices";

export type TtsMode = "normal" | "slow";

// 자연스러운 전달을 위한 지시문(gpt-4o-mini-tts 계열에서 사용)
const INSTRUCTIONS: Record<TtsMode, string> = {
  normal:
    "You are a warm, friendly native English teacher for Korean elementary school students. " +
    "Read the passage clearly and naturally at a normal, gentle pace with natural, human intonation. " +
    "Sound encouraging and lively — never robotic or monotone.",
  slow:
    "You are a pronunciation model for a young beginner English learner (a Korean 6th grader). " +
    "Read VERY slowly and deliberately, ONE WORD AT A TIME, with a clear, full pause between every single word. " +
    "Enunciate each word crisply and distinctly, slightly exaggerating each sound so the child can focus on and imitate the exact pronunciation of every word. " +
    "This is for careful word-by-word listening practice, so prioritize clarity and slowness over natural flow — but keep a warm, human voice, never robotic or stretched. " +
    "Pause a bit longer at the end of each line.",
};

// 느린(단어별) 버전 입력: 각 단어 사이에 멈춤(…)을 넣어 또박또박 읽게 유도.
// 정상 버전은 원문 그대로 자연스럽게 읽는다.
function toDeliberateScript(text: string): string {
  return text
    .split(/\n+/)
    .map((line) =>
      line
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .join(" … ")
    )
    .filter(Boolean)
    .join("\n\n");
}

// OpenAI TTS 로 지문을 원어민 발음 음성(mp3)으로 합성.
// 기본 모델은 gpt-4o-mini-tts (지시문으로 자연스러운 속도/톤 제어).
export async function synthesizeSpeech(
  text: string,
  mode: TtsMode = "normal",
  voiceChoice?: string
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 가 설정되지 않았습니다.");

  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  // 우선순위: 과제별 선택 음성 → 환경변수 → 기본값(coral)
  const voice = normalizeVoice(voiceChoice || process.env.OPENAI_TTS_VOICE);
  const isGpt4o = model.startsWith("gpt-4o");

  // 느린 버전은 단어 사이 멈춤을 넣어 또박또박(단어별) 읽게 한다.
  const input = mode === "slow" ? toDeliberateScript(text) : text;

  const body: Record<string, unknown> = {
    model,
    voice,
    input,
    response_format: "mp3",
  };
  if (isGpt4o) {
    // 자연스러운 속도/톤은 지시문으로 제어 (speed 파라미터의 '테이프 늘어짐' 방지)
    body.instructions = INSTRUCTIONS[mode];
  } else if (mode === "slow") {
    // 구형 tts 모델 폴백: 속도 파라미터 사용
    body.speed = 0.7;
  }

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS 실패 (${res.status}): ${detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await logUsage("tts", { model, chars: text.length });
  return Buffer.from(arrayBuffer);
}
