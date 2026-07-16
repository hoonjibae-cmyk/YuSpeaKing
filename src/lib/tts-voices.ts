// gpt-4o-mini-tts 음성 목록 (선생님이 과제 생성/재생성 시 선택)
export const TTS_VOICES = [
  { id: "coral", label: "코랄 — 밝고 친근한 여성 (기본)" },
  { id: "shimmer", label: "쉬머 — 부드럽고 밝은 여성" },
  { id: "nova", label: "노바 — 활기찬 여성" },
  { id: "sage", label: "세이지 — 차분한 여성" },
  { id: "alloy", label: "앨로이 — 중립적이고 또렷한" },
  { id: "ash", label: "애쉬 — 차분한 남성" },
  { id: "ballad", label: "발라드 — 부드러운 남성" },
  { id: "verse", label: "버스 — 생동감 있는 남성" },
] as const;

export const DEFAULT_TTS_VOICE = "coral";

const VALID = new Set(TTS_VOICES.map((v) => v.id as string));

// 허용된 음성만 통과, 아니면 기본값
export function normalizeVoice(v: string | null | undefined): string {
  return v && VALID.has(v) ? v : DEFAULT_TTS_VOICE;
}
