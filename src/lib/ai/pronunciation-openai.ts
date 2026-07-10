import "server-only";
import type { AzureScores } from "../types";

// Azure 대체 엔진: OpenAI Whisper 로 전사(STT) 후, 참조 지문과 단어 정렬 비교로
// 근사 점수를 산출한다. 음소 단위 정밀도는 Azure보다 낮지만, Azure 키 없이도
// 즉시 동작하도록 하기 위한 fallback 이다.
export async function assessPronunciationOpenAI(
  wav: Buffer,
  referenceText: string
): Promise<AzureScores> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY 가 설정되지 않았습니다.");

  // 1) Whisper 전사
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(wav)], { type: "audio/wav" }),
    "recording.wav"
  );
  form.append("model", "whisper-1");
  form.append("language", "en");
  form.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Whisper 전사 실패 (${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { text?: string };
  const recognizedText = (data.text ?? "").trim();
  if (!recognizedText) {
    throw new Error("음성을 인식하지 못했어요. 더 또렷하게 녹음해 주세요.");
  }

  // 2) 단어 정렬 비교로 근사 점수 산출
  return scoreByAlignment(referenceText, recognizedText);
}

function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

// LCS 기반 단어 정렬로 정확도/완성도/유창성 근사치 계산
function scoreByAlignment(reference: string, hypothesis: string): AzureScores {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  const R = ref.length || 1;

  // LCS 길이 및 매칭된 참조 단어 인덱스
  const n = ref.length;
  const m = hyp.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0)
  );
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        ref[i - 1] === hyp[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matched = dp[n][m];
  const matchedRefIdx = new Set<number>();
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (ref[i - 1] === hyp[j - 1]) {
      matchedRefIdx.add(i - 1);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const completeness = Math.round((matched / R) * 100);
  const accuracy = Math.round((matched / R) * 100);
  // 유창성: 발화 길이가 참조와 비슷할수록 높게 (누락/장황 penalize)
  const lengthRatio = Math.min(m, R) / Math.max(m, R || 1);
  const fluency = Math.round(lengthRatio * 100);
  const pronunciation = Math.round(
    accuracy * 0.5 + completeness * 0.3 + fluency * 0.2
  );

  const words = ref.map((w, idx) => ({
    word: w,
    accuracy: matchedRefIdx.has(idx) ? 100 : 0,
    errorType: matchedRefIdx.has(idx) ? "None" : "Omission",
  }));

  return {
    accuracy,
    fluency,
    completeness,
    pronunciation,
    recognizedText: hypothesis,
    words,
  };
}
