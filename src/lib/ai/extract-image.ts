import "server-only";
import { logUsage } from "../usage";
import { getAiModel } from "../settings";

// 교과서 사진 → 영어 본문 텍스트.
//
// 선생님이 휴대폰으로 찍은 교과서 쪽 사진에서 '학생이 읽을 본문' 만 옮겨 적는다.
// 쪽 번호·문제·단어장·한국어 해석 같은 건 뺀다. 결과는 바로 문장 선별(AI)이나
// 직접 수정으로 넘어가므로, 여기서는 철자 하나 바꾸지 않고 그대로 옮기는 게 핵심이다
// (학생이 이 문장을 그대로 읽고 발음 채점을 받는다).

export const MAX_IMAGES = 5;
export const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export type ImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const NO_TEXT = "NO_TEXT";

export async function extractPassageFromImages(
  images: { type: ImageType; base64: string }[],
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = await getAiModel();

  const system = `너는 영어 교과서 사진에서 본문을 옮겨 적는 도우미야.
선생님이 찍은 교과서 쪽 사진(여러 장이면 올린 순서대로 이어지는 쪽)에서, 학생이 소리 내어 읽을
'영어 본문' 만 정확히 옮겨 적는다.

[옮겨 적는다]
- 이야기·설명문·대화 등 그 쪽의 영어 본문.
- 대화문이면 말하는 사람 이름은 빼고 대사만 한 줄에 하나씩.

[빼고 적지 않는다]
- 쪽 번호, 단원 제목 번호, 머리말·꼬리말, 출판사 표기
- 문제·지시문(Read and answer, Look and say, Check 등), 보기, 빈칸 문제
- 단어장·어휘 목록, 그림 속 짧은 표지판 글자, 그림 설명
- 한국어 해석·설명
- 사진 가장자리에 잘려 일부만 보이는 줄

[매우 중요]
- 글자를 그대로(verbatim) 옮긴다. 철자·문법을 고치지 않는다. 단어를 더하거나 바꾸지 않는다.
- 줄바꿈 때문에 끊긴 문장은 이어 붙인다. 줄 끝 하이픈으로 나뉜 단어(won-\\nderful)는 붙여 쓴다.
- 문단 사이는 빈 줄 하나로 나눈다.
- 흐리거나 가려져서 읽을 수 없는 단어는 짐작해서 채우지 말고 [?] 로 적는다.
- 설명·머리말·코드블록 없이 본문 텍스트만 출력한다.
- 영어 본문이 전혀 없으면 ${NO_TEXT} 한 단어만 출력한다.`;

  const content = [
    ...images.map((img) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.type,
        data: img.base64,
      },
    })),
    {
      type: "text" as const,
      text:
        images.length > 1
          ? `교과서 사진 ${images.length}장입니다. 순서대로 이어지는 본문을 옮겨 적어 주세요.`
          : "교과서 사진입니다. 본문을 옮겨 적어 주세요.",
    },
  ];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      system,
      messages: [{ role: "user", content }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`사진 읽기 실패 (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await logUsage("claude_ocr", {
    model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  });

  const text = (data.content ?? [])
    .map((c) => c.text ?? "")
    .join("")
    .replace(/^```[a-z]*\n?|```$/gim, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || text === NO_TEXT) return "";
  return text;
}
