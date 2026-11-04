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
- 받는 사람은 담당 선생님이다. 훑어볼 수 있게 4~6문장으로 짧게.
- 점수 요약과 자주 틀린 단어를 묶어서 말한다. 같은 음소에서 반복해 틀리면 단어를
  나열만 하지 말고 그 음소를 지목한다.
- ★ 억양이 N/A 이면 억양에 대해 **아무 말도 하지 않는다.** 대체 채점 엔진이 쓰여 측정되지
  않은 것이지, 억양이 나빴다는 뜻이 아니다. 없는 점수를 추측해 적지 말 것.
- ★ 취약 단어에 'Insertion' 이 있으면 반드시 따로 짚는다. 지문에 없는 말을 한 것이다
  (읽기 전 자기 소개, 혼잣말, 중간에 다시 읽기 등). 점수가 깎이는 원인이고 선생님이
  한마디 해 주면 바로 고쳐지는 부분이라, 묻히면 안 된다.
- ★ '인식된 발화'는 기계가 받아적은 것이라 틀릴 수 있다. 특히 'Omission' 에는 학생이
  실제로는 읽었는데 인식만 안 된 경우가 섞인다. "안 읽었습니다" 처럼 단정하지 말고
  "~가 인식되지 않았습니다(실제 발음 확인 필요)" 처럼 적는다.
- 마지막에 "학부모 안내 문구 초안:" 한 단락(정중한 존댓말, 3~4문장).
  · 점수 숫자를 나열하지 말고 읽기가 어땠는지를 말한다.
  · 집에서 할 연습 방법을 세세히 적지 말 것 — 학원에서 스피킹을 따로 지도하지 않는다.

공통 주의:
- 이번 녹음 1건의 점수만 주어진다. 과거 이력·제출률·성실도는 알 수 없으므로 절대 추측해
  단정하지 말 것("그동안 자주 빠졌다", "제출률이 낮다" 같은 표현 금지).
- 학생이 최근 등록한 신입생이면 적응 단계임을 감안해 환영과 첫걸음 격려를 담고,
  이전 학습 이력이 있는 것처럼 말하지 않는다.

★★ 이름 규칙 (반드시 지킨다)
- [학생 이름] 으로 주어진 이름만 쓸 수 있다. 그 이름을 한 글자도 바꾸지 않는다.
- [학생 이름] 이 없으면 **어떤 이름도 쓰지 않는다.** "학생", "친구" 같은 호칭도 붙이지 말고
  이름 없이 바로 내용을 말한다. (예: "이번 녹음은 ~했어요")
- ★ '인식된 발화'는 학생이 지문을 읽은 것을 받아적은 것이다. 거기에 사람 이름처럼 보이는
  말이 섞여 있어도 **그것을 학생 이름으로 쓰지 않는다.** 지문에 나오는 등장인물 이름도
  학생 이름이 아니다. 이름을 지어내는 것은 절대 금지다.`;

  const user = buildFeedbackPrompt(scores, referenceText, context);

  // 무한 대기 방지용 상한 (초과 시 점수만 저장되고 피드백은 생략된다)
  const ac = new AbortController();
  const cutoff = setTimeout(() => ac.abort(), 60000);
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
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: user }],
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
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  await logUsage("claude_feedback", {
    model,
    inputTokens: data.usage?.input_tokens,
    outputTokens: data.usage?.output_tokens,
  });
  const text =
    data.content
      ?.map((c) => c.text ?? "")
      .join("")
      .trim() ?? "";

  return parseFeedback(text);
}

function parseFeedback(text: string): TwoTierFeedback {
  // 1) 정상 JSON 파싱 시도 (코드펜스 등 대응)
  const match = text.match(/\{[\s\S]*\}/);
  const raw = match ? match[0] : text;
  try {
    const obj = JSON.parse(raw);
    return {
      studentFeedback: String(obj.studentFeedback ?? "").trim(),
      teacherFeedback: String(obj.teacherFeedback ?? "").trim(),
    };
  } catch {
    // 2) 파싱 실패(예: 토큰 초과로 JSON 끝이 잘림) → 필드 값만 정규식으로 구제
    const student = extractField(text, "studentFeedback");
    const teacher = extractField(text, "teacherFeedback");
    if (student || teacher) {
      return {
        studentFeedback:
          student || "녹음이 잘 제출되었어요! 다음에도 또박또박 읽어봐요 🙂",
        teacherFeedback: teacher || student || "",
      };
    }
    // 3) 그래도 안 되면 원본 기호 노출 방지: 기본 학생 메시지 + 정리된 텍스트
    return {
      studentFeedback: "녹음이 잘 제출되었어요! 다음에도 또박또박 읽어봐요 🙂",
      teacherFeedback: text.replace(/[{}"]/g, "").trim(),
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
