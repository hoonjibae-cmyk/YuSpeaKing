import "server-only";
import type { AzureScores } from "../types";

export interface TwoTierFeedback {
  studentFeedback: string; // 학생용 간단·격려형 (즉시 노출)
  teacherFeedback: string; // 교사용 상세 리포트 (관리자 전용)
}

// Azure 발음 점수를 바탕으로 Claude 가 2단 피드백(학생용/교사용)을 생성
export async function generateFeedback(
  scores: AzureScores,
  referenceText: string
): Promise<TwoTierFeedback> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const weakWords = (scores.words ?? [])
    .filter((w) => w.errorType && w.errorType !== "None")
    .slice(0, 15)
    .map((w) => `${w.word}(${w.errorType},${Math.round(w.accuracy)})`)
    .join(", ");

  const system = `너는 초등학교 6학년 영어 스피킹을 지도하는 다정한 원어민 교사야.
Azure 발음평가 점수를 바탕으로 두 종류의 한국어 피드백을 만든다.
반드시 아래 JSON 형식 하나만 출력한다(설명·코드블록 금지):
{"studentFeedback": "...", "teacherFeedback": "..."}

studentFeedback (학생용):
- 초6 눈높이의 밝고 격려하는 말투(존댓말 반말 섞인 친근한 톤).
- 3~4문장. 먼저 잘한 점을 칭찬하고, 연습하면 좋을 발음 팁 1~2개를 구체적 단어로.
- 점수를 혼내는 느낌 금지. 이모지 1~2개 정도 가볍게.

teacherFeedback (교사용):
- 객관적·전문적. 정확도/유창성/완성도/억양 요약, 취약한 단어·음소, 지도 포인트.
- 마지막에 "학부모 안내 문구 초안:" 한 단락(정중한 존댓말)을 포함.`;

  const user = `[지문]
${referenceText}

[Azure 발음평가 점수 (0~100)]
- 종합 발음(pronunciation): ${scores.pronunciation}
- 정확도(accuracy): ${scores.accuracy}
- 유창성(fluency): ${scores.fluency}
- 완성도(completeness): ${scores.completeness}
- 억양(prosody): ${scores.prosody ?? "N/A"}
- 인식된 발화: ${scores.recognizedText ?? "N/A"}
- 취약 단어(단어(오류유형,정확도)): ${weakWords || "없음"}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude 피드백 실패 (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content?.map((c) => c.text ?? "").join("").trim() ?? "";

  return parseFeedback(text);
}

function parseFeedback(text: string): TwoTierFeedback {
  // JSON 블록 추출 (혹시 코드펜스가 붙어도 대응)
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try {
    const obj = JSON.parse(raw);
    return {
      studentFeedback: String(obj.studentFeedback ?? "").trim(),
      teacherFeedback: String(obj.teacherFeedback ?? "").trim(),
    };
  } catch {
    // 파싱 실패 시 전체 텍스트를 교사용에 넣고 학생용은 기본 메시지
    return {
      studentFeedback: "녹음이 잘 제출되었어요! 다음에도 또박또박 읽어봐요 🙂",
      teacherFeedback: text,
    };
  }
}
