import "server-only";

// OpenAI TTS-HD 로 지문을 원어민 발음 음성(mp3)으로 합성
export async function synthesizeSpeech(text: string): Promise<Buffer> {
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
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI TTS 실패 (${res.status}): ${detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
