import "server-only";
import { logUsage } from "../usage";

export interface SentenceSelection {
  selected: string[]; // 과제로 추릴 문장(원문 그대로), 최대 10개
  excluded: { sentence: string; reason: string }[]; // 제외된 대표 문장 + 사유
}

// 교과서 본문(수십 문장)에서 초6 스피킹 과제에 적합한 핵심 문장 10개를 선별.
// 너무 어려운 단어/고유명사/외국어가 포함된 문장은 제외한다.
export async function selectSentences(
  sourceText: string,
  limit = 10
): Promise<SentenceSelection> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

  const system = `너는 한국 초등학교 6학년 학생들의 영어 스피킹(소리내어 읽기·발음) 지도를 돕는 교사 보조야.
교사가 준 영어 교과서 본문(한 챕터, 수십 문장일 수 있음)에서 학생들이 소리내어 읽고 발음 연습을 할
'핵심 문장'을 최대 ${limit}개 선별한다.

[선별 기준 — 포함]
- 글의 맥락·주제를 대표하는 중요한 문장.
- 초6 수준에서 소리내어 읽기에 적절한 길이·구조.
- 본문 전체에 골고루 분포하도록.

[선별 기준 — 반드시 제외]
- 초6 수준을 넘는 너무 어려운 단어가 들어간 문장 (예: anthropologist, phenomenon, sophisticated).
- 고유명사·인명·지명이나 영어가 아닌 외국어 단어가 들어간 문장 (예: 스페인어 등 비영어 단어, 낯선 이름).
- 지나치게 길거나 복잡한 문장, 대화 지시문·문제 번호 등 본문이 아닌 요소.

[매우 중요]
- 선택한 문장은 원문 그대로(verbatim) 복사한다. 절대 바꾸거나 다듬지 않는다 — 학생이 이 문장을
  그대로 읽고 발음 채점을 받기 때문이다.
- 조건을 만족하는 문장이 ${limit}개보다 적으면, 만족하는 만큼만 반환한다.

반드시 아래 JSON 형식 하나만 출력한다(설명·코드블록 금지):
{"selected": ["문장1", "문장2", ...], "excluded": [{"sentence":"제외문장", "reason":"짧은 한국어 사유"}]}
- selected: 선택 문장 배열(원문 그대로, 본문 등장 순서, 최대 ${limit}개).
- excluded: 어려운 단어/고유명사 등으로 제외한 대표 문장 3~5개와 짧은 사유.`;

  const user = `[교과서 본문]\n${sourceText}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`문장 선별 실패 (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await logUsage("claude_select", {
    model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  });
  const text = data.content?.map((c) => c.text ?? "").join("").trim() ?? "";

  return parseSelection(text, limit);
}

function parseSelection(text: string, limit: number): SentenceSelection {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try {
    const obj = JSON.parse(raw) as {
      selected?: unknown;
      excluded?: unknown;
    };
    const selected = Array.isArray(obj.selected)
      ? obj.selected
          .map((s) => String(s).trim())
          .filter(Boolean)
          .slice(0, limit)
      : [];
    const excluded = Array.isArray(obj.excluded)
      ? obj.excluded
          .map((e) => {
            const o = e as { sentence?: unknown; reason?: unknown };
            return {
              sentence: String(o?.sentence ?? "").trim(),
              reason: String(o?.reason ?? "").trim(),
            };
          })
          .filter((e) => e.sentence)
          .slice(0, 5)
      : [];
    return { selected, excluded };
  } catch {
    return { selected: [], excluded: [] };
  }
}
