import "server-only";
import { logUsage } from "../usage";
import { getAiModel } from "../settings";

// 선생님이 고를 수 있는 문장 수 범위. 반 수준에 따라 늘려 쓴다.
export const MIN_SENTENCES = 10;
export const MAX_SENTENCES = 15;

// 범위를 벗어난 값(클라이언트가 보낸 값 포함)을 안전하게 가둔다
export function clampSentenceLimit(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return MIN_SENTENCES;
  return Math.min(MAX_SENTENCES, Math.max(MIN_SENTENCES, n));
}

export interface SentenceSelection {
  selected: string[]; // 과제로 추릴 문장(원문 그대로), 최대 limit 개
  excluded: { sentence: string; reason: string }[]; // 제외된 대표 문장 + 사유
}

// 교과서 본문(수십 문장)에서 초6 스피킹 과제에 적합한 핵심 문장을 limit 개 선별.
// 너무 어려운 단어·외국어·낯선 고유명사가 든 문장은 제외한다.
// 고유명사를 통째로 빼면 the Pacific, Korea 같은 문장까지 다 빠져서, '읽을 수
// 있는가' 로 가르게 했다.
export async function selectSentences(
  sourceText: string,
  limit: number = MIN_SENTENCES,
): Promise<SentenceSelection> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = await getAiModel();

  const system = `너는 한국 초등학교 6학년 학생들의 영어 스피킹(소리내어 읽기·발음) 지도를 돕는 교사 보조야.
교사가 준 영어 교과서 본문(한 챕터, 수십 문장일 수 있음)에서 학생들이 소리내어 읽고 발음 연습을 할
'핵심 문장'을 최대 ${limit}개 선별한다.

[선별 기준 — 포함]
- 글의 맥락·주제를 대표하는 중요한 문장.
- 초6 수준에서 소리내어 읽기에 적절한 길이·구조.
- 본문 전체에 골고루 분포하도록.

[선별 기준 — 반드시 제외]
- 초6 수준을 넘는 너무 어려운 단어가 들어간 문장 (예: anthropologist, phenomenon, sophisticated).
- 영어가 아닌 외국어 단어가 들어간 문장 (예: 스페인어·프랑스어 단어).
- 아래 '고유명사' 기준에서 제외 쪽에 해당하는 문장.
- 지나치게 길거나 복잡한 문장, 대화 지시문·문제 번호 등 본문이 아닌 요소.

[고유명사 — 대문자라는 이유만으로 빼지 않는다]
판단 기준은 하나다: "초6 학생이 처음 봐도 철자대로 소리 내어 읽을 수 있고, 평소에 들어 봤을 법한가?"

포함해도 된다 (자주 나오고 읽기 쉬운 고유명사):
- 나라·대륙·대양·행성: Korea, China, Japan, America, Africa, Asia, Europe,
  the Pacific, the Atlantic, Earth, Mars
- 잘 알려진 도시·지명: Seoul, Busan, London, Paris, New York, Mount Everest, the Amazon
- 요일·달·명절·언어: Monday, January, Christmas, Thanksgiving, English, Korean
- 흔한 영어 이름: Tom, Mary, John, Emma, Mike
- 교과서에 자주 나오는 유명 인물·명칭: Edison, Einstein, the Olympics, NASA
- 문장 첫 단어와 대명사 I 는 애초에 고유명사가 아니다.

제외한다 (어렵거나 낯선 고유명사):
- 철자만 보고 발음을 짐작하기 어려운 이름 (예: Tenochtitlan, Xochimilco, Nguyen, Worcester)
- 영어권이 아닌 곳의 인명·지명으로 초6이 들어 본 적 없을 것
- 잘 알려지지 않은 학자·인물·기관·작은 지역 이름
- 고유명사가 한 문장에 여러 개 몰려 있어 읽기 부담이 큰 문장

애매하면 포함 쪽으로 기운다. 선생님은 선별된 문장을 바로 지울 수 있지만, 빠진 문장은
본문에서 다시 찾아 넣어야 하기 때문이다.

[매우 중요]
- 선택한 문장은 원문 그대로(verbatim) 복사한다. 절대 바꾸거나 다듬지 않는다 — 학생이 이 문장을
  그대로 읽고 발음 채점을 받기 때문이다.
- 조건을 만족하는 문장이 ${limit}개보다 적으면, 만족하는 만큼만 반환한다.

반드시 아래 JSON 형식 하나만 출력한다(설명·코드블록 금지):
{"selected": ["문장1", "문장2", ...], "excluded": [{"sentence":"제외문장", "reason":"짧은 한국어 사유"}]}
- selected: 선택 문장 배열(원문 그대로, 본문 등장 순서, 최대 ${limit}개).
- excluded: 어려운 단어/고유명사 등으로 제외한 대표 문장 3~5개와 짧은 사유.
  사유에는 문제가 된 단어를 그대로 적는다 (예: "낯선 지명 Tenochtitlan", "어려운 단어 phenomenon").
  선생님이 왜 빠졌는지 보고 되살릴지 판단할 수 있어야 한다.`;

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
  const text =
    data.content
      ?.map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

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
