import "server-only";
import { logUsage } from "../usage";

// OpenAI TTS-HD 로 지문을 원어민 발음 음성(mp3)으로 합성
// speed: 0.25~4.0 (1.0=정상, 0.75=천천히)
export async function synthesizeSpeech(
  text: string,
  speed = 1.0
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 가 설정되지 않았습니다.");

  const voice = process.env.OPENAI_TTS_VOICE || "nova";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "tts-1-hd",
      voice,
      input: text,
      response_format: "mp3",
      speed,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS 실패 (${res.status}): ${detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  await logUsage("tts", { model: "tts-1-hd", chars: text.length });
  return Buffer.from(arrayBuffer);
}
