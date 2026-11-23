import { DEFAULT_TTS_VOICE, TTS_VOICES } from "./tts-voices";

export const DEFAULT_WAVENET_VOICE = "en-US-Wavenet-F";
// Official US English WaveNet catalogue, checked 2026-11-23. No subjective tone claims.
export const WAVENET_VOICES = [
  { id: "en-US-Wavenet-F", label: "미국 영어 F · 여성 (비교에 사용한 음성)" },
  ...["A", "B", "C", "D", "E", "G", "H", "I", "J"].map((letter) => ({
    id: `en-US-Wavenet-${letter}`,
    label: `미국 영어 ${letter} · ${["C", "E", "G", "H"].includes(letter) ? "여성" : "남성"}`,
  })),
] as const;

export function waveNetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const localTest = env.WAVENET_TEST_ENABLED === "true" &&
    env.GOOGLE_CLOUD_PROJECT === "yuspeaking-tts-test" &&
    env.YUSPEAKING_TEST_DATA_ONLY === "true" &&
    ["development", "test"].includes(env.NODE_ENV ?? "") && !env.VERCEL;
  const production = env.WAVENET_ENABLED === "true" && env.VERCEL_ENV === "production" &&
    env.GOOGLE_CLOUD_PROJECT === "yuspeaking-tts-test" &&
    env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE === "//iam.googleapis.com/projects/419110315377/locations/global/workloadIdentityPools/yuspeaking-vercel/providers/production" &&
    env.GOOGLE_TTS_SERVICE_ACCOUNT === "yuspeaking-tts@yuspeaking-tts-test.iam.gserviceaccount.com";
  return localTest || production;
}

// Compatibility for the existing local comparison test harness.
export const waveNetTestEnabled = waveNetEnabled;

export function isWaveNetVoice(value: string): boolean {
  return WAVENET_VOICES.some((voice) => voice.id === value);
}

export function selectSampleVoice(value: string | null | undefined, enabled: boolean): string {
  const voice = value?.trim() || DEFAULT_TTS_VOICE;
  if (isWaveNetVoice(voice)) {
    if (!enabled) throw new Error("Google 음성 기능이 아직 활성화되지 않았습니다. 기존 음성을 유지합니다.");
    return voice;
  }
  if (!TTS_VOICES.some((candidate) => candidate.id === voice)) {
    throw new Error("지원하지 않는 샘플 음성입니다.");
  }
  return voice;
}

export function buildWaveNetRequests(text: string, voice: string) {
  if (!isWaveNetVoice(voice)) throw new Error("지원하지 않는 WaveNet 음성입니다.");
  if (!text.trim()) throw new Error("지문이 비어 있습니다.");
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > 5000) throw new Error(`지문이 ${bytes}바이트입니다. WaveNet 제한은 5,000바이트이며 지문을 자르지 않았습니다.`);
  return [1, 0.7].map((speakingRate) => ({
    input: { text },
    voice: { languageCode: "en-US", name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate },
  }));
}
