import "server-only";
import { buildWaveNetRequests, waveNetEnabled } from "../sample-voices";
import { getWaveNetAccessToken } from "./google-tts-auth";
import { logUsage } from "../usage";

export function decodeWaveNetAudio(encoded: unknown): Buffer {
  if (typeof encoded !== "string" || !encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("WaveNet 음성 응답이 올바르지 않습니다.");
  }
  const audio = Buffer.from(encoded, "base64");
  if (audio.length < 128 || !(audio.subarray(0, 3).toString() === "ID3" || (audio[0] === 255 && (audio[1] & 224) === 224))) {
    throw new Error("WaveNet MP3 응답을 확인할 수 없습니다.");
  }
  return audio;
}

// Production uses Vercel OIDC → Google WIF; isolated local development uses user ADC.
export async function synthesizeWaveNetPair(text: string, voice: string) {
  if (!waveNetEnabled()) {
    throw new Error("Google 음성 기능이 비활성 상태입니다. 기존 음성을 유지합니다.");
  }
  const requests = buildWaveNetRequests(text, voice); // validate before credentials or paid calls
  const token = await getWaveNetAccessToken();
  const pair: Buffer[] = [];
  for (const body of requests) {
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-goog-user-project": "yuspeaking-tts-test" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`WaveNet 합성 실패 (${response.status}). 기존 음성을 유지합니다.`);
    await logUsage("tts", { model: voice, chars: Array.from(text).length });
    pair.push(decodeWaveNetAudio((await response.json()).audioContent));
  }
  return { normal: pair[0], slow: pair[1] };
}
