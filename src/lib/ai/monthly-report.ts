import "server-only";
import type { MonthlyData } from "../monthly";
import { logUsage } from "../usage";

// 월말 리포트 초안(학부모 발송용) 생성. 교사가 이후 수정 가능.
//
// 이 글은 학부모가 읽는다. 선생님이 직접 쓴 짧은 알림처럼 읽혀야 하므로
// 아래를 엄격히 지킨다.
//  · 등록일·합류 시점 같은 신상 정보는 넣지 않는다 (기록이 사실과 다를 수 있다)
//  · 학원은 스피킹을 따로 지도하지 않는다. 지도 계획이나 가정 학습 방법을
//    약속하거나 권하지 않는다
//  · 발음 교정법을 구체적으로 설명하지 않는다 (AI가 쓴 티가 난다)
export async function generateMonthlyReportDraft(
  studentName: string,
  month: string,
  data: MonthlyData
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const itemsText = data.items
    .map(
      (i) =>
        `- ${i.date} ${i.title}: ${
          i.submitted ? (i.score != null ? `${i.score}점` : "제출(채점중)") : "미제출"
        }`
    )
    .join("\n");

  const system = `너는 목동유쌤영어 학원에서 초등부를 맡고 있는 선생님이다.
학생의 한 달 스피킹 과제 기록을 보고, 학부모님께 보낼 짧은 안내글을 쓴다.

[무엇을 쓰나]
- 이번 달 제출 현황, 점수 흐름, 녹음에서 눈에 띈 점을 사실 그대로 전한다.
- 분량은 3~4문단, 전체 6~9문장. 짧을수록 좋다.
- 정중한 존댓말. 담임 선생님이 직접 적어 보내는 알림의 말투.

[절대 쓰지 않는 것]
- 등록일·합류 시점·신입생 여부 등 학생의 등록 관련 정보. 언급 자체를 하지 않는다.
- 다음 달 지도 계획이나 수업에서 무엇을 하겠다는 약속.
  (학원에서 스피킹을 따로 지도하지 않으므로 사실과 다르다)
- 가정에서 이렇게 연습시키라는 제안, 발음 교정 방법, 혀 위치·거울 보기 같은
  구체적 훈련법. 한 줄도 넣지 않는다.
- 제목, 소제목, 번호 목록, 불릿, 이모지, 머리말, 맺음 서명.

[문체 — 이것만 지켜도 읽는 느낌이 달라진다]
- 숫자를 앞세우고 수식어는 줄인다. "꾸준히 성실하게 참여하는 모습이
  인상적입니다" 같은 상투적 칭찬은 쓰지 않는다.
- 다음 표현은 금지: 인상적입니다, 돋보입니다, 기대됩니다, 눈부신, 괄목할,
  칭찬해 주고 싶습니다, 응원하겠습니다, ~해 보시면 좋겠습니다.
- 세 가지를 나란히 늘어놓는 문장(A하고 B하며 C하는)을 피한다.
- 모든 문장을 같은 어미로 끝내지 않는다.
- 좋게만 쓰지 않는다. 제출이 빠졌거나 점수가 내려갔으면 그대로 적는다.
- 데이터가 적으면 단정하지 말고, 적다는 사실만 적는다.

[발음 이야기]
- 자주 틀린 단어가 있으면 그 단어들을 그대로 보여 주는 선에서 그친다.
  어떻게 고치라는 말은 붙이지 않는다.
- 자주 틀린 단어가 없으면 이 이야기는 아예 빼고, 억지로 지어내지 않는다.

출력은 본문 텍스트만. 설명이나 코드블록 없이.`;

  const user = `[학생] ${studentName}
[기간] ${month}
[제출] 과제 ${data.assigned}개 중 ${data.submitted}개 제출 (제출률 ${data.rate}%)${
    data.assigned === 0 ? " — 이번 달 출제된 과제가 없습니다" : ""
  }
[점수] 평균 ${data.avg ?? "기록 없음"}점 · 첫 점수 ${
    data.firstScore ?? "기록 없음"
  } → 마지막 ${data.lastScore ?? "기록 없음"}${
    data.growth != null ? ` (${data.growth >= 0 ? "+" : ""}${data.growth})` : ""
  }
[자주 틀린 단어] ${data.weakWords.length ? data.weakWords.join(", ") : "없음"}
[과제별 기록]
${itemsText || "(이번 달 과제 없음)"}`;

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
    throw new Error(`월말 리포트 생성 실패 (${res.status}): ${detail}`);
  }
  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await logUsage("claude_monthly", {
    model,
    inputTokens: json.usage?.input_tokens,
    outputTokens: json.usage?.output_tokens,
  });
  return (json.content?.map((c) => c.text ?? "").join("") ?? "").trim();
}
