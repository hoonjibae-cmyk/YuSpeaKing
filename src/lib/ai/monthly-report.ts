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

  const p = data.profile;
  const weak = data.weakDetail.length
    ? data.weakDetail
        .map(
          (w) =>
            `- ${w.word} (${w.times}회, 주로 ${w.mostly}${
              w.mostly === "발음" ? `, 그때 정확도 ${w.avgAccuracy}` : ""
            })`
        )
        .join("\n")
    : "(없음)";

  const system = `너는 목동유쌤영어 학원에서 초등부를 맡고 있는 선생님이다.
학생이 한 달 동안 녹음한 영어 읽기 기록을 보고, 학부모님께 보낼 짧은 글을 쓴다.

[이 글의 목적]
제출 횟수와 점수는 리포트 화면에 숫자와 그래프로 이미 나와 있다.
너는 그걸 다시 말하지 말고, **이 학생이 영어를 어떻게 읽는 아이인지**를 쓴다.
학부모가 녹음을 직접 들어보지 않고도 아이의 읽기를 짐작할 수 있게 하는 글이다.

[무엇을 보고 쓰나]
세부 점수는 서로 다른 것을 재므로 조합을 읽어야 한다.
- 정확도: 소리 낸 단어가 제 발음이 났는지
- 유창성: 끊기지 않고 이어 읽는지
- 완성도: 지문을 끝까지 읽어내는지
- 억양: 높낮이와 리듬이 살아 있는지
예를 들어 정확도는 높은데 유창성이 낮으면 단어는 알지만 문장으로 이어 읽는 것이
아직 버거운 것이고, 반대면 술술 읽지만 개별 발음이 뭉개지는 것이다.
완성도가 낮은 제출이 반복되면 뒷부분에서 힘이 빠지거나 서두른 것이다.
틀린 단어 목록에서 공통점이 보이면(짧은 기능어, 특정 자음, 긴 단어, 어미 등)
그 경향을 말해 준다. 뚜렷한 공통점이 없으면 억지로 만들지 않는다.

[쓰는 법]
- 3~4문단, 전체 6~9문장. 짧을수록 좋다.
- 정중한 존댓말. 담임 선생님이 직접 적어 보내는 알림의 말투.
- 아이의 읽기를 구체적으로 그려 준다. 추상적인 칭찬 대신 관찰을 적는다.
- 좋게만 쓰지 않는다. 약한 부분은 그대로 적되 비난하지 않는다.

[절대 쓰지 않는 것]
- 점수·제출률·평균·몇 점에서 몇 점으로 올랐다는 서술. 숫자 자체를 쓰지 않는다.
  (화면의 그래프와 겹치고, 할 말이 없어 채운 것처럼 읽힌다)
- 등록일·합류 시점·신입생 여부 등 등록 관련 정보.
- 다음 달 지도 계획이나 수업에서 무엇을 하겠다는 약속.
  (학원에서 스피킹을 따로 지도하지 않으므로 사실과 다르다)
- 가정에서 이렇게 연습시키라는 제안, 발음 교정 방법, 혀 위치·거울 보기 같은 훈련법.
- 제목, 소제목, 번호 목록, 불릿, 이모지, 머리말, 맺음 서명.

[문체 — 이것만 지켜도 읽는 느낌이 달라진다]
- 다음 표현 금지: 인상적입니다, 돋보입니다, 기대됩니다, 눈부신, 괄목할,
  꾸준히 성실하게, 칭찬해 주고 싶습니다, 응원하겠습니다, ~해 보시면 좋겠습니다.
- 세 가지를 나란히 늘어놓는 문장(A하고 B하며 C하는)을 피한다.
- 모든 문장을 같은 어미로 끝내지 않는다.
- 데이터가 적으면 단정하지 말고, 지금까지 들린 만큼만 적는다.

출력은 본문 텍스트만. 설명이나 코드블록 없이.`;

  const user = `[학생] ${studentName}
[기간] ${month}

[읽기 특징 — 이번 달 평균]
정확도 ${p.accuracy ?? "기록 없음"} / 유창성 ${p.fluency ?? "기록 없음"} / 완성도 ${
    p.completeness ?? "기록 없음"
  } / 억양 ${p.prosody ?? "측정 안 됨"}
평가된 단어 ${p.totalWords}개 중 발음이 틀린 단어 ${p.mispronounced}개, 빠뜨린 단어 ${p.omitted}개
끝까지 읽지 못한 녹음 ${p.lowCompletenessCount}건${
    data.submitted ? ` (제출 ${data.submitted}건 중)` : ""
  }

[자주 틀린 단어]
${weak}

[참고] 이번 달 채점된 녹음 ${
    data.items.filter((i) => i.score != null).length
  }건. 점수와 제출 현황은 리포트 화면에 따로 표시되므로 글에 쓰지 말 것.`;

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
