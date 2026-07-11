import "server-only";
import type { MonthlyData } from "../monthly";
import { logUsage } from "../usage";

// 월말 리포트 초안(학부모 발송용) 생성. 교사가 이후 수정 가능.
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

  const system = `너는 초등학교 6학년 영어 스피킹을 지도하는 학원(목동유쌤영어) 선생님이야.
학생의 한 달 스피킹 학습 데이터를 바탕으로 학부모님께 보내는 '월말 리포트' 초안을 작성한다.
- 정중하고 따뜻한 존댓말, 학부모 대상.
- 아래 구성으로 자연스러운 문단 흐름(과한 이모지 금지):
  1) 인사 + 이번 달 총평 한두 문장
  2) 제출/참여 현황 (제출률)
  3) 발음 실력과 성장 (평균 점수, 첫 점수 대비 변화, 잘한 점)
  4) 개선하면 좋을 점 (취약 단어/발음, 구체적으로)
  5) 다음 달 지도 방향 및 가정 학습 제안
  6) 격려 마무리
- 데이터가 부족하면(제출이 적으면) 참여 독려를 부드럽게 포함.
- 출력은 리포트 본문 텍스트만. 머리말/코드블록/설명 금지.`;

  const user = `[학생] ${studentName}
[기간] ${month}
[제출 현황] 부여 과제 ${data.assigned}개 중 ${data.submitted}개 제출 (제출률 ${data.rate}%)
[점수] 평균 ${data.avg ?? "N/A"}점 · 첫 점수 ${data.firstScore ?? "N/A"} → 최근 ${
    data.lastScore ?? "N/A"
  } (변화 ${data.growth ?? "N/A"})
[자주 틀린 단어] ${data.weakWords.length ? data.weakWords.join(", ") : "없음"}
[과제별 내역]
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
      max_tokens: 2000,
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
