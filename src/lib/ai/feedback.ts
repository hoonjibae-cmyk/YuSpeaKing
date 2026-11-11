import "server-only";
import type { AzureScores } from "../types";
import { logUsage } from "../usage";
import { getAiModel } from "../settings";

export interface TwoTierFeedback {
  studentFeedback: string; // 학생용 간단·격려형 (즉시 노출)
  teacherFeedback: string; // 교사용 상세 리포트 (관리자 전용)
}

// Azure 발음 점수를 바탕으로 Claude 가 2단 피드백(학생용/교사용)을 생성
export interface StudentContext {
  name?: string | null; // 학생 이름 (유스피킹에 등록된 이름)
  approvedAt?: string | null; // 가입 승인일 (YYYY-MM-DD)
  submissionCount?: number; // 이번 제출을 포함한 누적 제출 횟수
}

// 모델에 보내는 사용자 메시지. 따로 떼어 둔 이유는 이름이 어떻게 들어가는지
// (또는 빠지는지) 눈으로 확인하고 시험할 수 있어야 하기 때문이다.
export function buildFeedbackPrompt(
  scores: AzureScores,
  referenceText: string,
  context?: StudentContext,
): string {
  const weakWords = (scores.words ?? [])
    .filter((w) => w.errorType && w.errorType !== "None")
    .slice(0, 15)
    .map((w) => `${w.word}(${w.errorType},${Math.round(w.accuracy)})`)
    .join(", ");

  // 이름은 DB 에 등록된 것만 쓴다. 없으면 아예 주지 않아 모델이 지어내지 못하게 한다.
  const nameLine = context?.name?.trim()
    ? `\n[학생 이름] ${context.name.trim()}`
    : "\n[학생 이름] 없음 — 이름이나 호칭을 쓰지 말고 바로 내용을 말할 것";

  const ctxLine = (() => {
    if (!context?.approvedAt) return "";
    const days = Math.floor(
      (Date.now() - new Date(context.approvedAt).getTime()) / 86400000,
    );
    const nth = context.submissionCount;
    const isNew = days <= 30 || (nth != null && nth <= 3);
    return `\n[학생 상황] 등록일 ${context.approvedAt} (재원 ${Math.max(
      0,
      days,
    )}일차)${nth != null ? ` · 누적 ${nth}번째 제출` : ""}${
      isNew
        ? " ★최근 등록한 신입생 — 적응 단계임을 감안해 환영·격려 위주로"
        : ""
    }`;
  })();

  return `[지문]
${referenceText}${nameLine}${ctxLine}

[Azure 발음평가 점수 (0~100)]
- 종합 발음(pronunciation): ${scores.pronunciation}
- 정확도(accuracy): ${scores.accuracy}
- 유창성(fluency): ${scores.fluency}
- 완성도(completeness): ${scores.completeness}
- 억양(prosody): ${scores.prosody ?? "N/A"}
- 인식된 발화: ${scores.recognizedText ?? "N/A"}
- 취약 단어(단어(오류유형,정확도)): ${weakWords || "없음"}`;
}

export async function generateFeedback(
  scores: AzureScores,
  referenceText: string,
  context?: StudentContext,
): Promise<TwoTierFeedback> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY 가 설정되지 않았습니다.");
  const model = await getAiModel();

  const system = `너는 초등학교 6학년 영어 스피킹을 지도하는 다정한 원어민 교사야.
Azure 발음평가 점수를 바탕으로 두 종류의 한국어 피드백을 만든다.
반드시 아래 JSON 형식 하나만 출력한다(설명·코드블록 금지):
{"studentFeedback": "...", "teacherFeedback": "..."}

studentFeedback (학생용):
- 초6 눈높이의 친근한 말투(존댓말 섞인 다정한 톤), 3~5문장.
- ★가장 중요: 반드시 '제공된 실제 점수'에 근거해서만 말한다. 실제로 일어나지 않은 것을
  칭찬하지 말 것(예: 완성도가 낮은데 "끝까지 읽었다"고 칭찬 금지 — 이는 거짓 피드백).
- 완성도(completeness) 기준으로 솔직하게:
  · 완성도 60 미만: 지문을 끝까지 읽지 않고 중간에 그만둔 것. "이번엔 끝부분을 못 읽고
    멈췄어요. 다음엔 끝까지 또박또박 읽어보자" 처럼 다정하지만 분명하게 짚어준다. 억지 칭찬 금지.
  · 완성도 60~85: 대부분 읽었지만 일부 빠짐 → 그 점을 알려주고 격려.
  · 완성도 85 이상: 끝까지 잘 읽음 → 칭찬.
- 정확도/유창성이 낮으면(예: 70 미만) 잘한 점 1개는 짚되, 개선점을 솔직하고 구체적으로
  (취약 단어 예시 포함) 말한다. 필요할 땐 부드럽게 쓴소리도 한다(비난·혼내기는 금지).
- 마지막은 다음에 어떻게 하면 좋을지 구체적 팁 1~2개 + 짧은 격려. 이모지 1개 정도만.

teacherFeedback (교사용):
- 받는 사람은 담당 선생님이다. 숫자와 근거를 충분히 담되 훑어볼 수 있게 쓴다.
- ★ 중심은 '발음이 자주 틀리는 단어' 다. 분량의 대부분을 여기에 쓴다.
  · 어떤 단어가 몇 점이었는지 적고, 무엇이 문제인지 짚는다 (강세 위치, 자음군, 모음 등).
  · 같은 단어가 여러 번 나오는데 점수가 들쭉날쭉하면 그 점을 지목한다 — 아직 그 단어가
    몸에 붙지 않았다는 뜻이라 선생님에게 쓸모가 있다.
  · 여러 단어가 같은 소리에서 걸리면 단어를 나열만 하지 말고 그 소리를 묶어서 말한다.
- 점수 요약은 한두 문장으로 그친다. 특히 억양(prosody)은 **중심이 아니다.** 점수를 한 번
  언급하는 정도로 끝내고, 억양 이야기로 문단을 채우지 않는다. 선생님이 수업에서 바로
  손쓸 수 있는 것은 단어 발음 쪽이다.
- ★ 억양이 N/A 이면 억양에 대해 **아무 말도 하지 않는다.** 대체 채점 엔진이 쓰여 측정되지
  않은 것이지, 억양이 나빴다는 뜻이 아니다. 없는 점수를 추측해 적지 말 것.
- ★ 취약 단어에 'Insertion' 이 있으면 반드시 따로 짚는다. 지문에 없는 말을 한 것이다
  (읽기 전 자기 소개, 혼잣말, 중간에 다시 읽기 등). 점수가 깎이는 원인이고 선생님이
  한마디 해 주면 바로 고쳐지는 부분이라, 묻히면 안 된다.
- ★ '인식된 발화'는 기계가 받아적은 것이라 틀릴 수 있다. 특히 'Omission' 에는 학생이
  실제로는 읽었는데 인식만 안 된 경우가 섞인다. "안 읽었습니다" 처럼 단정하지 말고
  "~가 인식되지 않았습니다(실제 발음 확인 필요)" 처럼 적는다.
- 지도 포인트를 2~3개 적는다. 수업 중에 바로 써먹을 수 있는 것으로, 위에서 짚은 단어와
  이어지게 쓴다 (억양 교정보다 단어 발음 쪽을 우선한다).
- 마지막에 "학부모 안내 문구 초안:" 한 단락(정중한 존댓말, 3~4문장).
  · 점수 숫자를 나열하지 말고 읽기가 어땠는지를 말한다.
  · 집에서 할 연습 방법을 세세히 적지 말 것 — 학원에서 스피킹을 따로 지도하지 않는다.

공통 주의:
- 이번 녹음 1건의 점수만 주어진다. 과거 이력·제출률·성실도는 알 수 없으므로 절대 추측해
  단정하지 말 것("그동안 자주 빠졌다", "제출률이 낮다" 같은 표현 금지).
- 학생이 최근 등록한 신입생이면 적응 단계임을 감안해 환영과 첫걸음 격려를 담고,
  이전 학습 이력이 있는 것처럼 말하지 않는다.

★★ 이름 규칙 (어기면 그 피드백은 폐기된다)
1. ★★ 이름을 지어내지 마라. 실제로 '지호야', '민준아' 같은 없는 이름을 붙여 내보낸
   사고가 있었다. 아래 [학생 이름] 에 적힌 글자 말고는 **어떤 사람 이름도 쓸 수 없다.**
   다정하게 들리게 하려고 이름을 만들어 붙이는 것이 가장 흔한 실수다. 하지 마라.
2. [학생 이름] 에 이름이 있으면 그 이름만, 한 글자도 바꾸지 말고 쓴다.
3. [학생 이름] 이 '없음' 이면 **이름도 호칭도 쓰지 않는다.** "학생", "친구", "○○야" 모두
   금지. 부르는 말 없이 바로 내용을 말한다. (예: "이번엔 지문을 끝까지 읽었어요")
4. 인식된 발화나 지문에 사람 이름처럼 보이는 말이 있어도 그것은 학생 이름이 아니다.

이름이 확실하지 않으면 **쓰지 않는 쪽을 고른다.** 이름 없는 피드백은 아무 문제가 없지만,
틀린 이름은 학생과 학부모가 바로 알아차린다.`;

  const user = buildFeedbackPrompt(scores, referenceText, context);

  // 한 번 실패하면 한 번 더 시도한다. 그래도 안 되면 예외를 던진다 — 예전에는
  // 여기서 '녹음이 잘 제출되었어요!' 같은 기본 문구를 넣어 내보냈는데, 그러면
  // 학생은 성의 없는 피드백을 받고 선생님은 실패한 줄도 모른다.
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await requestFeedback(key, model, system, user);
    } catch (e) {
      lastError = e;
      console.error(`[피드백] ${attempt}차 생성 실패:`, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("피드백 생성 실패");
}

// 응답 형식을 JSON 스키마로 고정한다. 모델이 설명을 덧붙이거나 따옴표를
// 잘못 써서 JSON 이 깨지는 일이 없다.
const FEEDBACK_SCHEMA = {
  type: "object",
  properties: {
    studentFeedback: { type: "string" },
    teacherFeedback: { type: "string" },
  },
  required: ["studentFeedback", "teacherFeedback"],
  additionalProperties: false,
} as const;

async function requestFeedback(
  key: string,
  model: string,
  system: string,
  user: string,
): Promise<TwoTierFeedback> {
  // 무한 대기 방지용 상한 (초과 시 점수만 저장되고 피드백은 생략된다)
  const ac = new AbortController();
  const cutoff = setTimeout(() => ac.abort(), 90_000);
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        // 요즘 모델은 답을 쓰기 전에 먼저 생각(thinking)하고, 그 분량도 이 한도에서
        // 깎인다. 예전 값(2500)은 생각만 하다 한도가 끝나 빈 응답이 오는 일이 있었다.
        max_tokens: 16000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: {
          format: { type: "json_schema", schema: FEEDBACK_SCHEMA },
        },
      }),
      signal: ac.signal,
    });
  } finally {
    clearTimeout(cutoff);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Claude 피드백 실패 (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await logUsage("claude_feedback", {
    model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  });

  if (data.stop_reason === "refusal") {
    throw new Error("Claude 가 피드백 생성을 거절했어요 (refusal)");
  }
  const text = (data.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();

  const parsed = parseFeedback(text);
  if (!parsed.studentFeedback || !parsed.teacherFeedback) {
    throw new Error(
      `피드백 응답을 읽지 못했어요 (stop_reason=${data.stop_reason ?? "?"}, ${text.length}자)`,
    );
  }
  return parsed;
}

// 스키마로 형식을 고정했지만, 한도에 걸려 끝이 잘린 응답에서도 학생용만큼은
// 건질 수 있게 필드 값을 따로 뽑아 본다. 못 건지면 빈 값 — 기본 문구로 채우지 않는다.
function parseFeedback(text: string): TwoTierFeedback {
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try {
    const obj = JSON.parse(raw);
    return {
      studentFeedback: String(obj.studentFeedback ?? "").trim(),
      teacherFeedback: String(obj.teacherFeedback ?? "").trim(),
    };
  } catch {
    return {
      studentFeedback: extractField(text, "studentFeedback"),
      teacherFeedback: extractField(text, "teacherFeedback"),
    };
  }
}

// 잘린 JSON 에서도 "field": "..." 의 값 문자열만 뽑아 이스케이프 해제
function extractField(text: string, field: string): string {
  const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "m");
  const m = text.match(re);
  if (!m) return "";
  const body = m[1];
  try {
    return JSON.parse(`"${body}"`).trim();
  } catch {
    return body
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  }
}
